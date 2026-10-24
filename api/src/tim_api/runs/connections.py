"""The instance's connections, as runs reach them: one hook per connection per run, acting as the
run's analyst."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from typing import Any

from fastapi import Request
from tim_actions import Action, Connection, Hook, RunError, Sink

from tim_api.auth.obo import OboError, OboTokenProvider
from tim_api.auth.principal import Principal


def run_connection_names(action: Action | Sink, params: Mapping[str, Any]) -> frozenset[str]:
    """The connections a run uses: the action's fixed ones and its connection params' values."""
    names = set(action.connections())
    if isinstance(action, Sink):
        return frozenset(names)
    names.update(
        str(params[p.name])
        for p in action.params
        if p.kind == "connection" and params.get(p.name) is not None
    )
    return frozenset(names)


class RunConnections:
    """The connections of one run. Each hook gets its tokens on behalf of the run's analyst."""

    def __init__(
        self,
        connections: Mapping[str, Connection],
        hooks: Mapping[str, type[Hook]],
        principal: Principal,
        obo: OboTokenProvider,
    ) -> None:
        self._connections = connections
        self._hooks = hooks
        self._principal = principal
        self._obo = obo

    @property
    def names(self) -> frozenset[str]:
        return frozenset(self._connections)

    def hook(self, name: str) -> Hook:
        """A new hook for the connection ``name``."""
        connection = self._connections[name]
        return self._hooks[connection.type](connection, self._token_for)

    def _token_for(self, scope: str) -> str:
        try:
            return self._obo.token_for(self._principal, scope)
        except OboError as exc:
            raise RunError(str(exc)) from None


class Connections:
    """The connections in the connections file, with the hooks of their connection types."""

    def __init__(
        self, connections: Mapping[str, Connection], hooks: Mapping[str, type[Hook]]
    ) -> None:
        self._connections = dict(connections)
        self._hooks = dict(hooks)

    def types(self) -> dict[str, str]:
        """Each connection's type, by name."""
        return {name: c.type for name, c in self._connections.items()}

    async def open(
        self, names: frozenset[str], principal: Principal, obo: OboTokenProvider
    ) -> RunConnections:
        """The connections ``names``, for a run by ``principal``, after getting each ``obo``
        connection's token, so consent and sign-in problems raise ``OboError`` before the run
        exists."""
        connections = {name: self._connections[name] for name in sorted(names)}
        for connection in connections.values():
            if connection.obo_scope is not None:
                await asyncio.to_thread(obo.token_for, principal, connection.obo_scope)
        return RunConnections(connections, self._hooks, principal, obo)


def get_connections(request: Request) -> Connections:
    connections: Connections = request.app.state.connections
    return connections
