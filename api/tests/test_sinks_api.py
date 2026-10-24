"""Sinks: ``POST /api/runs`` with the selected rows as ``input``, run like any action."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import httpx2 as httpx
import pytest
from app_factory import AuthKit
from scripted_actions import Recording, Rows, WaitingSink
from test_runs_api import ALICE, Env, open_env
from tim_actions import Column

from tim_api.storage import Storage

SAVE = Recording(key="acme.save_event", name="Save event", menu="Kusto")
HOST = {"name": "Host", "type": "string"}
INPUT = {
    "columns": [HOST, {"name": "Bytes", "type": "number"}],
    "rows": [{"Host": "h-1", "Bytes": 3}, {"Host": "h-2", "Bytes": None}],
}


@pytest.fixture(autouse=True)
def _received() -> Iterator[None]:
    Recording.received.clear()
    yield
    Recording.received.clear()


async def start(env: Env, action: str, body: dict[str, Any]) -> httpx.Response:
    return await env.client.post("/api/runs", json={"action": action, **body})


async def test_a_sink_run_writes_the_input_rows_and_keeps_none(
    storage: Storage, auth: AuthKit
) -> None:
    async with open_env(storage, auth, [SAVE]) as env:
        started = await start(env, "acme.save_event", {"input": INPUT})
        assert started.status_code == 200
        run = started.json()
        assert run["status"] == "succeeded"
        assert run["action"] == {"key": "acme.save_event", "name": "Save event"}
        assert run["params"] == {}
        assert list(run["details"]) == ["duration", "inputRowCount"]
        assert run["details"]["inputRowCount"] == 2
        assert "columns" not in run
        assert "rowCount" not in run
        assert Recording.received == [
            (
                [Column(name="Host", type="string"), Column(name="Bytes", type="number")],
                INPUT["rows"],
                ALICE,
            )
        ]
        assert (await env.client.get(f"/api/runs/{run['runId']}")).json() == run


SIGN_INS = Rows(key="acme.sign_ins", name="Sign-ins", pivot="none", rows=({"n": 1},))


@pytest.mark.parametrize(
    ("action", "body", "errors"),
    [
        ("acme.save_event", {}, {"input": ["A sink needs the rows to write"]}),
        ("acme.sign_ins", {"input": INPUT}, {"input": ["Only a sink takes input"]}),
        (
            "acme.save_event",
            {"input": {"columns": [], "rows": [{"n": n} for n in range(3)]}},
            {"input.rows": ["At most 2 rows; 3 given"]},
        ),
        (
            "acme.save_event",
            {"input": {**INPUT, "columns": [HOST, HOST]}},
            {"input.columns": ["Column names must be unique"]},
        ),
        ("acme.save_event", {"input": INPUT, "params": {"x": 1}}, {"params.x": ["Unknown param"]}),
    ],
)
async def test_a_sink_takes_input_and_only_a_sink_does(
    storage: Storage,
    auth: AuthKit,
    monkeypatch: pytest.MonkeyPatch,
    action: str,
    body: dict[str, Any],
    errors: dict[str, list[str]],
) -> None:
    monkeypatch.setenv("TIM_MAX_ANNOTATION_IDS", "2")
    async with open_env(storage, auth, [SAVE, SIGN_INS]) as env:
        refused = await start(env, action, body)
        assert refused.status_code == 422
        assert refused.json()["errors"] == errors
        assert Recording.received == []


async def test_a_failed_sink_reports_its_error_and_details(storage: Storage, auth: AuthKit) -> None:
    sink = Recording(
        key="acme.refuses", name="Refuses", details=(("cluster", "help"),), error="Ingest refused"
    )
    async with open_env(storage, auth, [sink]) as env:
        run = (await start(env, "acme.refuses", {"input": INPUT})).json()
        assert run["status"] == "error"
        assert run["error"] == "Ingest refused"
        assert list(run["details"]) == ["duration", "inputRowCount", "cluster"]
        assert run["details"]["inputRowCount"] == 2
        assert "columns" not in run


async def test_a_sink_run_can_be_cancelled_through_its_hook(
    storage: Storage, auth: AuthKit
) -> None:
    sink = WaitingSink(key="acme.waits", name="Waits")
    async with open_env(storage, auth, [sink], race_seconds=0.1) as env:
        started = await start(env, "acme.waits", {"input": INPUT})
        assert started.status_code == 202
        hook = await env.hook()
        run_id = started.json()["runId"]
        cancelled = (await env.client.post(f"/api/runs/{run_id}/cancel")).json()
        assert cancelled["status"] == "cancelled"
        assert hook.cancelled.is_set()
        assert list(cancelled["details"]) == ["duration", "inputRowCount"]


async def test_the_most_rows_of_a_few_kilobytes_each_fit_in_one_request(
    storage: Storage, auth: AuthKit
) -> None:
    rows = [{"Host": f"h-{n}", "Raw": "x" * 2000} for n in range(10_000)]
    async with open_env(storage, auth, [SAVE]) as env:
        started = await start(env, "acme.save_event", {"input": {"columns": [], "rows": rows}})
        assert started.status_code == 200
        assert started.json()["details"]["inputRowCount"] == 10_000
