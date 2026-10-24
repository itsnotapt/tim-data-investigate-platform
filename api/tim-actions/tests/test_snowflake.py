"""Snowflake as TIM runs it: Run SQL against ``tim_snowflake``, and the ``SnowflakeHook`` against
a fake connector."""

import threading
from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import pytest
from snowflake.connector import errors as sf_errors

from tim_actions import Column, Hook, RunError
from tim_actions.snowflake import RUN_SQL, SnowflakeConnection, SnowflakeHook
from tim_actions.testing import Connections, RunResult, run_action
from tim_actions.testing.snowflake import FakeSnowflake, SnowflakeCall

SCOPE = "api://snowflake/session:role-any"
CONNECTION = SnowflakeConnection(
    name="warehouse",
    title="Warehouse",
    type="snowflake",
    auth="obo",
    scope=SCOPE,
    account="myorg-myaccount",
    warehouse="ANALYSTS",
)
AS_TIM = SnowflakeConnection(
    name="warehouse-tim",
    title="Warehouse as TIM",
    type="snowflake",
    auth="workload_identity",
    account="myorg-myaccount",
    warehouse="ANALYSTS",
    role="TIM_READER",
)

# The connector's type codes: ``snowflake.connector.constants.FIELD_ID_TO_NAME``.
FIXED, REAL, TEXT, DATE, VARIANT, TIMESTAMP_TZ, TIMESTAMP_NTZ, BINARY, BOOLEAN = (
    0,
    1,
    2,
    3,
    5,
    7,
    8,
    11,
    13,
)


def described(*columns: tuple[str, int]) -> list[Any]:
    return [SimpleNamespace(name=n, type_code=t) for n, t in columns]


class OtherHook(Hook):
    def cancel(self) -> None:
        pass


def run_sql(connections: Connections, values: Mapping[str, Any]) -> RunResult:
    return run_action(
        RUN_SQL, {"connection": "warehouse", "sql": "SELECT 1", **values}, connections=connections
    )


def test_run_sql_runs_the_query_and_reports_snowflakes_columns(
    tim_snowflake: FakeSnowflake, tim_connections: Connections
) -> None:
    tim_connections.add(CONNECTION)
    columns = [Column("ID", "number"), Column("WHO", "string")]
    tim_snowflake.respond([{"ID": 7, "WHO": "a"}], columns=columns)
    result = run_sql(tim_connections, {"sql": "SELECT * FROM T", "idColumn": "ID"})
    assert (result.rows, result.ids) == ([{"ID": 7, "WHO": "a"}], ["7"])
    assert result.columns == columns
    assert tim_snowflake.calls == [SnowflakeCall("warehouse", "SELECT * FROM T")]


def test_without_an_id_column_the_rows_have_no_id(
    tim_snowflake: FakeSnowflake, tim_connections: Connections
) -> None:
    tim_connections.add(CONNECTION)
    tim_snowflake.respond([{"ID": 7}])
    assert run_sql(tim_connections, {}).ids == [None]


def test_a_failed_query_ends_the_run_with_snowflakes_message(
    tim_snowflake: FakeSnowflake, tim_connections: Connections
) -> None:
    tim_connections.add(CONNECTION)
    tim_snowflake.fail("SQL compilation error")
    with pytest.raises(RunError, match=r"^SQL compilation error$"):
        run_sql(tim_connections, {})


def test_run_sql_refuses_a_connection_of_another_type() -> None:
    connections = Connections()
    connections.add(CONNECTION, OtherHook)
    with pytest.raises(RunError, match="warehouse is not a Snowflake connection"):
        run_sql(connections, {})


class FakeCursor:
    def __init__(self, sdk: "FakeConnector") -> None:
        self.sdk = sdk
        self.description: list[Any] | None = None
        self._rows: list[tuple[Any, ...]] = []

    def execute(self, command: str, params: Sequence[Any] | None = None) -> "FakeCursor":
        self.sdk.executed.append(command)
        answer = self.sdk.answer(command)
        if isinstance(answer, Exception):
            raise answer
        self.description, self._rows = answer
        return self

    def execute_async(self, command: str, params: Sequence[Any] | None = None) -> dict[str, Any]:
        self.sdk.executed.append(command)
        return {"queryId": "01b2-query"}

    def get_results_from_sfqid(self, sfqid: str) -> None:
        self.sdk.querying.set()
        if self.sdk.hold:
            self.sdk.aborted_event.wait(10)
            raise sf_errors.ProgrammingError("SQL execution canceled")
        answer = self.sdk.answer(self.sdk.executed[-1])
        if isinstance(answer, Exception):
            raise answer
        self.description, self._rows = answer

    def fetchall(self) -> list[tuple[Any, ...]]:
        return self._rows

    def abort_query(self, qid: str) -> bool:
        self.sdk.aborted.append(qid)
        self.sdk.aborted_event.set()
        return True


class FakeConnection:
    def __init__(self, sdk: "FakeConnector") -> None:
        self.sdk = sdk

    def cursor(self) -> FakeCursor:
        return FakeCursor(self.sdk)

    def close(self) -> None:
        self.sdk.closed += 1


class FakeConnector:
    """``snowflake.connector.connect``: records each login and answers each statement from
    ``answers``, by the first key the statement contains, or with ``result``; ``login_error``
    fails the login; with ``hold``, a query waits until it's aborted."""

    def __init__(self) -> None:
        self.logins: list[dict[str, Any]] = []
        self.executed: list[str] = []
        self.result: tuple[list[Any], list[tuple[Any, ...]]] | Exception = ([], [])
        self.answers: dict[str, tuple[list[Any], list[tuple[Any, ...]]] | Exception] = {}
        self.login_error: Exception | None = None
        self.hold = False
        self.closed = 0
        self.aborted: list[str] = []
        self.querying = threading.Event()
        self.aborted_event = threading.Event()

    def __call__(self, **kwargs: Any) -> FakeConnection:
        self.logins.append(kwargs)
        if self.login_error is not None:
            raise self.login_error
        return FakeConnection(self)

    def answer(self, command: str) -> tuple[list[Any], list[tuple[Any, ...]]] | Exception:
        for key, answer in self.answers.items():
            if key in command:
                return answer
        return self.result


@pytest.fixture
def sdk(monkeypatch: pytest.MonkeyPatch) -> FakeConnector:
    fake = FakeConnector()
    monkeypatch.setattr(SnowflakeHook, "connect_factory", staticmethod(fake))
    return fake


def hook(connection: SnowflakeConnection = CONNECTION) -> SnowflakeHook:
    return SnowflakeHook(connection, lambda scope: f"token for {scope}")


def in_30s() -> datetime:
    return datetime.now(UTC) + timedelta(seconds=30)


def test_the_hook_logs_in_as_the_analyst_and_gives_columns_and_rows(sdk: FakeConnector) -> None:
    sdk.result = (
        described(("ID", FIXED), ("WHO", TEXT), ("AT", TIMESTAMP_NTZ), ("OK", BOOLEAN)),
        [(7, "a", datetime(2026, 1, 2, 3, 4, 5, 100000), True)],
    )
    result = hook().query("SELECT 1", deadline=in_30s())
    assert result.columns == (
        Column("ID", "number"),
        Column("WHO", "string"),
        Column("AT", "datetime"),
        Column("OK", "boolean"),
    )
    assert result.rows == [{"ID": 7, "WHO": "a", "AT": "2026-01-02T03:04:05.1Z", "OK": True}]
    [login] = sdk.logins
    timeout = login.pop("session_parameters")["STATEMENT_TIMEOUT_IN_SECONDS"]
    assert 25 < timeout <= 30
    assert login == {
        "account": "myorg-myaccount",
        "warehouse": "ANALYSTS",
        "authenticator": "oauth",
        "token": f"token for {SCOPE}",
        "paramstyle": "numeric",
    }
    assert sdk.executed == ["SELECT 1"]
    assert sdk.closed == 1


def test_with_workload_identity_the_hook_logs_in_as_tim_without_a_token(
    sdk: FakeConnector,
) -> None:
    def no_token(scope: str) -> str:
        raise AssertionError("workload_identity asks for no token")

    SnowflakeHook(AS_TIM, no_token).query("SELECT 1", deadline=in_30s())
    [login] = sdk.logins
    del login["session_parameters"]
    assert login == {
        "account": "myorg-myaccount",
        "warehouse": "ANALYSTS",
        "role": "TIM_READER",
        "authenticator": "WORKLOAD_IDENTITY",
        "workload_identity_provider": "AZURE",
        "paramstyle": "numeric",
    }


def test_a_failed_login_raises_a_run_error_with_its_message(sdk: FakeConnector) -> None:
    sdk.login_error = sf_errors.DatabaseError("Failed to authenticate with WIF", errno=250001)
    with pytest.raises(RunError, match=r"^Failed to authenticate with WIF$"):
        SnowflakeHook(AS_TIM, lambda scope: "").query("SELECT 1", deadline=in_30s())


def test_a_failed_query_raises_a_run_error_with_its_message(sdk: FakeConnector) -> None:
    sdk.result = sf_errors.ProgrammingError(
        "SQL compilation error: Object 'T' does not exist", errno=2003, sqlstate="42S02"
    )
    with pytest.raises(RunError, match=r"^SQL compilation error: Object 'T' does not exist$"):
        hook().query("SELECT * FROM T", deadline=in_30s())
    assert sdk.closed == 1


def test_cancel_aborts_the_running_query_and_refuses_new_ones(sdk: FakeConnector) -> None:
    sdk.hold = True
    running = hook()
    errors: list[RunError] = []

    def query() -> None:
        try:
            running.query("SELECT SYSTEM$WAIT(60)", deadline=in_30s())
        except RunError as exc:
            errors.append(exc)

    worker = threading.Thread(target=query)
    worker.start()
    assert sdk.querying.wait(5)
    running.cancel()
    worker.join(5)
    assert sdk.aborted == ["01b2-query"]
    assert [str(e) for e in errors] == ["The query was cancelled"]
    with pytest.raises(RunError, match="cancelled"):
        running.query("SELECT 1", deadline=in_30s())
    assert len(sdk.logins) == 1


def test_cancel_with_nothing_running_logs_in_to_nothing(sdk: FakeConnector) -> None:
    hook().cancel()
    assert sdk.logins == []


def test_values_are_given_as_tim_stores_them(sdk: FakeConnector) -> None:
    sdk.result = (
        described(
            ("DAY", DATE),
            ("AT", TIMESTAMP_TZ),
            ("EXACT", FIXED),
            ("PRICE", FIXED),
            ("DOC", VARIANT),
            ("NOT_JSON", VARIANT),
            ("RAW", BINARY),
            ("RATIO", REAL),
        ),
        [
            (
                date(2026, 1, 2),
                datetime(2026, 1, 2, 5, 4, 5, tzinfo=timezone(timedelta(hours=2))),
                Decimal("12345678901234567890.12"),
                Decimal("1.50"),
                '{\n  "a": [1, 2]\n}',
                "not json",
                b"\x01\xff",
                float("nan"),
            )
        ],
    )
    result = hook().query("SELECT 1", deadline=in_30s())
    assert result.rows == [
        {
            "DAY": "2026-01-02T00:00:00Z",
            "AT": "2026-01-02T03:04:05Z",
            "EXACT": "12345678901234567890.12",
            "PRICE": 1.5,
            "DOC": {"a": [1, 2]},
            "NOT_JSON": "not json",
            "RAW": "01ff",
            "RATIO": "NaN",
        }
    ]
    assert [c.type for c in result.columns] == [
        "datetime",
        "datetime",
        "number",
        "number",
        "json",
        "json",
        "string",
        "number",
    ]


INFORMATION_SCHEMA_COLUMNS = described(
    ("TABLE_SCHEMA", TEXT), ("TABLE_NAME", TEXT), ("COLUMN_NAME", TEXT), ("DATA_TYPE", TEXT)
)


def test_the_editor_schema_is_the_tree_of_each_database_the_analyst_can_see(
    sdk: FakeConnector,
) -> None:
    sdk.answers = {
        "SHOW TERSE DATABASES": (
            described(("created_on", TIMESTAMP_TZ), ("name", TEXT), ("kind", TEXT)),
            [(None, "SALES", "STANDARD"), (None, 'NO"ACCESS', "IMPORTED DATABASE")],
        ),
        '"SALES".INFORMATION_SCHEMA.COLUMNS': (
            INFORMATION_SCHEMA_COLUMNS,
            [
                ("PUBLIC", "ORDERS", "ID", "NUMBER"),
                ("PUBLIC", "ORDERS", "AT", "TIMESTAMP_NTZ"),
                ("PUBLIC", "USERS", "UPN", "TEXT"),
                ("RAW", "EVENTS", "DOC", "VARIANT"),
            ],
        ),
        '"NO""ACCESS".INFORMATION_SCHEMA.COLUMNS': sf_errors.ProgrammingError(
            "Insufficient privileges", errno=3001
        ),
    }
    schema = hook().editor_schema({})
    assert schema is not None
    assert schema.kind == "sql"
    assert schema.schema == {
        "databases": [
            {
                "name": "SALES",
                "schemas": [
                    {
                        "name": "PUBLIC",
                        "tables": [
                            {
                                "name": "ORDERS",
                                "columns": [
                                    {"name": "ID", "type": "NUMBER"},
                                    {"name": "AT", "type": "TIMESTAMP_NTZ"},
                                ],
                            },
                            {"name": "USERS", "columns": [{"name": "UPN", "type": "TEXT"}]},
                        ],
                    },
                    {
                        "name": "RAW",
                        "tables": [
                            {"name": "EVENTS", "columns": [{"name": "DOC", "type": "VARIANT"}]}
                        ],
                    },
                ],
            },
        ]
    }
    assert len(sdk.logins) == 1
    assert sdk.closed == 1


def test_an_editor_schema_that_cant_be_had_raises_a_run_error(sdk: FakeConnector) -> None:
    sdk.login_error = sf_errors.DatabaseError("Invalid OAuth access token", errno=390303)
    with pytest.raises(RunError, match=r"^Invalid OAuth access token$"):
        hook().editor_schema({})


@pytest.mark.parametrize("account", ["myorg-myaccount", "xy12345.west-europe.azure", "MY_ORG-A1"])
def test_an_account_identifier_is_accepted(account: str) -> None:
    connection = SnowflakeConnection.model_validate(CONNECTION.model_dump() | {"account": account})
    assert connection.account == account


@pytest.mark.parametrize(
    "account", ["myorg-myaccount.snowflakecomputing.com/x", "https://myorg", "evil.com#", "a..b"]
)
def test_an_account_that_is_not_an_identifier_is_refused(account: str) -> None:
    with pytest.raises(ValueError, match="account identifier"):
        SnowflakeConnection.model_validate(CONNECTION.model_dump() | {"account": account})
