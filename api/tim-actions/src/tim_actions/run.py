"""What an action's ``run`` gets besides its params."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from tim_actions.columns import Column
from tim_actions.hooks import Hook


@dataclass(frozen=True)
class Analyst:
    """The analyst a run is for: display name and user principal name."""

    name: str
    upn: str


DetailValue = str | int | float | bool


class RunContext(Protocol):
    """Given to ``Action.run`` by TIM."""

    @property
    def analyst(self) -> Analyst: ...

    @property
    def deadline(self) -> datetime:
        """When the run times out (UTC), for hooks that pass a server timeout on."""
        ...

    def hook(self, connection: str) -> Hook:
        """The hook for one of the connections the action declared, as the analyst."""
        ...

    def detail(self, key: str, value: DetailValue) -> None:
        """Report a run detail; a ``warning`` key gets a warning icon."""
        ...

    def declare_columns(self, columns: Sequence[Column]) -> None:
        """Declare result columns, such as types the backend reports."""
        ...
