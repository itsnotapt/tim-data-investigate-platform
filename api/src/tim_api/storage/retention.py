"""Periodic deletion of expired query runs (ADR-0004).

One mechanism for every run, independent of the backing store. Correctness does not depend on
the loop: ``get_for_owner`` already treats an expired run as missing.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

from tim_api.storage.base import Storage

logger = logging.getLogger("tim_api.retention")


async def sweep_expired(storage: Storage, now: datetime | None = None) -> int:
    """Delete expired runs once. Failures are logged and swallowed (retried next tick)."""
    try:
        deleted = await storage.runs.delete_expired(now or datetime.now(UTC))
    except Exception:
        logger.exception("Retention sweep failed")
        return 0
    if deleted:
        logger.info("Retention sweep deleted %d expired query run(s)", deleted)
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
