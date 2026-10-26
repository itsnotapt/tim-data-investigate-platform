"""``snowflake_query``: fixed SQL on a fixed Snowflake connection, its params bound by position.
Snowflake is faked by ``tim_snowflake``."""

from datetime import UTC, datetime
from pathlib import Path

import pytest

from tim_actions import Action
from tim_actions.snowflake import SnowflakeConnection, SnowflakeQuery
from tim_actions.testing import ActionFilesError, Connections, load_actions, run_action
from tim_actions.testing.snowflake import FakeSnowflake, SnowflakeCall

SIGNINS_SQL = """\
SELECT ID, UPN, AT FROM SIGNINS
WHERE UPN IN (SELECT value::string FROM TABLE(FLATTEN(PARSE_JSON(:1))))
  AND AT >= :2
LIMIT COALESCE(:3, 100)
"""

ACTIONS = """\
type: snowflake_query
key: acme.signins
name: Sign-ins
pivot: rows
connection: warehouse
sql_file: signins.sql
id: ID
params:
  - {name: upns, kind: string, many: true, from_columns: [UPN]}
  - {name: since, kind: datetime}
  - {name: limit, kind: number, required: false}
  - {name: filter, kind: json, required: false}
---
type: snowflake_query
key: acme.signin_count
name: Sign-in count
pivot: none
connection: warehouse
sql: |
  SELECT COUNT(*) AS N FROM SIGNINS
"""

WAREHOUSE = SnowflakeConnection(
    name="warehouse",
    title="Warehouse",
    type="snowflake",
    auth="obo",
    scope="api://snowflake/session:role-any",
    account="myorg-myaccount",
    warehouse="ANALYSTS",
)


@pytest.fixture
def actions(tmp_path: Path) -> dict[str, Action]:
    (tmp_path / "signins.yaml").write_text(ACTIONS)
    (tmp_path / "signins.sql").write_text(SIGNINS_SQL)
    loaded = load_actions(tmp_path, [SnowflakeQuery])
    return {key: action for key, action in loaded.items() if isinstance(action, Action)}


@pytest.fixture
def connections(tim_connections: Connections) -> Connections:
    tim_connections.add(WAREHOUSE)
    return tim_connections


def test_the_params_are_bound_in_their_order_with_the_sidecar_sql_as_written(
    actions: dict[str, Action], tim_snowflake: FakeSnowflake, connections: Connections
) -> None:
    tim_snowflake.respond([{"ID": 7, "UPN": "alice@contoso.com"}, {"ID": 8}])
    params = {
        "upns": ["alice@contoso.com", "bob@contoso.com"],
        "since": "2026-01-02T03:00:00+02:00",
        "limit": 10,
        "filter": {"app": "Teams"},
    }
    result = run_action(actions["acme.signins"], params, connections=connections)
    assert tim_snowflake.calls == [
        SnowflakeCall(
            "warehouse",
            SIGNINS_SQL,
            (
                '["alice@contoso.com","bob@contoso.com"]',
                datetime(2026, 1, 2, 1, tzinfo=UTC),
                10,
                '{"app":"Teams"}',
            ),
        )
    ]
    assert result.ids == ["7", "8"]


def test_an_optional_param_without_a_value_is_bound_as_null(
    actions: dict[str, Action], tim_snowflake: FakeSnowflake, connections: Connections
) -> None:
    tim_snowflake.respond([])
    params = {"upns": ["alice@contoso.com"], "since": "2026-01-02T00:00:00Z"}
    run_action(actions["acme.signins"], params, connections=connections)
    [call] = tim_snowflake.calls
    assert call.params[2:] == (None, None)


def test_inline_sql_without_params_is_sent_as_written(
    actions: dict[str, Action], tim_snowflake: FakeSnowflake, connections: Connections
) -> None:
    tim_snowflake.respond([{"N": 3}])
    assert run_action(actions["acme.signin_count"], connections=connections).rows == [{"N": 3}]
    assert tim_snowflake.calls == [
        SnowflakeCall("warehouse", "SELECT COUNT(*) AS N FROM SIGNINS\n", ())
    ]


@pytest.mark.parametrize("kind", ["timespan", "sql"])
def test_a_snowflake_query_param_is_a_value_snowflake_can_bind(tmp_path: Path, kind: str) -> None:
    (tmp_path / "bad.yaml").write_text(
        "type: snowflake_query\nkey: acme.bad\nname: Bad\npivot: none\nconnection: warehouse\n"
        f"sql: SELECT :1\nparams: [{{name: since, kind: {kind}}}]\n"
    )
    with pytest.raises(ActionFilesError) as raised:
        load_actions(tmp_path, [SnowflakeQuery])
    assert raised.value.problems == [
        f"{tmp_path / 'bad.yaml'}:7: params: since: a snowflake_query param is bound by "
        f"position, so its kind is one of string, number, boolean, datetime, json, not {kind}"
    ]
