"""Scripted action types for API tests: actions whose behaviour the test spells out."""

from __future__ import annotations

import threading
from collections.abc import Iterator, Mapping
from typing import Annotated, Any, ClassVar

from tim_actions import (
    Action,
    ActionDocument,
    Column,
    Connection,
    DetailValue,
    Hook,
    RunContext,
    RunError,
    Sidecar,
    TokenFor,
)


class Rows(Action):
    """Yields the rows it is configured with, after reporting its ``details`` and declaring
    ``run_columns``. With ``generate``, yields that many rows ``{"n": <row number>}`` instead."""

    rows: tuple[dict[str, Any], ...] = ()
    generate: int = 0
    details: tuple[tuple[str, DetailValue], ...] = ()
    run_columns: tuple[Column, ...] = ()

    def run(self, params: Mapping[str, Any], ctx: RunContext) -> Iterator[Mapping[str, Any]]:
        for key, value in self.details:
            ctx.detail(key, value)
        if self.run_columns:
            ctx.declare_columns(self.run_columns)
        if self.generate:
            yield from ({"n": n} for n in range(self.generate))
        yield from self.rows


class Echo(Action):
    """Yields one row holding the params it was run with, and the analyst."""

    def run(self, params: Mapping[str, Any], ctx: RunContext) -> Iterator[Mapping[str, Any]]:
        yield {**params, "analyst": ctx.analyst.upn}


class CancellableHook(Hook):
    """A connection whose work ends when it is cancelled. Every hook built is kept in
    ``built``."""

    connection_type = "fake"
    built: ClassVar[list[CancellableHook]] = []

    def __init__(self, connection: Connection, token_for: TokenFor) -> None:
        super().__init__(connection, token_for)
        CancellableHook.built.append(self)
        self.cancelled = threading.Event()
        self.cancel_threads: list[str] = []

    def cancel(self) -> None:
        self.cancel_threads.append(threading.current_thread().name)
        self.cancelled.set()


class WaitUntilCancelled(Action):
    """Yields ``rows``, then waits on its connection's hook until it is cancelled, giving up
    after 30 s."""

    connection: str = "fake"
    rows: tuple[dict[str, Any], ...] = ()

    def connections(self) -> Mapping[str, str]:
        return {self.connection: "fake"}

    def run(self, params: Mapping[str, Any], ctx: RunContext) -> Iterator[Mapping[str, Any]]:
        hook = ctx.hook(self.connection)
        assert isinstance(hook, CancellableHook)
        yield from self.rows
        hook.cancelled.wait(30)


class SafeError(Action):
    """Yields ``rows``, then fails with a message the analyst may see."""

    rows: tuple[dict[str, Any], ...] = ()
    message: str = "The sign-in log is unavailable"

    def run(self, params: Mapping[str, Any], ctx: RunContext) -> Iterator[Mapping[str, Any]]:
        yield from self.rows
        raise RunError(self.message)


class Unexpected(Action):
    """Yields ``rows``, then fails with an exception whose message holds internals."""

    rows: tuple[dict[str, Any], ...] = ()

    def run(self, params: Mapping[str, Any], ctx: RunContext) -> Iterator[Mapping[str, Any]]:
        yield from self.rows
        raise RuntimeError("connection string Password=hunter2 rejected")


class UndeclaredHook(Action):
    """Asks for a connection it didn't declare."""

    def run(self, params: Mapping[str, Any], ctx: RunContext) -> Iterator[Mapping[str, Any]]:
        ctx.hook("elsewhere")
        yield {}


class RowsFile(ActionDocument):
    rows: tuple[dict[str, Any], ...] = ()


class FileRows(Rows):
    """A file-capable action type: yields the rows its action file gives."""

    type_name = "rows"
    File = RowsFile


class OtherFileRows(Rows):
    type_name = "rows"
    File = RowsFile


class LinesFile(ActionDocument):
    text: Annotated[str, Sidecar()]


class FileLines(Action):
    """A file-capable action type whose text can come from a sidecar: one row per line."""

    type_name = "lines"
    File = LinesFile

    text: str

    def run(self, params: Mapping[str, Any], ctx: RunContext) -> Iterator[Mapping[str, Any]]:
        for line in self.text.splitlines():
            yield {"line": line}


class FakeKustoHook(Hook):
    connection_type = "kusto"

    def cancel(self) -> None:
        pass


class OtherKustoHook(FakeKustoHook):
    pass
