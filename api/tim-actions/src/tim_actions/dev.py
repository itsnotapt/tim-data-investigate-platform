"""Development actions, which TIM registers only with ``TIM_DEV_ACTIONS`` (ADR-0011): rows an
analyst pastes, Run KQL on a connection with a fixed editor schema, an action file type that gives
rows, a sink type that discards them, delays and errors for e2e scenarios, and that connection
type."""

from __future__ import annotations

import time
from collections.abc import Iterator, Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

from pydantic import Field, StrictInt, field_validator, model_validator

from tim_actions._common import NonBlankStr
from tim_actions.action import Action, QueryParameter, Sink
from tim_actions.columns import TIM_COLUMNS, Column
from tim_actions.connections import Connection
from tim_actions.files import ActionDocument, SinkDocument
from tim_actions.hooks import EditorSchema, Hook
from tim_actions.params import Param
from tim_actions.pivots import first_value
from tim_actions.provider import Provider
from tim_actions.query_parameters import QUERY_PARAMETER_TYPES, TakesQueryParameters
from tim_actions.run import DetailValue, RunContext, RunError


class DevJson(Action):
    """``tim.dev_json``: yields the rows of its ``rows`` param."""

    def run(self, params: Mapping[str, Any], ctx: RunContext) -> Iterator[Mapping[str, Any]]:
        rows = params["rows"]
        if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
            raise RunError("Rows must be a JSON array of objects")
        yield from rows


DEV_JSON = DevJson(
    key="tim.dev_json",
    name="JSON (development)",
    menu="Development",
    description="Rows pasted as JSON. As a pivot, the selected rows.",
    params=(Param("rows", "json", title="Rows", help="A JSON array of objects, one per row"),),
    pivot="rows",
)


class DevRunKql(TakesQueryParameters):
    """``tim.dev_run_kql``: Run KQL's params and query parameters on a ``dev_kql`` connection,
    declared as Run KQL declares them. It runs nothing and yields no rows."""

    parameter_types = QUERY_PARAMETER_TYPES

    def declare_statement(self, query_parameters: Sequence[QueryParameter]) -> str:
        from tim_actions.kusto import RUN_KQL

        return RUN_KQL.declare_statement(query_parameters)

    def run(self, params: Mapping[str, Any], ctx: RunContext) -> Iterator[Mapping[str, Any]]:
        self.parameter_entries(params)
        yield from ()


DEV_RUN_KQL = DevRunKql(
    key="tim.dev_run_kql",
    name="Run KQL (development)",
    menu="Development",
    description="Run KQL's query and query parameters on a dev_kql connection. Yields no rows.",
    params=(
        Param("connection", "connection", title="Connection", connection_type="dev_kql"),
        Param("database", "string", title="Database"),
        Param("kql", "kql", title="Query", schema_from=("connection", "database")),
        Param(
            "parameters",
            "json",
            title="Query parameters",
            required=False,
            help="[{name, type, value}]: declared before the query",
        ),
    ),
    pivot="none",
)


_FILTER_KINDS = ("string", "number", "boolean")


def _same(value: Any, wanted: Any) -> bool:
    """Equal, where a boolean never equals a number (Python's ``True == 1``)."""
    return isinstance(value, bool) == isinstance(wanted, bool) and value == wanted


_GENERATED_FROM = datetime(2026, 1, 1, tzinfo=UTC)


def _generated(column: Column, n: int) -> Any:
    """The value of ``column`` in generated row ``n``."""
    match column.type:
        case "string":
            return f"{column.name}-{n}"
        case "number":
            return n
        case "bigint":
            return 2**64 + n
        case "boolean":
            return n % 2 == 0
        case "datetime":
            return (_GENERATED_FROM + timedelta(minutes=n)).isoformat().replace("+00:00", "Z")
        case "timespan":
            return f"PT{n}S"
        case "json":
            return {"n": n}


class DevRowsFile(ActionDocument):
    rows: tuple[dict[str, Any], ...] = ()
    generate: Annotated[StrictInt, Field(ge=0)] = 0
    delay: Annotated[float, Field(ge=0, strict=True)] = 0
    error: NonBlankStr | None = None
    details: dict[str, DetailValue] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _rows_or_generate(self) -> DevRowsFile:
        if self.rows and self.generate:
            raise ValueError("give rows or generate, not both")
        return self


class DevRows(Action):
    """``dev_rows``: reports its ``details`` and waits ``delay`` seconds, then fails with
    ``error`` or yields its ``rows``. ``generate`` rows are numbered from 1, each with a value
    made from the row number for every declared column but TIM's own, or only ``n`` without
    ``columns``.

    Only the rows that match every param with ``from_columns`` and a value are yielded.

    Nothing is reached through a hook, so a cancelled or timed-out run ends at once; the wait
    itself ends at the delay or the run's deadline."""

    type_name = "dev_rows"
    File = DevRowsFile

    rows: tuple[dict[str, Any], ...] = ()
    generate: int = 0
    delay: float = 0
    error: str | None = None
    details: Mapping[str, DetailValue] = Field(default_factory=dict)

    @field_validator("params")
    @classmethod
    def _filters(cls, value: Sequence[Param]) -> Sequence[Param]:
        for param in value:
            if param.from_columns and param.kind not in _FILTER_KINDS:
                raise ValueError(
                    "from_columns filter only string, number and boolean params, not "
                    f"{param.name} ({param.kind})"
                )
        return value

    def _kept(self, row: Mapping[str, Any], params: Mapping[str, Any]) -> bool:
        """Whether ``row`` matches every param that has a value and ``from_columns``."""
        for param in self.params:
            wanted = params.get(param.name)
            if wanted is None or not param.from_columns:
                continue
            value = first_value(row, param.from_columns)
            if not any(_same(value, each) for each in (wanted if param.many else [wanted])):
                return False
        return True

    def _rows(self) -> Iterator[Mapping[str, Any]]:
        yield from self.rows
        for n in range(1, self.generate + 1):
            if self.columns is None:
                yield {"n": n}
            else:
                yield {
                    column.name: _generated(column, n)
                    for column in self.columns
                    if column.name not in TIM_COLUMNS
                }

    def run(self, params: Mapping[str, Any], ctx: RunContext) -> Iterator[Mapping[str, Any]]:
        for key, value in self.details.items():
            ctx.detail(key, value)
        _wait(self.delay, ctx)
        if self.error is not None:
            raise RunError(self.error)
        yield from (row for row in self._rows() if self._kept(row, params))


def _wait(delay: float, ctx: RunContext) -> None:
    """Sleep ``delay`` seconds, or until the run's deadline."""
    if delay:
        until_deadline = (ctx.deadline - datetime.now(UTC)).total_seconds()
        time.sleep(max(0, min(delay, until_deadline)))


class DevSinkFile(SinkDocument):
    delay: Annotated[float, Field(ge=0, strict=True)] = 0
    error: NonBlankStr | None = None


class DevSink(Sink):
    """``dev_sink``: waits ``delay`` seconds, then fails with ``error`` or discards the rows.
    The wait ends at the delay or the run's deadline."""

    type_name = "dev_sink"
    File = DevSinkFile

    delay: float = 0
    error: str | None = None

    def run(
        self, columns: Sequence[Column], rows: Sequence[Mapping[str, Any]], ctx: RunContext
    ) -> None:
        _wait(self.delay, ctx)
        if self.error is not None:
            raise RunError(self.error)


class DevKqlConnection(Connection):
    """A ``dev_kql`` connection: nothing behind it, so nothing to sign in to. ``databases`` are
    suggestions for the analyst, as on a Kusto connection."""

    type: Literal["dev_kql"]
    auth: Literal["workload_identity"]
    databases: tuple[NonBlankStr, ...] | None = None

    def database_suggestions(self) -> tuple[str, ...] | None:
        return self.databases


_DEV_KQL_TABLES = {
    "SignIns": (
        ("TimeGenerated", "datetime"),
        ("UserPrincipalName", "string"),
        ("ResultType", "string"),
    ),
}


class DevKqlHook(Hook):
    """``dev_kql``: a connection type whose ``kql`` editor schema is the same few tables for any
    database, so e2e flows can complete a query without Kusto. It runs no queries."""

    connection_type = "dev_kql"
    Connection = DevKqlConnection
    editor = "kql"

    def cancel(self) -> None:
        pass

    def editor_schema(self, scope: dict[str, Any]) -> EditorSchema | None:
        """``.show schema as json`` of ``_DEV_KQL_TABLES`` for the scope's ``database``; ``None``
        without one."""
        database = scope.get("database")
        if not isinstance(database, str) or not database:
            return None
        tables = {
            name: {
                "Name": name,
                "OrderedColumns": [{"Name": c, "CslType": t} for c, t in columns],
            }
            for name, columns in _DEV_KQL_TABLES.items()
        }
        schema = {"Databases": {database: {"Name": database, "Tables": tables, "Functions": {}}}}
        return EditorSchema("kql", schema)


def provider() -> Provider:
    """The development actions, action types and connection type."""
    return Provider(
        actions=[DEV_JSON, DEV_RUN_KQL], action_types=[DevRows, DevSink], hooks=[DevKqlHook]
    )
