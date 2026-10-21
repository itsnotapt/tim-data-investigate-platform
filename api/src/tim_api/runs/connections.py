"""The instance's connections, as runs reach them: one hook per connection per run."""

from __future__ import annotations

from typing import Protocol

from fastapi import Request
from tim_actions import Analyst, Hook


class Connections(Protocol):
    def hook(self, name: str, analyst: Analyst) -> Hook:
        """A new hook for the connection ``name``, acting as ``analyst``. Raises
        ``LookupError`` when there is no such connection."""
        ...


class NoConnections:
    """An instance with no connections configured."""

    def hook(self, name: str, analyst: Analyst) -> Hook:
        raise LookupError(f"No connection named {name}")


def get_connections(request: Request) -> Connections:
    connections: Connections = request.app.state.connections
    return connections
