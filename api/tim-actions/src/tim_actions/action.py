"""Actions: the operations analysts run, as configured instances of an action type."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Annotated, Any, ClassVar, Literal, Self

from pydantic import BaseModel, StringConstraints, field_validator

from tim_actions._common import STRICT, NonBlankStr
from tim_actions.columns import Column
from tim_actions.params import Param, validate_params
from tim_actions.pivots import PivotContext, Resolved, resolve_from_columns
from tim_actions.rows import IdColumns, RowId
from tim_actions.run import RunContext

if TYPE_CHECKING:
    from tim_actions.files import ActionDocument, DocumentBase, SinkDocument

ActionKey = Annotated[str, StringConstraints(pattern=r"^[a-z0-9_.-]+$")]
"""Lowercase letters, digits, ``_``, ``-`` and ``.``; the ``tim.`` prefix is TIM's own."""

Pivot = Literal["row", "rows", "none"]

QueryParameterType = Literal["string", "long", "real", "bool", "datetime", "timespan", "dynamic"]


@dataclass(frozen=True)
class QueryParameter:
    """A query parameter of a preset: a name in its query, declared with ``type`` (``string``,
    ``long``, ``real``, ``bool``, ``datetime``, ``timespan`` or ``dynamic``). It is fixed to
    ``value``, or with ``from_columns`` filled from the rows; no columns asks the analyst."""

    name: str
    type: QueryParameterType
    value: Any = None
    from_columns: tuple[str, ...] | None = None


class ActionBase(BaseModel, ABC):
    """What query actions and sinks share: the key, name, menu folder path and description, the
    fixed connections, and how an action file builds one.

    ``menu`` is a ``/``-separated folder path.
    """

    model_config = STRICT | {"frozen": True}

    type_name: ClassVar[str | None] = None
    """Set by action types that action files can name, with ``File``."""

    key: ActionKey
    name: NonBlankStr
    menu: str = ""
    description: NonBlankStr | None = None

    @field_validator("menu")
    @classmethod
    def _menu(cls, value: str) -> str:
        if value and not all(part.strip() for part in value.split("/")):
            raise ValueError("every folder in the path must be non-blank")
        return value

    @classmethod
    def from_file(cls, file: DocumentBase) -> Self:
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


class Action(ActionBase):
    """A query action. An action type subclasses this, adds its own configuration fields and
    implements ``run``; each instance is one action.

    ``pivot``, which has no default, says whether the action is offered on one row, several rows
    or not at all in the grid's context menu. ``id`` is the column, or alternatives where the
    first non-empty one wins, that gives each row its ``id``.
    """

    File: ClassVar[type[ActionDocument] | None] = None
    """The model an action file of this type is validated against."""

    params: Sequence[Param] = ()
    pivot: Pivot
    columns: Sequence[Column] | None = None
    id: NonBlankStr | Sequence[NonBlankStr] | None = None

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

    def check_params(
        self, values: Mapping[str, Any], *, connections: Mapping[str, str] | None = None
    ) -> dict[str, Any]:
        """Validate ``values`` when a run starts and return them converted, keyed by param name;
        raises ``ParamsError``. The default checks each value against its param
        (``validate_params``); override it to check more, such as the entries of a ``json``
        param."""
        return validate_params(self.params, values, connections=connections)

    def preset_file(
        self,
        *,
        key: str,
        name: str,
        menu: str,
        params: Mapping[str, Any],
        query_parameters: Sequence[QueryParameter],
    ) -> ActionDocument | None:
        """The action file document of an action that runs what a preset of this action runs:
        ``params`` are the preset's fixed values, ``query_parameters`` its query parameters.
        ``None`` when the preset has none; by default no preset of this action has one."""
        return None

    @property
    def has_preset_file(self) -> bool:
        """Whether a preset of this action has an action file: its type overrides
        ``preset_file``."""
        return type(self).preset_file is not Action.preset_file

    @property
    def takes_query_parameters(self) -> bool:
        """Whether the action takes query parameters: it has a ``json`` param named
        ``parameters``."""
        return any(p.name == "parameters" and p.kind == "json" for p in self.params)

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


class Sink(ActionBase):
    """A sink: an action that takes the selected rows and writes them somewhere. An action type
    subclasses this, adds its own configuration fields and implements ``run``.

    A sink has no params, no column requirements and no ``id``; it is offered on any selected
    rows.
    """

    File: ClassVar[type[SinkDocument] | None] = None
    """The model an action file of this type is validated against."""

    @abstractmethod
    def run(
        self, columns: Sequence[Column], rows: Sequence[Mapping[str, Any]], ctx: RunContext
    ) -> None:
        """Write ``rows``, whose columns are ``columns``. Runs synchronously, in a worker thread.
        Raise ``RunError`` to end the run in error with a message the analyst sees; any other
        exception ends it with a generic message."""


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


ActionType = type[Action] | type[Sink]
"""A query action type or a sink type."""
