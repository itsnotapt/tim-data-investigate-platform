"""Periodic deletion of expired runs (ADR-0004).

One mechanism for every run, independent of the backing store. Correctness does not depend on
the loop: reads already treat an expired run as missing. Runs are deleted a few at a time, each
batch in its own transaction, because deleting a run deletes all of its rows.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

from tim_api.storage.base import Storage

logger = logging.getLogger("tim_api.retention")

RUNS_PER_BATCH = 10


async def sweep_expired(storage: Storage, now: datetime | None = None) -> int:
    """Delete expired runs once; returns how many. Failures are logged and swallowed (retried
    next tick)."""
    now = now or datetime.now(UTC)
    deleted = 0
    try:
        while (batch := await storage.runs.delete_expired(now, RUNS_PER_BATCH)) > 0:
            deleted += batch
            if batch < RUNS_PER_BATCH:
                break
    except Exception:
        logger.exception("Retention sweep failed")
        return deleted
    if deleted:
        logger.info("Retention sweep deleted %d expired run(s)", deleted)
    return deleted


async def _loop(storage: Storage, interval: float) -> None:
    while True:
        await sweep_expired(storage)
        await asyncio.sleep(interval)


def start_retention_loop(
    storage: Storage, interval_seconds: float
) -> Callable[[], Awaitable[None]]:
    """Start the background loop; returns an async ``stop`` to await on shutdown."""
    task = asyncio.create_task(_loop(storage, interval_seconds), name="tim-run-retention")

    async def stop() -> None:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    return stop
