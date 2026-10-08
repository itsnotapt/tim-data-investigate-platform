import asyncio
import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import httpx2 as httpx
import pytest
from pydantic import SecretStr

from tim_api.auth import Principal, get_current_principal
from tim_api.auth.dependencies import get_obo_provider
from tim_api.auth.obo import OboAuthError
from tim_api.kusto.query_client import (
    KustoQueryClient,
    KustoQueryError,
    KustoResultLimitError,
    QueryResult,
    ResultLimits,
    get_kusto_client,
)
from tim_api.main import create_app
from tim_api.query_runs import runner
from tim_api.query_runs.models import (
    KustoQueryEcho,
    KustoQueryRun,
    KustoQueryStats,
    QueryRunStatus,
)
from tim_api.query_runs.runner import NUL_REPLACEMENT, sanitise_nul
from tim_api.storage import Storage

CLUSTER = "https://c1.westeurope.kusto.windows.net"
ALICE = Principal(oid="a", name="alice@example.com", tenant_id="t", token=SecretStr("x"))
BOB = Principal(oid="b", name="bob@example.com", tenant_id="t", token=SecretStr("y"))
BODY = {"cluster": CLUSTER, "database": "Sec", "query": "T | take 1"}


class FakeObo:
    def __init__(self) -> None:
        self.calls: list[str] = []
        self.error: Exception | None = None

    async def get_token(self, principal: Principal, cluster_url: str) -> str:
        if self.error:
            raise self.error
        self.calls.append(cluster_url)
        return "kusto-token"


class FakeKusto:
    def __init__(self) -> None:
        self.rows: list[dict[str, Any]] = [{"a": 1}]
        self.metrics = KustoQueryStats(execution_time=0.5)
        self.error: Exception | None = None
        self.gate: asyncio.Event | None = None
        self.calls: list[tuple[Any, ...]] = []

    async def execute(
        self,
        cluster_url: str,
        database: str,
        query: str,
        token: str,
        start: datetime | None,
        end: datetime | None,
        limits: ResultLimits,
    ) -> QueryResult:
        self.calls.append((cluster_url, database, query, token, start, end, limits))
        if self.gate is not None:
            await self.gate.wait()
        if self.error:
            raise self.error
        return QueryResult(rows=self.rows, execution_metrics=self.metrics)


class Env:
    def __init__(self, client: httpx.AsyncClient, kusto: FakeKusto, obo: FakeObo, who: list[Any]):
        self.client = client
        self.kusto = kusto
        self.obo = obo
        self._who = who

    def as_user(self, principal: Principal) -> None:
        self._who[0] = principal


@pytest.fixture
async def env(storage: Storage, monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[Env]:
    monkeypatch.setattr("tim_api.main.build_storage", lambda _s: storage)
    monkeypatch.setattr(runner, "RACE_SECONDS", 0.2)
    kusto, obo, who = FakeKusto(), FakeObo(), [ALICE]
    app = create_app()
    app.dependency_overrides[get_current_principal] = lambda: who[0]
    app.dependency_overrides[get_obo_provider] = lambda: obo
    fake: KustoQueryClient = kusto  # type: ignore[assignment]
    app.dependency_overrides[get_kusto_client] = lambda: fake
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            yield Env(client, kusto, obo, who)


async def test_fast_query_returns_200_completed(env: Env) -> None:
    r = await env.client.post("/api/kusto/query", json={**BODY, "requestedBy": "mallory"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "completed"
    assert body["resultData"] == [{"a": 1}]
    assert body["executionMetrics"]["execution_time"] == 0.5
    assert body["kustoQuery"]["requestedBy"] == "alice@example.com"
    assert body["kustoQuery"]["cluster"] == CLUSTER
    assert "stackTrace" not in body
    assert env.obo.calls == [CLUSTER]
    assert env.kusto.calls[0][3] == "kusto-token"
    got = await env.client.get(f"/api/kusto/query/{body['queryRunId']}")
    assert got.status_code == 200
    assert got.json() == body


async def test_slow_query_202_then_200(env: Env) -> None:
    env.kusto.gate = asyncio.Event()
    r = await env.client.post("/api/kusto/query", json=BODY)
    assert r.status_code == 202
    run = r.json()
    assert run["status"] == "created"
    assert run["resultData"] is None
    url = f"/api/kusto/query/{run['queryRunId']}"
    polled = await env.client.get(url)
    assert polled.status_code == 202
    env.kusto.gate.set()
    for _ in range(50):
        polled = await env.client.get(url)
        if polled.status_code == 200:
            break
        await asyncio.sleep(0.02)
    assert polled.status_code == 200
    assert polled.json()["status"] == "completed"


async def test_kusto_error_has_no_stack(env: Env) -> None:
    env.kusto.error = KustoQueryError("Failed to resolve table 'Nope'\n   at Kusto.Foo.Bar()")
    r = await env.client.post("/api/kusto/query", json=BODY)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "error"
    assert body["resultData"] is None
    assert body["mainError"] == "Failed to resolve table 'Nope'"
    assert "Kusto.Foo" not in r.text
    assert "Traceback" not in r.text


async def test_result_limit_error(env: Env) -> None:
    env.kusto.error = KustoResultLimitError("Result exceeds limit of 5 rows")
    body = (await env.client.post("/api/kusto/query", json=BODY)).json()
    assert body["status"] == "error"
    assert body["mainError"] == "Result exceeds limit of 5 rows"


async def test_unexpected_error_is_generic(env: Env, caplog: pytest.LogCaptureFixture) -> None:
    env.kusto.error = RuntimeError("secret connection string")
    r = await env.client.post("/api/kusto/query", json=BODY)
    body = r.json()
    assert body["status"] == "error"
    assert body["mainError"] == runner.GENERIC_ERROR_MESSAGE
    assert "secret" not in r.text
    assert "traceId=" in caplog.text


async def test_timeout_sets_timed_out(env: Env, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TIM_QUERY_TIMEOUT_SECONDS", "1")
    from tim_api.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setattr(runner, "RACE_SECONDS", 3.0)
    env.kusto.gate = asyncio.Event()  # never set
    r = await env.client.post("/api/kusto/query", json=BODY)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "timedOut"
    assert "time limit" in body["mainError"]
    assert body["resultData"] is None


async def test_other_users_run_is_404(env: Env) -> None:
    run_id = (await env.client.post("/api/kusto/query", json=BODY)).json()["queryRunId"]
    env.as_user(BOB)
    r = await env.client.get(f"/api/kusto/query/{run_id}")
    assert r.status_code == 404
    unknown = await env.client.get(f"/api/kusto/query/{uuid4()}")
    assert unknown.status_code == 404
    assert r.json()["detail"] == unknown.json()["detail"]


async def test_expired_run_is_404(env: Env, storage: Storage) -> None:
    run_id = (await env.client.post("/api/kusto/query", json=BODY)).json()["queryRunId"]
    run = await storage.runs.get_for_owner(UUID(run_id), ALICE.name, datetime.now(UTC))
    assert run is not None
    await storage.runs.update_result(
        run.query_run_id,
        status=QueryRunStatus.COMPLETED,
        expires_at=datetime.now(UTC) - timedelta(seconds=1),
    )
    assert (await env.client.get(f"/api/kusto/query/{run_id}")).status_code == 404


async def test_malformed_uuid_is_400(env: Env) -> None:
    r = await env.client.get("/api/kusto/query/not-a-guid")
    assert r.status_code == 400


async def test_start_after_end_is_400(env: Env) -> None:
    body = {**BODY, "startTime": "2026-03-14T00:00:00Z", "endTime": "2026-03-13T00:00:00Z"}
    r = await env.client.post("/api/kusto/query", json=body)
    assert r.status_code == 400
    assert env.obo.calls == []


async def test_bad_cluster_is_400_before_token(env: Env) -> None:
    r = await env.client.post("/api/kusto/query", json={**BODY, "cluster": "https://evil.example"})
    assert r.status_code == 400
    assert env.obo.calls == []
    assert env.kusto.calls == []


async def test_nul_in_query_is_400(env: Env) -> None:
    r = await env.client.post("/api/kusto/query", json={**BODY, "query": "T\u0000"})
    assert r.status_code == 400


async def test_obo_failure_is_synchronous_403(env: Env, storage: Storage) -> None:
    env.obo.error = OboAuthError("consent")
    r = await env.client.post("/api/kusto/query", json=BODY)
    assert r.status_code == 403
    assert env.kusto.calls == []


async def test_unauthenticated_is_401(storage: Storage, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("tim_api.main.build_storage", lambda _s: storage)
    app = create_app()
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            assert (await client.post("/api/kusto/query", json=BODY)).status_code == 401
            assert (await client.get(f"/api/kusto/query/{uuid4()}")).status_code == 401


async def test_nul_characters_are_sanitised_before_persisting(env: Env) -> None:
    env.kusto.rows = [{"a\u0000k": "x\u0000y", "n": [{"d": "\u0000"}], "i": 1}]
    body = (await env.client.post("/api/kusto/query", json=BODY)).json()
    assert body["status"] == "completed"
    assert body["resultData"] == [
        {f"a{NUL_REPLACEMENT}k": f"x{NUL_REPLACEMENT}y", "n": [{"d": NUL_REPLACEMENT}], "i": 1}
    ]
    again = (await env.client.get(f"/api/kusto/query/{body['queryRunId']}")).json()
    assert again == body
    assert "\\u0000" not in json.dumps(again)


async def test_nul_in_error_message_is_sanitised(env: Env) -> None:
    env.kusto.error = KustoQueryError("bad \u0000 thing")
    body = (await env.client.post("/api/kusto/query", json=BODY)).json()
    assert body["mainError"] == f"bad {NUL_REPLACEMENT} thing"


def test_sanitise_nul_leaves_other_values_alone() -> None:
    value = {"a": [1, 2.5, None, True, "ok"]}
    assert sanitise_nul(value) == value
    assert sanitise_nul("\x00") == NUL_REPLACEMENT


async def test_startup_sweep_marks_stale_runs(
    storage: Storage, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("tim_api.main.build_storage", lambda _s: storage)
    now = datetime.now(UTC)

    def make(age: timedelta) -> KustoQueryRun:
        return KustoQueryRun(
            query_run_id=uuid4(),
            status=QueryRunStatus.CREATED,
            kusto_query=KustoQueryEcho(
                cluster=CLUSTER, database="d", query="q", requested_by=ALICE.name
            ),
            execute_date_time_utc=now - age,
            expires_at=now + timedelta(days=1),
        )

    stale, fresh = make(timedelta(hours=1)), make(timedelta(seconds=5))
    await storage.runs.create(stale)
    await storage.runs.create(fresh)
    app = create_app()
    async with app.router.lifespan_context(app):
        got_stale = await storage.runs.get_for_owner(stale.query_run_id, ALICE.name, now)
        got_fresh = await storage.runs.get_for_owner(fresh.query_run_id, ALICE.name, now)
    assert got_stale is not None
    assert got_stale.status is QueryRunStatus.ERROR
    assert got_stale.main_error == "Run interrupted by server restart"
    assert got_fresh is not None
    assert got_fresh.status is QueryRunStatus.CREATED


async def test_shutdown_cancels_running_tasks_and_marks_error(
    storage: Storage, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("tim_api.main.build_storage", lambda _s: storage)
    monkeypatch.setattr(runner, "RACE_SECONDS", 0.05)
    kusto, obo = FakeKusto(), FakeObo()
    kusto.gate = asyncio.Event()
    app = create_app()
    app.dependency_overrides[get_current_principal] = lambda: ALICE
    app.dependency_overrides[get_obo_provider] = lambda: obo
    fake: KustoQueryClient = kusto  # type: ignore[assignment]
    app.dependency_overrides[get_kusto_client] = lambda: fake
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            r = await client.post("/api/kusto/query", json=BODY)
        assert r.status_code == 202
        assert len(app.state.run_tasks) == 1
    assert not app.state.run_tasks
    run = await storage.runs.get_for_owner(
        UUID(r.json()["queryRunId"]), ALICE.name, datetime.now(UTC)
    )
    assert run is not None
    assert run.status is QueryRunStatus.ERROR
