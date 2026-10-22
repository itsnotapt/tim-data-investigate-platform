"""Hooks: how actions reach a connection type's backend."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, ClassVar

from tim_actions import connections

TokenFor = Callable[[str], str]
"""Gives an access token for a scope, on behalf of the run's analyst. Raises when the token can't
be had; TIM gets each ``obo`` connection's token before the run starts, so a hook's call is
normally answered from the token cache."""


@dataclass(frozen=True)
class EditorSchema:
    """What a ``kql``/``sql`` editor completes from: ``kind`` picks the browser's adapter."""

    kind: str
    schema: Any


class Hook(ABC):
    """Access to one connection of a connection type, built per run as the analyst.

    ``Connection`` validates the connection type's entries in the connections file. ``editor``
    is the kind of editor its queries are written in (``kql``, ``sql``), if any.
    """

    connection_type: ClassVar[str]
    Connection: ClassVar[type[connections.Connection]] = connections.Connection
    editor: ClassVar[str | None] = None

    def __init__(self, connection: connections.Connection, token_for: TokenFor) -> None:
        self.connection = connection
        self.token_for = token_for

    @abstractmethod
    def cancel(self) -> None:
        """Stop the work in progress. Called from another thread on timeout or cancel."""

    def editor_schema(self, scope: dict[str, Any]) -> EditorSchema | None:
        """The editor schema for ``scope``, or ``None`` if the connection type has none.

        ``scope`` holds the values of the editor param's ``schema_from`` params, by name,
        without its ``connection`` param. Raises ``RunError``, with a message for the analyst,
        when the schema can't be had.
        """
        return None
