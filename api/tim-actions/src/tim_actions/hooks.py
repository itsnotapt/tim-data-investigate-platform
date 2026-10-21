"""Hooks: how actions reach a connection type's backend."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, ClassVar


@dataclass(frozen=True)
class EditorSchema:
    """What a ``kql``/``sql`` editor completes from: ``kind`` picks the browser's adapter."""

    kind: str
    schema: Any


class Hook(ABC):
    """Access to one connection of a connection type, built per run as the analyst."""

    connection_type: ClassVar[str]

    @abstractmethod
    def cancel(self) -> None:
        """Stop the work in progress. Called from another thread on timeout or cancel."""

    def editor_schema(self, scope: dict[str, Any]) -> EditorSchema | None:
        """The editor schema for ``scope`` (the values of a param's ``schema_from``), if any."""
        return None
