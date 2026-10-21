"""Scripted action types for API tests: actions whose behaviour the test spells out."""

from collections.abc import Iterator, Mapping
from typing import Any

from tim_actions import Action, Hook, RunContext


class Rows(Action):
    """Yields the rows it is configured with."""

    rows: tuple[dict[str, Any], ...] = ()

    def run(self, params: Mapping[str, Any], ctx: RunContext) -> Iterator[Mapping[str, Any]]:
        yield from self.rows


class FileRows(Rows):
    """A file-capable action type."""

    type_name = "rows"


class OtherFileRows(Rows):
    type_name = "rows"


class FakeKustoHook(Hook):
    connection_type = "kusto"

    def cancel(self) -> None:
        pass


class OtherKustoHook(FakeKustoHook):
    pass
