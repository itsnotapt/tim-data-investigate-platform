"""``lookup``: a connection type with a static table in the connections file, and an action type
that looks keys up in it. No external system is reached."""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from typing import Any, Literal

from tim_actions import Action, Connection, ConnectionName, Hook, RunContext, RunError


class LookupConnection(Connection):
    """A lookup table: each key's fields. Nothing is behind it, so it runs as TIM."""

    type: Literal["lookup"]
    auth: Literal["workload_identity"]
    entries: dict[str, dict[str, str]]


class LookupHook(Hook):
    """Access to one lookup connection's table."""

    connection_type = "lookup"
    Connection = LookupConnection

    connection: LookupConnection

    def get_conn(self) -> Mapping[str, Mapping[str, str]]:
        """The table: each key's fields."""
        return self.connection.entries

    def cancel(self) -> None:
        """Nothing to stop: a lookup returns at once."""


class LookupAction(Action):
    """Each of the ``keys`` param's values, with its fields from a lookup connection. A key
    missing from the table gives a row with no fields."""

    connection: ConnectionName
    key_column: str

    def connections(self) -> Mapping[str, str]:
        return {self.connection: "lookup"}

    def run(self, params: Mapping[str, Any], ctx: RunContext) -> Iterator[Mapping[str, Any]]:
        hook = ctx.hook(self.connection)
        if not isinstance(hook, LookupHook):
            raise RunError(f"{self.connection} is not a lookup connection")
        table = hook.get_conn()
        for key in params["keys"]:
            yield {self.key_column: key, **table.get(key, {})}
