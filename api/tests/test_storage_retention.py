"""Retention: expired runs are deleted by one mechanism for every store."""

import asyncio
from datetime import datetime, timedelta

import pytest
from storage_contract import T0, make_run

from tim_api.storage import Storage, start_retention_loop, sweep_expired


async def test_sweep_removes_only_expired(storage: Storage) -> None:
    old = make_run(expires=T0 + timedelta(minutes=1))
    fresh = make_run(expires=T0 + timedelta(hours=5))
    await storage.runs.create(old)
    await storage.runs.create(fresh)
    assert await sweep_expired(storage, T0 + timedelta(hours=1)) == 1
    assert await storage.runs.get_for_owner(old.query_run_id, "alice", T0) is None
    assert await storage.runs.get_for_owner(fresh.query_run_id, "alice", T0) == fresh


async def test_background_loop_deletes_expired(
    storage: Storage, monkeypatch: pytest.MonkeyPatch
) -> None:
    run = make_run(expires=T0)  # long expired relative to the real clock the loop uses
    await storage.runs.create(run)
    swept = asyncio.Event()
    original = storage.runs.delete_expired

    async def spy(now: datetime) -> int:
        count = await original(now)
        if count:
            swept.set()
        return count

    monkeypatch.setattr(storage.runs, "delete_expired", spy)
    stop = start_retention_loop(storage, 0.01)
    try:
        async with asyncio.timeout(10):
            await swept.wait()
    finally:
        await stop()
    await storage.runs.create(run)  # the row is really gone
