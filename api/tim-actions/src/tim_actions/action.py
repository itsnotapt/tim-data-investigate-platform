"""Actions: the operations analysts run, as configured instances of an action type."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Iterable, Mapping, Sequence
from typing import TYPE_CHECKING, Annotated, Any, ClassVar, Literal, Self

from pydantic import BaseModel, StringConstraints, field_validator

from tim_actions._common import STRICT, NonBlankStr
from tim_actions.columns import Column
from tim_actions.params import Param
from tim_actions.pivots import PivotContext, Resolved, resolve_from_columns
from tim_actions.rows import IdColumns, RowId
from tim_actions.run import RunContext

if TYPE_CHECKING:
    from tim_actions.files import ActionDocument

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
    """Set by action types that action files can name, with ``File``."""
    File: ClassVar[type[ActionDocument] | None] = None
    """The model an action file of this type is validated against."""

    key: ActionKey
    name: NonBlankStr
    menu: str = ""
    description: NonBlankStr | None = None
    params: Sequence[Param] = ()
    pivot: Pivot
    columns: Sequence[Column] | None = None
    id: NonBlankStr | Sequence[NonBlankStr] | None = None

    @field_validator("menu")
    @classmethod
    def _menu(cls, value: str) -> str:
        if value and not all(part.strip() for part in value.split("/")):
            raise ValueError("every folder in the path must be non-blank")
        return value

    @field_validator("params")
    @classmethod
    def _params(cls, value: Sequence[Param]) -> Sequence[Param]:
        names = [param.name for param in value]
        if len(set(names)) != len(names):
            raise ValueError("names must be unique")
        for param in value:
            unknown = [name for name in param.schema_from if name not in names]
            if unknown:
                raise ValueError(f"{param.name}.schema_from: unknown params {unknown}")
        return value

    @field_validator("columns")
    @classmethod
    def _columns(cls, value: Sequence[Column] | None) -> Sequence[Column] | None:
        if value is not None:
            names = [column.name for column in value]
            if len(set(names)) != len(names):
                raise ValueError("names must be unique")
        return value

    @field_validator("id")
    @classmethod
    def _id(cls, value: str | Sequence[str] | None) -> str | Sequence[str] | None:
        if value is not None and not value:
            raise ValueError("give a column name, or leave id out")
        return value

    @classmethod
    def from_file(cls, file: ActionDocument) -> Self:
        """Build the action from its validated document in an action file. The default passes the
        document's fields, all but ``type``, through by name; override it when the action type's
        fields differ."""
        return cls.model_validate({name: value for name, value in file if name != "type"})

    @property
    def menu_path(self) -> list[str]:
        return [part.strip() for part in self.menu.split("/")] if self.menu else []

    def connections(self) -> Mapping[str, str]:
        """The fixed connections this action uses: each name and the connection type it must
        be."""
        return {}

    def pivot_columns(self) -> list[list[str]]:
        """The context menu's filter: a row needs one column from each group. Each
        required param's ``from_columns`` is a group."""
        return [list(p.from_columns) for p in self.params if p.required and p.from_columns]

    def resolve(self, context: PivotContext) -> Resolved:
        """The params a pivot from ``context``'s rows gives this action. The default reads each
        param's ``from_columns``; override it, with ``pivot_columns()``, for logic that needs
        code."""
        return resolve_from_columns(self.params, context)

    def row_id(self, params: Mapping[str, Any]) -> RowId | None:
        """How each row of a run with these params gets its ``id``, or ``None`` for no ``id``.
        The default reads the action's ``id`` columns; override it for any other scheme, such as
        a composite key or an id column chosen by a param."""
        if self.id is None:
            return None
        return IdColumns([self.id] if isinstance(self.id, str) else self.id)

    @abstractmethod
    def run(self, params: Mapping[str, Any], ctx: RunContext) -> Iterable[Mapping[str, Any]]:
        """Yield the result rows. Runs synchronously, in a worker thread. Raise ``RunError``
        to end the run in error with a message the analyst sees; any other exception ends it
        with a generic message."""
