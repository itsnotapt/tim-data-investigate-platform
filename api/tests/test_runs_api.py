"""``/api/runs``: running actions on the server and reading their rows back."""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx2 as httpx
import pytest
from app_factory import AuthKit, create_test_app
from scripted_actions import (
    CancellableHook,
    Echo,
    Rows,
    SafeError,
    UndeclaredHook,
    Unexpected,
    WaitUntilCancelled,
)
from tim_actions import Column, Param, Provider

from tim_api.auth.dependencies import get_obo_provider
from tim_api.auth.principal import Principal
from tim_api.runs.models import RunStatus
from tim_api.storage import Storage

ALICE = "alice@example.com"
BOB = "bob@example.com"


FAKE_CONNECTIONS = Path(__file__).parent / "fixtures" / "connections" / "fake.yaml"


class FakeObo:
    """The OBO exchange, faked at ``token_for``."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def token_for(self, principal: Principal, scope: str) -> str:
        self.calls.append((principal.name, scope))
        return f"obo:{principal.name}:{scope}"


class Env:
    def __init__(
        self,
        client: httpx.AsyncClient,
        auth: AuthKit,
        storage: Storage,
        obo: FakeObo,
    ) -> None:
        self.client = client
        self.storage = storage
        self.obo = obo
        self._auth = auth

    def as_user(self, name: str, oid: str) -> None:
        self.client.headers.update(self._auth.headers(name, oid))

    async def start(self, action: str, params: dict[str, Any] | None = None) -> httpx.Response:
        return await self.client.post("/api/runs", json={"action": action, "params": params or {}})

    async def wait(self, run_id: str) -> dict[str, Any]:
        """Poll the run until it ends."""
        async with asyncio.timeout(10):
            while True:
                response = await self.client.get(f"/api/runs/{run_id}")
                assert response.status_code == 200
                body: dict[str, Any] = response.json()
                if body["status"] != "running":
                    return body
                await asyncio.sleep(0.02)

    async def rows(self, run_id: str, **query: int) -> httpx.Response:
        return await self.client.get(f"/api/runs/{run_id}/rows", params=query)

    @staticmethod
    async def hook() -> CancellableHook:
        """The latest hook built for the ``fake`` connection, once a run has built one."""
        async with asyncio.timeout(10):
            while not CancellableHook.built:  # noqa: ASYNC110 - no change signal
                await asyncio.sleep(0.01)
        return CancellableHook.built[-1]


@asynccontextmanager
async def open_env(
    storage: Storage, auth: AuthKit, actions: Sequence[Any], race_seconds: float = 0.5
) -> AsyncIterator[Env]:
    os.environ["TIM_CONNECTIONS_FILE"] = str(FAKE_CONNECTIONS)
    CancellableHook.built.clear()
    obo = FakeObo()
    app = create_test_app(
        storage_factory=lambda _s: storage,
        race_seconds=race_seconds,
        providers=[Provider(actions=actions, hooks=[CancellableHook])],
    )
    auth.install(app)
    app.dependency_overrides[get_obo_provider] = lambda: obo
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://t", headers=auth.headers(ALICE, "oid-a")
        ) as client:
            yield Env(client, auth, storage, obo)


SIGN_INS = Rows(
    key="acme.sign_ins",
    name="Sign-ins",
    pivot="none",
    id="CorrelationId",
    rows=(
        {"CorrelationId": "c-1", "User": "alice", "Count": 3},
        {"CorrelationId": "c-2", "User": "bob", "Count": 5},
        {"CorrelationId": "c-1", "User": "carol", "Count": 1},
    ),
)


async def test_a_run_goes_end_to_end_over_http(storage: Storage, auth: AuthKit) -> None:
    async with open_env(storage, auth, [SIGN_INS]) as env:
        started = await env.start("acme.sign_ins")
        assert started.status_code == 200
        run = started.json()
        assert run["status"] == "succeeded"
        assert run["action"] == {"key": "acme.sign_ins", "name": "Sign-ins"}
        assert run["owner"] == ALICE
        assert run["params"] == {}
        assert run["rowCount"] == 3
        assert list(run["details"])[:2] == ["duration", "rowCount"]
        assert run["details"]["rowCount"] == 3
        assert run["columns"] == [
            {"name": "CorrelationId", "type": "string", "declared": False},
            {"name": "User", "type": "string", "declared": False},
            {"name": "Count", "type": "number", "declared": False},
        ]
        assert "error" not in run
        assert {"startedAt", "finishedAt", "expiresAt"} <= set(run)

        polled = await env.client.get(f"/api/runs/{run['runId']}")
        assert polled.status_code == 200
        assert polled.json() == run

        first = await env.rows(run["runId"], startRow=0, endRow=2)
        assert first.status_code == 200
        assert first.json() == {
            "rows": [
                {
                    "row": 0,
                    "id": "c-1",
                    "data": {"CorrelationId": "c-1", "User": "alice", "Count": 3},
                },
                {
                    "row": 1,
                    "id": "c-2",
                    "data": {"CorrelationId": "c-2", "User": "bob", "Count": 5},
                },
            ],
            "lastRow": 3,
        }
        rest = await env.rows(run["runId"], startRow=2, endRow=10)
        assert rest.json()["rows"] == [
            {"row": 2, "id": "c-1", "data": {"CorrelationId": "c-1", "User": "carol", "Count": 1}}
        ]


# More than one batch, so some rows are stored before the run ends.
PARTIAL = tuple({"CorrelationId": f"c-{n}", "n": n} for n in range(1500))
WAITS = WaitUntilCancelled(key="acme.waits", name="Waits", pivot="none", rows=PARTIAL)


async def stored_rows_exist(env: Env, run_id: str) -> bool:
    from uuid import UUID

    return await env.storage.runs.has_rows(UUID(run_id))


async def wait_for_rows(env: Env, run_id: str) -> None:
    """Until the worker has written the partial rows."""
    async with asyncio.timeout(10):
        while not await stored_rows_exist(env, run_id):  # noqa: ASYNC110 - no change signal
            await asyncio.sleep(0.01)


async def test_cancel_calls_the_hook_from_another_thread_and_drops_partial_rows(
    storage: Storage, auth: AuthKit
) -> None:
    async with open_env(storage, auth, [WAITS], race_seconds=0.1) as env:
        started = await env.start("acme.waits")
        assert started.status_code == 202
        hook = await env.hook()
        run = started.json()
        assert run["status"] == "running"
        assert "finishedAt" not in run
        assert run["details"] == {}
        await wait_for_rows(env, run["runId"])
        assert (await env.rows(run["runId"])).status_code == 409

        cancelled = await env.client.post(f"/api/runs/{run['runId']}/cancel")
        assert cancelled.status_code == 200
        body = cancelled.json()
        assert body["status"] == "cancelled"
        assert "error" not in body
        assert "rowCount" not in body
        assert "columns" not in body
        assert hook.cancelled.is_set()
        assert hook.cancel_threads and hook.cancel_threads[0] != "MainThread"
        assert await stored_rows_exist(env, run["runId"]) is False
        assert [h.connection.name for h in CancellableHook.built] == ["fake"]
        assert env.obo.calls == [(ALICE, "api://fake/.default")]

        again = await env.client.post(f"/api/runs/{run['runId']}/cancel")
        assert again.status_code == 200
        assert again.json() == body
        gone = await env.rows(run["runId"])
        assert gone.status_code == 409
        assert gone.json()["type"] == "urn:tim:problem:run-not-succeeded"


async def test_cancelling_a_finished_run_returns_it_unchanged(
    storage: Storage, auth: AuthKit
) -> None:
    async with open_env(storage, auth, [SIGN_INS]) as env:
        run = (await env.start("acme.sign_ins")).json()
        cancelled = await env.client.post(f"/api/runs/{run['runId']}/cancel")
        assert cancelled.status_code == 200
        assert cancelled.json() == run


async def test_only_the_owner_can_read_or_cancel_a_run(storage: Storage, auth: AuthKit) -> None:
    async with open_env(storage, auth, [SIGN_INS]) as env:
        run = (await env.start("acme.sign_ins")).json()
        env.as_user(BOB, "oid-b")
        for response in (
            await env.client.get(f"/api/runs/{run['runId']}"),
            await env.client.post(f"/api/runs/{run['runId']}/cancel"),
            await env.rows(run["runId"]),
        ):
            assert response.status_code == 404
            assert response.json()["detail"] == "Run not found"


async def test_a_run_over_the_timeout_ends_timed_out_without_rows(
    storage: Storage, auth: AuthKit, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("TIM_RUN_TIMEOUT_SECONDS", "1")
    async with open_env(storage, auth, [WAITS], race_seconds=0.1) as env:
        run = (await env.start("acme.waits")).json()
        hook = await env.hook()
        ended = await env.wait(run["runId"])
        assert ended["status"] == "timedOut"
        assert ended["error"] == "Run exceeded the time limit of 1 seconds"
        assert hook.cancelled.is_set()
        assert await stored_rows_exist(env, run["runId"]) is False


async def test_a_safe_error_is_shown_and_leaves_no_rows(storage: Storage, auth: AuthKit) -> None:
    action = SafeError(key="acme.fails", name="Fails", pivot="none", rows=PARTIAL)
    async with open_env(storage, auth, [action]) as env:
        run = (await env.start("acme.fails")).json()
        assert run["status"] == "error"
        assert run["error"] == "The sign-in log is unavailable"
        assert list(run["details"]) == ["duration"]
        assert await stored_rows_exist(env, run["runId"]) is False


async def test_an_unexpected_error_hides_its_message_and_leaves_no_rows(
    storage: Storage, auth: AuthKit, caplog: pytest.LogCaptureFixture
) -> None:
    action = Unexpected(key="acme.breaks", name="Breaks", pivot="none", rows=PARTIAL)
    async with open_env(storage, auth, [action]) as env:
        response = await env.start("acme.breaks")
        run = response.json()
        assert run["status"] == "error"
        assert run["error"] == "The run failed unexpectedly"
        assert "hunter2" not in response.text
        assert await stored_rows_exist(env, run["runId"]) is False
    assert "hunter2" in caplog.text  # the traceback is logged server-side


GENERATES = Rows(key="acme.many", name="Many", pivot="none", generate=1500)


@pytest.mark.parametrize(
    ("variable", "value", "message"),
    [
        ("TIM_MAX_RESULT_ROWS", "1200", "Result exceeds limit of 1200 rows"),
        ("TIM_MAX_RESULT_BYTES", "12000", "Result exceeds limit of 12000 bytes"),
    ],
)
async def test_a_result_over_a_cap_is_an_error_never_truncated(
    storage: Storage,
    auth: AuthKit,
    monkeypatch: pytest.MonkeyPatch,
    variable: str,
    value: str,
    message: str,
) -> None:
    monkeypatch.setenv(variable, value)
    async with open_env(storage, auth, [GENERATES]) as env:
        run = (await env.start("acme.many")).json()
        assert run["status"] == "error"
        assert run["error"] == message
        assert await stored_rows_exist(env, run["runId"]) is False


async def test_rows_come_in_pages_of_at_most_the_page_size(
    storage: Storage, auth: AuthKit, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("TIM_ROWS_PAGE_SIZE", "1000")
    async with open_env(storage, auth, [GENERATES]) as env:
        run = (await env.start("acme.many")).json()
        assert run["rowCount"] == 1500
        first = (await env.rows(run["runId"])).json()
        assert [r["row"] for r in first["rows"]] == list(range(1000))
        assert first["lastRow"] == 1500
        assert first["rows"][7] == {"row": 7, "id": None, "data": {"n": 7}}
        clamped = (await env.rows(run["runId"], startRow=200, endRow=1500)).json()
        assert len(clamped["rows"]) == 1000
        assert clamped["rows"][0]["row"] == 200
        tail = (await env.rows(run["runId"], startRow=1400, endRow=1500)).json()
        assert [r["row"] for r in tail["rows"]] == list(range(1400, 1500))
        past = await env.rows(run["runId"], startRow=1500, endRow=1600)
        assert past.status_code == 200
        assert past.json() == {"rows": [], "lastRow": 1500}
        backwards = await env.rows(run["runId"], startRow=10, endRow=5)
        assert backwards.status_code == 400


async def test_a_run_with_no_rows_has_an_empty_first_page(storage: Storage, auth: AuthKit) -> None:
    empty = Rows(key="acme.empty", name="Empty", pivot="none", id="CorrelationId")
    async with open_env(storage, auth, [empty]) as env:
        run = (await env.start("acme.empty")).json()
        assert (run["status"], run["rowCount"], run["columns"]) == ("succeeded", 0, [])
        assert "warning" not in run["details"]
        page = await env.rows(run["runId"])
        assert page.status_code == 200
        assert page.json() == {"rows": [], "lastRow": 0}


async def test_unknown_and_expired_runs_are_not_found(
    storage: Storage, auth: AuthKit, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("TIM_RUN_RETENTION_SECONDS", "1")
    async with open_env(storage, auth, [SIGN_INS]) as env:
        unknown = "00000000-0000-0000-0000-000000000000"
        assert (await env.client.get(f"/api/runs/{unknown}")).status_code == 404
        assert (await env.rows(unknown)).status_code == 404
        run = (await env.start("acme.sign_ins")).json()
        await asyncio.sleep(1.1)
        assert (await env.client.get(f"/api/runs/{run['runId']}")).status_code == 404
        assert (await env.rows(run["runId"])).status_code == 404


async def test_rows_lost_after_a_crash_are_gone(postgres_dsn: str, auth: AuthKit) -> None:
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    from tim_api.storage import PostgresStorage

    storage = PostgresStorage(postgres_dsn)
    try:
        async with open_env(storage, auth, [SIGN_INS]) as env:
            run = (await env.start("acme.sign_ins")).json()
            engine = create_async_engine(postgres_dsn)
            async with engine.begin() as conn:  # what crash recovery does to an UNLOGGED table
                await conn.execute(text("TRUNCATE run_rows"))
            await engine.dispose()
            gone = await env.rows(run["runId"])
            assert gone.status_code == 410
            assert gone.json()["type"] == "urn:tim:problem:results-gone"
            assert (await env.client.get(f"/api/runs/{run['runId']}")).json() == run
    finally:
        await storage.aclose()


def ids_of(page: dict[str, Any]) -> list[str | None]:
    return [row["id"] for row in page["rows"]]


async def test_the_id_is_the_first_non_empty_alternative_in_canonical_text(
    storage: Storage, auth: AuthKit
) -> None:
    action = Rows(
        key="acme.ids",
        name="Ids",
        pivot="none",
        id=["CorrelationId", "EventId"],
        rows=(
            {"CorrelationId": "c-1", "EventId": 9},
            {"CorrelationId": None, "EventId": 9},
            {"CorrelationId": "", "EventId": 1.5},
            {"CorrelationId": "", "EventId": None},
            {"CorrelationId": " padded ", "EventId": None},
            {"CorrelationId": 1, "EventId": None},
            {"CorrelationId": "1", "EventId": None},
            {"CorrelationId": "x" * 512, "EventId": None},
            {"CorrelationId": "y" * 513, "EventId": None},
            {"CorrelationId": "a\x00b", "EventId": None},
        ),
    )
    async with open_env(storage, auth, [action]) as env:
        run = (await env.start("acme.ids")).json()
        assert run["status"] == "succeeded"
        assert ids_of((await env.rows(run["runId"])).json()) == [
            "c-1",
            "9",
            "1.5",
            None,
            " padded ",
            "1",
            "1",
            "x" * 512,
            None,
            "a\ufffdb",
        ]
        assert run["details"]["warning"] == "1 row(s) have an id over 512 characters and get no id"


@pytest.mark.parametrize(
    ("id_", "warning"),
    [
        ("CorrelationId", "Id column CorrelationId not in results"),
        (["EventId", "CorrelationId"], "Id column CorrelationId not in results"),
        (["Missing", "CorrelationId"], "Id columns Missing, CorrelationId not in results"),
    ],
)
async def test_an_id_column_missing_from_the_results_is_a_warning(
    storage: Storage, auth: AuthKit, id_: str | list[str], warning: str
) -> None:
    action = Rows(
        key="acme.no_id",
        name="No id",
        pivot="none",
        id=id_,
        rows=({"EventId": "e-1", "User": "alice"},),
    )
    async with open_env(storage, auth, [action]) as env:
        run = (await env.start("acme.no_id")).json()
        assert run["status"] == "succeeded"
        assert run["details"]["warning"] == warning
        expected = "e-1" if "EventId" in id_ else None
        assert ids_of((await env.rows(run["runId"])).json()) == [expected]


async def test_a_declared_id_column_no_row_carries_is_a_warning(
    storage: Storage, auth: AuthKit
) -> None:
    action = Rows(
        key="acme.declared_id",
        name="Declared id",
        pivot="none",
        id="CorrelationId",
        columns=(Column("CorrelationId", "string"),),
        rows=({"User": "alice"},),
    )
    async with open_env(storage, auth, [action]) as env:
        run = (await env.start("acme.declared_id")).json()
        assert run["details"]["warning"] == "Id column CorrelationId not in results"


async def test_an_action_without_an_id_gives_rows_no_id(storage: Storage, auth: AuthKit) -> None:
    action = Rows(key="acme.plain", name="Plain", pivot="none", rows=({"CorrelationId": "c"},))
    async with open_env(storage, auth, [action]) as env:
        run = (await env.start("acme.plain")).json()
        assert "warning" not in run["details"]
        assert ids_of((await env.rows(run["runId"])).json()) == [None]


ECHO = Echo(
    key="acme.echo",
    name="Echo",
    pivot="none",
    params=(
        Param("user", "string"),
        Param("since", "datetime", required=False, default="2026-10-01T02:00:00+02:00"),
        Param("window", "timespan", required=False),
        Param("limit", "number", required=False),
    ),
)


async def test_params_are_validated_before_the_run_is_created(
    storage: Storage, auth: AuthKit
) -> None:
    async with open_env(storage, auth, [ECHO]) as env:
        response = await env.start("acme.echo", {"limit": "ten", "colour": "red"})
        assert response.status_code == 422
        body = response.json()
        assert body["type"] == "urn:tim:problem:validation"
        assert body["errors"] == {
            "params.colour": ["Unknown param"],
            "params.user": ["Required"],
            "params.limit": ["Must be a number"],
        }
        unknown = await env.start("acme.nope")
        assert unknown.status_code == 422
        assert unknown.json()["errors"] == {"action": ["Unknown action"]}


async def test_the_run_holds_the_resolved_params_and_runs_as_the_analyst(
    storage: Storage, auth: AuthKit
) -> None:
    async with open_env(storage, auth, [ECHO]) as env:
        run = (await env.start("acme.echo", {"user": "bob", "window": "PT1H30M"})).json()
        resolved = {
            "user": "bob",
            "since": "2026-10-01T00:00:00Z",
            "window": "PT1H30M",
            "limit": None,
        }
        assert run["params"] == resolved
        [row] = (await env.rows(run["runId"])).json()["rows"]
        assert row["data"] == {**resolved, "analyst": ALICE}


async def test_details_come_after_duration_and_row_count_in_the_order_reported(
    storage: Storage, auth: AuthKit
) -> None:
    action = Rows(
        key="acme.details",
        name="Details",
        pivot="none",
        id="Missing",
        details=(
            ("zeta", "z"),
            ("rowCount", 99),
            ("alpha", 1.5),
            ("warning", "Sampled"),
            ("ok", True),
        ),
        rows=({"a": 1},),
    )
    async with open_env(storage, auth, [action]) as env:
        run = (await env.start("acme.details")).json()
        assert list(run["details"]) == ["duration", "rowCount", "zeta", "alpha", "warning", "ok"]
        assert run["details"]["rowCount"] == 1
        assert run["details"]["warning"] == "Sampled; Id column Missing not in results"
        assert isinstance(run["details"]["duration"], int | float)
        again = (await env.client.get(f"/api/runs/{run['runId']}")).json()
        assert list(again["details"]) == list(run["details"])


async def test_columns_are_declared_first_then_inferred_in_first_seen_order(
    storage: Storage, auth: AuthKit
) -> None:
    action = Rows(
        key="acme.columns",
        name="Columns",
        pivot="none",
        columns=(Column("Count", "number"), Column("Elapsed", "timespan")),
        run_columns=(Column("Host", "string"), Column("Count", "string")),
        rows=(
            {"When": "2026-10-01T12:00:00Z", "Host": "h1", "Count": 1, "Late": None},
            {"Day": "2026-10-01", "Flag": True, "Bag": {"k": [1]}, "Mixed": 1, "Late": 2},
            {"When": "2026-10-02 08:30", "Mixed": "x", "Note": "2026-99-99"},
        ),
    )
    async with open_env(storage, auth, [action]) as env:
        run = (await env.start("acme.columns")).json()
        assert run["columns"] == [
            {"name": "Count", "type": "number", "declared": True},
            {"name": "Elapsed", "type": "timespan", "declared": True},
            {"name": "Host", "type": "string", "declared": True},
            {"name": "When", "type": "datetime", "declared": False},
            {"name": "Late", "type": "number", "declared": False},
            {"name": "Day", "type": "datetime", "declared": False},
            {"name": "Flag", "type": "boolean", "declared": False},
            {"name": "Bag", "type": "json", "declared": False},
            {"name": "Mixed", "type": "string", "declared": False},
            {"name": "Note", "type": "string", "declared": False},
        ]


async def test_nul_characters_become_replacement_characters(
    storage: Storage, auth: AuthKit
) -> None:
    action = Rows(
        key="acme.nul",
        name="NUL",
        pivot="none",
        details=(("note\x00", "a\x00b"),),
        rows=({"Te\x00xt": "x\x00y", "Nested": {"k\x00": ["\x00"]}},),
    )
    async with open_env(storage, auth, [action]) as env:
        run = (await env.start("acme.nul")).json()
        assert run["details"]["note\ufffd"] == "a\ufffdb"
        [row] = (await env.rows(run["runId"])).json()["rows"]
        assert row["data"] == {"Te\ufffdxt": "x\ufffdy", "Nested": {"k\ufffd": ["\ufffd"]}}


async def test_a_run_cannot_reach_a_connection_its_action_did_not_declare(
    storage: Storage, auth: AuthKit
) -> None:
    action = UndeclaredHook(key="acme.sneaky", name="Sneaky", pivot="none")
    async with open_env(storage, auth, [action]) as env:
        run = (await env.start("acme.sneaky")).json()
        assert run["status"] == "error"
        assert run["error"] == "The run failed unexpectedly"
        assert CancellableHook.built == []


async def test_startup_marks_runs_left_running_past_the_timeout_as_interrupted(
    storage: Storage, auth: AuthKit
) -> None:
    from datetime import UTC, datetime, timedelta

    from storage_contract import make_rows, make_run

    now = datetime.now(UTC)
    stale = make_run(started=now - timedelta(minutes=11))
    recent = make_run(started=now - timedelta(minutes=1))
    for run in (stale, recent):
        await storage.runs.create(run)
        await storage.runs.add_rows(run.run_id, make_rows(0, 2))
    async with open_env(storage, auth, []):
        got = await storage.runs.get(stale.run_id, now)
        assert got is not None
        assert (got.status, got.error) == (RunStatus.ERROR, "Run interrupted by server restart")
        assert got.finished_at is not None
        assert await storage.runs.has_rows(stale.run_id) is False
        untouched = await storage.runs.get(recent.run_id, now)
        assert untouched is not None
        assert untouched.status is RunStatus.RUNNING


async def test_shutdown_ends_runs_in_flight_as_interrupted(storage: Storage, auth: AuthKit) -> None:
    from datetime import UTC, datetime
    from uuid import UUID

    async with open_env(storage, auth, [WAITS], race_seconds=0.1) as env:
        run_id = (await env.start("acme.waits")).json()["runId"]
        hook = await env.hook()
        await wait_for_rows(env, run_id)
    got = await storage.runs.get(UUID(run_id), datetime.now(UTC))
    assert got is not None
    assert (got.status, got.error) == (RunStatus.ERROR, "Run interrupted by server restart")
    assert await storage.runs.has_rows(UUID(run_id)) is False
    async with asyncio.timeout(5):
        await asyncio.to_thread(hook.cancelled.wait)


async def test_a_cancel_reaches_a_run_executing_in_another_process(
    storage: Storage, auth: AuthKit
) -> None:
    async with (
        open_env(storage, auth, [WAITS], race_seconds=0.1) as executing,
        open_env(storage, auth, [WAITS], race_seconds=0.1) as other,
    ):
        run_id = (await executing.start("acme.waits")).json()["runId"]
        hook = await executing.hook()
        answered = await other.client.post(f"/api/runs/{run_id}/cancel")
        assert answered.status_code == 200
        assert answered.json()["status"] == "running"
        ended = await other.wait(run_id)
        assert ended["status"] == "cancelled"
        assert hook.cancelled.is_set()


async def test_a_run_waiting_for_a_slot_is_running_and_can_be_cancelled(
    storage: Storage, auth: AuthKit, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("TIM_MAX_CONCURRENT_RUNS", "1")
    async with open_env(storage, auth, [WAITS, SIGN_INS], race_seconds=0.1) as env:
        busy = (await env.start("acme.waits")).json()
        hook = await env.hook()
        waiting = await env.start("acme.sign_ins")
        assert waiting.status_code == 202
        assert waiting.json()["status"] == "running"
        cancelled = await env.client.post(f"/api/runs/{waiting.json()['runId']}/cancel")
        assert cancelled.json()["status"] == "cancelled"
        assert not hook.cancelled.is_set()  # the busy run is untouched
        assert (await env.client.post(f"/api/runs/{busy['runId']}/cancel")).json()[
            "status"
        ] == "cancelled"
        after = await env.start("acme.sign_ins")  # the slot is free again
        assert after.json()["status"] == "succeeded"
