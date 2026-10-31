"""The ``snowflake`` connection type and the built-in Run SQL action. Needs the ``snowflake``
extra."""

from __future__ import annotations

import json
import math
import re
import threading
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time
from decimal import Decimal
from typing import Annotated, Any, ClassVar, Literal, Protocol, cast

import snowflake.connector
from pydantic import field_validator
from snowflake.connector import errors as sf_errors

from tim_actions import connections
from tim_actions._common import NonBlankStr
from tim_actions.action import Action, QueryParameter, QueryParameterType
from tim_actions.columns import Column, ColumnType
from tim_actions.connections import Connection, ConnectionName
from tim_actions.files import ActionDocument, Sidecar
from tim_actions.hooks import EditorSchema, Hook, TokenFor
from tim_actions.params import Param, ParamKind
from tim_actions.query_parameters import (
    QUERY_PARAMETER_TYPES,
    TakesQueryParameters,
    params_and_values,
)
from tim_actions.run import RunContext, RunError

# --- the connection type ----------------------------------------------------------------


# ``<org>-<account>``, or a legacy ``<locator>[.<region>[.<cloud>]]``. The connector signs in at
# ``<account>.snowflakecomputing.com``.
_ACCOUNT = re.compile(r"^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$")


class SnowflakeConnection(Connection):
    """A Snowflake account, reached with ``warehouse`` and, if given, ``role``. ``obo`` signs in
    as the analyst through External OAuth, with a token for ``scope``; ``workload_identity``
    signs in as TIM's workload identity."""

    type: Literal["snowflake"]
    auth: Literal["obo", "workload_identity"]
    account: NonBlankStr
    warehouse: NonBlankStr
    role: NonBlankStr | None = None

    @field_validator("account")
    @classmethod
    def _account(cls, value: str) -> str:
        if not _ACCOUNT.match(value):
            raise ValueError(
                "must be an account identifier, such as myorg-myaccount, not a URL or host name"
            )
        return value


# --- values -------------------------------------------------------------------------------

# By the connector's type code (``FIELD_ID_TO_NAME``); ``string`` for the rest.
_COLUMN_TYPES: dict[int, ColumnType] = {
    0: "number",  # FIXED
    1: "number",  # REAL
    3: "datetime",  # DATE
    4: "datetime",  # TIMESTAMP
    5: "json",  # VARIANT
    6: "datetime",  # TIMESTAMP_LTZ
    7: "datetime",  # TIMESTAMP_TZ
    8: "datetime",  # TIMESTAMP_NTZ
    9: "json",  # OBJECT
    10: "json",  # ARRAY
    13: "boolean",  # BOOLEAN
    14: "json",  # GEOGRAPHY
    15: "json",  # GEOMETRY
    16: "json",  # VECTOR
    17: "json",  # MAP
}


def _seconds(value: datetime | time) -> str:
    """The value's seconds and their fraction, trimmed of trailing zeros."""
    frac = f"{value.microsecond:06d}".rstrip("0")
    return f"{value:%S}.{frac}" if frac else f"{value:%S}"


def _datetime(value: datetime) -> str:
    """ISO 8601 in UTC, the fraction trimmed of trailing zeros, with a ``Z`` suffix. A value
    without a time zone (``TIMESTAMP_NTZ``) is taken as UTC."""
    if value.tzinfo is not None:
        value = value.astimezone(UTC)
    return f"{value:%Y-%m-%dT%H:%M:}{_seconds(value)}Z"


def _number(value: Decimal | float) -> float | str:
    """A float when it survives the round trip, else the exact string; ``NaN``, ``Infinity``
    and ``-Infinity`` as strings."""
    as_float = float(value)
    if not math.isfinite(as_float):
        return json.dumps(as_float)
    if isinstance(value, float) or Decimal(repr(as_float)) == value:
        return as_float
    return str(value)


def _json(value: str) -> Any:
    try:
        return json.loads(value)
    except ValueError:
        return value


def _value(column_type: ColumnType, value: Any) -> Any:
    """A value of a Snowflake column, from the connector, as TIM stores it."""
    if value is None or (isinstance(value, bool | int | str) and column_type != "json"):
        return value
    if isinstance(value, datetime):
        return _datetime(value)
    if isinstance(value, date):
        return f"{value.isoformat()}T00:00:00Z"
    if isinstance(value, time):
        return f"{value:%H:%M:}{_seconds(value)}"
    if isinstance(value, Decimal | float):
        return _number(value)
    if isinstance(value, bytes | bytearray):
        return value.hex()
    if column_type == "json":
        return _json(value) if isinstance(value, str) else value
    return str(value)


@dataclass(frozen=True)
class SnowflakeResult:
    """A query's result: its columns and its rows."""

    columns: tuple[Column, ...]
    rows: list[dict[str, Any]]


def _result(description: Sequence[Any], raw_rows: Sequence[Sequence[Any]]) -> SnowflakeResult:
    columns = tuple(Column(d.name, _COLUMN_TYPES.get(d.type_code, "string")) for d in description)
    rows = [
        {c.name: _value(c.type, v) for c, v in zip(columns, raw, strict=True)} for raw in raw_rows
    ]
    return SnowflakeResult(columns, rows)


_MAX_ERROR_CHARS = 2000


def error_message(exc: sf_errors.Error) -> str:
    """Snowflake's message, without the connector's error code and ids."""
    return (exc.raw_msg or str(exc)).strip()[:_MAX_ERROR_CHARS]


# --- binding ------------------------------------------------------------------------------

BIND_KINDS: tuple[ParamKind, ...] = ("string", "number", "boolean", "datetime", "json")
"""The param kinds whose values Snowflake binds."""


def _json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def bind_value(kind: ParamKind, value: Any, *, many: bool = False) -> Any:
    """What is bound for ``value``, of param kind ``kind``: JSON text for a list (``many``) and
    for JSON, which the query parses with ``PARSE_JSON``; the value itself for the rest, a
    datetime in UTC. ``None`` is bound as ``NULL``."""
    if kind not in BIND_KINDS:
        raise ValueError(f"a {kind} param can't be bound in Snowflake")
    if value is None:
        return None
    if many:
        return _json_text([_datetime(v) if kind == "datetime" else v for v in value])
    if kind == "json":
        return _json_text(value)
    return value


def bind_values(params: Sequence[Param], values: Mapping[str, Any]) -> list[Any]:
    """What is bound for validated param ``values``, in the order of ``params``: ``:1`` is the
    first param's value. A param without a value is bound as ``NULL``."""
    return [bind_value(p.kind, values.get(p.name), many=p.many) for p in params]


# --- the editor schema -------------------------------------------------------------------


def _identifier(name: str) -> str:
    """``name`` as a quoted identifier."""
    return '"' + name.replace('"', '""') + '"'


def _columns_query(database: str) -> str:
    return (
        "SELECT table_schema, table_name, column_name, data_type"  # noqa: S608 - quoted identifier
        f" FROM {_identifier(database)}.INFORMATION_SCHEMA.COLUMNS"
        " WHERE table_schema <> 'INFORMATION_SCHEMA'"
        " ORDER BY table_schema, table_name, ordinal_position"
    )


def _query_rows(cursor: SdkCursor, command: str) -> list[dict[str, Any]]:
    cursor.execute(command)
    names = [d.name.lower() for d in cursor.description or ()]
    return [dict(zip(names, row, strict=True)) for row in cursor.fetchall()]


def _database_tree(name: str, columns: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """``{name, schemas: [{name, tables: [{name, columns: [{name, type}]}]}]}``, in the order of
    ``columns``."""
    schemas: dict[str, dict[str, list[dict[str, str]]]] = {}
    for c in columns:
        table = schemas.setdefault(c["table_schema"], {}).setdefault(c["table_name"], [])
        table.append({"name": c["column_name"], "type": c["data_type"]})
    return {
        "name": name,
        "schemas": [
            {"name": schema, "tables": [{"name": t, "columns": cs} for t, cs in tables.items()]}
            for schema, tables in schemas.items()
        ],
    }


# --- the hook -----------------------------------------------------------------------------


class SdkCursor(Protocol):
    """The slice of ``snowflake.connector.cursor.SnowflakeCursor`` the hook uses."""

    @property
    def description(self) -> Sequence[Any] | None: ...

    def execute(self, command: str) -> object: ...

    def execute_async(
        self, command: str, params: Sequence[Any] | None = None
    ) -> dict[str, Any]: ...

    def get_results_from_sfqid(self, sfqid: str) -> None: ...

    def fetchall(self) -> Sequence[Sequence[Any]]: ...

    def abort_query(self, qid: str) -> bool: ...


class SdkConnection(Protocol):
    """The slice of ``snowflake.connector.SnowflakeConnection`` the hook uses."""

    def cursor(self) -> SdkCursor: ...

    def close(self) -> None: ...


def _connect(**kwargs: Any) -> SdkConnection:
    return cast(SdkConnection, snowflake.connector.connect(**kwargs))


class SnowflakeHook(Hook):
    """Runs SQL on one Snowflake account, with one login per query.

    A query runs asynchronously, so ``cancel`` can abort it by its query id.
    ``connect_factory`` is ``snowflake.connector.connect``.
    """

    connection_type = "snowflake"
    Connection = SnowflakeConnection
    editor = "sql"
    connect_factory: ClassVar[staticmethod[..., SdkConnection]] = staticmethod(_connect)

    connection: SnowflakeConnection

    def __init__(self, connection: connections.Connection, token_for: TokenFor) -> None:
        super().__init__(connection, token_for)
        self._lock = threading.Lock()
        self._running: tuple[SdkConnection, str] | None = None  # the login and its query id
        self._cancelled = False

    def get_conn(self, *, deadline: datetime | None = None) -> SdkConnection:
        """A login to the account, as the connection's auth says, in a session whose time zone
        is UTC, with the time left until ``deadline``, if given, as each statement's timeout."""
        login: dict[str, Any] = {
            "account": self.connection.account,
            "warehouse": self.connection.warehouse,
            "paramstyle": "numeric",
            # Close always logs out, which ends a query still running on the login.
            "enable_server_session_keep_alive_auto_detection": False,
        }
        if self.connection.role is not None:
            login["role"] = self.connection.role
        if self.connection.obo_scope is not None:
            login |= {"authenticator": "oauth", "token": self.token_for(self.connection.obo_scope)}
        else:
            login |= {"authenticator": "WORKLOAD_IDENTITY", "workload_identity_provider": "AZURE"}
        # A bound datetime is UTC with its offset dropped; Snowflake reads it in this time zone.
        session: dict[str, Any] = {"TIMEZONE": "UTC"}
        if deadline is not None:
            seconds = max(int((deadline - datetime.now(UTC)).total_seconds()), 1)
            session["STATEMENT_TIMEOUT_IN_SECONDS"] = seconds
        login["session_parameters"] = session
        return self.connect_factory(**login)

    def query(self, sql: str, *, deadline: datetime, params: Sequence[Any] = ()) -> SnowflakeResult:
        """Run ``sql`` with ``params`` bound server-side by position, ``:1`` the first, and the
        time left until ``deadline`` as its timeout. Raises ``RunError`` with Snowflake's message
        when the login or the query fails."""
        self._refuse_if_cancelled()
        try:
            conn = self.get_conn(deadline=deadline)
            try:
                cursor = conn.cursor()
                query_id = cursor.execute_async(sql, list(params) or None)["queryId"]
                with self._lock:
                    self._running = (conn, query_id)
                    cancelled = self._cancelled
                if cancelled:  # cancel came while the query was being sent
                    cursor.abort_query(query_id)
                cursor.get_results_from_sfqid(query_id)
                rows = cursor.fetchall()
                description = cursor.description or ()
            finally:
                with self._lock:
                    self._running = None
                conn.close()
        except sf_errors.Error as exc:
            self._refuse_if_cancelled()
            raise RunError(error_message(exc)) from None
        return _result(description, rows)

    def editor_schema(self, scope: dict[str, Any]) -> EditorSchema:
        """The tree of the account's databases the login can see: ``{databases: [{name, schemas:
        [{name, tables: [{name, columns: [{name, type}]}]}]}]}``, from each database's
        ``INFORMATION_SCHEMA``. A database whose columns can't be read is left out."""
        try:
            conn = self.get_conn()
            try:
                cursor = conn.cursor()
                databases = []
                for database in _query_rows(cursor, "SHOW TERSE DATABASES"):
                    try:
                        columns = _query_rows(cursor, _columns_query(database["name"]))
                    except sf_errors.ProgrammingError:
                        continue
                    databases.append(_database_tree(database["name"], columns))
            finally:
                conn.close()
        except sf_errors.Error as exc:
            raise RunError(error_message(exc)) from None
        return EditorSchema("sql", {"databases": databases})

    def cancel(self) -> None:
        """Abort the query in progress, and refuse new ones."""
        with self._lock:
            self._cancelled = True
            running = self._running
        if running is not None:
            conn, query_id = running
            conn.cursor().abort_query(query_id)

    def _refuse_if_cancelled(self) -> None:
        with self._lock:
            if self._cancelled:
                raise RunError("The query was cancelled")


# --- Run SQL ------------------------------------------------------------------------------


BOUND_PARAMETER_TYPES: Mapping[QueryParameterType, ParamKind] = {
    name: kind for name, kind in QUERY_PARAMETER_TYPES.items() if name != "timespan"
}
"""The types a Run SQL query parameter can be, each with the param kind of its value. Snowflake
has no ``timespan``."""


class RunSql(TakesQueryParameters):
    """``tim.run_sql``: ad-hoc SQL on a Snowflake connection, its query parameters bound by
    position."""

    parameter_types = BOUND_PARAMETER_TYPES

    def preset_file(
        self,
        *,
        key: str,
        name: str,
        menu: str,
        params: Mapping[str, Any],
        query_parameters: Sequence[QueryParameter],
        id_column: str | None,
    ) -> SnowflakeQueryFile | None:
        """A ``snowflake_query`` action with the preset's connection, SQL and Id column, and its
        query parameters as params in their order (``preset_file_params``); ``None`` when the
        preset lacks the connection or SQL."""
        file_params = self.preset_file_params(params, query_parameters, ("connection", "sql"))
        if file_params is None:
            return None
        return SnowflakeQueryFile(
            type="snowflake_query",
            key=key,
            name=name,
            menu=menu,
            pivot=file_params.pivot,
            connection=params["connection"],
            sql=params["sql"],
            id=id_column,
            params=file_params.params,
        )

    def run(self, params: Mapping[str, Any], ctx: RunContext) -> Iterator[Mapping[str, Any]]:
        entries = self.parameter_entries(params)
        binds = bind_values(*params_and_values(entries))
        yield from _run_query(ctx, params["connection"], params["sql"], binds)


def _run_query(
    ctx: RunContext, connection: str, sql: str, params: Sequence[Any]
) -> Iterator[Mapping[str, Any]]:
    """Run ``sql`` with ``params`` bound by position on ``connection``, as a run of ``ctx``:
    Snowflake's columns are declared."""
    hook = ctx.hook(connection)
    if not isinstance(hook, SnowflakeHook):
        raise RunError(f"{connection} is not a Snowflake connection")
    result = hook.query(sql, deadline=ctx.deadline, params=params)
    ctx.declare_columns(result.columns)
    yield from result.rows


RUN_SQL = RunSql(
    key="tim.run_sql",
    name="Run SQL",
    description="Ad-hoc SQL on a Snowflake connection.",
    params=(
        Param("connection", "connection", title="Connection", connection_type="snowflake"),
        Param("sql", "sql", title="Query", schema_from=("connection",)),
        Param(
            "parameters",
            "json",
            title="Query parameters",
            required=False,
            help="[{name, type, value}]: bound by position, :1 the first",
        ),
    ),
    pivot="none",
)


# --- snowflake_query ----------------------------------------------------------------------


class SnowflakeQueryFile(ActionDocument):
    connection: ConnectionName
    sql: Annotated[NonBlankStr, Sidecar()]


class SnowflakeQuery(Action):
    """``snowflake_query``: fixed SQL on a fixed Snowflake connection. Its params are bound
    server-side by position, in the order they are declared: ``:1`` is the first. The SQL is
    sent unchanged (ADR-0019)."""

    type_name = "snowflake_query"
    File = SnowflakeQueryFile

    connection: ConnectionName
    sql: NonBlankStr

    @field_validator("params")
    @classmethod
    def _bound_params(cls, value: Sequence[Param]) -> Sequence[Param]:
        for param in value:
            if param.kind not in BIND_KINDS:
                raise ValueError(
                    f"{param.name}: a snowflake_query param is bound by position, so its kind "
                    f"is one of {', '.join(BIND_KINDS)}, not {param.kind}"
                )
        return value

    def connections(self) -> Mapping[str, str]:
        return {self.connection: "snowflake"}

    def run(self, params: Mapping[str, Any], ctx: RunContext) -> Iterator[Mapping[str, Any]]:
        yield from _run_query(ctx, self.connection, self.sql, bind_values(self.params, params))
