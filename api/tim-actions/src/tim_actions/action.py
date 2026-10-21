"""Actions: the operations analysts run, as configured instances of an action type."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Iterable, Mapping, Sequence
from typing import Annotated, Any, ClassVar, Literal

from pydantic import BaseModel, StringConstraints, model_validator

from tim_actions._common import STRICT, NonBlankStr
from tim_actions.columns import Column
from tim_actions.params import Param
from tim_actions.run import RunContext

ActionKey = Annotated[str, StringConstraints(pattern=r"^[a-z0-9_.-]+$")]
"""Lowercase letters, digits, ``_``, ``-`` and ``.``; the ``tim.`` prefix is TIM's own."""

Pivot = Literal["row", "rows", "none"]


class Action(BaseModel, ABC):
    """A query action. An action type subclasses this, adds its own configuration fields and
    implements ``run``; each instance is one action.

    ``menu`` is a ``/``-separated folder path. ``pivot``, which has no default, says whether the
    action is offered on one row, several rows or not at all in the grid's context menu. ``id`` is
    the column, or alternatives where the first non-empty one wins, that gives each row its
    ``id``.
    """

    model_config = STRICT | {"frozen": True}

    type_name: ClassVar[str | None] = None
    """Set by action types that action files can name."""

    key: ActionKey
    name: NonBlankStr
    menu: str = ""
    description: NonBlankStr | None = None
    params: Sequence[Param] = ()
    pivot: Pivot
    columns: Sequence[Column] | None = None
    id: NonBlankStr | Sequence[NonBlankStr] | None = None

    @model_validator(mode="after")
    def _check(self) -> Action:
        if self.menu and not all(part.strip() for part in self.menu.split("/")):
            raise ValueError("menu: every folder in the path must be non-blank")
        names = [param.name for param in self.params]
        if len(set(names)) != len(names):
            raise ValueError("params: names must be unique")
        for param in self.params:
            unknown = [name for name in param.schema_from if name not in names]
            if unknown:
                raise ValueError(f"params.{param.name}.schema_from: unknown params {unknown}")
        if self.columns is not None:
            column_names = [column.name for column in self.columns]
            if len(set(column_names)) != len(column_names):
                raise ValueError("columns: names must be unique")
        if self.id is not None and not self.id:
            raise ValueError("id: give a column name, or leave id out")
        return self

    @property
    def menu_path(self) -> list[str]:
        return [part.strip() for part in self.menu.split("/")] if self.menu else []

    def connections(self) -> tuple[str, ...]:
        """The names of the fixed connections this action uses."""
        return ()

    def pivot_columns(self) -> list[list[str]]:
        """The context menu's filter: a row needs one column from each group. Each
        required param's ``from_columns`` is a group."""
        return [list(p.from_columns) for p in self.params if p.required and p.from_columns]

    @abstractmethod
    def run(self, params: Mapping[str, Any], ctx: RunContext) -> Iterable[Mapping[str, Any]]:
        """Yield the result rows. Runs synchronously, in a worker thread."""
