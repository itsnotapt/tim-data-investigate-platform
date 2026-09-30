"""Query run models (api-contract.md 3.3, 3.4, 4)."""

from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import ConfigDict, Field, ValidationInfo, field_validator

from tim_api.models_common import ApiModel, Database, NonBlankStr, UtcDatetime

MAX_QUERY_CHARS = 100_000


class QueryRunStatus(StrEnum):
    CREATED = "created"
    COMPLETED = "completed"
    ERROR = "error"
    TIMED_OUT = "timedOut"


class KustoQueryRequest(ApiModel):
    """Body of `POST /api/kusto/query`. `requestedBy` is ignored (owner comes from the token)."""

    cluster: NonBlankStr
    database: Database
    query: NonBlankStr = Field(max_length=MAX_QUERY_CHARS)
    start_time: UtcDatetime | None = None
    end_time: UtcDatetime | None = Field(default=None, validate_default=True)

    @field_validator("end_time")
    @classmethod
    def _end_not_before_start(
        cls, value: UtcDatetime | None, info: ValidationInfo
    ) -> UtcDatetime | None:
        start = info.data.get("start_time")
        if value is not None and start is not None and start > value:
            raise ValueError("must not be earlier than startTime")
        return value


class KustoQueryEcho(ApiModel):
    """Echo of the request; `requestedBy` is the token identity (read-only)."""

    cluster: str
    database: str
    query: str
    start_time: UtcDatetime | None = None
    end_time: UtcDatetime | None = None
    requested_by: str


class KustoQueryStats(ApiModel):
    """Kusto `QueryCompletionInformation` stats. Keys are snake_case as Kusto returns them."""

    # No camelCase aliasing: names are Kusto's. Unknown keys pass through.
    model_config = ConfigDict(alias_generator=None, extra="allow")

    execution_time: float
    resource_usage: dict[str, Any] | None = None
    input_dataset_statistics: dict[str, Any] | None = None
    dataset_statistics: list[dict[str, Any]] | None = None


class KustoQueryRun(ApiModel):
    """Run resource returned by POST (200/202) and GET. Server-produced only, never a request."""

    query_run_id: UUID
    status: QueryRunStatus
    kusto_query: KustoQueryEcho
    execute_date_time_utc: UtcDatetime
    expires_at: UtcDatetime
    result_data: list[dict[str, Any]] | None = None
    execution_metrics: KustoQueryStats | None = None
    main_error: str | None = None
