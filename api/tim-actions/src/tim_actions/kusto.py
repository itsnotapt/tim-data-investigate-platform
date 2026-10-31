"""The ``kusto`` connection type and the built-in Run KQL action. Needs the ``kusto`` extra."""

from __future__ import annotations

import ipaddress
import json
import math
import re
import threading
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Annotated, Any, ClassVar, Literal, Protocol
from urllib.parse import urlsplit
from uuid import uuid4

from azure.kusto.data import ClientRequestProperties, KustoClient, KustoConnectionStringBuilder
from azure.kusto.data import exceptions as kusto_exc
from pydantic import ValidationInfo, field_validator

from tim_actions import connections
from tim_actions._common import NonBlankStr
from tim_actions.action import Action, QueryParameter
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
from tim_actions.run import DetailValue, RunContext, RunError

# --- cluster URLs (ADR-0010's shape checks) ---------------------------------------------

_LABEL = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
_FORBIDDEN_CHARS = re.compile(r"[\s\x00-\x1f\x7f\\]")


def _is_ip_literal(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return False
    return True


def _ascii_host(host: str) -> str:
    """Lowercased ASCII (punycode) form of ``host``, or raise."""
    try:
        ascii_host = host.encode("idna").decode("ascii").lower()
    except UnicodeError:
        raise ValueError("host is not a valid domain name") from None
    labels = ascii_host.split(".")
    if len(ascii_host) > 253 or not all(_LABEL.match(label) for label in labels):
        raise ValueError("host is not a valid domain name")
    return ascii_host


def normalise_cluster_url(url: str, *, https_only: bool = True) -> str:
    """``https://<host>`` for a cluster URL: an absolute ``https`` URL with a plain DNS host and
    no credentials, port other than 443, path, query or fragment. Raises ``ValueError`` with the
    reason otherwise.

    Without ``https_only``, an ``http`` URL is accepted too, and the scheme and any port are
    kept: ``<scheme>://<host>[:<port>]``."""
    raw = url.strip() if isinstance(url, str) else ""
    if not raw:
        raise ValueError("value is required")
    if _FORBIDDEN_CHARS.search(raw):
        raise ValueError("contains whitespace or control characters")
    try:
        parts = urlsplit(raw)
    except ValueError:
        raise ValueError("not a valid URL") from None
    schemes = ("https",) if https_only else ("http", "https")
    scheme = parts.scheme.lower()
    if scheme not in schemes or not raw.lower().startswith(f"{scheme}://"):
        raise ValueError(f"must be an absolute {' or '.join(schemes)} URL")
    if parts.query or parts.fragment or "?" in raw or "#" in raw:
        raise ValueError("must not contain a query or fragment")
    if parts.path not in ("", "/"):
        raise ValueError("must not contain a path")
    netloc = parts.netloc
    if "@" in netloc:
        raise ValueError("must not contain credentials")
    if "[" in netloc or "]" in netloc:
        raise ValueError("must not be an IP address")
    try:
        port = parts.port
    except ValueError:
        raise ValueError("invalid port") from None
    if netloc.endswith(":"):
        raise ValueError("invalid port")
    if https_only and port is not None and port != 443:
        raise ValueError("port must be omitted or 443")
    hostname = parts.hostname
    if not hostname:
        raise ValueError("host is missing")
    if _is_ip_literal(hostname):
        raise ValueError("must not be an IP address")
    host = _ascii_host(hostname)
    if _is_ip_literal(host):
        raise ValueError("must not be an IP address")
    if https_only:
        return f"https://{host}"
    return f"{scheme}://{host}" if port is None else f"{scheme}://{host}:{port}"


# --- the connection type ----------------------------------------------------------------


class KustoConnection(Connection):
    """A Kusto cluster. ``databases`` are suggestions for the analyst, not a restriction.

    With ``auth: obo``, ``cluster`` is normalised to ``https://<host>`` and the scope defaults
    to ``{cluster}/.default``. ``auth: none`` is for a local Kusto emulator in development
    (ADR-0026): ``cluster`` may be ``http`` too, and keeps its scheme and port."""

    type: Literal["kusto"]
    auth: Literal["obo", "none"]
    cluster: str
    databases: tuple[NonBlankStr, ...] | None = None

    @field_validator("cluster")
    @classmethod
    def _cluster(cls, value: str, info: ValidationInfo) -> str:
        return normalise_cluster_url(value, https_only=info.data.get("auth") != "none")

    def default_scope(self) -> str:
        return f"{self.cluster}/.default"

    def database_suggestions(self) -> tuple[str, ...] | None:
        return self.databases


# --- values and errors --------------------------------------------------------------------

_TIMESPAN_RE = re.compile(r"^(-)?(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?$")
_DATETIME_RE = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z?$")
_MAX_ERROR_CHARS = 2000


def _datetime(value: str) -> str:
    """ISO 8601 form with the fraction trimmed of trailing zeros and a ``Z`` suffix."""
    match = _DATETIME_RE.match(value)
    if not match:
        return value
    base, frac = match.groups()
    frac = (frac or "").rstrip("0")
    return f"{base}.{frac}Z" if frac else f"{base}Z"


def _timespan(value: str) -> str:
    """Normalise to ``[-][d.]hh:mm:ss[.fffffff]``: days omitted when zero, 7-digit fraction."""
    match = _TIMESPAN_RE.match(value)
    if not match:
        return value
    sign, days, hours, minutes, seconds, frac = match.groups()
    out = f"{sign or ''}{f'{int(days)}.' if days and int(days) else ''}"
    out += f"{int(hours):02d}:{minutes}:{seconds}"
    if frac and frac.strip("0"):
        out += "." + frac.ljust(7, "0")[:7]
    return out


def _decimal(value: Any) -> Any:
    """Number when it survives a float round trip, else the exact string."""
    try:
        exact = Decimal(str(value))
        as_float = float(exact)
    except (InvalidOperation, ValueError):
        return value
    if math.isfinite(as_float) and Decimal(repr(as_float)) == exact:
        return as_float
    return str(value)


def _dynamic(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return value
    return value


def serialise_value(column_type: str, value: Any) -> Any:
    """A value of a Kusto column, from Kusto's JSON, as TIM stores it."""
    if value is None:
        return None
    kind = column_type.lower()
    if kind in ("datetime", "date") and isinstance(value, str):
        return _datetime(value)
    if kind in ("timespan", "time") and isinstance(value, str):
        return _timespan(value)
    if kind == "dynamic":
        return _dynamic(value)
    if kind == "decimal":
        return _decimal(value)
    if kind in ("guid", "uniqueid"):
        return str(value)
    return value


_COLUMN_TYPES: dict[str, ColumnType] = {
    "bool": "boolean",
    "boolean": "boolean",
    "datetime": "datetime",
    "date": "datetime",
    "timespan": "timespan",
    "time": "timespan",
    "dynamic": "json",
    "int": "number",
    "long": "number",
    "real": "number",
    "double": "number",
    "decimal": "number",
}


def column_type(kusto_type: str) -> ColumnType:
    """The TIM column type of a Kusto column type; ``string`` for strings, guids and the rest."""
    return _COLUMN_TYPES.get(kusto_type.lower(), "string")


# --- query parameters ---------------------------------------------------------------------

QUERY_PARAMETER_KINDS: tuple[ParamKind, ...] = (
    "string",
    "number",
    "boolean",
    "datetime",
    "timespan",
    "json",
)
"""The param kinds a Kusto query parameter can take."""


def _datetime_literal(value: datetime) -> str:
    utc = value.astimezone(UTC)
    return f"datetime({utc:%Y-%m-%dT%H:%M:%S}.{utc.microsecond:06d}0Z)"


def _timespan_literal(value: timedelta) -> str:
    """``timespan([-][d.]hh:mm:ss[.fffffff])``."""
    micros = abs(value // timedelta(microseconds=1))
    seconds, micros = divmod(micros, 1_000_000)
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    days, hours = divmod(hours, 24)
    out = "-" if value < timedelta(0) else ""
    out += f"{days}." if days else ""
    out += f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    out += f".{micros:06d}0" if micros else ""
    return f"timespan({out})"


def _number_literal(value: float) -> str:
    if math.isnan(value):
        return "real(nan)"
    if math.isinf(value):
        return "real(+inf)" if value > 0 else "real(-inf)"
    return repr(value)


def _literal(kind: ParamKind, value: Any) -> str:
    """``value`` as a Kusto literal, which is also its form inside a ``dynamic`` literal: Kusto's
    number, datetime and timespan literals, and JSON for the rest."""
    match kind:
        case "number":
            return _number_literal(value)
        case "datetime":
            return _datetime_literal(value)
        case "timespan":
            return _timespan_literal(value)
        case _:
            return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def kusto_literal(kind: ParamKind, value: Any, *, many: bool = False) -> str:
    """The query parameter value Kusto parses ``value`` of param kind ``kind`` from: a literal
    of the declared type, except that a string is its own text. A list (``many``) and JSON are
    ``dynamic``."""
    if kind not in QUERY_PARAMETER_KINDS:
        raise ValueError(f"a {kind} param can't be a Kusto query parameter")
    if many:
        return f"dynamic([{','.join(_literal(kind, each) for each in value)}])"
    if kind == "string":
        return str(value)
    if kind == "json":
        return f"dynamic({_literal(kind, value)})"
    return _literal(kind, value)


def query_parameters(params: Sequence[Param], values: Mapping[str, Any]) -> dict[str, str]:
    """The Kusto query parameters for validated param ``values``, by param name. A param
    without a value is left out, so the KQL's ``declare query_parameters`` default applies."""
    return {
        param.name: kusto_literal(param.kind, values[param.name], many=param.many)
        for param in params
        if values.get(param.name) is not None
    }


def _declared_before(declare: str, kql: str) -> str:
    """``kql`` with the declare statement on the line before it, if there is one."""
    return f"{declare}\n{kql}" if declare else kql


def sanitise_message(text: str) -> str:
    """Keep the Kusto message, drop stack-trace lines, cap the length."""
    lines = [ln for ln in text.splitlines() if not re.match(r"^\s+at\s", ln)]
    cleaned = "\n".join(lines).strip() or "Kusto query failed"
    return cleaned[:_MAX_ERROR_CHARS]


def is_forbidden(exc: Exception) -> bool:
    """Whether Kusto refused the caller (HTTP 403)."""
    if not isinstance(exc, kusto_exc.KustoServiceError):
        return False
    return getattr(exc.http_response, "status_code", None) == 403


def error_message(exc: Exception) -> str:
    """A message for an SDK exception that is safe to show: no stack, headers or tokens."""
    if is_forbidden(exc):
        return "Access to the Kusto cluster or database was denied."
    if isinstance(exc, kusto_exc.KustoApiError):
        err = exc.get_api_error()
        return sanitise_message(err.description or err.message or exc.message_text)
    if isinstance(exc, kusto_exc.KustoMultiApiError):
        errors = exc.get_api_errors()
        first = errors[0] if errors else None
        text = (first.description or first.message) if first else None
        return sanitise_message(text or exc.message_text)
    if isinstance(exc, kusto_exc.KustoNetworkError):
        return "Could not reach the Kusto cluster."
    if isinstance(exc, kusto_exc.KustoAuthenticationError):
        return "Authentication to the Kusto cluster failed."
    if isinstance(exc, kusto_exc.KustoServiceError):
        return sanitise_message(exc.message_text)
    return "Kusto query failed."


# --- the editor schema --------------------------------------------------------------------

# Result column holding the schema document; ``ClusterSchema`` and ``DatabaseSchema`` are accepted.
SCHEMA_COLUMNS = ("ClusterSchema", "DatabaseSchema")


def schema_document(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Parse the schema JSON document out of the ``.show schema as json`` result.

    Raises ``ValueError`` (safe, generic message) if no usable document is found.
    """
    if not rows:
        raise ValueError("no rows")
    row = rows[0]
    raw: Any = None
    for name in SCHEMA_COLUMNS:
        if name in row:
            raw = row[name]
            break
    else:
        if len(row) != 1:
            raise ValueError("unknown schema column")
        raw = next(iter(row.values()))
    # The command returns a JSON string; the SDK may already hand back a parsed object.
    doc = json.loads(raw) if isinstance(raw, str) else raw
    if not isinstance(doc, dict):
        raise ValueError("schema is not a JSON object")
    return doc


# --- the hook -----------------------------------------------------------------------------


class SdkClient(Protocol):
    """The slice of ``azure.kusto.data.KustoClient`` the hook uses."""

    def execute_query(
        self, database: str, query: str, properties: ClientRequestProperties
    ) -> Any: ...

    def execute_mgmt(
        self, database: str | None, query: str, properties: ClientRequestProperties
    ) -> Any: ...

    def close(self) -> None: ...


def _sdk_client(cluster: str, token: str | None) -> SdkClient:
    if token is None:
        kcsb = KustoConnectionStringBuilder.with_no_authentication(cluster)
    else:
        kcsb = KustoConnectionStringBuilder.with_aad_user_token_authentication(cluster, token)
    return KustoClient(kcsb)


def _table_kind(table: Any) -> str:
    kind = table.table_kind
    return str(getattr(kind, "value", kind))


# Execution metrics reported as run details, from the ``Stats`` row's payload.
_DETAILS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("executionTime", ("ExecutionTime",)),
    ("cpuTime", ("resource_usage", "cpu", "total cpu")),
    ("memoryPeakPerNode", ("resource_usage", "memory", "peak_per_node")),
    ("extentsScanned", ("input_dataset_statistics", "extents", "scanned")),
    ("extentsTotal", ("input_dataset_statistics", "extents", "total")),
)


def _details(table: Any) -> dict[str, DetailValue]:
    names = [c.get("ColumnName") for c in table.raw_columns]
    if "LevelName" not in names or "Payload" not in names:
        return {}
    level, payload = names.index("LevelName"), names.index("Payload")
    for row in table.raw_rows:
        if row[level] != "Stats":
            continue
        try:
            stats = json.loads(row[payload])
        except (TypeError, ValueError):
            return {}
        details: dict[str, DetailValue] = {}
        for key, path in _DETAILS:
            value: Any = stats
            for part in path:
                value = value.get(part) if isinstance(value, dict) else None
            if isinstance(value, str | int | float | bool):
                details[key] = value
        return details
    return {}


@dataclass(frozen=True)
class KustoResult:
    """A query's result: its columns, its rows from every ``PrimaryResult`` table, and its
    execution metrics."""

    columns: tuple[Column, ...]
    rows: list[dict[str, Any]]
    details: dict[str, DetailValue]


def _result(response: Any) -> KustoResult:
    columns: dict[str, Column] = {}
    rows: list[dict[str, Any]] = []
    details: dict[str, DetailValue] = {}
    for table in response.tables:
        kind = _table_kind(table)
        if kind == "QueryCompletionInformation":
            details = _details(table) or details
        if kind != "PrimaryResult":
            continue
        names = [c["ColumnName"] for c in table.raw_columns]
        types = [str(c.get("ColumnType") or c.get("DataType") or "") for c in table.raw_columns]
        for name, kusto_type in zip(names, types, strict=True):
            columns.setdefault(name, Column(name, column_type(kusto_type)))
        rows.extend(
            {n: serialise_value(t, v) for n, t, v in zip(names, types, raw, strict=True)}
            for raw in table.raw_rows
        )
    return KustoResult(tuple(columns.values()), rows, details)


class KustoHook(Hook):
    """Runs KQL on one Kusto cluster as the analyst.

    Each query carries a client request id, so ``cancel`` can name it in ``.cancel query``.
    ``client_factory`` builds the SDK client from the cluster URL and a token, or ``None`` for a
    connection with ``auth: none``.
    """

    connection_type = "kusto"
    Connection = KustoConnection
    editor = "kql"
    client_factory: ClassVar[staticmethod[[str, str | None], SdkClient]] = staticmethod(_sdk_client)

    connection: KustoConnection

    def __init__(self, connection: connections.Connection, token_for: TokenFor) -> None:
        super().__init__(connection, token_for)
        self._lock = threading.Lock()
        self._running: dict[str, str] = {}  # client request id -> database
        self._cancelled = False

    def get_conn(self) -> SdkClient:
        """An SDK client for the cluster, with a token for the analyst, or none without auth."""
        scope = self.connection.obo_scope
        token = None if scope is None else self.token_for(scope)
        return self.client_factory(self.connection.cluster, token)

    def query(
        self,
        database: str,
        kql: str,
        *,
        deadline: datetime,
        parameters: Mapping[str, str] | None = None,
    ) -> KustoResult:
        """Run ``kql`` in ``database`` with ``parameters`` (see ``query_parameters``) as its query
        parameters, and the time left until ``deadline`` as Kusto's server timeout. Raises
        ``RunError`` with Kusto's message when it fails."""
        request_id = f"TIM.RunKql;{uuid4()}"
        properties = ClientRequestProperties()  # type: ignore[no-untyped-call]
        properties.client_request_id = request_id
        for name, value in (parameters or {}).items():
            properties.set_parameter(name, value)
        properties.set_option(
            ClientRequestProperties.request_timeout_option_name,
            max(deadline - datetime.now(UTC), timedelta(seconds=1)),
        )
        with self._lock:
            if self._cancelled:
                raise RunError("The query was cancelled")
            self._running[request_id] = database
        try:
            client = self.get_conn()
            try:
                response = client.execute_query(database, kql, properties)
            finally:
                client.close()
        except kusto_exc.KustoError as exc:
            raise RunError(error_message(exc)) from None
        finally:
            with self._lock:
                self._running.pop(request_id, None)
        return _result(response)

    def editor_schema(self, scope: dict[str, Any]) -> EditorSchema | None:
        """``.show schema as json`` for the scope's ``database``; ``None`` without one."""
        database = scope.get("database")
        if not isinstance(database, str) or not database:
            return None
        try:
            client = self.get_conn()
            try:
                response = client.execute_mgmt(
                    database,
                    ".show schema as json",
                    ClientRequestProperties(),  # type: ignore[no-untyped-call]
                )
            finally:
                client.close()
        except kusto_exc.KustoError as exc:
            raise RunError(error_message(exc)) from None
        tables = response.primary_results
        if not tables:
            raise RunError("The Kusto cluster returned no schema.")
        names = [c["ColumnName"] for c in tables[0].raw_columns]
        rows = [dict(zip(names, row, strict=True)) for row in tables[0].raw_rows]
        try:
            return EditorSchema("kql", schema_document(rows))
        except ValueError:
            raise RunError("The Kusto cluster returned an unrecognised schema.") from None

    def cancel(self) -> None:
        """Cancel the queries in progress with ``.cancel query``, and refuse new ones."""
        with self._lock:
            self._cancelled = True
            running = dict(self._running)
        if not running:
            return
        client = self.get_conn()
        try:
            for request_id, database in running.items():
                client.execute_mgmt(
                    database,
                    f'.cancel query "{request_id}"',
                    ClientRequestProperties(),  # type: ignore[no-untyped-call]
                )
        finally:
            client.close()


# --- Run KQL ----------------------------------------------------------------------------


# What a preset of Run KQL needs to be an action file.
_PRESET_FILE_PARAMS = ("connection", "database", "kql")


class RunKql(TakesQueryParameters):
    """``tim.run_kql``: ad-hoc KQL on a Kusto connection."""

    parameter_types = QUERY_PARAMETER_TYPES

    def declare_statement(self, query_parameters: Sequence[QueryParameter]) -> str:
        """``declare query_parameters(name:type, …);``; empty without query parameters."""
        if not query_parameters:
            return ""
        declared = ", ".join(f"{p.name}:{p.type}" for p in query_parameters)
        return f"declare query_parameters({declared});"

    def preset_file(
        self,
        *,
        key: str,
        name: str,
        menu: str,
        params: Mapping[str, Any],
        query_parameters: Sequence[QueryParameter],
        id_column: str | None,
    ) -> KqlQueryFile | None:
        """A ``kql_query`` action with the preset's connection, database and Id column, and its
        query parameters declared before the KQL, as params (``preset_file_params``); ``None``
        when the preset lacks the connection, database or KQL."""
        file_params = self.preset_file_params(params, query_parameters, _PRESET_FILE_PARAMS)
        if file_params is None:
            return None
        declare = self.declare_statement(query_parameters)
        return KqlQueryFile(
            type="kql_query",
            key=key,
            name=name,
            menu=menu,
            pivot=file_params.pivot,
            connection=params["connection"],
            database=params["database"],
            kql=_declared_before(declare, params["kql"]),
            id=id_column,
            params=file_params.params,
        )

    def run(self, params: Mapping[str, Any], ctx: RunContext) -> Iterator[Mapping[str, Any]]:
        entries = self.parameter_entries(params)
        declare = self.declare_statement([QueryParameter(e.param.name, e.type) for e in entries])
        yield from _run_query(
            ctx,
            params["connection"],
            params["database"],
            _declared_before(declare, params["kql"]),
            parameters=query_parameters(*params_and_values(entries)),
        )


def _run_query(
    ctx: RunContext,
    connection: str,
    database: str,
    kql: str,
    *,
    parameters: Mapping[str, str],
) -> Iterator[Mapping[str, Any]]:
    """Run ``kql`` on ``connection`` as a run of ``ctx``: Kusto's columns are declared and its
    execution metrics reported as run details."""
    hook = ctx.hook(connection)
    if not isinstance(hook, KustoHook):
        raise RunError(f"{connection} is not a Kusto connection")
    result = hook.query(database, kql, deadline=ctx.deadline, parameters=parameters)
    ctx.declare_columns(result.columns)
    for key, value in result.details.items():
        ctx.detail(key, value)
    yield from result.rows


RUN_KQL = RunKql(
    key="tim.run_kql",
    name="Run KQL",
    description="Ad-hoc KQL on a Kusto connection, as you.",
    params=(
        Param("connection", "connection", title="Connection", connection_type="kusto"),
        Param("database", "string", title="Database"),
        Param("kql", "kql", title="Query", schema_from=("connection", "database")),
        Param(
            "parameters",
            "json",
            title="Query parameters",
            required=False,
            help="[{name, type, value}]: declared before the query and sent as Kusto query "
            "parameters",
        ),
    ),
    pivot="none",
)


# --- kql_query ----------------------------------------------------------------------------


class KqlQueryFile(ActionDocument):
    connection: ConnectionName
    database: NonBlankStr
    kql: Annotated[NonBlankStr, Sidecar()]


class KqlQuery(Action):
    """``kql_query``: fixed KQL in a database of a fixed Kusto connection. Its params are sent as
    Kusto query parameters by name, which the KQL declares with ``declare query_parameters``;
    the KQL text is sent unchanged (ADR-0019)."""

    type_name = "kql_query"
    File = KqlQueryFile

    connection: ConnectionName
    database: NonBlankStr
    kql: NonBlankStr

    @field_validator("params")
    @classmethod
    def _query_parameters(cls, value: Sequence[Param]) -> Sequence[Param]:
        for param in value:
            if param.kind not in QUERY_PARAMETER_KINDS:
                raise ValueError(
                    f"{param.name}: a kql_query param is a Kusto query parameter, so its kind "
                    f"is one of {', '.join(QUERY_PARAMETER_KINDS)}, not {param.kind}"
                )
        return value

    def connections(self) -> Mapping[str, str]:
        return {self.connection: "kusto"}

    def run(self, params: Mapping[str, Any], ctx: RunContext) -> Iterator[Mapping[str, Any]]:
        yield from _run_query(
            ctx,
            self.connection,
            self.database,
            self.kql,
            parameters=query_parameters(self.params, params),
        )
