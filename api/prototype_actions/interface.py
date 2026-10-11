"""PROTOTYPE, throwaway: the interface TIM would give action packages.

Everything an action author touches is in this file. TIM's side (discovery, the run loop, the
catalogue sent to the browser) is in ``tim_side.py``; the actions are in ``builtin.py`` and the
``contoso_tim_actions`` package.

Shape, in Airflow terms:

* ``Action`` is the operator base class. A subclass that implements ``run`` is an **action type**
  (``KqlQuery``, ``SnowflakeQuery``, ``RunKql``); an instance of it is an **action**.
* ``Connection`` is per-instance config (an Airflow connection). ``Hook`` is built from one per
  action run with the analyst's identity, so ``get_conn()`` runs as the analyst.
* Packages expose actions and hook types through the ``tim.actions`` entry-point group.
"""

from __future__ import annotations

import hashlib
import json
from abc import ABC, abstractmethod
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any, ClassVar, Literal

Row = dict[str, Any]

# --- identity and connections ----------------------------------------------------------------


@dataclass(frozen=True)
class Analyst:
    """The analyst the run is for. ``token`` is for hooks (OBO); actions should not need it."""

    oid: str
    upn: str
    name: str
    tenant_id: str
    token: str = field(repr=False)


@dataclass(frozen=True)
class Connection:
    """One preconfigured backend endpoint of this instance (the "Connections and auth" ticket
    decides the config format; this is only what a hook receives)."""

    name: str
    backend: str  # matches Hook.backend
    endpoint: str
    auth: Literal["obo", "external_oauth", "managed_identity", "service_account"]
    extra: dict[str, Any] = field(default_factory=dict)


class Hook(ABC):
    """Backend access for one action run. Built per run, never shared across analysts."""

    backend: ClassVar[str]

    def __init__(self, connection: Connection, analyst: Analyst) -> None:
        self.connection = connection
        self.analyst = analyst

    @abstractmethod
    def get_conn(self) -> Any:
        """The backend's own client, authenticated as the analyst where the backend supports it."""

    def cancel(self) -> None:
        """Stop what this hook is running (timeout or the analyst's cancel). Called from another
        thread while ``run`` is blocked in the backend client."""

    def editor_schema(self, scope: dict[str, Any]) -> dict[str, Any] | None:
        """Completion schema for KQL/SQL editors, e.g. ``{"database": "Security"}`` -> Kusto's
        ``.show schema as json``. Served by ``POST /api/connections/{name}/schema``; None: no
        completion for this backend."""
        return None


# --- params, pivots, columns -----------------------------------------------------------------

ParamKind = Literal["string", "int", "datetime", "choice", "connection", "kql", "sql", "json"]


@dataclass(frozen=True)
class Param:
    """A form input. TIM validates and converts values before ``run`` sees them."""

    name: str
    kind: ParamKind = "string"
    label: str | None = None
    required: bool = True
    default: Any = None
    many: bool = False  # a list of values, e.g. one per selected row
    choices: Sequence[str] = ()  # kind="choice"
    backend: str | None = None  # kind="connection": TIM offers this instance's connections
    # kind="kql"/"sql": the params naming the connection and scope the editor's schema is for.
    schema_from: Sequence[str] = ()
    # Default pivot resolution: fill from the first of these columns found in the context.
    # Also what the context menu is filtered on (see Action.pivot_columns).
    from_columns: Sequence[str] = ()


@dataclass(frozen=True)
class PivotContext:
    """What the browser sends when an analyst picks an action from the context menu."""

    row: Row  # the clicked row
    rows: list[Row]  # the selected rows; [row] when nothing is selected
    column: str | None  # the clicked cell's column
    value: Any  # the clicked cell's value


ColumnType = Literal["string", "number", "bool", "datetime", "timespan", "json"]


@dataclass(frozen=True)
class Column:
    name: str
    type: ColumnType = "string"
    hidden: bool = False


# --- row ids ---------------------------------------------------------------------------------

IdFn = Callable[[Row], str]


def hash_values(row: Row) -> str:
    """The fallback ``id``: a hash of every column name and value in the row."""
    canonical = json.dumps(row, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()[:32]


def from_columns(*names: str) -> IdFn:
    """``id`` from the named columns: the value itself for one column, else a hash of them."""

    def row_id(row: Row) -> str:
        if len(names) == 1:
            return str(row[names[0]])
        return hash_values({name: row[name] for name in names})

    return row_id


def first_of(*names: str, fallback: IdFn = hash_values) -> IdFn:
    """``id`` from the first named column present in the row, else ``fallback``."""

    def row_id(row: Row) -> str:
        for name in names:
            if row.get(name) not in (None, ""):
                return str(row[name])
        return fallback(row)

    return row_id


# --- the run ---------------------------------------------------------------------------------


class RunContext:
    """What ``run`` gets besides its params. TIM builds one per action run."""

    def __init__(self, analyst: Analyst, hooks: Callable[[str], Hook]) -> None:
        self.analyst = analyst
        self._hooks = hooks
        self.details: dict[str, Any] = {}
        self.columns: list[Column] | None = None

    def hook(self, connection: str) -> Hook:
        """The hook for a named connection, built for this run's analyst."""
        return self._hooks(connection)

    def detail(self, key: str, value: Any) -> None:
        """Add a run detail. TIM adds ``duration`` and ``rowCount`` itself."""
        self.details[key] = value

    def declare_columns(self, columns: list[Column]) -> None:
        """Columns learnt while running (Run KQL gets them from Kusto); overrides Action.columns."""
        self.columns = columns


@dataclass(kw_only=True)
class Action(ABC):
    """An operation analysts run. Subclass and implement ``run`` to make an action type."""

    key: str  # stable across releases: share links, saved params and run records use it
    name: str
    menu: Sequence[str] = ()  # path in the New menu and the context menu
    description: str = ""
    params: Sequence[Param] = ()
    pivot: Literal["none", "row", "rows"] = "row"  # offered on one row, a selection, or never
    columns: Sequence[Column] | None = None  # None: TIM infers them (ISO-8601 dates detected)
    id: IdFn  # required: hash_values is a choice the author makes, never a silent default

    def pivot_columns(self) -> list[list[str]]:
        """Columns the context menu is filtered on: every group needs one column in the row.

        Defaults to the ``from_columns`` of each required param. Override when ``resolve`` is.
        """
        return [list(p.from_columns) for p in self.params if p.required and p.from_columns]

    def resolve(self, context: PivotContext) -> dict[str, Any]:
        """Params for a pivot. Missing required params leave the form open instead of running."""
        resolved: dict[str, Any] = {}
        for param in self.params:
            if not param.from_columns:
                continue
            rows = context.rows if param.many else [context.row]
            values = [v for row in rows if (v := _first_present(row, param.from_columns))]
            if values:
                resolved[param.name] = list(dict.fromkeys(values)) if param.many else values[0]
        return resolved

    def row_id(self, params: dict[str, Any]) -> IdFn:
        """The ``id`` for this run. Override to let a param choose it (Run KQL's ``idColumn``)."""
        return self.id

    @abstractmethod
    def run(self, params: dict[str, Any], ctx: RunContext) -> Iterable[Row]:
        """Yield result rows. Synchronous: TIM runs it in a worker thread and cancels through
        the hooks it handed out."""


def _first_present(row: Row, names: Sequence[str]) -> Any:
    return next((row[n] for n in names if row.get(n) not in (None, "")), None)


# --- discovery -------------------------------------------------------------------------------


@dataclass(frozen=True)
class Provider:
    """What a package's ``tim.actions`` entry point returns."""

    name: str
    actions: Sequence[Action] = ()
    hooks: Sequence[type[Hook]] = ()
    # Action types that can be written as action files (see action_files.py), by type_name.
    action_types: Sequence[type[Action]] = ()
