"""Providers: what an installed package adds to an instance."""

from __future__ import annotations

from collections.abc import Sequence
from importlib.resources.abc import Traversable

from pydantic import ConfigDict, model_validator
from pydantic.dataclasses import dataclass

from tim_actions.action import Action, ActionType, Sink
from tim_actions.hooks import Hook

ENTRY_POINT_GROUP = "tim.actions"
"""The entry-point group TIM discovers providers in. An entry point names a callable that
returns a ``Provider``."""


@dataclass(frozen=True, config=ConfigDict(extra="forbid", arbitrary_types_allowed=True))
class Provider:
    """Actions and sinks, file-capable action types and connection types' hooks.

    ``action_files`` is a directory of action files in the package's data, such as
    ``importlib.resources.files("acme_tim") / "actions"``.
    """

    actions: Sequence[Action | Sink] = ()
    action_types: Sequence[ActionType] = ()
    hooks: Sequence[type[Hook]] = ()
    action_files: Traversable | None = None

    @model_validator(mode="after")
    def _check(self) -> Provider:
        for action_type in self.action_types:
            if not action_type.type_name:
                raise ValueError(f"action_types: {action_type.__name__} has no type_name")
            if action_type.File is None:
                raise ValueError(f"action_types: {action_type.__name__} has no File model")
        for hook in self.hooks:
            if not getattr(hook, "connection_type", None):
                raise ValueError(f"hooks: {hook.__name__} has no connection_type")
        return self
