from tim_actions.testing import Connections, resolve_pivot, run_action

from example_provider import STATE_REGIONS
from example_provider.lookup import LookupConnection, LookupHook

REGIONS = LookupConnection(
    name="regions",
    title="US regions",
    type="lookup",
    auth="workload_identity",
    entries={
        "TEXAS": {"Region": "South", "Division": "West South Central"},
        "KANSAS": {"Region": "Midwest", "Division": "West North Central"},
    },
)


def test_state_regions_looks_each_state_up_in_the_lookup_connection() -> None:
    connections = Connections()
    connections.add(REGIONS, LookupHook)

    result = run_action(STATE_REGIONS, {"keys": ["TEXAS", "GUAM"]}, connections=connections)

    assert result.rows == [
        {"State": "TEXAS", "Region": "South", "Division": "West South Central"},
        {"State": "GUAM"},
    ]
    assert result.ids == ["TEXAS", "GUAM"]


def test_a_pivot_into_state_regions_takes_the_distinct_states() -> None:
    rows = [{"State": "TEXAS"}, {"State": "KANSAS"}, {"State": "TEXAS"}]

    assert resolve_pivot(STATE_REGIONS, rows).params == {"keys": ["TEXAS", "KANSAS"]}
