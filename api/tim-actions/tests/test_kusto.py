"""Kusto as TIM runs it: Run KQL against ``tim_kusto``, the ``KustoHook`` against a fake SDK
client, the URL and value rules the hook shares with the API, and the literals query parameters
are sent as."""

import threading
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any

import pytest
from azure.kusto.data import ClientRequestProperties
from azure.kusto.data import exceptions as kusto_exc

from tim_actions import Column, Hook, Param, ParamKind, QueryParameter, RunError, validate_params
from tim_actions.kusto import (
    RUN_KQL,
    KustoConnection,
    KustoHook,
    error_message,
    kusto_literal,
    normalise_cluster_url,
    query_parameters,
    serialise_value,
)
from tim_actions.snowflake import RUN_SQL
from tim_actions.testing import Connections, RunResult, run_action
from tim_actions.testing.kusto import FakeKusto, KustoCall

CLUSTER = "https://help.kusto.windows.net"
CONNECTION = KustoConnection(
    name="security", title="Security", type="kusto", auth="obo", cluster=CLUSTER
)


def table(kind: str, columns: list[tuple[str, str]], rows: list[list[Any]]) -> Any:
    return SimpleNamespace(
        table_kind=SimpleNamespace(value=kind),
        raw_columns=[{"ColumnName": n, "ColumnType": t} for n, t in columns],
        raw_rows=rows,
    )


STATS = table(
    "QueryCompletionInformation",
    [("LevelName", "string"), ("Payload", "string")],
    [["Stats", '{"ExecutionTime": 0.25, "input_dataset_statistics": {"extents": {"total": 3}}}']],
)


class FakeSdkClient:
    """The SDK client: answers with ``tables`` or raises ``error``; with ``hold``, a query waits
    for a ``.cancel query`` naming it."""

    def __init__(self) -> None:
        self.tables: list[Any] = []
        self.error: Exception | None = None
        self.hold = False
        self.clients: list[tuple[str, str]] = []
        self.queries: list[tuple[str, str, ClientRequestProperties]] = []
        self.commands: list[tuple[str | None, str]] = []
        self.querying = threading.Event()
        self.cancelled = threading.Event()

    def __call__(self, cluster: str, token: str) -> "FakeSdkClient":
        self.clients.append((cluster, token))
        return self

    def execute_query(self, database: str, query: str, properties: ClientRequestProperties) -> Any:
        self.queries.append((database, query, properties))
        self.querying.set()
        if self.hold:
            self.cancelled.wait(10)
            raise kusto_exc.KustoServiceError("Query was cancelled")
        if self.error is not None:
            raise self.error
        return SimpleNamespace(tables=self.tables)

    def execute_mgmt(
        self, database: str | None, query: str, properties: ClientRequestProperties
    ) -> Any:
        self.commands.append((database, query))
        self.cancelled.set()

    def close(self) -> None:
        pass


class OtherHook(Hook):
    def cancel(self) -> None:
        pass


@pytest.fixture
def sdk(monkeypatch: pytest.MonkeyPatch) -> FakeSdkClient:
    fake = FakeSdkClient()
    monkeypatch.setattr(KustoHook, "client_factory", staticmethod(fake))
    return fake


def hook() -> KustoHook:
    return KustoHook(CONNECTION, lambda scope: f"token for {scope}")


def run_kql(connections: Connections, values: Mapping[str, Any]) -> RunResult:
    params = {"connection": "security", "database": "Samples", "kql": "T", **values}
    return run_action(RUN_KQL, params, connections=connections)


def test_run_kql_runs_the_query_and_reports_kustos_columns_and_metrics(
    tim_kusto: FakeKusto, tim_connections: Connections
) -> None:
    tim_connections.add(CONNECTION)
    columns = [Column("Id", "number"), Column("Who", "string")]
    tim_kusto.respond([{"Id": 7, "Who": "a"}], columns=columns, details={"executionTime": 0.25})
    result = run_kql(tim_connections, {"kql": "T | take 1", "idColumn": "Id"})
    assert result.rows == [{"Id": 7, "Who": "a"}]
    assert result.columns == columns
    assert result.details == {"executionTime": 0.25}
    assert tim_kusto.calls == [KustoCall("security", "Samples", "T | take 1", {})]


def test_run_kql_declares_its_query_parameters_by_name_and_type() -> None:
    declared = [QueryParameter("a", "string"), QueryParameter("b", "long", value=1)]
    assert RUN_KQL.declare_statement(declared) == "declare query_parameters(a:string, b:long);"


def test_run_kql_declares_nothing_without_query_parameters() -> None:
    assert RUN_KQL.declare_statement([]) == ""


def test_an_action_that_takes_query_parameters_declares_nothing_by_default() -> None:
    assert RUN_SQL.declare_statement([QueryParameter("a", "string")]) == ""


def test_run_kql_refuses_a_connection_of_another_type() -> None:
    connections = Connections()
    connections.add(CONNECTION, OtherHook)
    with pytest.raises(RunError, match="security is not a Kusto connection"):
        run_kql(connections, {})


def test_the_hook_queries_as_the_analyst_and_gives_columns_rows_and_metrics(
    sdk: FakeSdkClient,
) -> None:
    sdk.tables = [
        table(
            "PrimaryResult",
            [("Id", "long"), ("At", "datetime"), ("Extra", "dynamic"), ("Who", "guid")],
            [[7, "2026-01-02T03:04:05.1000000Z", '{"a": 1}', "0f8fad5b"]],
        ),
        STATS,
    ]
    deadline = datetime.now(UTC) + timedelta(seconds=30)
    result = hook().query("Samples", "T | take 1", deadline=deadline, parameters={"n": "1"})
    assert result.rows == [
        {"Id": 7, "At": "2026-01-02T03:04:05.1Z", "Extra": {"a": 1}, "Who": "0f8fad5b"}
    ]
    assert result.columns == (
        Column("Id", "number"),
        Column("At", "datetime"),
        Column("Extra", "json"),
        Column("Who", "string"),
    )
    assert result.details == {"executionTime": 0.25, "extentsTotal": 3}
    assert sdk.clients == [(CLUSTER, f"token for {CLUSTER}/.default")]
    [(database, kql, properties)] = sdk.queries
    assert (database, kql) == ("Samples", "T | take 1")
    assert properties.client_request_id.startswith("TIM.RunKql;")
    assert properties.has_parameter("n")
    timeout: Any = properties.get_option(ClientRequestProperties.request_timeout_option_name, None)
    assert timedelta(seconds=25) < timeout <= timedelta(seconds=30)


def test_a_kusto_error_raises_a_run_error_with_its_message(sdk: FakeSdkClient) -> None:
    sdk.error = kusto_exc.KustoServiceError("Semantic error: no T\n   at Kusto.Engine.Run()")
    with pytest.raises(RunError, match=r"^Semantic error: no T$"):
        hook().query("Samples", "T", deadline=datetime.now(UTC) + timedelta(seconds=30))


def test_cancel_cancels_the_running_query_and_refuses_new_ones(sdk: FakeSdkClient) -> None:
    sdk.hold = True
    running = hook()
    errors: list[Exception] = []

    def query() -> None:
        try:
            running.query("Samples", "T", deadline=datetime.now(UTC) + timedelta(seconds=30))
        except RunError as exc:
            errors.append(exc)

    worker = threading.Thread(target=query)
    worker.start()
    assert sdk.querying.wait(5)
    running.cancel()
    worker.join(5)
    [(_, _, properties)] = sdk.queries
    assert sdk.commands == [("Samples", f'.cancel query "{properties.client_request_id}"')]
    assert len(errors) == 1
    with pytest.raises(RunError, match="cancelled"):
        running.query("Samples", "T", deadline=datetime.now(UTC))


def test_cancel_with_nothing_running_sends_nothing(sdk: FakeSdkClient) -> None:
    hook().cancel()
    assert sdk.clients == []


@pytest.mark.parametrize(
    ("url", "normalised"),
    [
        ("https://Help.Kusto.Windows.Net/", CLUSTER),
        ("  https://help.kusto.windows.net:443 ", CLUSTER),
        ("https://bücher.example", "https://xn--bcher-kva.example"),
    ],
)
def test_a_cluster_url_is_normalised(url: str, normalised: str) -> None:
    assert normalise_cluster_url(url) == normalised


@pytest.mark.parametrize(
    ("url", "reason"),
    [
        ("", "value is required"),
        ("https://a b", "whitespace"),
        ("http://help.kusto.windows.net", "absolute https"),
        ("https://help.kusto.windows.net?x=1", "query or fragment"),
        ("https://help.kusto.windows.net/db", "path"),
        ("https://user@help.kusto.windows.net", "credentials"),
        ("https://[::1]", "IP address"),
        ("https://10.0.0.1", "IP address"),
        ("https://help.kusto.windows.net:8443", "port"),
        ("https://help.kusto.windows.net:x", "invalid port"),
        ("https://", "host is missing"),
        ("https://-bad-.example", "valid domain name"),
    ],
)
def test_a_cluster_url_of_another_shape_is_refused(url: str, reason: str) -> None:
    with pytest.raises(ValueError, match=reason):
        normalise_cluster_url(url)


@pytest.mark.parametrize(
    ("kusto_type", "value", "stored"),
    [
        ("timespan", "1.02:03:04.5000000", "1.02:03:04.5000000"),
        ("timespan", "00:00:01", "00:00:01"),
        ("timespan", "not a timespan", "not a timespan"),
        ("datetime", "2026-01-02T03:04:05Z", "2026-01-02T03:04:05Z"),
        ("dynamic", "not json", "not json"),
        ("dynamic", [1], [1]),
        ("decimal", "1.5", 1.5),
        ("decimal", "0.1000000000000000000001", "0.1000000000000000000001"),
        ("decimal", "NaN", "NaN"),
        ("string", None, None),
        ("long", 3, 3),
    ],
)
def test_values_are_stored_as_json(kusto_type: str, value: Any, stored: Any) -> None:
    assert serialise_value(kusto_type, value) == stored


@pytest.mark.parametrize(
    ("error", "message"),
    [
        (
            kusto_exc.KustoServiceError("no", http_response=SimpleNamespace(status_code=403)),
            "Access to the Kusto cluster or database was denied.",
        ),
        (
            kusto_exc.KustoApiError(
                {"error": {"code": "BadRequest", "message": "Bad", "@message": "Bad request: x"}}
            ),
            "Bad request: x",
        ),
        (
            kusto_exc.KustoMultiApiError(
                [
                    {
                        "OneApiErrors": [
                            {"error": {"code": "One", "message": "One", "@message": "First"}}
                        ]
                    }
                ]
            ),
            "First",
        ),
        (kusto_exc.KustoNetworkError(CLUSTER), "Could not reach the Kusto cluster."),
        (
            kusto_exc.KustoAuthenticationError("token", Exception("x")),
            "Authentication to the Kusto cluster failed.",
        ),
        (kusto_exc.KustoClientError("x"), "Kusto query failed."),
    ],
)
def test_sdk_errors_have_safe_messages(error: Exception, message: str) -> None:
    assert error_message(error) == message


PLUS_TWO = timezone(timedelta(hours=2))


@pytest.mark.parametrize(
    ("kind", "value", "literal"),
    [
        ("string", 'it\'s "quoted"\nand multiline', 'it\'s "quoted"\nand multiline'),
        ("number", 10, "10"),
        ("number", -0.25, "-0.25"),
        ("number", float("nan"), "real(nan)"),
        ("number", float("inf"), "real(+inf)"),
        ("number", float("-inf"), "real(-inf)"),
        ("boolean", False, "false"),
        (
            "datetime",
            datetime(2026, 10, 1, 12, 30, 15, 123456, tzinfo=PLUS_TWO),
            "datetime(2026-10-01T10:30:15.1234560Z)",
        ),
        ("timespan", timedelta(0), "timespan(00:00:00)"),
        ("timespan", timedelta(minutes=90, milliseconds=500), "timespan(01:30:00.5000000)"),
        ("timespan", -timedelta(days=2, hours=3), "timespan(-2.03:00:00)"),
        ("json", {"a": [1, None], "b": "café"}, 'dynamic({"a":[1,null],"b":"café"})'),
        ("json", "x", 'dynamic("x")'),
    ],
)
def test_a_value_is_sent_as_a_kusto_literal(kind: ParamKind, value: Any, literal: str) -> None:
    assert kusto_literal(kind, value) == literal


@pytest.mark.parametrize(
    ("kind", "values", "literal"),
    [
        ("string", ['a"b', "café"], 'dynamic(["a\\"b","café"])'),
        ("number", [1, 2.5, float("inf")], "dynamic([1,2.5,real(+inf)])"),
        ("boolean", [True], "dynamic([true])"),
        (
            "datetime",
            [datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 1, 2, 3, tzinfo=UTC)],
            "dynamic([datetime(2026-01-01T00:00:00.0000000Z),"
            "datetime(2026-01-02T03:00:00.0000000Z)])",
        ),
        ("timespan", [timedelta(hours=1)], "dynamic([timespan(01:00:00)])"),
        ("string", [], "dynamic([])"),
    ],
)
def test_many_values_are_sent_as_a_dynamic_array(
    kind: ParamKind, values: Any, literal: str
) -> None:
    assert kusto_literal(kind, values, many=True) == literal


@pytest.mark.parametrize("kind", ["kql", "sql", "connection"])
def test_an_editor_or_connection_value_is_not_a_query_parameter(kind: ParamKind) -> None:
    with pytest.raises(ValueError, match=f"a {kind} param can't be a Kusto query parameter"):
        kusto_literal(kind, "x")


def test_query_parameters_are_the_validated_params_with_a_value() -> None:
    params = (
        Param("users", "string", many=True),
        Param("since", "datetime"),
        Param("limit", "number", required=False),
    )
    values = validate_params(params, {"users": ["alice"], "since": "2026-10-01T00:00:00Z"})
    assert query_parameters(params, values) == {
        "users": 'dynamic(["alice"])',
        "since": "datetime(2026-10-01T00:00:00.0000000Z)",
    }
