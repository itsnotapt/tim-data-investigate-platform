"""Query-run lifecycle (P2-09, api-contract 3.3/3.4, ADR-0004).

``RunManager`` persists a run as ``created``, executes it in a tracked asyncio task and writes
the terminal state. The task never raises: every outcome (success, Kusto error, limit, timeout,
unexpected failure, shutdown) is persisted as the run's final state. Errors returned to users
are sanitised messages only; stack traces are logged with the trace id (SEC-04).

PostgreSQL JSONB and TEXT cannot store U+0000, so NUL characters in result data and error text
are replaced with U+FFFD before persisting (``sanitise_nul``).
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from tim_api.config import Settings
from tim_api.kusto.query_client import (
    KustoQueryClient,
    KustoQueryError,
    KustoResultLimitError,
    ResultLimits,
)
from tim_api.kusto.query_client import sanitise_message as _sanitise_message
from tim_api.query_runs.models import (
    KustoQueryEcho,
    KustoQueryRequest,
    KustoQueryRun,
    QueryRunStatus,
)
from tim_api.storage import QueryRunStore

logger = logging.getLogger("tim_api.query_runs")

NUL_REPLACEMENT = "�"
INTERRUPTED_MESSAGE = "Run interrupted by server restart"
TIMEOUT_MESSAGE = "Query exceeded the execution time limit of {seconds} seconds"
GENERIC_ERROR_MESSAGE = "The query failed unexpectedly"
RACE_SECONDS = 1.0


def sanitise_nul(value: Any) -> Any:
    """Replace U+0000 with U+FFFD in every string (keys and values) of a JSON-like value."""
    if isinstance(value, str):
        return value.replace("\x00", NUL_REPLACEMENT) if "\x00" in value else value
    if isinstance(value, dict):
        return {sanitise_nul(k): sanitise_nul(v) for k, v in value.items()}
    if isinstance(value, list):
        return [sanitise_nul(v) for v in value]
    return value


Clock = Callable[[], datetime]


def _utcnow() -> datetime:
    return datetime.now(UTC)


class RunManager:
    def __init__(
        self,
        store: QueryRunStore,
        kusto: KustoQueryClient,
        settings: Settings,
        tasks: set[asyncio.Task[KustoQueryRun]],
        *,
        clock: Clock = _utcnow,
        race_seconds: float | None = None,
    ) -> None:
        self._store = store
        self._kusto = kusto
        self._settings = settings
        self._tasks = tasks  # owned by app.state: strong refs until done, cancelled on shutdown
        self._clock = clock
        self._race_seconds = RACE_SECONDS if race_seconds is None else race_seconds

    def _expires(self) -> datetime:
        return self._clock() + timedelta(seconds=self._settings.run_retention_seconds)

    async def start(
        self,
        body: KustoQueryRequest,
        *,
        cluster: str,
        owner: str,
        token: str,
        trace_id: str,
    ) -> KustoQueryRun:
        """Create the run, execute it, and return the run as seen after the 1 s race."""
        run = KustoQueryRun(
            query_run_id=uuid4(),
            status=QueryRunStatus.CREATED,
            kusto_query=KustoQueryEcho(
                cluster=cluster,
                database=body.database,
                query=body.query,
                start_time=body.start_time,
                end_time=body.end_time,
                requested_by=owner,
            ),
            execute_date_time_utc=self._clock(),
            expires_at=self._expires(),
        )
        await self._store.create(run)
        task = asyncio.create_task(
            self._execute(run, token, trace_id), name=f"tim-run-{run.query_run_id}"
        )
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        # asyncio.wait neither cancels the task on timeout nor propagates a client disconnect to it.
        done, _ = await asyncio.wait({task}, timeout=self._race_seconds)
        return task.result() if task in done else run

    async def _execute(self, run: KustoQueryRun, token: str, trace_id: str) -> KustoQueryRun:
        """Run the query and persist the terminal state. Never raises."""
        settings = self._settings
        echo = run.kusto_query
        limits = ResultLimits(settings.max_result_rows, settings.max_result_bytes)
        fields: dict[str, Any]
        try:
            async with asyncio.timeout(settings.query_timeout_seconds) as scope:
                result = await self._kusto.execute(
                    echo.cluster,
                    echo.database,
                    echo.query,
                    token,
                    echo.start_time,
                    echo.end_time,
                    limits,
                )
            fields = {
                "status": QueryRunStatus.COMPLETED,
                "result_data": sanitise_nul(result.rows),
                "execution_metrics": result.execution_metrics,
            }
        except TimeoutError:
            if not scope.expired():  # a timeout raised inside the client, not our deadline
                fields = self._unexpected(run, trace_id)
            else:
                message = TIMEOUT_MESSAGE.format(seconds=settings.query_timeout_seconds)
                fields = {"status": QueryRunStatus.TIMED_OUT, "main_error": message}
        except KustoResultLimitError as exc:
            fields = self._error(str(exc))
        except KustoQueryError as exc:
            # Message only; the traceback (if any) stays in the log.
            logger.info("Query run %s failed: %s", run.query_run_id, type(exc).__name__)
            fields = self._error(_sanitise_message(str(exc)))
        except asyncio.CancelledError:
            # Shutdown: best effort so the run doesn't wait for the next startup sweep.
            await self._persist(run, self._error(INTERRUPTED_MESSAGE))
            raise
        except Exception:
            fields = self._unexpected(run, trace_id)
        return await self._persist(run, fields)

    @staticmethod
    def _error(message: str) -> dict[str, Any]:
        return {"status": QueryRunStatus.ERROR, "main_error": sanitise_nul(message)}

    def _unexpected(self, run: KustoQueryRun, trace_id: str) -> dict[str, Any]:
        logger.exception(
            "Query run %s failed unexpectedly (traceId=%s)", run.query_run_id, trace_id
        )
        return self._error(GENERIC_ERROR_MESSAGE)

    async def _persist(self, run: KustoQueryRun, fields: dict[str, Any]) -> KustoQueryRun:
        try:
            return await self._store.update_result(
                run.query_run_id, expires_at=self._expires(), **fields
            )
        except Exception:
            logger.exception("Could not persist the result of query run %s", run.query_run_id)
            return run


async def mark_stale_runs(store: QueryRunStore, settings: Settings) -> int:
    """Startup sweep (BUG-02): runs left ``created`` longer than the timeout become ``error``."""
    now = _utcnow()
    try:
        count = await store.mark_stale_created_as_error(
            now - timedelta(seconds=settings.query_timeout_seconds),
            message=INTERRUPTED_MESSAGE,
            expires_at=now + timedelta(seconds=settings.run_retention_seconds),
        )
    except Exception:
        logger.exception("Stale query-run sweep failed")
        return 0
    if count:
        logger.warning("Marked %d interrupted query run(s) as error", count)
    return count


async def cancel_tasks(tasks: set[asyncio.Task[KustoQueryRun]]) -> None:
    pending = list(tasks)
    for task in pending:
        task.cancel()
    await asyncio.gather(*pending, return_exceptions=True)
