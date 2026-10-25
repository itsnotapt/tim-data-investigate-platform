"""Records what a real Snowflake account answers to the statements ``test_snowflake.py`` replays,
into ``fixtures/snowflake.json``.

It runs ``SnowflakeHook`` itself, so a recording also checks the hook's calls against Snowflake.
It signs in as a connection from your ``~/.snowflake/connections.toml``, with whatever
authentication that gives (key pair, programmatic access token, MFA), its warehouse and a role
that can create a database and a role. It creates, and keeps, ``TIM_RECORDING`` with tables of
every type, ``TIM_RECORDING_HIDDEN``, and the role ``TIM_RECORDING_READER``, granted to you, which
can read ``TIM_RECORDING`` and only see ``TIM_RECORDING_HIDDEN``. The hook signs in with that
role, and no secondary roles, as TIM does with a reader role.

Of the databases ``SHOW TERSE DATABASES`` lists, only those in ``DATABASES`` are kept, so none of
your own; of ``SNOWFLAKE_SAMPLE_DATA``'s columns, only those of one schema.

    uv run python tests/record_snowflake.py <connection name>
"""

import json
import sys
import threading
import time
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

import snowflake.connector
from snowflake.connector import errors as sf_errors
from snowflake_recording import RECORDING, encode, encode_description, encode_error

from tim_actions import RunError
from tim_actions.snowflake import SnowflakeConnection, SnowflakeHook

ROLE = "TIM_RECORDING_READER"
DATABASES = {"SNOWFLAKE", "SNOWFLAKE_SAMPLE_DATA", "TIM_RECORDING", "TIM_RECORDING_HIDDEN"}
# A database's columns query, and the one schema of it kept.
SCHEMA_KEPT = {'"SNOWFLAKE_SAMPLE_DATA".INFORMATION_SCHEMA': "TPCH_SF1"}
SETUP = [
    "CREATE DATABASE IF NOT EXISTS TIM_RECORDING",
    """CREATE OR REPLACE TABLE TIM_RECORDING.PUBLIC.EVERY_TYPE (
        ID NUMBER(38, 0), BIG NUMBER(38, 0), PRICE NUMBER(10, 2), RATIO FLOAT, NAME VARCHAR,
        OK BOOLEAN, DAY DATE, AT_TIME TIME, AT_NTZ TIMESTAMP_NTZ, AT_LTZ TIMESTAMP_LTZ,
        AT_TZ TIMESTAMP_TZ, DOC VARIANT, OBJ OBJECT, ARR ARRAY, BYTES BINARY, PLACE GEOGRAPHY,
        SHAPE GEOMETRY, VEC VECTOR(FLOAT, 3)
    )""",
    """INSERT INTO TIM_RECORDING.PUBLIC.EVERY_TYPE SELECT
        1, 12345678901234567890, 1.50, 0.25, 'alice@contoso.com', TRUE, '2026-01-02'::DATE,
        '03:04:05.123'::TIME, '2026-01-02 03:04:05.123456'::TIMESTAMP_NTZ,
        '2026-01-02 03:04:05 +00:00'::TIMESTAMP_LTZ, '2026-01-02 03:04:05.5 +02:00'::TIMESTAMP_TZ,
        PARSE_JSON('{"a": [1, 2]}'), OBJECT_CONSTRUCT('k', 'v'), ARRAY_CONSTRUCT(1, 'two'),
        TO_BINARY('CAFE', 'HEX'), TO_GEOGRAPHY('POINT(1 2)'), TO_GEOMETRY('POINT(3 4)'),
        [1.5, 2, 3]::VECTOR(FLOAT, 3)""",
    "INSERT INTO TIM_RECORDING.PUBLIC.EVERY_TYPE (ID) VALUES (2)",
    'CREATE SCHEMA IF NOT EXISTS TIM_RECORDING."Mixed Case"',
    'CREATE OR REPLACE TABLE TIM_RECORDING."Mixed Case"."Sign-ins" ("User Name" VARCHAR)',
    """CREATE OR REPLACE VIEW TIM_RECORDING.PUBLIC.NAMES AS
        SELECT ID, NAME FROM TIM_RECORDING.PUBLIC.EVERY_TYPE""",
    "CREATE DATABASE IF NOT EXISTS TIM_RECORDING_HIDDEN",
    "CREATE OR REPLACE TABLE TIM_RECORDING_HIDDEN.PUBLIC.SECRET (X NUMBER)",
    "CREATE ROLE IF NOT EXISTS TIM_RECORDING_READER",
    """SET (me, warehouse) = (SELECT '"' || REPLACE(CURRENT_USER(), '"', '""') || '"',
        '"' || REPLACE(CURRENT_WAREHOUSE(), '"', '""') || '"')""",
    "GRANT ROLE TIM_RECORDING_READER TO USER IDENTIFIER($me)",
    "GRANT USAGE ON WAREHOUSE IDENTIFIER($warehouse) TO ROLE TIM_RECORDING_READER",
    "GRANT USAGE ON DATABASE TIM_RECORDING TO ROLE TIM_RECORDING_READER",
    "GRANT USAGE ON ALL SCHEMAS IN DATABASE TIM_RECORDING TO ROLE TIM_RECORDING_READER",
    "GRANT SELECT ON ALL TABLES IN DATABASE TIM_RECORDING TO ROLE TIM_RECORDING_READER",
    "GRANT SELECT ON ALL VIEWS IN DATABASE TIM_RECORDING TO ROLE TIM_RECORDING_READER",
    "GRANT MONITOR ON DATABASE TIM_RECORDING_HIDDEN TO ROLE TIM_RECORDING_READER",
]

EVERY_TYPE = "SELECT * FROM TIM_RECORDING.PUBLIC.EVERY_TYPE ORDER BY ID"
NUMBERS = (
    "SELECT 'NaN'::FLOAT AS NOT_A_NUMBER, '-inf'::FLOAT AS MINUS_INFINITY,"
    " 0.1::NUMBER(38, 20) AS TENTH, 1234567890.123456789::NUMBER(38, 9) AS PRECISE"
)
MISSING = "SELECT * FROM TIM_RECORDING.PUBLIC.NOPE"
SYNTAX = "SELEC 1"
TIMED_OUT = "SELECT SYSTEM$WAIT(10)"
CANCELLED = "SELECT SYSTEM$WAIT(30)"


class Recorder:
    """Wraps the connector, recording each statement's description and rows, or its error."""

    def __init__(self, connection_name: str) -> None:
        self.connection_name = connection_name
        self.statements: list[dict[str, Any]] = []
        self.querying = threading.Event()

    def connect(self, **login: Any) -> "RecordingConnection":
        """``connect_factory``: the hook's login, signed in as ``connection_name`` instead, with
        only the hook's role."""
        keep = (
            "role",
            "paramstyle",
            "session_parameters",
            "enable_server_session_keep_alive_auto_detection",
        )
        conn = snowflake.connector.connect(
            connection_name=self.connection_name, **{k: login[k] for k in keep if k in login}
        )
        conn.cursor().execute("USE SECONDARY ROLES NONE")
        return RecordingConnection(self, conn)

    def record(self, sql: str, **answer: Any) -> None:
        self.statements.append({"sql": sql, **answer})


class RecordingConnection:
    def __init__(self, recorder: Recorder, conn: Any) -> None:
        self.recorder = recorder
        self.conn = conn

    def cursor(self) -> "RecordingCursor":
        return RecordingCursor(self.recorder, self.conn.cursor())

    def close(self) -> None:
        self.conn.close()


class RecordingCursor:
    def __init__(self, recorder: Recorder, cursor: Any) -> None:
        self.recorder = recorder
        self.cursor = cursor
        self.sql = ""

    @property
    def description(self) -> Sequence[Any] | None:
        return self.cursor.description  # type: ignore[no-any-return]

    def execute(self, command: str) -> object:
        self.sql = command
        return self._recording_errors(lambda: self.cursor.execute(command))

    def execute_async(self, command: str) -> dict[str, Any]:
        self.sql = command
        started: dict[str, Any] = self.cursor.execute_async(command)
        self.recorder.querying.set()
        return started

    def get_results_from_sfqid(self, sfqid: str) -> None:
        self._recording_errors(lambda: self.cursor.get_results_from_sfqid(sfqid))

    def fetchall(self) -> Sequence[Sequence[Any]]:
        rows: list[Sequence[Any]] = self._recording_errors(self.cursor.fetchall)
        description = self.cursor.description or ()
        names = [d.name.lower() for d in description]
        if self.sql == "SHOW TERSE DATABASES":
            rows = [row for row in rows if row[names.index("name")] in DATABASES]
        for query, schema in SCHEMA_KEPT.items():
            if query in self.sql:
                rows = [row for row in rows if row[names.index("table_schema")] == schema]
        self.recorder.record(
            self.sql,
            description=encode_description(description),
            rows=[[encode(v) for v in row] for row in rows],
        )
        return rows

    def abort_query(self, qid: str) -> bool:
        return self.cursor.abort_query(qid)  # type: ignore[no-any-return]

    def _recording_errors(self, call: Any) -> Any:
        try:
            return call()
        except sf_errors.Error as exc:
            self.recorder.record(self.sql, error=encode_error(exc))
            raise


def query(hook: SnowflakeHook, sql: str, *, seconds: int = 60) -> None:
    try:
        hook.query(sql, deadline=datetime.now(UTC) + timedelta(seconds=seconds))
    except RunError as exc:
        print(f"{sql}: {exc}")


def main(connection_name: str) -> None:
    with snowflake.connector.connect(
        connection_name=connection_name, enable_server_session_keep_alive_auto_detection=False
    ) as conn:
        for statement in SETUP:
            conn.cursor().execute(statement)

    recorder = Recorder(connection_name)
    SnowflakeHook.connect_factory = staticmethod(recorder.connect)
    connection = SnowflakeConnection(
        name="recording",
        title="Recording",
        type="snowflake",
        auth="workload_identity",
        account="recording",
        warehouse="RECORDING",
        role=ROLE,
    )

    def hook() -> SnowflakeHook:
        return SnowflakeHook(connection, lambda scope: "")

    for sql in (EVERY_TYPE, NUMBERS, MISSING, SYNTAX):
        query(hook(), sql)
    query(hook(), TIMED_OUT, seconds=3)

    cancelled = hook()
    recorder.querying.clear()
    worker = threading.Thread(target=query, args=(cancelled, CANCELLED))
    worker.start()
    recorder.querying.wait(30)
    time.sleep(2)
    cancelled.cancel()
    worker.join(60)

    hook().editor_schema({})

    RECORDING.parent.mkdir(exist_ok=True)
    recorded = {
        "connector": snowflake.connector.__version__,
        "recorded": datetime.now(UTC).date().isoformat(),
        "statements": recorder.statements,
    }
    RECORDING.write_text(json.dumps(recorded, indent=2, ensure_ascii=False) + "\n")
    print(f"Recorded {len(recorder.statements)} statements in {RECORDING}")


if __name__ == "__main__":
    main(*sys.argv[1:])
