"""``kql_query``: fixed KQL in a database of a fixed Kusto connection, its params sent as Kusto
query parameters. Kusto is faked by ``tim_kusto``."""

from pathlib import Path
from typing import Any

import pytest

from tim_actions import Action
from tim_actions.kusto import KqlQuery, KustoConnection
from tim_actions.testing import (
    ActionFilesError,
    Connections,
    load_actions,
    resolve_pivot,
    run_action,
)
from tim_actions.testing.kusto import FakeKusto, KustoCall

STORMS_KQL = """\
declare query_parameters(states: dynamic, since: datetime, limit: int = 100);
StormEvents | where State in (states) and StartTime >= since | take limit
"""

ACTIONS = """\
type: kql_query
key: acme.storms
name: Storms
pivot: rows
connection: security
database: Samples
kql_file: storms.kql
id: EventId
params:
  - {name: states, kind: string, many: true, from_columns: [State]}
  - {name: since, kind: datetime}
  - {name: limit, kind: number, required: false}
---
type: kql_query
key: acme.storm_count
name: Storm count
pivot: none
connection: security
database: Samples
kql: |
  StormEvents | count
"""

SECURITY = KustoConnection(
    name="security",
    title="Security",
    type="kusto",
    auth="obo",
    cluster="https://help.kusto.windows.net",
)


@pytest.fixture
def actions(tmp_path: Path) -> dict[str, Action]:
    (tmp_path / "storms.yaml").write_text(ACTIONS)
    (tmp_path / "storms.kql").write_text(STORMS_KQL)
    loaded = load_actions(tmp_path, [KqlQuery])
    return {key: action for key, action in loaded.items() if isinstance(action, Action)}


@pytest.fixture
def connections(tim_connections: Connections) -> Connections:
    tim_connections.add(SECURITY)
    return tim_connections


def test_the_params_reach_kusto_as_query_parameters_with_the_sidecar_kql(
    actions: dict[str, Action], tim_kusto: FakeKusto, connections: Connections
) -> None:
    tim_kusto.respond([{"EventId": 61032, "State": "TEXAS"}, {"EventId": 60904}])
    params = {"states": ["TEXAS", "FLORIDA"], "since": "2007-09-01T00:00:00Z", "limit": 10}
    run_action(actions["acme.storms"], params, connections=connections)
    assert tim_kusto.calls == [
        KustoCall(
            "security",
            "Samples",
            STORMS_KQL,
            {
                "states": 'dynamic(["TEXAS","FLORIDA"])',
                "since": "datetime(2007-09-01T00:00:00.0000000Z)",
                "limit": "10",
            },
        )
    ]


def test_an_optional_param_without_a_value_leaves_the_kql_default(
    actions: dict[str, Action], tim_kusto: FakeKusto, connections: Connections
) -> None:
    tim_kusto.respond([])
    params = {"states": ["TEXAS"], "since": "2007-09-01T00:00:00Z", "limit": None}
    run_action(actions["acme.storms"], params, connections=connections)
    [call] = tim_kusto.calls
    assert "limit" not in call.parameters


def test_inline_kql_without_params_is_sent_as_written(
    actions: dict[str, Action], tim_kusto: FakeKusto, connections: Connections
) -> None:
    tim_kusto.respond([{"Count": 3}])
    assert run_action(actions["acme.storm_count"], connections=connections).rows == [{"Count": 3}]
    assert tim_kusto.calls == [KustoCall("security", "Samples", "StormEvents | count\n", {})]


def test_the_action_pivots_on_its_from_columns(actions: dict[str, Action]) -> None:
    rows: list[dict[str, Any]] = [{"State": "TEXAS", "EventId": 1}, {"State": "FLORIDA"}]
    resolved = resolve_pivot(actions["acme.storms"], rows)
    assert resolved.params == {"states": ["TEXAS", "FLORIDA"]}
    assert resolved.missing == {"since": None}


def test_a_kql_query_param_is_a_kusto_query_parameter(tmp_path: Path) -> None:
    (tmp_path / "bad.yaml").write_text(
        "type: kql_query\nkey: acme.bad\nname: Bad\npivot: none\nconnection: security\n"
        "database: Samples\nkql: T\nparams: [{name: query, kind: kql}]\n"
    )
    with pytest.raises(ActionFilesError) as raised:
        load_actions(tmp_path, [KqlQuery])
    assert raised.value.problems == [
        f"{tmp_path / 'bad.yaml'}:8: params: query: a kql_query param is a Kusto query "
        "parameter, so its kind is one of string, number, boolean, datetime, timespan, json, "
        "not kql"
    ]
