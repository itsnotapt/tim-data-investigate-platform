"""Kusto query client (P2-05).

Layers:

* ``parse_v2_frames`` is a pure function over raw Kusto REST v2 frames (JSON dicts). It
  concatenates every ``PrimaryResult`` table, extracts the ``QueryCompletionInformation``
  stats row, serialises values like the legacy backend and enforces the Q-021 limits.
* ``AzureKustoQueryClient`` runs the query with ``azure-kusto-data`` (sync client in a worker
  thread; the aio client needs the extra ``aiohttp`` dependency) and feeds the parser.
* ``KustoQueryClient`` is the protocol callers (query runner, schema endpoint) depend on.

Legacy reference: ``backend/Tim.Backend/Providers/Kusto/KustoQueryClient.cs:77-204``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import re
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Annotated, Any, Protocol

from azure.kusto.data import ClientRequestProperties, KustoClient, KustoConnectionStringBuilder
from azure.kusto.data import exceptions as kusto_exc
from fastapi import Depends

from tim_api.config import Settings, get_settings
from tim_api.query_runs.models import KustoQueryStats

logger = logging.getLogger(__name__)

_MAX_ERROR_CHARS = 2000


class KustoQueryError(Exception):
    """A Kusto query failed. ``str(exc)`` is safe to show to the user (no stack, no secrets)."""


class KustoForbiddenError(KustoQueryError):
    """Kusto refused the caller (HTTP 403): the user lacks access to the cluster or database."""


class KustoResultLimitError(KustoQueryError):
    """The result exceeded ``max_rows`` or ``max_bytes`` (Q-021; no truncation)."""


class KustoUnexpectedFrameError(KustoQueryError):
    """A progressive or otherwise unexpected V2 frame was received (legacy UnexpectedFrame)."""


@dataclass(frozen=True)
class ResultLimits:
    max_rows: int
    max_bytes: int


@dataclass
class QueryResult:
    rows: list[dict[str, Any]] = field(default_factory=list)
    execution_metrics: KustoQueryStats | None = None
    # Limits raise KustoResultLimitError (api-contract 3.3, no truncation), so this stays False.
    truncated: bool = False


class KustoQueryClient(Protocol):
    async def execute(
        self,
        cluster_url: str,
        database: str,
        query: str,
        token: str,
        start: datetime | None,
        end: datetime | None,
        limits: ResultLimits,
    ) -> QueryResult: ...

    async def show_schema(
        self, cluster_url: str, database: str, token: str
    ) -> list[dict[str, Any]]:
        """Run ``.show schema as json`` in ``database``; return the result rows as dicts."""
        ...


# --- value serialisation ---------------------------------------------------------------

_TIMESPAN_RE = re.compile(r"^(-)?(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?$")
_DATETIME_RE = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z?$")


def _datetime(value: str) -> str:
    """.NET/Newtonsoft round-trip form: fraction trimmed of trailing zeros, ``Z`` suffix."""
    match = _DATETIME_RE.match(value)
    if not match:
        return value
    base, frac = match.groups()
    frac = (frac or "").rstrip("0")
    return f"{base}.{frac}Z" if frac else f"{base}Z"


def _timespan(value: str) -> str:
    """.NET ``TimeSpan.ToString()`` (constant format): ``[-][d.]hh:mm:ss[.fffffff]``."""
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


# --- frame parsing ---------------------------------------------------------------------


def _one_api_error_message(errors: Any) -> str | None:
    """First message of a ``OneApiErrors`` list ``[{"error": {"message"/"@message": ...}}]``."""
    if isinstance(errors, list) and errors:
        first = errors[0]
        err = first.get("error", first) if isinstance(first, dict) else {}
        message = err.get("@message") or err.get("message") if isinstance(err, dict) else None
        return str(message) if message else "Kusto reported an error"
    return None


def sanitise_message(text: str) -> str:
    """Keep the Kusto message, drop stack-trace lines, cap the length."""
    lines = [ln for ln in text.splitlines() if not re.match(r"^\s+at\s", ln)]
    cleaned = "\n".join(lines).strip() or "Kusto query failed"
    return cleaned[:_MAX_ERROR_CHARS]


def _stats_from_table(table: Mapping[str, Any]) -> KustoQueryStats | None:
    names = [c.get("ColumnName") for c in table.get("Columns", [])]
    if "LevelName" not in names or "Payload" not in names:
        return None
    level_idx, payload_idx = names.index("LevelName"), names.index("Payload")
    for row in table.get("Rows", []):
        if row[level_idx] != "Stats":
            continue
        try:
            payload = json.loads(row[payload_idx])
        except (TypeError, ValueError):
            return None
        if not isinstance(payload, dict):
            return None
        # Kusto sends "ExecutionTime"; legacy read "execution_time" and so always got 0.
        execution_time = payload.pop("ExecutionTime", None)
        payload.setdefault("execution_time", execution_time if execution_time is not None else 0.0)
        return KustoQueryStats.model_validate(payload)
    return None


def parse_v2_frames(frames: Iterable[Mapping[str, Any]], limits: ResultLimits) -> QueryResult:
    rows: list[dict[str, Any]] = []
    stats: KustoQueryStats | None = None
    total_bytes = 0

    for frame in frames:
        frame_type = frame.get("FrameType")
        if frame_type == "DataSetHeader":
            if frame.get("IsProgressive"):
                raise KustoUnexpectedFrameError("Received unexpected progressive Kusto response.")
            continue
        if frame_type == "DataSetCompletion":
            if frame.get("Cancelled"):
                raise KustoQueryError("The query was cancelled by Kusto.")
            if frame.get("HasErrors"):
                message = _one_api_error_message(frame.get("OneApiErrors"))
                raise KustoQueryError(sanitise_message(message or "Kusto reported an error"))
            continue
        if frame_type != "DataTable":
            raise KustoUnexpectedFrameError(f"Received unexpected frame type `{frame_type}`.")

        kind = frame.get("TableKind")
        if kind == "QueryCompletionInformation":
            stats = _stats_from_table(frame) or stats
            continue
        if kind != "PrimaryResult":
            continue

        columns = frame.get("Columns", [])
        names = [c["ColumnName"] for c in columns]
        types = [str(c.get("ColumnType") or c.get("DataType") or "") for c in columns]
        for raw in frame.get("Rows", []):
            if isinstance(raw, dict):  # partial-failure marker row: {"OneApiErrors": [...]}
                message = _one_api_error_message(raw.get("OneApiErrors"))
                raise KustoQueryError(sanitise_message(message or "Kusto reported an error"))
            if len(rows) >= limits.max_rows:
                raise KustoResultLimitError(f"Result exceeds limit of {limits.max_rows} rows")
            row = {n: serialise_value(t, v) for n, t, v in zip(names, types, raw, strict=True)}
            total_bytes += len(json.dumps(row, separators=(",", ":")).encode()) + 1
            if total_bytes > limits.max_bytes:
                raise KustoResultLimitError(f"Result exceeds limit of {limits.max_bytes} bytes")
            rows.append(row)

    return QueryResult(rows=rows, execution_metrics=stats)


# --- Azure SDK implementation ----------------------------------------------------------


class SdkClient(Protocol):
    """The slice of ``azure.kusto.data.KustoClient`` used here (fakeable in tests)."""

    def execute_query(
        self, database: str, query: str, properties: ClientRequestProperties
    ) -> Any: ...

    def execute_mgmt(
        self, database: str | None, query: str, properties: ClientRequestProperties
    ) -> Any: ...

    def close(self) -> None: ...


SdkClientFactory = Callable[[str, str], SdkClient]


def _default_factory(cluster_url: str, token: str) -> SdkClient:
    kcsb = KustoConnectionStringBuilder.with_aad_user_token_authentication(cluster_url, token)
    return KustoClient(kcsb)


def format_query_parameter(value: datetime) -> str:
    """ISO 8601 round-trip ("o") UTC string, as legacy passes it (KustoQueryClient.cs:84,89)."""
    utc = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    return utc.strftime("%Y-%m-%dT%H:%M:%S.%f") + "0Z"


def build_request_properties(
    start: datetime | None, end: datetime | None, timeout_seconds: int
) -> ClientRequestProperties:
    props = ClientRequestProperties()  # type: ignore[no-untyped-call]
    # Query parameters: the KQL must `declare query_parameters(StartTime:datetime, ...)`.
    if start is not None:
        props.set_parameter("StartTime", format_query_parameter(start))
    if end is not None:
        props.set_parameter("EndTime", format_query_parameter(end))
    props.set_option(
        ClientRequestProperties.request_timeout_option_name, timedelta(seconds=timeout_seconds)
    )
    return props


def _frames_from_response(response: Any) -> list[dict[str, Any]]:
    """Rebuild V2 DataTable frames from the SDK's parsed dataset (raw JSON values kept)."""
    frames: list[dict[str, Any]] = []
    for table in response.tables:
        kind = table.table_kind
        frames.append(
            {
                "FrameType": "DataTable",
                "TableKind": getattr(kind, "value", kind),
                "TableName": table.table_name,
                "Columns": table.raw_columns,
                "Rows": table.raw_rows,
            }
        )
    return frames


def _is_forbidden(exc: Exception) -> bool:
    if not isinstance(exc, kusto_exc.KustoServiceError):
        return False
    return getattr(exc.http_response, "status_code", None) == 403


def map_sdk_error(exc: Exception) -> KustoQueryError:
    """Translate SDK exceptions to a user-safe `KustoQueryError` (no stack, no headers)."""
    if _is_forbidden(exc):
        return KustoForbiddenError("Access to the Kusto cluster or database was denied.")
    if isinstance(exc, kusto_exc.KustoApiError):
        err = exc.get_api_error()
        return KustoQueryError(sanitise_message(err.description or err.message or exc.message_text))
    if isinstance(exc, kusto_exc.KustoMultiApiError):
        errors = exc.get_api_errors()
        first = errors[0] if errors else None
        text = (first.description or first.message) if first else None
        return KustoQueryError(sanitise_message(text or exc.message_text))
    if isinstance(exc, kusto_exc.KustoNetworkError):
        return KustoQueryError("Could not reach the Kusto cluster.")
    if isinstance(exc, kusto_exc.KustoAuthenticationError):
        return KustoQueryError("Authentication to the Kusto cluster failed.")
    if isinstance(exc, kusto_exc.KustoServiceError):
        return KustoQueryError(sanitise_message(exc.message_text))
    return KustoQueryError("Kusto query failed.")


class AzureKustoQueryClient:
    def __init__(
        self, timeout_seconds: int, client_factory: SdkClientFactory = _default_factory
    ) -> None:
        self._timeout_seconds = timeout_seconds
        self._factory = client_factory

    def _run(
        self,
        cluster_url: str,
        database: str,
        query: str,
        token: str,
        start: datetime | None,
        end: datetime | None,
        limits: ResultLimits,
    ) -> QueryResult:
        props = build_request_properties(start, end, self._timeout_seconds)
        try:
            client = self._factory(cluster_url, token)
            try:
                response = client.execute_query(database, query, props)
            finally:
                client.close()
        except kusto_exc.KustoError as exc:
            logger.warning("Kusto query failed: %s", type(exc).__name__, exc_info=True)
            raise map_sdk_error(exc) from None
        return parse_v2_frames(_frames_from_response(response), limits)

    def _show_schema(self, cluster_url: str, database: str, token: str) -> list[dict[str, Any]]:
        props = ClientRequestProperties()  # type: ignore[no-untyped-call]
        props.set_option(
            ClientRequestProperties.request_timeout_option_name,
            timedelta(seconds=self._timeout_seconds),
        )
        try:
            client = self._factory(cluster_url, token)
            try:
                response = client.execute_mgmt(database, ".show schema as json", props)
            finally:
                client.close()
        except kusto_exc.KustoError as exc:
            logger.warning("Kusto schema command failed: %s", type(exc).__name__, exc_info=True)
            raise map_sdk_error(exc) from None
        tables = response.primary_results
        if not tables:
            return []
        names = [c["ColumnName"] for c in tables[0].raw_columns]
        return [dict(zip(names, row, strict=True)) for row in tables[0].raw_rows]

    async def show_schema(
        self, cluster_url: str, database: str, token: str
    ) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self._show_schema, cluster_url, database, token)

    async def execute(
        self,
        cluster_url: str,
        database: str,
        query: str,
        token: str,
        start: datetime | None,
        end: datetime | None,
        limits: ResultLimits,
    ) -> QueryResult:
        # The sync SDK client blocks, so run it in a worker thread. Cancelling the awaiting task
        # does not stop the thread; the server-side timeout bounds it.
        return await asyncio.to_thread(
            self._run, cluster_url, database, query, token, start, end, limits
        )


def get_kusto_client(settings: Annotated[Settings, Depends(get_settings)]) -> KustoQueryClient:
    return AzureKustoQueryClient(timeout_seconds=settings.query_timeout_seconds)
