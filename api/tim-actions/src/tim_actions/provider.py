"""Providers: what an installed package adds to an instance."""

from __future__ import annotations

from collections.abc import Sequence

from pydantic import ConfigDict, model_validator
from pydantic.dataclasses import dataclass

from tim_actions.action import Action
from tim_actions.hooks import Hook

ENTRY_POINT_GROUP = "tim.actions"
"""The entry-point group TIM discovers providers in. An entry point names a callable that
returns a ``Provider``."""


@dataclass(frozen=True, config=ConfigDict(extra="forbid", arbitrary_types_allowed=True))
class Provider:
    """Actions, file-capable action types and connection types' hooks."""

    actions: Sequence[Action] = ()
    action_types: Sequence[type[Action]] = ()
    hooks: Sequence[type[Hook]] = ()

    @model_validator(mode="after")
    def _check(self) -> Provider:
        for action_type in self.action_types:
            if not action_type.type_name:
                raise ValueError(f"action_types: {action_type.__name__} has no type_name")
        for hook in self.hooks:
            if not getattr(hook, "connection_type", None):
                raise ValueError(f"hooks: {hook.__name__} has no connection_type")
        return self
