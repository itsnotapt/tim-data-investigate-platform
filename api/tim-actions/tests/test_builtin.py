import sys
from importlib.metadata import entry_points

import pytest

from tim_actions import ENTRY_POINT_GROUP, Provider
from tim_actions.builtin import provider


def test_the_built_in_provider_registers_through_the_entry_point_group() -> None:
    [entry_point] = [ep for ep in entry_points(group=ENTRY_POINT_GROUP) if ep.name == "tim"]
    assert entry_point.dist is not None
    assert entry_point.dist.name == "tim-actions"
    assert isinstance(entry_point.load()(), Provider)


def contents(built_in: Provider) -> tuple[set[str], set[str]]:
    return {h.connection_type for h in built_in.hooks}, {a.key for a in built_in.actions}


def test_the_built_in_provider_has_each_connection_type_whose_extra_is_installed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert contents(provider()) == ({"kusto", "snowflake"}, {"tim.run_kql", "tim.run_sql"})
    monkeypatch.setitem(sys.modules, "snowflake.connector", None)
    assert contents(provider()) == ({"kusto"}, {"tim.run_kql"})
    monkeypatch.setitem(sys.modules, "azure.kusto.data", None)
    assert contents(provider()) == (set(), set())
    monkeypatch.undo()
    monkeypatch.setitem(sys.modules, "azure.kusto.data", None)
    assert contents(provider()) == ({"snowflake"}, {"tim.run_sql"})
