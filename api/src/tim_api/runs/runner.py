"""Run lifecycle (ADR-0012).

``Runner.start`` stores a run as ``running`` and executes it in a tracked asyncio task, which
runs the action's synchronous ``run`` in its own daemon thread. The thread writes rows in
batches as ``run`` yields them; the task enforces the timeout and cancel and writes the final
state. The task never raises: every outcome (success, safe error, limit, timeout, cancel,
unexpected failure, shutdown) is stored as the run's final state, and only a succeeded run keeps
its rows.

Cancel reaches the process executing a run directly, or through the run's stored cancel request,
which each process polls for the runs it executes.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import threading
import time
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from tim_actions import Action, Analyst, Column, DetailValue, Hook, RunError, Sink

from tim_api.config import Settings
from tim_api.runs.connections import RunConnections
from tim_api.runs.models import Run, RunAction, RunRow, RunStatus
from tim_api.runs.results import ResultBuilder, ResultLimitError, sanitise_nul, to_json_value
from tim_api.storage import RunStore

logger = logging.getLogger("tim_api.runs")

INTERRUPTED_MESSAGE = "Run interrupted by server restart"
TIMEOUT_MESSAGE = "Run exceeded the time limit of {seconds} seconds"
GENERIC_ERROR_MESSAGE = "The run failed unexpectedly"
RACE_SECONDS = 1.0
CANCEL_POLL_SECONDS = 1.0
# How long a cancelled or timed-out run waits for Hook.cancel() or the worker before it ends
# anyway.
CANCEL_GRACE_SECONDS = 10.0
BATCH_ROWS = 1000
BATCH_BYTES = 8 * 1024 * 1024

Clock = Callable[[], datetime]


def _utcnow() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True)
class RunInput:
    """The rows a sink's run writes, and their columns."""

    columns: Sequence[Column]
    rows: Sequence[Mapping[str, Any]]


class _Stopped(Exception):
    """The run has ended while its worker was still going; the worker stops."""


def _in_thread[T](fn: Callable[[], T], name: str) -> asyncio.Future[T]:
    """Call ``fn`` in a new daemon thread, so a hung action never blocks shutdown."""
    loop = asyncio.get_running_loop()
    future: asyncio.Future[T] = loop.create_future()

    def settle(result: T | None, exc: BaseException | None) -> None:
        if future.done():
            return
        if exc is not None:
            future.set_exception(exc)
        else:
            future.set_result(result)  # type: ignore[arg-type]

    def target() -> None:
        result: T | None = None
        exc: BaseException | None = None
        try:
            result = fn()
        except BaseException as caught:
            exc = caught
        with contextlib.suppress(RuntimeError):  # the loop has closed: nobody is waiting
            loop.call_soon_threadsafe(settle, result, exc)

    # Mark a late exception as retrieved, so an abandoned worker logs nothing on its own.
    future.add_done_callback(lambda f: f.cancelled() or f.exception())
    threading.Thread(target=target, name=name, daemon=True).start()
    return future


class _Context:
    """The ``RunContext`` an action's ``run`` gets. Called from the worker thread."""

    def __init__(
        self,
        active_run: _ActiveRun,
        analyst: Analyst,
        connections: RunConnections,
    ) -> None:
        self._active_run = active_run
        self._analyst = analyst
        self._connections = connections
        self._hooks: dict[str, Hook] = {}
        self._lock = threading.Lock()
        self.details: dict[str, DetailValue] = {}
        self.deadline_at = _utcnow()

    @property
    def analyst(self) -> Analyst:
        return self._analyst

    @property
    def deadline(self) -> datetime:
        return self.deadline_at

    def hook(self, connection: str) -> Hook:
        if connection not in self._connections.names:
            raise ValueError(f"The action did not declare the connection {connection}")
        with self._lock:
            if self._active_run.stopping.is_set():
                raise _Stopped
            if connection not in self._hooks:
                self._hooks[connection] = self._connections.hook(connection)
            return self._hooks[connection]

    def hooks(self) -> list[Hook]:
        with self._lock:
            return list(self._hooks.values())

    def detail(self, key: str, value: DetailValue) -> None:
        if not isinstance(key, str) or not isinstance(value, str | int | float | bool):
            raise TypeError("a run detail is a string key with a string, number or bool value")
        self.details[sanitise_nul(key)] = sanitise_nul(value)

    def declare_columns(self, columns: Sequence[Column]) -> None:
        self._active_run.builder.declare(columns)


class _ActiveRun:
    """One run executing in this process."""

    def __init__(
        self,
        runner: Runner,
        run: Run,
        action: Action | Sink,
        params: Mapping[str, Any],
        run_input: RunInput | None,
        analyst: Analyst,
        connections: RunConnections,
        trace_id: str,
    ) -> None:
        settings = runner.settings
        self._runner = runner
        self.run = run
        self._action = action
        self._params = params
        self._input = run_input
        self._trace_id = trace_id
        self.cancel_requested = asyncio.Event()
        self.stopping = threading.Event()
        self._write_lock = asyncio.Lock()
        self._closed = False
        self._loop = asyncio.get_running_loop()
        query = action if isinstance(action, Action) else None
        self.builder = ResultBuilder(
            query.columns if query else None,
            query.row_id(params) if query else None,
            max_rows=settings.max_result_rows,
            max_bytes=settings.max_result_bytes,
        )
        self.ctx = _Context(self, analyst, connections)

    # --- worker thread ----------------------------------------------------------------

    def _work(self) -> None:
        if isinstance(self._action, Sink):
            assert self._input is not None  # noqa: S101 - start_run gives every sink its input
            self._action.run(self._input.columns, self._input.rows, self.ctx)
            return
        rows: Iterable[Mapping[str, Any]] = self._action.run(self._params, self.ctx)
        iterator = iter(rows)
        try:
            batch: list[RunRow] = []
            batch_start = 0
            for row in iterator:
                if self.stopping.is_set():
                    raise _Stopped
                batch.append(self.builder.add(row))
                if len(batch) >= BATCH_ROWS or self.builder.byte_count - batch_start >= BATCH_BYTES:
                    self._flush(batch)
                    batch, batch_start = [], self.builder.byte_count
            self._flush(batch)
        finally:
            close = getattr(iterator, "close", None)
            if close is not None:
                close()

    def _flush(self, batch: list[RunRow]) -> None:
        if batch:
            asyncio.run_coroutine_threadsafe(self._write(batch), self._loop).result()

    async def _write(self, batch: list[RunRow]) -> None:
        async with self._write_lock:
            if self._closed:
                raise _Stopped
            await self._runner.store.add_rows(self.run.run_id, batch)

    # --- event loop -------------------------------------------------------------------

    async def execute(self) -> Run:
        """Run the action and store the final state. Never raises, except on shutdown."""
        settings = self._runner.settings
        timeout = settings.run_timeout_seconds
        started = time.monotonic()
        try:
            if not await self._take_slot():
                return await self._finish(RunStatus.CANCELLED, started)
            try:
                started = time.monotonic()
                self.ctx.deadline_at = self._runner.clock() + timedelta(seconds=timeout)
                worker = _in_thread(self._work, f"tim-run-{self.run.run_id}")
                cancel = asyncio.ensure_future(self.cancel_requested.wait())
                waiting: set[asyncio.Future[Any]] = {worker, cancel}
                try:
                    done, _ = await asyncio.wait(
                        waiting, timeout=timeout, return_when=asyncio.FIRST_COMPLETED
                    )
                finally:
                    cancel.cancel()
                if worker in done:
                    return await self._outcome(worker, started)
                await self._stop(worker)
                if cancel in done:
                    return await self._finish(RunStatus.CANCELLED, started)
                return await self._finish(
                    RunStatus.TIMED_OUT, started, error=TIMEOUT_MESSAGE.format(seconds=timeout)
                )
            finally:
                self._runner.slots.release()
        except asyncio.CancelledError:
            # Shutdown: best effort, so the run doesn't wait for the next startup sweep.
            self.stopping.set()
            _in_thread(self._cancel_hooks, f"tim-run-{self.run.run_id}-cancel")
            await self._finish(RunStatus.ERROR, started, error=INTERRUPTED_MESSAGE)
            raise

    async def _take_slot(self) -> bool:
        """Wait for a concurrency slot; ``False`` when the run is cancelled first."""
        slots = self._runner.slots
        acquire = asyncio.ensure_future(slots.acquire())
        cancel = asyncio.ensure_future(self.cancel_requested.wait())
        waiting: set[asyncio.Future[Any]] = {acquire, cancel}
        try:
            await asyncio.wait(waiting, return_when=asyncio.FIRST_COMPLETED)
        except BaseException:
            if acquire.done() and not acquire.cancelled():
                slots.release()
            raise
        finally:
            cancel.cancel()
            if not acquire.done():
                acquire.cancel()
        if acquire.done() and not acquire.cancelled():
            if not self.cancel_requested.is_set():
                return True
            slots.release()
        return False

    def _cancel_hooks(self) -> None:
        for hook in self.ctx.hooks():
            try:
                hook.cancel()
            except Exception:
                logger.exception("Hook.cancel() of run %s failed", self.run.run_id)

    async def _stop(self, worker: asyncio.Future[None]) -> None:
        """Stop the worker: no more rows are written, and each hook is cancelled. Returns once
        every ``Hook.cancel()`` has returned or the worker has exited."""
        self.stopping.set()
        async with self._write_lock:
            self._closed = True
        cancelled = _in_thread(self._cancel_hooks, f"tim-run-{self.run.run_id}-cancel")
        await asyncio.wait(
            {worker, cancelled}, timeout=CANCEL_GRACE_SECONDS, return_when=asyncio.FIRST_COMPLETED
        )

    async def _outcome(self, worker: asyncio.Future[None], started: float) -> Run:
        exc = worker.exception()
        if exc is None:
            return await self._finish(RunStatus.SUCCEEDED, started)
        if isinstance(exc, RunError | ResultLimitError):
            logger.info("Run %s failed: %s", self.run.run_id, type(exc).__name__)
            return await self._finish(RunStatus.ERROR, started, error=str(exc))
        logger.error(
            "Run %s failed unexpectedly (traceId=%s)",
            self.run.run_id,
            self._trace_id,
            exc_info=(type(exc), exc, exc.__traceback__),
        )
        return await self._finish(RunStatus.ERROR, started, error=GENERIC_ERROR_MESSAGE)

    async def _finish(self, status: RunStatus, started: float, *, error: str | None = None) -> Run:
        async with self._write_lock:
            self._closed = True
        # Only a query action's succeeded run keeps rows; a sink's never does.
        kept = status is RunStatus.SUCCEEDED and self._input is None
        details: dict[str, DetailValue] = {"duration": round(time.monotonic() - started, 3)}
        if self._input is not None:
            details["inputRowCount"] = len(self._input.rows)
        if kept:
            details["rowCount"] = self.builder.row_count
        own = {k: v for k, v in self.ctx.details.items() if k not in details}
        details.update(own)
        if kept:
            warnings = self.builder.warnings()
            if warnings:
                details["warning"] = "; ".join(
                    [str(details["warning"]), *warnings] if "warning" in details else warnings
                )
        now = self._runner.clock()
        try:
            return await self._runner.store.finish(
                self.run.run_id,
                status=status,
                finished_at=now,
                expires_at=now + timedelta(seconds=self._runner.settings.run_retention_seconds),
                details=details,
                columns=self.builder.columns() if kept else None,
                row_count=self.builder.row_count if kept else None,
                error=sanitise_nul(error) if error is not None else None,
            )
        except Exception:
            logger.exception("Could not store the outcome of run %s", self.run.run_id)
            return self.run


class Runner:
    """Starts, cancels and tracks the runs this process executes."""

    def __init__(
        self,
        store: RunStore,
        settings: Settings,
        *,
        slots: asyncio.Semaphore,
        race_seconds: float = RACE_SECONDS,
        clock: Clock = _utcnow,
        cancel_poll_seconds: float = CANCEL_POLL_SECONDS,
    ) -> None:
        self.store = store
        self.settings = settings
        self.slots = slots
        self.clock = clock
        self._race_seconds = race_seconds
        self._cancel_poll_seconds = cancel_poll_seconds
        self._active: dict[UUID, tuple[_ActiveRun, asyncio.Task[Run]]] = {}
        self._watcher: asyncio.Task[None] | None = None

    def _expires(self) -> datetime:
        return self.clock() + timedelta(seconds=self.settings.run_retention_seconds)

    async def start(
        self,
        action: Action | Sink,
        params: Mapping[str, Any],
        *,
        run_input: RunInput | None = None,
        analyst: Analyst,
        owner: str,
        connections: RunConnections,
        trace_id: str,
    ) -> Run:
        """Store the run, execute it, and return the run as it is after the race. A sink's run
        writes ``run_input``."""
        run = Run(
            run_id=uuid4(),
            status=RunStatus.RUNNING,
            action=RunAction(key=action.key, name=action.name),
            params=sanitise_nul(to_json_value(params)),
            owner=owner,
            started_at=self.clock(),
            expires_at=self._expires(),
        )
        await self.store.create(run)
        active_run = _ActiveRun(
            self, run, action, params, run_input, analyst, connections, trace_id
        )
        task = asyncio.create_task(active_run.execute(), name=f"tim-run-{run.run_id}")
        self._active[run.run_id] = (active_run, task)
        task.add_done_callback(lambda _t: self._active.pop(run.run_id, None))
        # asyncio.wait neither cancels the task on timeout nor passes a client disconnect on.
        done, _ = await asyncio.wait({task}, timeout=self._race_seconds)
        return task.result() if task in done else run

    async def cancel(self, run: Run) -> Run:
        """Cancel a running run, wherever it executes, and return it as it is after the race.
        A run that has ended is returned unchanged."""
        if run.status is not RunStatus.RUNNING:
            return run
        await self.store.request_cancel(run.run_id)
        local = self._active.get(run.run_id)
        if local is None:
            return run
        active_run, task = local
        active_run.cancel_requested.set()
        done, _ = await asyncio.wait({task}, timeout=self._race_seconds)
        return task.result() if task in done else run

    def start_watching(self) -> None:
        """Poll for cancel requests made through other processes."""
        self._watcher = asyncio.create_task(self._watch(), name="tim-run-cancel-watcher")

    async def _watch(self) -> None:
        while True:
            await asyncio.sleep(self._cancel_poll_seconds)
            if not self._active:
                continue
            try:
                requested = await self.store.cancel_requested(set(self._active))
            except Exception:
                logger.exception("Polling for run cancel requests failed")
                continue
            for run_id in requested:
                local = self._active.get(run_id)
                if local is not None:
                    local[0].cancel_requested.set()

    async def mark_stale(self) -> int:
        """Startup sweep: runs left ``running`` longer than the timeout become ``error``."""
        now = self.clock()
        try:
            count = await self.store.mark_stale_running_as_error(
                now - timedelta(seconds=self.settings.run_timeout_seconds),
                message=INTERRUPTED_MESSAGE,
                finished_at=now,
                expires_at=self._expires(),
            )
        except Exception:
            logger.exception("Stale run sweep failed")
            return 0
        if count:
            logger.warning("Marked %d interrupted run(s) as error", count)
        return count

    async def aclose(self) -> None:
        """Shutdown: runs in flight end as ``error``."""
        if self._watcher is not None:
            self._watcher.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._watcher
        tasks = [task for _, task in self._active.values()]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
