"""Retention: expired runs are deleted by one mechanism for every store."""

import asyncio
from datetime import timedelta

from storage_contract import T0, make_rows, make_run

from tim_api.storage import Storage, start_retention_loop, sweep_expired


async def test_background_loop_deletes_expired(storage: Storage) -> None:
    run = make_run(expires=T0)  # long expired relative to the real clock the loop uses
    await storage.runs.create(run)
    before = T0 - timedelta(days=1)
    stop = start_retention_loop(storage, 0.01)
    try:
        async with asyncio.timeout(10):
            # Poll with a "now" before expiry so only a real deletion makes the run vanish.
            while await storage.runs.get(run.run_id, before):  # noqa: ASYNC110 - no change signal exists
                await asyncio.sleep(0.01)
    finally:
        await stop()
    await storage.runs.create(run)  # the row is really gone


async def test_sweep_deletes_expired_runs_and_their_rows_a_few_at_a_time(
    storage: Storage,
) -> None:
    expired = [make_run(expires=T0 + timedelta(minutes=i)) for i in range(25)]
    fresh = make_run(expires=T0 + timedelta(hours=5))
    for run in (*expired, fresh):
        await storage.runs.create(run)
        await storage.runs.add_rows(run.run_id, make_rows(0, 2))
    assert await sweep_expired(storage, T0 + timedelta(hours=1)) == 25
    assert await storage.runs.get(fresh.run_id, T0) == fresh
    assert await storage.runs.has_rows(fresh.run_id) is True
    for run in expired:
        assert await storage.runs.has_rows(run.run_id) is False
