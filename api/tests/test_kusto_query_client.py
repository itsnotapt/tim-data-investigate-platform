import json
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from azure.kusto.data import ClientRequestProperties
from azure.kusto.data import exceptions as kusto_exc

from tim_api.kusto.query_client import (
    AzureKustoQueryClient,
    KustoForbiddenError,
    KustoQueryError,
    KustoResultLimitError,
    KustoUnexpectedFrameError,
    ResultLimits,
    build_request_properties,
    format_query_parameter,
    get_kusto_client,
    map_sdk_error,
    parse_v2_frames,
    sanitise_message,
    serialise_value,
)

FIXTURES = Path(__file__).parent / "fixtures" / "kusto"
BIG = ResultLimits(max_rows=1000, max_bytes=10_000_000)


def frames(name: str) -> list[dict[str, Any]]:
    data: list[dict[str, Any]] = json.loads((FIXTURES / f"{name}.json").read_text())
    return data


def test_multi_table_concat_ignores_other_tables() -> None:
    result = parse_v2_frames(frames("multi_table"), BIG)
    assert result.rows == [{"A": 1, "B": "x"}, {"A": 2, "B": "y"}, {"A": 3, "B": "z"}]
    assert result.truncated is False


def test_value_types() -> None:
    (row,) = parse_v2_frames(frames("value_types"), BIG).rows
    assert row["b"] is True
    assert row["i"] == 5
    assert row["l"] == 9007199254740993
    assert row["r"] == 1.5
    assert row["s"] == "hi"
    assert row["dt"] == "2026-03-13T10:20:30.12Z"
    assert row["dt2"] == "2026-03-13T10:20:30Z"
    assert row["ts"] == "00:00:05"
    assert row["ts2"] == "1.02:03:04.5000000"
    assert row["ts3"] == "-00:01:00"
    assert row["dyn"] == {"a": [1, {"b": None}]}
    assert row["dyn2"] == {"k": 1}
    assert row["dyn3"] == "not json"
    assert row["g"] == "74be27de-1e4e-49d9-b579-fe0b331d3642"
    assert row["d"] == 1.25
    assert row["d2"] == "0.1234567890123456789012345"  # not float-exact: kept as string
    assert row["n"] is None
    assert row["nd"] is None


def test_serialise_edge_cases() -> None:
    assert serialise_value("timespan", "00:00:01.5") == "00:00:01.5000000"
    assert serialise_value("timespan", "0.00:00:00.0000000") == "00:00:00"
    assert serialise_value("timespan", "weird") == "weird"
    assert serialise_value("datetime", "weird") == "weird"
    assert serialise_value("decimal", "abc") == "abc"
    assert serialise_value("decimal", "NaN") == "NaN"
    assert serialise_value("guid", "g") == "g"
    assert serialise_value("dynamic", {"x": 1}) == {"x": 1}
    assert serialise_value("real", "NaN") == "NaN"


def test_stats_extracted() -> None:
    stats = parse_v2_frames(frames("multi_table"), BIG).execution_metrics
    assert stats is not None
    assert stats.execution_time == pytest.approx(0.0156)
    assert stats.resource_usage == {"cache": {"memory": {"hits": 1}}}
    assert stats.input_dataset_statistics == {"extents": {"total": 2}}
    assert stats.dataset_statistics == [{"table_row_count": 3, "table_size": 120}]


def test_no_stats_row_gives_none() -> None:
    result = parse_v2_frames(frames("no_stats"), BIG)
    assert result.rows == [{"A": 1}]
    assert result.execution_metrics is None


def _stats_frame(rows: list[list[Any]], columns: list[str] | None = None) -> dict[str, Any]:
    names = columns or ["LevelName", "Payload"]
    return {
        "FrameType": "DataTable",
        "TableKind": "QueryCompletionInformation",
        "Columns": [{"ColumnName": n, "ColumnType": "string"} for n in names],
        "Rows": rows,
    }


@pytest.mark.parametrize(
    "frame",
    [
        _stats_frame([["Stats", "not json"]]),
        _stats_frame([["Stats", "[1]"]]),
        _stats_frame([["Info", "{}"]]),
        _stats_frame([["Stats"]], columns=["LevelName"]),
    ],
)
def test_unusable_stats_are_ignored(frame: dict[str, Any]) -> None:
    assert parse_v2_frames([frame], BIG).execution_metrics is None


def test_row_limit() -> None:
    limits = ResultLimits(max_rows=2, max_bytes=10_000)
    with pytest.raises(KustoResultLimitError, match="2 rows"):
        parse_v2_frames(frames("multi_table"), limits)
    # exactly at the limit is fine
    assert len(parse_v2_frames(frames("multi_table"), ResultLimits(3, 10_000)).rows) == 3


def test_byte_limit() -> None:
    with pytest.raises(KustoResultLimitError, match="20 bytes"):
        parse_v2_frames(frames("multi_table"), ResultLimits(max_rows=100, max_bytes=20))


@pytest.mark.parametrize("name", ["progressive", "progressive_frames_only"])
def test_progressive_frames_are_errors(name: str) -> None:
    with pytest.raises(KustoUnexpectedFrameError):
        parse_v2_frames(frames(name), BIG)


def test_dataset_completion_error_maps_to_kusto_query_error() -> None:
    with pytest.raises(KustoQueryError, match="exceeded the allowed limits"):
        parse_v2_frames(frames("dataset_error"), BIG)


def test_partial_error_row() -> None:
    with pytest.raises(KustoQueryError, match="Row-level failure"):
        parse_v2_frames(frames("partial_error_row"), BIG)


def test_cancelled_and_messageless_errors() -> None:
    with pytest.raises(KustoQueryError, match="cancelled"):
        parse_v2_frames([{"FrameType": "DataSetCompletion", "Cancelled": True}], BIG)
    with pytest.raises(KustoQueryError, match="reported an error"):
        parse_v2_frames([{"FrameType": "DataSetCompletion", "HasErrors": True}], BIG)


def test_sanitise_message_strips_stack_and_caps() -> None:
    text = "Semantic error: bad\n   at Kusto.Foo.Bar()\n   at Baz"
    assert sanitise_message(text) == "Semantic error: bad"
    assert sanitise_message("   at only") == "Kusto query failed"
    assert len(sanitise_message("x" * 5000)) == 2000


# --- SDK layer ---------------------------------------------------------------------------


def test_query_parameter_format() -> None:
    assert (
        format_query_parameter(datetime(2026, 3, 13, tzinfo=UTC)) == "2026-03-13T00:00:00.0000000Z"
    )
    tz = timezone(timedelta(hours=2))
    assert (
        format_query_parameter(datetime(2026, 3, 13, 2, 0, 0, 5, tzinfo=tz))
        == "2026-03-13T00:00:00.0000050Z"
    )
    assert format_query_parameter(datetime(2026, 3, 13)) == "2026-03-13T00:00:00.0000000Z"


def test_build_request_properties() -> None:
    props = build_request_properties(datetime(2026, 3, 13, tzinfo=UTC), None, 600)
    assert props.get_parameter("StartTime", "") == "2026-03-13T00:00:00.0000000Z"
    assert not props.has_parameter("EndTime")
    assert props.get_option(ClientRequestProperties.request_timeout_option_name, None) == timedelta(
        seconds=600
    )


class FakeSdkClient:
    def __init__(self, response: Any = None, error: Exception | None = None) -> None:
        self.response = response
        self.error = error
        self.calls: list[tuple[str, str, ClientRequestProperties]] = []
        self.closed = False

    def execute_query(self, database: str, query: str, properties: ClientRequestProperties) -> Any:
        self.calls.append((database, query, properties))
        if self.error:
            raise self.error
        return self.response

    def execute_mgmt(
        self, database: str | None, query: str, properties: ClientRequestProperties
    ) -> Any:
        self.calls.append((database or "", query, properties))
        if self.error:
            raise self.error
        return self.response

    def close(self) -> None:
        self.closed = True


def _response(name: str) -> Any:
    tables = [
        SimpleNamespace(
            table_kind=SimpleNamespace(value=f["TableKind"]),
            table_name=f.get("TableName"),
            raw_columns=f["Columns"],
            raw_rows=f["Rows"],
        )
        for f in frames(name)
        if f["FrameType"] == "DataTable"
    ]
    return SimpleNamespace(tables=tables)


def _client(
    fake: FakeSdkClient, seen: list[tuple[str, str]] | None = None
) -> AzureKustoQueryClient:
    def factory(cluster: str, token: str) -> FakeSdkClient:
        if seen is not None:
            seen.append((cluster, token))
        return fake

    return AzureKustoQueryClient(timeout_seconds=300, client_factory=factory)


async def test_execute_sets_parameters_and_parses() -> None:
    fake = FakeSdkClient(_response("multi_table"))
    seen: list[tuple[str, str]] = []
    start = datetime(2026, 3, 13, tzinfo=UTC)
    end = datetime(2026, 3, 14, tzinfo=UTC)
    result = await _client(fake, seen).execute(
        "https://c.kusto.windows.net", "db", "T | take 3", "tok", start, end, BIG
    )
    assert len(result.rows) == 3
    assert result.execution_metrics is not None
    assert seen == [("https://c.kusto.windows.net", "tok")]
    database, query, props = fake.calls[0]
    assert (database, query) == ("db", "T | take 3")
    assert props.get_parameter("StartTime", "") == "2026-03-13T00:00:00.0000000Z"
    assert props.get_parameter("EndTime", "") == "2026-03-14T00:00:00.0000000Z"
    assert props.get_option("servertimeout", None) == timedelta(seconds=300)
    assert fake.closed


async def test_execute_without_times_sets_no_parameters() -> None:
    fake = FakeSdkClient(_response("no_stats"))
    await _client(fake).execute("https://c", "db", "q", "t", None, None, BIG)
    props = fake.calls[0][2]
    assert not props.has_parameter("StartTime")
    assert not props.has_parameter("EndTime")


async def test_execute_maps_service_error_and_closes() -> None:
    api_error = kusto_exc.KustoApiError(
        {
            "error": {
                "code": "BadRequest_SemanticError",
                "message": "Request is invalid",
                "@message": "Semantic error: 'where' operator: Failed to resolve NoSuchColumn\n"
                "   at Kusto.Secret.Stack()",
            }
        }
    )
    fake = FakeSdkClient(error=api_error)
    with pytest.raises(KustoQueryError) as info:
        await _client(fake).execute("https://c", "db", "q", "t", None, None, BIG)
    assert str(info.value) == "Semantic error: 'where' operator: Failed to resolve NoSuchColumn"
    assert "Secret" not in str(info.value)
    assert fake.closed


async def test_execute_propagates_limit_error() -> None:
    fake = FakeSdkClient(_response("multi_table"))
    with pytest.raises(KustoResultLimitError):
        await _client(fake).execute("https://c", "db", "q", "t", None, None, ResultLimits(1, 999))


def test_map_sdk_error_variants() -> None:
    multi = kusto_exc.KustoMultiApiError(
        [{"OneApiErrors": [{"error": {"code": "a", "message": "m", "@message": "first"}}]}]
    )
    assert str(map_sdk_error(multi)) == "first"
    assert str(map_sdk_error(kusto_exc.KustoMultiApiError([]))) == "Kusto query failed"
    assert "reach" in str(map_sdk_error(kusto_exc.KustoNetworkError("https://c")))
    assert "Authentication" in str(
        map_sdk_error(kusto_exc.KustoAuthenticationError("x", Exception("y")))
    )
    assert str(map_sdk_error(kusto_exc.KustoServiceError("Plain failure"))) == "Plain failure"
    assert str(map_sdk_error(kusto_exc.KustoClientError())) == "Kusto query failed."


def test_get_kusto_client_uses_timeout_setting() -> None:
    settings = SimpleNamespace(query_timeout_seconds=42)
    client = get_kusto_client(settings)  # type: ignore[arg-type]
    assert isinstance(client, AzureKustoQueryClient)
    assert client._timeout_seconds == 42


def _mgmt_response(columns: list[str], rows: list[list[Any]]) -> Any:
    table = SimpleNamespace(raw_columns=[{"ColumnName": c} for c in columns], raw_rows=rows)
    return SimpleNamespace(primary_results=[table])


async def test_show_schema_runs_mgmt_command_and_returns_dict_rows() -> None:
    fake = FakeSdkClient(_mgmt_response(["DatabaseSchema"], [['{"a":1}']]))
    seen: list[tuple[str, str]] = []
    rows = await _client(fake, seen).show_schema("https://c", "db", "tok")
    assert rows == [{"DatabaseSchema": '{"a":1}'}]
    assert seen == [("https://c", "tok")]
    assert fake.calls[0][:2] == ("db", ".show schema as json")
    assert fake.closed


async def test_show_schema_empty_result() -> None:
    fake = FakeSdkClient(SimpleNamespace(primary_results=[]))
    assert await _client(fake).show_schema("https://c", "db", "t") == []


async def test_show_schema_maps_errors() -> None:
    fake = FakeSdkClient(error=kusto_exc.KustoNetworkError("https://c"))
    with pytest.raises(KustoQueryError, match="Could not reach"):
        await _client(fake).show_schema("https://c", "db", "t")
    assert fake.closed


async def test_show_schema_forbidden() -> None:
    err = kusto_exc.KustoServiceError("denied", SimpleNamespace(status_code=403))
    with pytest.raises(KustoForbiddenError):
        await _client(FakeSdkClient(error=err)).show_schema("https://c", "db", "t")
