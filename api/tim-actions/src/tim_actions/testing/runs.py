"""Runs of actions and sinks, as TIM's runner makes them."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from tim_actions.action import Action, Sink, run_connection_names
from tim_actions.columns import Column
from tim_actions.connections import Connection
from tim_actions.hooks import Hook, TokenFor
from tim_actions.params import validate_params
from tim_actions.rows import MAX_ID_CHARS, canonical_id, id_warnings
from tim_actions.run import Analyst, DetailValue

DEFAULT_ANALYST = Analyst("Alice", "alice@example.com")


@dataclass(frozen=True)
class RunResult:
    """What a run of an action gave: its rows as yielded, each row's ``id`` in the text form TIM
    stores (``None`` for none), the declared columns and the run details.

    ``columns`` are the action's own, then those ``run`` declared; a name keeps its first
    declaration. TIM adds the undeclared columns of the rows after them.
    """

    rows: list[dict[str, Any]]
    ids: list[str | None]
    columns: list[Column]
    details: dict[str, DetailValue]


def _token_for(scope: str) -> str:
    return f"token for {scope}"


class Connections:
    """The connections a test's runs reach, as a connections file gives them, each with the hook
    that answers for it. A hook class is built per run with ``token_for``, as TIM builds it with
    the analyst's tokens."""

    def __init__(self, token_for: TokenFor = _token_for) -> None:
        self.token_for = token_for
        self._connections: dict[str, tuple[Connection, type[Hook] | None]] = {}
        self._answering: dict[str, type[Hook]] = {}

    def answer(self, connection_type: str, hook: type[Hook]) -> None:
        """Answer the connections of ``connection_type`` added without a hook with ``hook``, as
        a fake such as ``tim_kusto`` does."""
        self._answering[connection_type] = hook

    def add(self, connection: Connection, hook: type[Hook] | None = None) -> None:
        """Add ``connection``, answered by ``hook``, or else by the hook answering its connection
        type when a run reaches it."""
        self._connections[connection.name] = (connection, hook)

    def types(self) -> dict[str, str]:
        """Each connection's type, by name."""
        return {name: connection.type for name, (connection, _) in self._connections.items()}

    def hook(self, name: str) -> Hook:
        """A new hook for the connection ``name``."""
        if name not in self._connections:
            raise LookupError(f"No connection named {name}: add it to the connections")
        connection, hook = self._connections[name]
        hook = hook or self._answering.get(connection.type)
        if hook is None:
            raise LookupError(
                f"No hook answers the {connection.type} connection {name}: add it with a hook, "
                "or use the fixture that fakes its connection type"
            )
        return hook(connection, self.token_for)


@dataclass(frozen=True)
class SinkResult:
    """What a run of a sink gave: its run details."""

    details: dict[str, DetailValue]


class _Context:
    """The ``RunContext`` a run gets, recording what ``run`` reports."""

    def __init__(
        self,
        analyst: Analyst,
        deadline: datetime,
        columns: Sequence[Column],
        connections: Connections,
        declared: frozenset[str],
    ) -> None:
        self._analyst = analyst
        self._deadline = deadline
        self._connections = connections
        self._declared = declared
        self._hooks: dict[str, Hook] = {}
        self.columns: dict[str, Column] = {column.name: column for column in columns}
        self.details: dict[str, DetailValue] = {}

    @property
    def analyst(self) -> Analyst:
        return self._analyst

    @property
    def deadline(self) -> datetime:
        return self._deadline

    def hook(self, connection: str) -> Hook:
        if connection not in self._declared:
            raise ValueError(f"The action did not declare the connection {connection}")
        if connection not in self._hooks:
            self._hooks[connection] = self._connections.hook(connection)
        return self._hooks[connection]

    def detail(self, key: str, value: DetailValue) -> None:
        if not isinstance(key, str) or not isinstance(value, str | int | float | bool):
            raise TypeError("a run detail is a string key with a string, number or bool value")
        self.details[key] = value

    def declare_columns(self, columns: Sequence[Column]) -> None:
        for column in columns:
            self.columns.setdefault(column.name, column)


def run_action(
    action: Action,
    params: Mapping[str, Any] | None = None,
    *,
    connections: Connections | None = None,
    analyst: Analyst = DEFAULT_ANALYST,
    timeout: timedelta = timedelta(seconds=30),
) -> RunResult:
    """Run ``action`` with ``params``, as wire values, for ``analyst``, reaching
    ``connections``. Raises ``ParamsError`` for params TIM would refuse, ``TypeError`` for a row
    that isn't a mapping or a bad run detail, and whatever ``run`` raises."""
    connections = connections or Connections()
    values = validate_params(action.params, params or {}, connections=connections.types())
    row_id = action.row_id(values)
    ctx = _Context(
        analyst,
        datetime.now(UTC) + timeout,
        action.columns or (),
        connections,
        run_connection_names(action, values),
    )
    rows: list[dict[str, Any]] = []
    for row in action.run(values, ctx):
        if not isinstance(row, Mapping):
            raise TypeError(f"run yielded a {type(row).__name__}, not a mapping")
        rows.append(dict(row))
    ids = [canonical_id(row_id(row)) if row_id else None for row in rows]
    long_ids = sum(1 for id in ids if id is not None and len(id) > MAX_ID_CHARS)
    ids = [None if id is not None and len(id) > MAX_ID_CHARS else id for id in ids]
    seen = list(dict.fromkeys(name for row in rows for name in row))
    _add_warnings(ctx.details, id_warnings(row_id, seen, long_ids))
    return RunResult(rows=rows, ids=ids, columns=list(ctx.columns.values()), details=ctx.details)


def _add_warnings(details: dict[str, DetailValue], warnings: list[str]) -> None:
    """Add ``warnings`` to the ``warning`` run detail, after the one ``run`` reported."""
    if warnings:
        details["warning"] = "; ".join(
            [str(details["warning"]), *warnings] if "warning" in details else warnings
        )


def run_sink(
    sink: Sink,
    rows: Sequence[Mapping[str, Any]],
    *,
    columns: Sequence[Column] | None = None,
    connections: Connections | None = None,
    analyst: Analyst = DEFAULT_ANALYST,
    timeout: timedelta = timedelta(seconds=30),
) -> SinkResult:
    """Run ``sink`` on ``rows``, whose columns are ``columns``, for ``analyst``, reaching
    ``connections``. Without ``columns``, each column of the rows, in first-seen order, is a
    ``string`` column. Raises ``TypeError`` for a bad run detail, and whatever ``run``
    raises."""
    if columns is None:
        names = dict.fromkeys(name for row in rows for name in row)
        columns = [Column(name, "string") for name in names]
    ctx = _Context(
        analyst,
        datetime.now(UTC) + timeout,
        (),
        connections or Connections(),
        run_connection_names(sink, {}),
    )
    sink.run(columns, rows, ctx)
    return SinkResult(details=ctx.details)
