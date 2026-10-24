"""``tim_kusto``: a recording fake of Kusto connections' hook, answering Kusto queries in order."""

import pytest

from tim_actions import Column, RunError
from tim_actions.kusto import RUN_KQL, KustoConnection
from tim_actions.testing import Connections, run_action
from tim_actions.testing.kusto import FakeKusto, KustoCall

SECURITY = KustoConnection(
    name="security",
    title="Security",
    type="kusto",
    auth="obo",
    cluster="https://help.kusto.windows.net",
)


@pytest.fixture
def connections(tim_connections: Connections) -> Connections:
    tim_connections.add(SECURITY)
    return tim_connections


def run_kql(connections: Connections, kql: str) -> list[dict[str, object]]:
    params = {"connection": "security", "database": "Samples", "kql": kql}
    return run_action(RUN_KQL, params, connections=connections).rows


def test_queries_get_the_queued_answers_in_order_and_are_recorded(
    tim_kusto: FakeKusto, connections: Connections
) -> None:
    tim_kusto.respond([{"Host": "h-1"}], columns=[Column("Host", "string")], details={"n": 1})
    tim_kusto.respond([])
    result = run_action(
        RUN_KQL,
        {"connection": "security", "database": "Samples", "kql": "Hosts"},
        connections=connections,
    )
    assert (result.rows, result.columns, result.details) == (
        [{"Host": "h-1"}],
        [Column("Host", "string")],
        {"n": 1},
    )
    assert run_kql(connections, "Empty") == []
    assert tim_kusto.calls == [
        KustoCall("security", "Samples", "Hosts", {}),
        KustoCall("security", "Samples", "Empty", {}),
    ]


def test_a_queued_failure_ends_the_run_with_its_message(
    tim_kusto: FakeKusto, connections: Connections
) -> None:
    tim_kusto.fail("Semantic error")
    with pytest.raises(RunError, match=r"^Semantic error$"):
        run_kql(connections, "T")
    tim_kusto.fail(TimeoutError("slow"))
    with pytest.raises(TimeoutError):
        run_kql(connections, "T")


def test_a_query_with_no_answer_queued_fails_the_test(
    tim_kusto: FakeKusto, connections: Connections
) -> None:
    with pytest.raises(AssertionError, match="no answer queued for Kusto query T"):
        run_kql(connections, "T")


def test_the_fake_reaches_no_kusto_cluster(tim_kusto: FakeKusto, connections: Connections) -> None:
    hook = connections.hook("security")
    with pytest.raises(AssertionError, match="tim_kusto reaches no Kusto cluster"):
        hook.editor_schema({"database": "Samples"})
