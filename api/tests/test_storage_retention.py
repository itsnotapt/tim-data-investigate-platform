"""Retention: expired runs are deleted by one mechanism for every store."""

import asyncio
from datetime import timedelta

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


async def test_background_loop_deletes_expired(storage: Storage) -> None:
    run = make_run(expires=T0)  # long expired relative to the real clock the loop uses
    await storage.runs.create(run)
    before = T0 - timedelta(days=1)
    stop = start_retention_loop(storage, 0.01)
    try:
        async with asyncio.timeout(10):
            # Poll with a "now" before expiry so only a real deletion makes the run vanish.
            while await storage.runs.get_for_owner(  # noqa: ASYNC110 - no change signal exists
                run.query_run_id, "alice", before
            ):
                await asyncio.sleep(0.01)
    finally:
        await stop()
    await storage.runs.create(run)  # the row is really gone
