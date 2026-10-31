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
from snowflake_recording import BoundKey, bound_key, load, load_binds

from tim_actions import Column, Hook, RunError
from tim_actions.params import Param
from tim_actions.snowflake import RUN_SQL, SnowflakeConnection, SnowflakeHook, bind_values
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
    assert result.rows == [{"ID": 7, "WHO": "a"}]
    assert result.columns == columns
    assert tim_snowflake.calls == [SnowflakeCall("warehouse", "SELECT * FROM T")]


def test_run_sqls_query_parameters_are_bound_in_their_order(
    tim_snowflake: FakeSnowflake, tim_connections: Connections
) -> None:
    tim_connections.add(CONNECTION)
    tim_snowflake.respond([])
    sql = "SELECT * FROM T WHERE UPN IN (SELECT value FROM TABLE(FLATTEN(PARSE_JSON(:1))))"
    parameters = [
        {"name": "upns", "type": "dynamic", "value": ["alice@contoso.com", "bob@contoso.com"]},
        {"name": "since", "type": "datetime", "value": "2026-01-02T03:00:00+02:00"},
        {"name": "limit", "type": "long", "value": 10},
        {"name": "ratio", "type": "real", "value": 0.5},
        {"name": "ok", "type": "bool", "value": True},
        {"name": "who", "type": "string", "value": "alice"},
        {"name": "doc", "type": "dynamic", "value": {"a": 1}},
    ]
    run_sql(tim_connections, {"sql": sql, "parameters": parameters})
    assert tim_snowflake.calls == [
        SnowflakeCall(
            "warehouse",
            sql,
            (
                '["alice@contoso.com","bob@contoso.com"]',
                datetime(2026, 1, 2, 1, tzinfo=UTC),
                10,
                0.5,
                True,
                "alice",
                '{"a":1}',
            ),
        )
    ]


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
        self.sdk.binds.append(params)
        return {"queryId": "01b2-query"}

    def get_results_from_sfqid(self, sfqid: str) -> None:
        self.sdk.querying.set()
        if self.sdk.hold:
            self.sdk.aborted_event.wait(10)
        answer = self.sdk.answer(self.sdk.executed[-1], self.sdk.binds[-1])
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
    ``answers``, by the first key the statement contains, or with ``result``; a statement with
    bound values from ``bound``, by ``bound_key`` with the login's ``TIMEZONE``; ``login_error``
    fails the login; with ``hold``, a query waits until it's aborted, then answers."""

    def __init__(self) -> None:
        self.logins: list[dict[str, Any]] = []
        self.executed: list[str] = []
        self.binds: list[Sequence[Any] | None] = []  # the values bound to each async statement
        self.bound: dict[BoundKey, tuple[list[Any], list[tuple[Any, ...]]] | Exception] = {}
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

    def answer(
        self, command: str, params: Sequence[Any] | None = None
    ) -> tuple[list[Any], list[tuple[Any, ...]]] | Exception:
        if params is not None:
            timezone = self.logins[-1].get("session_parameters", {}).get("TIMEZONE")
            return self.bound.get(
                bound_key(command, params, timezone), AssertionError("not recorded")
            )
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
        "enable_server_session_keep_alive_auto_detection": False,
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
        "enable_server_session_keep_alive_auto_detection": False,
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
    sdk.answers = {"SYSTEM$WAIT": sf_errors.ProgrammingError("SQL execution canceled")}
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


# --- against what a real account answered (``record_snowflake.py``) -----------------------


@pytest.fixture
def recorded(sdk: FakeConnector) -> FakeConnector:
    sdk.answers = dict(load())
    sdk.bound = load_binds()
    sdk.result = AssertionError("not recorded")
    return sdk


def test_each_type_snowflake_gives_comes_back_as_tim_stores_it(recorded: FakeConnector) -> None:
    result = hook().query(
        "SELECT * FROM TIM_RECORDING.PUBLIC.EVERY_TYPE ORDER BY ID", deadline=in_30s()
    )
    assert [(c.name, c.type) for c in result.columns] == [
        ("ID", "number"),
        ("BIG", "number"),
        ("PRICE", "number"),
        ("RATIO", "number"),
        ("NAME", "string"),
        ("OK", "boolean"),
        ("DAY", "datetime"),
        ("AT_TIME", "string"),
        ("AT_NTZ", "datetime"),
        ("AT_LTZ", "datetime"),
        ("AT_TZ", "datetime"),
        ("DOC", "json"),
        ("OBJ", "json"),
        ("ARR", "json"),
        ("BYTES", "string"),
        ("PLACE", "json"),
        ("SHAPE", "json"),
        ("VEC", "json"),
    ]
    assert result.rows == [
        {
            "ID": 1,
            "BIG": 12345678901234567890,
            "PRICE": 1.5,
            "RATIO": 0.25,
            "NAME": "alice@contoso.com",
            "OK": True,
            "DAY": "2026-01-02T00:00:00Z",
            "AT_TIME": "03:04:05.123",
            "AT_NTZ": "2026-01-02T03:04:05.123456Z",
            "AT_LTZ": "2026-01-02T03:04:05Z",
            "AT_TZ": "2026-01-02T01:04:05.5Z",
            "DOC": {"a": [1, 2]},
            "OBJ": {"k": "v"},
            "ARR": [1, "two"],
            "BYTES": "cafe",
            "PLACE": {"coordinates": [1, 2], "type": "Point"},
            "SHAPE": {"coordinates": [3, 4], "type": "Point"},
            "VEC": [1.5, 2, 3],
        },
        {"ID": 2} | {c.name: None for c in result.columns[1:]},
    ]


def test_numbers_a_float_cant_hold_come_back_as_strings(recorded: FakeConnector) -> None:
    sql = (
        "SELECT 'NaN'::FLOAT AS NOT_A_NUMBER, '-inf'::FLOAT AS MINUS_INFINITY,"
        " 0.1::NUMBER(38, 20) AS TENTH, 1234567890.123456789::NUMBER(38, 9) AS PRECISE"
    )
    assert hook().query(sql, deadline=in_30s()).rows == [
        {
            "NOT_A_NUMBER": "NaN",
            "MINUS_INFINITY": "-Infinity",
            "TENTH": 0.1,
            "PRECISE": "1234567890.123456789",
        }
    ]


@pytest.mark.parametrize(
    ("sql", "message"),
    [
        (
            "SELECT * FROM TIM_RECORDING.PUBLIC.NOPE",
            r"^SQL compilation error:\s+Object 'TIM_RECORDING.PUBLIC.NOPE' does not exist or not"
            r" authorized\. Your primary role ",
        ),
        ("SELEC 1", r"^SQL compilation error:\s+syntax error line 1 at position 0 "),
        ("SELECT SYSTEM$WAIT(10)", r"timeout of \d+ second\(s\) and was canceled\.$"),
    ],
)
def test_snowflakes_errors_end_the_query_with_its_message(
    recorded: FakeConnector, sql: str, message: str
) -> None:
    with pytest.raises(RunError, match=message):
        hook().query(sql, deadline=in_30s())


def test_a_query_cancelled_on_snowflake_ends_as_cancelled(recorded: FakeConnector) -> None:
    recorded.hold = True
    running = hook()
    errors: list[RunError] = []

    def query() -> None:
        try:
            running.query("SELECT SYSTEM$WAIT(30)", deadline=in_30s())
        except RunError as exc:
            errors.append(exc)

    worker = threading.Thread(target=query)
    worker.start()
    assert recorded.querying.wait(5)
    running.cancel()
    worker.join(5)
    assert [str(e) for e in errors] == ["The query was cancelled"]


def test_the_editor_schema_is_the_tree_snowflake_shows_the_role(recorded: FakeConnector) -> None:
    schema = hook().editor_schema({})
    assert schema is not None
    databases = {d["name"]: d["schemas"] for d in schema.schema["databases"]}
    assert list(databases) == [
        "SNOWFLAKE",
        "SNOWFLAKE_SAMPLE_DATA",
        "TIM_RECORDING",
        "TIM_RECORDING_HIDDEN",
    ]
    # Databases the role sees but can't use, with nothing in them it can read.
    assert databases["SNOWFLAKE"] == databases["TIM_RECORDING_HIDDEN"] == []
    # A shared database, recorded with one of its schemas.
    [tpch] = databases["SNOWFLAKE_SAMPLE_DATA"]
    assert tpch["name"] == "TPCH_SF1"
    tables = {t["name"]: t["columns"] for t in tpch["tables"]}
    assert list(tables) == [
        "CUSTOMER",
        "LINEITEM",
        "NATION",
        "ORDERS",
        "PART",
        "PARTSUPP",
        "REGION",
        "SUPPLIER",
    ]
    assert tables["REGION"] == [
        {"name": "R_REGIONKEY", "type": "NUMBER"},
        {"name": "R_NAME", "type": "TEXT"},
        {"name": "R_COMMENT", "type": "TEXT"},
    ]
    types = [
        ("ID", "NUMBER"),
        ("BIG", "NUMBER"),
        ("PRICE", "NUMBER"),
        ("RATIO", "FLOAT"),
        ("NAME", "TEXT"),
        ("OK", "BOOLEAN"),
        ("DAY", "DATE"),
        ("AT_TIME", "TIME"),
        ("AT_NTZ", "TIMESTAMP_NTZ"),
        ("AT_LTZ", "TIMESTAMP_LTZ"),
        ("AT_TZ", "TIMESTAMP_TZ"),
        ("DOC", "VARIANT"),
        ("OBJ", "OBJECT"),
        ("ARR", "ARRAY"),
        ("BYTES", "BINARY"),
        ("PLACE", "GEOGRAPHY"),
        ("SHAPE", "GEOMETRY"),
        ("VEC", "VECTOR"),
    ]
    assert databases["TIM_RECORDING"] == [
        {
            "name": "Mixed Case",
            "tables": [{"name": "Sign-ins", "columns": [{"name": "User Name", "type": "TEXT"}]}],
        },
        {
            "name": "PUBLIC",
            "tables": [
                {"name": "EVERY_TYPE", "columns": [{"name": n, "type": t} for n, t in types]},
                # A view.
                {
                    "name": "NAMES",
                    "columns": [{"name": "ID", "type": "NUMBER"}, {"name": "NAME", "type": "TEXT"}],
                },
            ],
        },
    ]


def test_values_are_bound_by_position_and_a_position_can_be_used_again(
    recorded: FakeConnector,
) -> None:
    result = hook().query("SELECT :1 AS A, :2 AS B, :1 AS C", deadline=in_30s(), params=["x", 2])
    assert result.rows == [{"A": "x", "B": 2, "C": "x"}]


def test_a_datetime_is_compared_with_timestamp_columns_as_utc(recorded: FakeConnector) -> None:
    sql = "SELECT ID FROM TIM_RECORDING.PUBLIC.EVERY_TYPE WHERE {} >= :1 ORDER BY ID"
    # Row 1 is at 01:04:05.5 and 03:04:05 UTC.
    one_am, three_am = datetime(2026, 1, 2, 1, tzinfo=UTC), datetime(2026, 1, 2, 3, tzinfo=UTC)
    assert hook().query(sql.format("AT_TZ"), deadline=in_30s(), params=[one_am]).rows == [{"ID": 1}]
    assert hook().query(sql.format("AT_LTZ"), deadline=in_30s(), params=[three_am]).rows == [
        {"ID": 1}
    ]


@pytest.mark.parametrize(
    ("column", "cast", "values", "ids"),
    [
        ("NAME", "string", '["alice@contoso.com", "bob@contoso.com"]', [1]),
        ("ID", "number", "[1, 2, 3]", [1, 2]),
        ("ID", "number", "[]", []),
    ],
)
def test_many_values_are_bound_as_json_text_the_query_parses(
    recorded: FakeConnector, column: str, cast: str, values: str, ids: list[int]
) -> None:
    sql = f"""SELECT ID, NAME FROM TIM_RECORDING.PUBLIC.EVERY_TYPE
    WHERE {column} IN (SELECT value::{cast} FROM TABLE(FLATTEN(PARSE_JSON(:1)))) ORDER BY ID"""  # noqa: S608 - the test's own literals
    rows = hook().query(sql, deadline=in_30s(), params=[values]).rows
    assert [row["ID"] for row in rows] == ids


def test_a_bound_value_can_be_cast(recorded: FakeConnector) -> None:
    sql = "SELECT :1::NUMBER(38, 0) AS N, :2::TIMESTAMP_TZ AS T, :3::VARIANT AS J"
    params = ["123", "2026-01-02 03:04:05 +02:00", '{"a": 1}']
    assert hook().query(sql, deadline=in_30s(), params=params).rows == [
        {"N": 123, "T": "2026-01-02T01:04:05Z", "J": '{"a": 1}'}
    ]


def bound_rows(sql: str, params: list[Param], values: Mapping[str, Any]) -> list[dict[str, Any]]:
    """The rows of ``sql`` with ``values`` bound as TIM binds a ``snowflake_query``'s params."""
    return hook().query(sql, deadline=in_30s(), params=bind_values(params, values)).rows


def test_many_datetimes_are_bound_as_utc_times_the_query_parses(recorded: FakeConnector) -> None:
    sql = """SELECT ID FROM TIM_RECORDING.PUBLIC.EVERY_TYPE
    WHERE AT_TZ IN (SELECT value::TIMESTAMP_TZ FROM TABLE(FLATTEN(PARSE_JSON(:1)))) ORDER BY ID"""
    # Row 1's AT_TZ is 03:04:05.5 +02:00.
    ats = [datetime(2026, 1, 2, 1, 4, 5, 500000, tzinfo=UTC), datetime(2026, 1, 3, tzinfo=UTC)]
    rows = bound_rows(sql, [Param("ats", "datetime", many=True)], {"ats": ats})
    assert rows == [{"ID": 1}]


def test_many_numbers_keep_every_digit(recorded: FakeConnector) -> None:
    sql = """SELECT ID FROM TIM_RECORDING.PUBLIC.EVERY_TYPE
    WHERE BIG IN (SELECT value::NUMBER(38, 0) FROM TABLE(FLATTEN(PARSE_JSON(:1)))) ORDER BY ID"""
    rows = bound_rows(sql, [Param("bigs", "number", many=True)], {"bigs": [12345678901234567890]})
    assert rows == [{"ID": 1}]


def test_a_json_value_is_bound_as_json_text_the_query_parses(recorded: FakeConnector) -> None:
    sql = "SELECT PARSE_JSON(:1):app::STRING AS APP, ARRAY_SIZE(PARSE_JSON(:1):ids) AS N"
    filter_ = {"app": "Teams", "ids": [1, 2]}
    assert bound_rows(sql, [Param("filter", "json")], {"filter": filter_}) == [
        {"APP": "Teams", "N": 2}
    ]


def test_an_optional_value_left_out_is_null(recorded: FakeConnector) -> None:
    sql = (
        "SELECT ID FROM TIM_RECORDING.PUBLIC.EVERY_TYPE"
        " WHERE (:1 IS NULL OR AT_TZ >= :1) ORDER BY ID"
    )
    since = [Param("since", "datetime", required=False)]
    assert bound_rows(sql, since, {}) == [{"ID": 1}, {"ID": 2}]
    assert bound_rows(sql, since, {"since": datetime(2026, 1, 2, 1, tzinfo=UTC)}) == [{"ID": 1}]


def test_a_limit_can_be_bound_and_null_is_none(recorded: FakeConnector) -> None:
    sql = "SELECT ID FROM TIM_RECORDING.PUBLIC.EVERY_TYPE ORDER BY ID LIMIT :1"
    limit = [Param("limit", "number", required=False)]
    assert bound_rows(sql, limit, {"limit": 1}) == [{"ID": 1}]
    assert bound_rows(sql, limit, {}) == [{"ID": 1}, {"ID": 2}]


def test_a_position_without_a_value_ends_the_query_with_snowflakes_message(
    recorded: FakeConnector,
) -> None:
    with pytest.raises(RunError, match=r"Bind variable :2 not set\.$"):
        hook().query("SELECT :1 AS A, :2 AS B", deadline=in_30s(), params=["only one"])


def test_a_query_without_values_binds_none(sdk: FakeConnector) -> None:
    hook().query("SELECT ':1' AS LIT", deadline=in_30s())
    assert sdk.binds == [None]
