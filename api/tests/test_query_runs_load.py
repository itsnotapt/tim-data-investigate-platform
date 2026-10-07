"""Load and robustness checks for query runs.

Memory budget (documented in api/README.md): turning a Kusto V2 response into stored run
rows (``parse_v2_frames`` + ``sanitise_nul``) must peak below ``PEAK_BUDGET_FACTOR`` times the
serialised payload size, on top of the raw frames the SDK already holds.
"""

from __future__ import annotations

import asyncio
import json
import tracemalloc
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

import pytest
from pydantic import SecretStr

from tim_api.config import Settings
from tim_api.kusto.query_client import (
    KustoResultLimitError,
    QueryResult,
    ResultLimits,
    parse_v2_frames,
)
from tim_api.query_runs.models import KustoQueryRequest, QueryRunStatus
from tim_api.query_runs.runner import RunManager, sanitise_nul
from tim_api.storage.memory import MemoryStorage

PEAK_BUDGET_FACTOR = 3
ROWS = 100_000
CLUSTER = "https://c1.westeurope.kusto.windows.net"

COLUMNS = [
    ("Timestamp", "datetime"),
    ("Computer", "string"),
    ("EventId", "int"),
    ("Level", "string"),
    ("Account", "string"),
    ("Message", "string"),
    ("Count", "long"),
    ("Score", "real"),
    ("Id", "guid"),
    ("Props", "dynamic"),
]


def make_frames(rows: int, message_len: int = 60) -> list[dict[str, Any]]:
    message = "x" * message_len
    data: list[list[Any]] = [
        [
            "2026-09-01T10:11:12.1234567Z",
            f"host-{i % 500}.corp.example.com",
            4624 + i % 7,
            "Information",
            f"user{i % 10_000}@example.com",
            f"{message} {i}",
            i,
            i / 7,
            f"00000000-0000-0000-0000-{i:012d}",
            json.dumps({"ip": f"10.0.{i % 255}.{i % 200}", "port": i % 65535, "tags": ["a", "b"]}),
        ]
        for i in range(rows)
    ]
    return [
        {"FrameType": "DataSetHeader", "IsProgressive": False},
        {
            "FrameType": "DataTable",
            "TableKind": "PrimaryResult",
            "Columns": [{"ColumnName": n, "ColumnType": t} for n, t in COLUMNS],
            "Rows": data,
        },
        {"FrameType": "DataSetCompletion", "HasErrors": False, "Cancelled": False},
    ]


def payload_bytes(rows: list[dict[str, Any]]) -> int:
    return len(json.dumps(rows, separators=(",", ":")).encode())


@pytest.fixture
def frames_100k() -> Iterator[list[dict[str, Any]]]:
    yield make_frames(ROWS)


@pytest.mark.parametrize(
    "rows",
    [10_000, pytest.param(ROWS, marks=pytest.mark.slow)],
    ids=["10k", "100k"],
)
def test_rows_within_caps_and_memory_budget(rows: int) -> None:
    """The 100k case is the row cap; run it with ``uv run pytest -m slow``."""
    limits = ResultLimits(max_rows=ROWS, max_bytes=64 * 1024 * 1024)
    frames = make_frames(rows)
    tracemalloc.start()
    try:
        result = parse_v2_frames(frames, limits)
        stored = sanitise_nul(result.rows)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert len(stored) == rows
    assert stored[5]["Props"]["tags"] == ["a", "b"]  # dynamic parsed
    payload = payload_bytes(stored)
    assert payload < limits.max_bytes
    assert peak < PEAK_BUDGET_FACTOR * payload, f"peak {peak} vs payload {payload}"


def test_row_cap_rejects_before_building_rows(frames_100k: list[dict[str, Any]]) -> None:
    tracemalloc.start()
    try:
        with pytest.raises(KustoResultLimitError, match="99999 rows"):
            parse_v2_frames(frames_100k, ResultLimits(max_rows=ROWS - 1, max_bytes=10**9))
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert peak < 1_000_000  # the frame pre-check allocates no per-row state


def test_row_cap_counts_across_tables() -> None:
    frames = make_frames(10)
    frames.insert(2, frames[1])
    with pytest.raises(KustoResultLimitError, match="15 rows"):
        parse_v2_frames(frames, ResultLimits(max_rows=15, max_bytes=10**9))


def test_byte_cap_with_wide_rows_stops_early() -> None:
    frames = make_frames(2_000, message_len=50_000)  # ~100 MB of messages
    limits = ResultLimits(max_rows=ROWS, max_bytes=8 * 1024 * 1024)
    tracemalloc.start()
    try:
        with pytest.raises(KustoResultLimitError, match=f"{limits.max_bytes} bytes"):
            parse_v2_frames(frames, limits)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    # The parser aborts once the cap is crossed, so only ~cap bytes of rows were ever built.
    assert peak < 3 * limits.max_bytes


class ConcurrencyKusto:
    """Fake client that records peak in-flight executions and echoes the query per run."""

    def __init__(self) -> None:
        self.in_flight = 0
        self.peak = 0

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
        self.in_flight += 1
        self.peak = max(self.peak, self.in_flight)
        try:
            await asyncio.sleep(0.01)
            return QueryResult(rows=[{"query": query, "token": token}])
        finally:
            self.in_flight -= 1


async def test_concurrent_runs_complete_without_cross_talk() -> None:
    settings = Settings(
        auth_tenant_id="t",
        auth_client_id="c",
        tag_cluster_uri="https://ingest.example.com",
        database_url=SecretStr("memory://"),
        environment="development",
        max_concurrent_runs=5,
    )
    storage = MemoryStorage()
    kusto = ConcurrencyKusto()
    tasks: set[asyncio.Task[Any]] = set()
    slots = asyncio.Semaphore(settings.max_concurrent_runs)
    manager = RunManager(
        storage.runs,
        kusto,  # type: ignore[arg-type]
        settings,
        tasks,
        slots=slots,
        race_seconds=30,
    )
    n = 20

    async def one(i: int) -> Any:
        body = KustoQueryRequest.model_validate(
            {"cluster": CLUSTER, "database": "db", "query": f"T{i}"}
        )
        return await manager.start(
            body, cluster=CLUSTER, owner=f"user{i}", token=f"tok{i}", trace_id="t"
        )

    runs = await asyncio.gather(*(one(i) for i in range(n)))
    assert not tasks or all(t.done() for t in tasks)
    assert kusto.peak <= settings.max_concurrent_runs
    assert kusto.peak > 1  # runs really overlapped
    assert len({r.query_run_id for r in runs}) == n
    for i, run in enumerate(runs):
        assert run.status is QueryRunStatus.COMPLETED
        assert run.result_data == [{"query": f"T{i}", "token": f"tok{i}"}]
        assert run.kusto_query.requested_by == f"user{i}"
        stored = await storage.runs.get_for_owner(run.query_run_id, f"user{i}", datetime.now(UTC))
        assert stored is not None
        assert stored.result_data == run.result_data
