"""Run KQL (``tim.run_kql``) over ``/api/runs``, on a Kusto connection from the connections file.
OBO is faked at ``token_for``, and Kusto at the SDK client."""

import asyncio
import os
import threading
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import httpx2 as httpx
import pytest
from app_factory import AuthKit, create_test_app
from azure.kusto.data import ClientRequestProperties
from azure.kusto.data import exceptions as kusto_exc
from tim_actions.kusto import KustoHook

from tim_api.auth.dependencies import get_obo_provider
from tim_api.auth.obo import OboAuthError, OboUnavailableError, OboUpstreamError
from tim_api.auth.principal import Principal
from tim_api.storage import MemoryStorage

ALICE = "alice@example.com"
CLUSTER = "https://help.kusto.windows.net"


def connections_file(cluster: str, database: str) -> str:
    return f"""\
- name: security
  title: Security
  type: kusto
  auth: obo
  cluster: {cluster}/
  databases: [{database}]
"""


def table(kind: str, columns: list[tuple[str, str]], rows: list[list[Any]]) -> Any:
    """A table of the SDK's parsed V2 response, with Kusto's raw JSON values."""
    return SimpleNamespace(
        table_kind=SimpleNamespace(value=kind),
        table_name=kind,
        raw_columns=[{"ColumnName": n, "ColumnType": t} for n, t in columns],
        raw_rows=rows,
    )


STATS = table(
    "QueryCompletionInformation",
    [("LevelName", "string"), ("Payload", "string")],
    [
        ["Info", "{}"],
        [
            "Stats",
            '{"ExecutionTime": 0.25, "resource_usage": {"cpu": {"total cpu": "00:00:00.0312500"},'
            ' "memory": {"peak_per_node": 1048576}}, "input_dataset_statistics":'
            ' {"extents": {"total": 10, "scanned": 4}}}',
        ],
    ],
)

STORMS = table(
    "PrimaryResult",
    [
        ("EventId", "long"),
        ("State", "string"),
        ("StartTime", "datetime"),
        ("Duration", "timespan"),
        ("Damage", "real"),
        ("Fatal", "bool"),
        ("Extra", "dynamic"),
    ],
    [
        [61032, "ATLANTIC SOUTH", "2007-09-29T08:11:00Z", "00:30:00", 1.5, False, {"a": 1}],
        [60904, "FLORIDA", "2007-09-18T20:00:00.1000000Z", "1.00:00:00", 0, True, None],
    ],
)


class FakeKusto:
    """Kusto as the SDK client sees it: each query answered with ``tables``, or ``error``
    raised. With ``hold``, a query waits until a ``.cancel query`` names its request id."""

    def __init__(self) -> None:
        self.tables: list[Any] = [STORMS, STATS]
        self.error: Exception | None = None
        self.hold = False
        self.clients: list[tuple[str, str]] = []
        self.queries: list[tuple[str, str, ClientRequestProperties]] = []
        self.commands: list[tuple[str | None, str]] = []
        self.querying = threading.Event()
        self._cancelled: set[str] = set()
        self._cancel = threading.Condition()

    def client(self, cluster: str, token: str) -> "FakeKusto.Client":
        self.clients.append((cluster, token))
        return FakeKusto.Client(self)

    class Client:
        def __init__(self, kusto: "FakeKusto") -> None:
            self._kusto = kusto

        def execute_query(
            self, database: str, query: str, properties: ClientRequestProperties
        ) -> Any:
            kusto = self._kusto
            kusto.queries.append((database, query, properties))
            kusto.querying.set()
            if kusto.hold:
                with kusto._cancel:
                    kusto._cancel.wait_for(
                        lambda: properties.client_request_id in kusto._cancelled, timeout=10
                    )
                raise kusto_exc.KustoServiceError("Query was cancelled")
            if kusto.error is not None:
                raise kusto.error
            return SimpleNamespace(tables=kusto.tables)

        def execute_mgmt(
            self, database: str | None, query: str, properties: ClientRequestProperties
        ) -> Any:
            kusto = self._kusto
            kusto.commands.append((database, query))
            if query.startswith(".cancel query "):
                with kusto._cancel:
                    kusto._cancelled.add(query.removeprefix(".cancel query ").strip('"'))
                    kusto._cancel.notify_all()
            return SimpleNamespace(tables=[])

        def close(self) -> None:
            pass


class FakeObo:
    """The OBO exchange, faked at ``token_for``: a token naming the analyst and the scope."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []
        self.error: Exception | None = None

    def token_for(self, principal: Principal, scope: str) -> str:
        if self.error is not None:
            raise self.error
        self.calls.append((principal.name, scope))
        return f"obo:{principal.name}:{scope}"


class AzureObo:
    """Stands in for the OBO exchange in the live test: the token is the test's own identity's,
    from ``DefaultAzureCredential``."""

    def __init__(self) -> None:
        from azure.identity import DefaultAzureCredential

        self._credential = DefaultAzureCredential()

    def token_for(self, principal: Principal, scope: str) -> str:
        return self._credential.get_token(scope).token


class Env:
    def __init__(self, client: httpx.AsyncClient, kusto: FakeKusto, obo: FakeObo) -> None:
        self.client = client
        self.kusto = kusto
        self.obo = obo

    async def start(self, **params: Any) -> httpx.Response:
        body = {"action": "tim.run_kql", "params": {"connection": "security", **params}}
        return await self.client.post("/api/runs", json=body)

    async def wait(self, run_id: str) -> dict[str, Any]:
        async with asyncio.timeout(10):
            while True:
                body: dict[str, Any] = (await self.client.get(f"/api/runs/{run_id}")).json()
                if body["status"] != "running":
                    return body
                await asyncio.sleep(0.02)


@pytest.fixture
def kusto(monkeypatch: pytest.MonkeyPatch) -> FakeKusto:
    fake = FakeKusto()
    monkeypatch.setattr(KustoHook, "client_factory", staticmethod(fake.client))
    return fake


@asynccontextmanager
async def open_client(
    auth: AuthKit,
    obo: FakeObo | AzureObo,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    *,
    cluster: str = CLUSTER,
    database: str = "Samples",
) -> AsyncIterator[httpx.AsyncClient]:
    """A client of TIM with one Kusto connection, ``security``, on ``cluster``."""
    path = tmp_path / "connections.yaml"
    path.write_text(connections_file(cluster, database))
    monkeypatch.setenv("TIM_CONNECTIONS_FILE", str(path))
    monkeypatch.setenv("TIM_RUN_TIMEOUT_SECONDS", "60")
    app = create_test_app(
        storage_factory=lambda _s: MemoryStorage(), race_seconds=0.5, providers=None
    )
    auth.install(app)
    app.dependency_overrides[get_obo_provider] = lambda: obo
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://t", headers=auth.headers(ALICE, "oid-a")
        ) as client:
            yield client


@pytest.fixture
async def env(
    auth: AuthKit, kusto: FakeKusto, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[Env]:
    obo = FakeObo()
    async with open_client(auth, obo, tmp_path, monkeypatch) as client:
        yield Env(client, kusto, obo)


async def test_run_kql_returns_the_querys_rows_as_the_analyst(env: Env) -> None:
    started = await env.start(database="Samples", kql="StormEvents | take 2", idColumn="EventId")
    assert started.status_code == 200
    run = started.json()
    assert run["status"] == "succeeded"
    assert run["rowCount"] == 2
    assert run["columns"] == [
        {"name": "EventId", "type": "number", "declared": True},
        {"name": "State", "type": "string", "declared": True},
        {"name": "StartTime", "type": "datetime", "declared": True},
        {"name": "Duration", "type": "timespan", "declared": True},
        {"name": "Damage", "type": "number", "declared": True},
        {"name": "Fatal", "type": "boolean", "declared": True},
        {"name": "Extra", "type": "json", "declared": True},
    ]
    assert {k: v for k, v in run["details"].items() if k not in ("duration", "rowCount")} == {
        "executionTime": 0.25,
        "cpuTime": "00:00:00.0312500",
        "memoryPeakPerNode": 1048576,
        "extentsScanned": 4,
        "extentsTotal": 10,
    }

    rows = (await env.client.get(f"/api/runs/{run['runId']}/rows")).json()["rows"]
    assert [(r["id"], r["data"]) for r in rows] == [
        (
            "61032",
            {
                "EventId": 61032,
                "State": "ATLANTIC SOUTH",
                "StartTime": "2007-09-29T08:11:00Z",
                "Duration": "00:30:00",
                "Damage": 1.5,
                "Fatal": False,
                "Extra": {"a": 1},
            },
        ),
        (
            "60904",
            {
                "EventId": 60904,
                "State": "FLORIDA",
                "StartTime": "2007-09-18T20:00:00.1Z",
                "Duration": "1.00:00:00",
                "Damage": 0,
                "Fatal": True,
                "Extra": None,
            },
        ),
    ]

    scope = f"{CLUSTER}/.default"
    assert env.kusto.clients == [(CLUSTER, f"obo:{ALICE}:{scope}")]
    [(database, kql, properties)] = env.kusto.queries
    assert (database, kql) == ("Samples", "StormEvents | take 2")
    timeout: Any = properties.get_option(ClientRequestProperties.request_timeout_option_name, None)
    assert timedelta(seconds=50) < timeout <= timedelta(seconds=60)
    assert env.obo.calls[0] == (ALICE, scope)


async def test_without_an_id_column_the_rows_have_no_id(env: Env) -> None:
    run = (await env.start(database="Samples", kql="StormEvents | take 2")).json()
    rows = (await env.client.get(f"/api/runs/{run['runId']}/rows")).json()["rows"]
    assert [row.get("id") for row in rows] == [None, None]


async def test_cancel_cancels_the_query_on_kusto(env: Env) -> None:
    env.kusto.hold = True
    started = await env.start(database="Samples", kql="StormEvents")
    assert started.status_code == 202
    run_id = started.json()["runId"]
    assert await asyncio.to_thread(env.kusto.querying.wait, 5)

    cancelled = await env.client.post(f"/api/runs/{run_id}/cancel")
    assert cancelled.status_code == 200
    assert (await env.wait(run_id))["status"] == "cancelled"
    [(_, _, properties)] = env.kusto.queries
    assert env.kusto.commands == [("Samples", f'.cancel query "{properties.client_request_id}"')]


async def test_a_kusto_error_ends_the_run_with_its_message(env: Env) -> None:
    env.kusto.error = kusto_exc.KustoServiceError(
        "Semantic error: 'StormEvent' could not be resolved\n   at Kusto.Engine.Run()"
    )
    run = (await env.start(database="Samples", kql="StormEvent")).json()
    assert run["status"] == "error"
    assert run["error"] == "Semantic error: 'StormEvent' could not be resolved"


@pytest.mark.parametrize(
    ("error", "status", "detail"),
    [
        (
            OboAuthError("consent"),
            403,
            "Consent or sign-in is required for the downstream service",
        ),
        (OboUpstreamError("down"), 502, "The identity provider could not be reached"),
        (OboUnavailableError("no token"), 503, "Token exchange is not available"),
    ],
)
async def test_an_obo_error_answers_the_post_and_starts_no_run(
    env: Env, error: Exception, status: int, detail: str
) -> None:
    env.obo.error = error
    response = await env.start(database="Samples", kql="StormEvents")
    assert (response.status_code, response.json()["detail"]) == (status, detail)
    assert env.kusto.queries == []


async def test_an_unknown_connection_is_unprocessable(env: Env) -> None:
    response = await env.start(connection="nowhere", database="Samples", kql="StormEvents")
    assert response.status_code == 422
    assert set(response.json()["errors"]) == {"params.connection"}
    assert env.obo.calls == []


@pytest.mark.kusto
@pytest.mark.skipif(
    not os.environ.get("TIM_TEST_KUSTO_CLUSTER"), reason="TIM_TEST_KUSTO_CLUSTER not set"
)
async def test_run_kql_on_a_real_cluster(
    auth: AuthKit, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Needs an ``AZURE_*`` identity that can query ``TIM_TEST_KUSTO_QUERY_DATABASE``."""
    cluster = os.environ["TIM_TEST_KUSTO_CLUSTER"].rstrip("/")
    database = os.environ.get("TIM_TEST_KUSTO_QUERY_DATABASE", "Samples")
    async with open_client(
        auth, AzureObo(), tmp_path, monkeypatch, cluster=cluster, database=database
    ) as client:
        body = {
            "action": "tim.run_kql",
            "params": {
                "connection": "security",
                "database": database,
                "kql": "print n = 1, s = 'x'",
                "idColumn": "n",
            },
        }
        run = (await client.post("/api/runs", json=body)).json()
        async with asyncio.timeout(60):
            while run["status"] == "running":
                await asyncio.sleep(0.5)
                run = (await client.get(f"/api/runs/{run['runId']}")).json()
        assert run["status"] == "succeeded", run.get("error")
        assert [(c["name"], c["type"]) for c in run["columns"]] == [
            ("n", "number"),
            ("s", "string"),
        ]
        assert "executionTime" in run["details"]
        rows = (await client.get(f"/api/runs/{run['runId']}/rows")).json()["rows"]
        assert [(r["id"], r["data"]) for r in rows] == [("1", {"n": 1, "s": "x"})]
