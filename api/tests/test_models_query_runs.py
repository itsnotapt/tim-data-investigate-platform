import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from tim_api.kusto.models import KustoClusterDatabase, SchemaRequest, SchemaResponse
from tim_api.models_common import format_utc
from tim_api.query_runs.models import (
    MAX_QUERY_CHARS,
    KustoQueryRequest,
    KustoQueryRun,
    KustoQueryStats,
    QueryRunStatus,
)

FIXTURES = Path(__file__).parent / "fixtures"


def load(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((FIXTURES / name).read_text())
    return data


def locs(exc: ValidationError) -> list[str]:
    return [".".join(str(p) for p in e["loc"]) for e in exc.errors()]


@pytest.mark.parametrize(
    ("name", "status"),
    [
        ("query_run_completed.json", QueryRunStatus.COMPLETED),
        ("query_run_error.json", QueryRunStatus.ERROR),
        ("query_run_created.json", QueryRunStatus.CREATED),
    ],
)
def test_run_round_trip(name: str, status: QueryRunStatus) -> None:
    raw = load(name)
    run = KustoQueryRun.model_validate(raw)
    assert run.status is status
    assert run.model_dump(mode="json", exclude_unset=True) == raw
    assert KustoQueryRun.model_validate_json(run.model_dump_json()) == run


def test_completed_run_details() -> None:
    run = KustoQueryRun.model_validate(load("query_run_completed.json"))
    assert run.result_data is not None and len(run.result_data) == 3
    assert run.result_data[0]["TagEvent"] == {
        "IsSaved": True,
        "Tags": ["investigate"],
        "Determination": "malicious",
        "Comment": "Confirmed",
        "Comments": [],
    }
    assert run.execution_metrics is not None
    dumped = run.model_dump(mode="json")
    # Kusto stats keys stay snake_case and are not re-cased
    assert dumped["executionMetrics"]["execution_time"] == 0.42
    assert dumped["executionMetrics"]["dataset_statistics"] == [
        {"table_row_count": 3, "table_size": 9000}
    ]
    assert dumped["expiresAt"].endswith("Z")
    assert "stackTrace" not in dumped


def test_row_keys_are_not_recased() -> None:
    raw = load("query_run_completed.json")
    raw["resultData"] = [{"some_Column": 1, "AnotherOne": None}]
    dumped = KustoQueryRun.model_validate(raw).model_dump(mode="json")
    assert dumped["resultData"] == [{"some_Column": 1, "AnotherOne": None}]


def test_timed_out_status_and_stats_extras() -> None:
    raw = load("query_run_error.json")
    raw["status"] = "timedOut"
    raw["mainError"] = "Query exceeded 600 seconds"
    assert KustoQueryRun.model_validate(raw).status is QueryRunStatus.TIMED_OUT
    stats = KustoQueryStats.model_validate({"execution_time": 1, "future_key": {"a": 1}})
    assert stats.model_dump(mode="json")["future_key"] == {"a": 1}
    with pytest.raises(ValidationError):
        KustoQueryRun.model_validate({**raw, "status": "running"})


def test_run_requires_server_fields() -> None:
    with pytest.raises(ValidationError) as exc:
        KustoQueryRun.model_validate({"queryRunId": "run-1", "status": "completed"})
    assert {"queryRunId", "kustoQuery", "executeDateTimeUtc", "expiresAt"} <= set(locs(exc.value))


def test_run_stack_trace_not_serialised() -> None:
    raw = load("query_run_error.json")
    raw["stackTrace"] = "at Foo.Bar()"
    assert "stackTrace" not in KustoQueryRun.model_validate(raw).model_dump(mode="json")


BASE_REQUEST = {
    "cluster": "https://contoso.westus2.kusto.windows.net",
    "database": "SecurityLogs",
    "query": "SignInLogs | take 2",
}


def test_request_minimal_and_full() -> None:
    req = KustoQueryRequest.model_validate(BASE_REQUEST)
    assert req.start_time is None and req.end_time is None
    full = KustoQueryRequest.model_validate(
        {
            **BASE_REQUEST,
            "startTime": "2026-03-13T00:00:00Z",
            "endTime": "2026-03-14T02:00:00+02:00",
        }
    )
    assert full.end_time == datetime(2026, 3, 14, 0, 0, tzinfo=UTC)
    assert full.model_dump(mode="json")["endTime"] == "2026-03-14T00:00:00Z"


def test_request_ignores_requested_by() -> None:
    req = KustoQueryRequest.model_validate({**BASE_REQUEST, "requestedBy": "mallory"})
    assert "requestedBy" not in req.model_dump(mode="json")


@pytest.mark.parametrize("field", ["cluster", "database", "query"])
def test_request_required(field: str) -> None:
    body = {k: v for k, v in BASE_REQUEST.items() if k != field}
    with pytest.raises(ValidationError) as exc:
        KustoQueryRequest.model_validate(body)
    assert locs(exc.value) == [field]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("cluster", " "),
        ("database", ""),
        ("database", "d" * 257),
        ("query", "  \n"),
        ("query", "q" * (MAX_QUERY_CHARS + 1)),
    ],
)
def test_request_limits(field: str, value: str) -> None:
    with pytest.raises(ValidationError) as exc:
        KustoQueryRequest.model_validate({**BASE_REQUEST, field: value})
    assert locs(exc.value) == [field]


def test_request_limits_boundaries_ok() -> None:
    KustoQueryRequest.model_validate(
        {**BASE_REQUEST, "database": "d" * 256, "query": "q" * MAX_QUERY_CHARS}
    )


def test_request_end_before_start_rejected() -> None:
    with pytest.raises(ValidationError) as exc:
        KustoQueryRequest.model_validate(
            {**BASE_REQUEST, "startTime": "2026-03-14T00:00:01Z", "endTime": "2026-03-14T00:00:00Z"}
        )
    assert locs(exc.value) == ["endTime"]
    same = "2026-03-14T00:00:00Z"
    KustoQueryRequest.model_validate({**BASE_REQUEST, "startTime": same, "endTime": same})


def test_naive_datetime_is_utc_and_offset_converted() -> None:
    req = KustoQueryRequest.model_validate({**BASE_REQUEST, "startTime": "2026-03-14T10:00:00"})
    assert req.start_time == datetime(2026, 3, 14, 10, tzinfo=UTC)


def test_format_utc() -> None:
    assert (
        format_utc(datetime(2026, 3, 14, 9, 31, 2, 114000, tzinfo=UTC))
        == "2026-03-14T09:31:02.114Z"
    )
    assert format_utc(datetime(2026, 3, 14, 9, 31, 2)) == "2026-03-14T09:31:02Z"


def test_schema_models() -> None:
    req = SchemaRequest.model_validate({"cluster": "https://x.kusto.windows.net", "database": "db"})
    assert isinstance(req, KustoClusterDatabase)
    with pytest.raises(ValidationError) as exc:
        SchemaRequest.model_validate({"cluster": "https://x"})
    assert locs(exc.value) == ["database"]
    raw = load("schema_response.json")
    resp = SchemaResponse.model_validate(raw)
    assert resp.schema_ == raw["schema"]
    assert resp.model_dump(mode="json") == raw
    assert SchemaResponse.model_validate_json(resp.model_dump_json()) == resp
    with pytest.raises(ValidationError):
        SchemaResponse.model_validate({"schema": "not-an-object"})
