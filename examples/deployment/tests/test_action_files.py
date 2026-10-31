from importlib.resources import files
from pathlib import Path

import pytest
from tim_actions.kusto import KqlQuery
from tim_actions.testing import ActionFilesError, load_actions, resolve_pivot

from example_provider import provider
from example_provider.storm_summary import StormSummary

CONFIG = Path(__file__).parents[1] / "config"


def test_the_package_data_action_files_load_with_the_providers_action_types() -> None:
    actions = load_actions(files("example_provider") / "actions", provider().action_types)

    summary = actions["example.storm_summary"]
    assert isinstance(summary, StormSummary)
    assert (summary.connection, summary.database) == ("samples", "Samples")
    assert [param.name for param in summary.params] == ["states", "since", "until"]


def test_a_storm_summary_file_can_not_give_params(tmp_path: Path) -> None:
    (tmp_path / "summary.yaml").write_text(
        "type: storm_summary\n"
        "key: acme.summary\n"
        "name: Summary\n"
        "pivot: rows\n"
        "connection: samples\n"
        "database: Samples\n"
        "params: [{name: state, kind: string}]\n"
    )

    with pytest.raises(ActionFilesError, match="storm_summary declares its own params"):
        load_actions(tmp_path, [StormSummary])


def test_the_instance_action_files_load_and_pivot_from_a_storm_event() -> None:
    actions = load_actions(CONFIG / "actions", [KqlQuery])

    assert sorted(actions) == ["example.storm_episode", "example.storm_events"]
    episode = actions["example.storm_episode"]
    assert isinstance(episode, KqlQuery)
    event = {"EventId": 61032, "EpisodeId": 1231, "State": "TEXAS", "EventType": "Hail"}
    assert resolve_pivot(episode, [event]).params == {"episode": 1231}
