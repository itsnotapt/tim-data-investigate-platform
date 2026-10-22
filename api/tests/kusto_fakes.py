"""Kusto as TIM's tests see it: the SDK client faked behind ``KustoHook.client_factory``, OBO
faked at ``token_for``, and a TIM client with Kusto connections from a connections file."""

import threading
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import httpx2 as httpx
import pytest
from app_factory import AuthKit, create_test_app
from azure.kusto.data import ClientRequestProperties
from azure.kusto.data import exceptions as kusto_exc

from tim_api.auth.dependencies import get_obo_provider
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


@asynccontextmanager
async def open_client(
    auth: AuthKit,
    obo: FakeObo | AzureObo,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    *,
    cluster: str = CLUSTER,
    database: str = "Samples",
    actions_dir: Path | None = None,
) -> AsyncIterator[httpx.AsyncClient]:
    """A client of TIM with one Kusto connection, ``security``, on ``cluster``, and the action
    files of ``actions_dir``."""
    path = tmp_path / "connections.yaml"
    path.write_text(connections_file(cluster, database))
    monkeypatch.setenv("TIM_CONNECTIONS_FILE", str(path))
    monkeypatch.setenv("TIM_RUN_TIMEOUT_SECONDS", "60")
    if actions_dir is not None:
        monkeypatch.setenv("TIM_ACTIONS_DIR", str(actions_dir))
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
