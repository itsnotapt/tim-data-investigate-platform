from importlib.metadata import entry_points

from tim_actions import ENTRY_POINT_GROUP, Provider


def test_the_built_in_provider_registers_through_the_entry_point_group() -> None:
    [entry_point] = [ep for ep in entry_points(group=ENTRY_POINT_GROUP) if ep.name == "tim"]
    assert entry_point.dist is not None
    assert entry_point.dist.name == "tim-actions"
    assert isinstance(entry_point.load()(), Provider)
