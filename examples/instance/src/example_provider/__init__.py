"""The example instance's provider: the ``storm_summary`` action type and its action file, the
``lookup`` connection type, and a Python action on it."""

from importlib.resources import files

from tim_actions import Column, Param, Provider

from example_provider.lookup import LookupAction, LookupHook
from example_provider.storm_summary import StormSummary

STATE_REGIONS = LookupAction(
    key="example.state_regions",
    name="State regions",
    menu="Weather",
    description="The US Census region and division of each state",
    pivot="rows",
    connection="regions",
    key_column="State",
    params=(Param("keys", "string", title="States", many=True, from_columns=("State",)),),
    id="State",
    columns=(
        Column("State", "string", pinned="left", sort="asc"),
        Column("Region", "string"),
        Column("Division", "string"),
    ),
)


def provider() -> Provider:
    return Provider(
        actions=[STATE_REGIONS],
        action_types=[StormSummary],
        hooks=[LookupHook],
        action_files=files("example_provider") / "actions",
    )
