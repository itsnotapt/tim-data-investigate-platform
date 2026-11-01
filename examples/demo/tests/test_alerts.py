from pathlib import Path

import pytest
import yaml
from tim_actions import Action
from tim_actions.kusto import KqlQuery, KustoConnection
from tim_actions.testing import Connections, load_actions, run_action
from tim_actions.testing.kusto import FakeKusto

CONFIG = Path(__file__).parents[1] / "config"


@pytest.fixture
def alerts(tim_connections: Connections) -> Action:
    [security] = yaml.safe_load((CONFIG / "connections.yaml").read_text())
    tim_connections.add(KustoConnection.model_validate(security))
    return load_actions(CONFIG / "actions", [KqlQuery])["demo.alerts"]


def test_the_alerts_action_lists_the_alerts_in_the_security_logs() -> None:
    actions = load_actions(CONFIG / "actions", [KqlQuery])

    alerts = actions["demo.alerts"]
    assert isinstance(alerts, KqlQuery)
    assert (alerts.name, alerts.menu, alerts.pivot) == ("Alerts", "Alerts", "none")
    assert (alerts.connection, alerts.database, alerts.id) == ("security", "Security", "EventId")
    assert [column.name for column in alerts.columns] == [
        "Timestamp",
        "Host",
        "Severity",
        "Alert",
        "Product",
        "EventId",
    ]


def test_a_run_of_the_alerts_queries_its_time_window_in_the_security_logs(
    alerts: Action, tim_connections: Connections, tim_kusto: FakeKusto
) -> None:
    alert = {
        "Timestamp": "2018-08-20T10:00:00Z",
        "Host": "BGIST-L",
        "Severity": "High",
        "Alert": "Backdoor.PsEmpire",
        "Product": "Symantec Endpoint Protection",
        "EventId": "986c2f0e-9c88-45e1-af60-e4c2545dff54",
    }
    tim_kusto.respond([alert])

    result = run_action(
        alerts,
        {"since": "2018-08-20T00:00:00Z", "until": "2018-08-21T00:00:00Z"},
        connections=tim_connections,
    )

    [call] = tim_kusto.calls
    assert (call.connection, call.database) == ("security", "Security")
    assert call.parameters == {
        "since": "datetime(2018-08-20T00:00:00.0000000Z)",
        "until": "datetime(2018-08-21T00:00:00.0000000Z)",
    }
    assert "Timestamp between (since .. until)" in call.kql
    assert result.rows == [alert]


def test_a_run_without_a_time_window_uses_the_kqls_window_over_the_whole_data(
    alerts: Action, tim_connections: Connections, tim_kusto: FakeKusto
) -> None:
    tim_kusto.respond([])

    run_action(alerts, {}, connections=tim_connections)

    [call] = tim_kusto.calls
    assert call.parameters == {}
    assert call.kql.startswith(
        "declare query_parameters(since: datetime = datetime(2018-08-01), "
        "until: datetime = datetime(2018-09-01));"
    )
