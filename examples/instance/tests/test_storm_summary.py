from tim_actions.kusto import KustoConnection
from tim_actions.testing import Connections, resolve_pivot, run_action
from tim_actions.testing.kusto import FakeKusto

from example_provider.storm_summary import StormSummary

SUMMARY = StormSummary(
    key="example.storm_summary",
    name="Storm summary",
    pivot="rows",
    connection="samples",
    database="Samples",
)


def test_a_pivot_summarises_the_selected_states_over_the_rows_time_window() -> None:
    rows = [
        {"State": "TEXAS", "StartTime": "2007-06-02T10:00:00Z", "EndTime": "2007-06-02T12:00:00Z"},
        {"State": "KANSAS", "StartTime": "2007-05-04T21:00:00Z", "EndTime": "2007-05-05T03:00:00Z"},
        {"State": "TEXAS", "StartTime": "2007-08-17T01:00:00Z", "EndTime": "2007-08-19T00:00:00Z"},
    ]

    resolved = resolve_pivot(SUMMARY, rows)

    assert resolved.params == {
        "states": ["TEXAS", "KANSAS"],
        "since": "2007-05-04T21:00:00Z",
        "until": "2007-08-19T00:00:00Z",
    }
    assert resolved.missing == {}


def test_a_run_binds_the_params_by_name_and_ids_each_row_by_its_window(
    tim_connections: Connections, tim_kusto: FakeKusto
) -> None:
    tim_connections.add(
        KustoConnection(
            name="samples",
            title="Samples",
            type="kusto",
            auth="obo",
            cluster="https://help.kusto.windows.net",
        )
    )
    tim_kusto.respond([{"State": "TEXAS", "EventType": "Hail", "Events": 3}])

    result = run_action(
        SUMMARY,
        {"states": ["TEXAS"], "since": "2007-05-04T21:00:00Z", "until": "2007-08-19T00:00:00Z"},
        connections=tim_connections,
    )

    [call] = tim_kusto.calls
    assert (call.connection, call.database) == ("samples", "Samples")
    assert call.kql.startswith("declare query_parameters(states: dynamic")
    assert call.parameters == {
        "states": 'dynamic(["TEXAS"])',
        "since": "datetime(2007-05-04T21:00:00.0000000Z)",
        "until": "datetime(2007-08-19T00:00:00.0000000Z)",
    }
    assert result.rows == [{"State": "TEXAS", "EventType": "Hail", "Events": 3}]
    assert result.ids == ['["TEXAS","Hail","2007-05-04T21:00:00Z","2007-08-19T00:00:00Z"]']
