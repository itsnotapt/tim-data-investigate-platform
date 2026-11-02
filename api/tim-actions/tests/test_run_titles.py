"""Run titles: an action's ``title`` template, rendered from a run's resolved params."""

from collections.abc import Iterator, Mapping
from pathlib import Path
from typing import Any

import pytest
from jinja2.exceptions import SecurityError

from tim_actions import Action, ActionDocument, RunContext
from tim_actions.files import load_action_files


class QueryFile(ActionDocument):
    query: str


class Query(Action):
    type_name = "query"
    File = QueryFile

    query: str

    def run(self, params: Mapping[str, Any], ctx: RunContext) -> Iterator[Mapping[str, Any]]:
        yield {"query": self.query}


TYPES: dict[str, type[Action]] = {"query": Query}

HOST_TIMELINE = """
type: query
key: host-timeline
name: Host timeline
pivot: row
query: Events
params:
  - {name: host, kind: string, from_columns: [Host]}
"""


def _action(tmp_path: Path, text: str) -> Action:
    (tmp_path / "actions.yaml").write_text(text)
    loaded = load_action_files(tmp_path, TYPES)
    assert loaded.problems == []
    [item] = loaded.actions
    assert isinstance(item.action, Action)
    return item.action


def test_the_title_template_renders_the_params_and_the_actions_name(tmp_path: Path) -> None:
    action = _action(tmp_path, HOST_TIMELINE + 'title: "{{ action_name }} {{ host }}"\n')
    assert action.title_for({"host": "BGIST-L"}) == "Host timeline BGIST-L"


def test_without_a_template_the_title_is_the_actions_name(tmp_path: Path) -> None:
    assert _action(tmp_path, HOST_TIMELINE).title_for({"host": "BGIST-L"}) == "Host timeline"


def _problems(tmp_path: Path, text: str) -> list[str]:
    (tmp_path / "actions.yaml").write_text(text)
    return load_action_files(tmp_path, TYPES).problems


def test_a_template_with_a_syntax_error_is_refused(tmp_path: Path) -> None:
    [problem] = _problems(tmp_path, HOST_TIMELINE + 'title: "{{ action_name }} {{ host"\n')
    assert problem.startswith(f"{tmp_path / 'actions.yaml'}:9: title: not a valid template: ")


def test_a_template_may_name_only_params_and_the_actions_name(tmp_path: Path) -> None:
    assert _problems(tmp_path, HOST_TIMELINE + 'title: "{{ host }} {{ user }} {{ menu }}"\n') == [
        f"{tmp_path / 'actions.yaml'}:9: title: names menu, user,"
        " which are neither params nor action_name"
    ]


def test_a_param_may_not_be_named_action_name(tmp_path: Path) -> None:
    text = HOST_TIMELINE + "  - {name: action_name, kind: string}\n"
    assert _problems(tmp_path, text) == [
        f"{tmp_path / 'actions.yaml'}:7: params: action_name is the action's name in its title"
    ]


def test_a_template_cannot_reach_python_internals(tmp_path: Path) -> None:
    action = _action(tmp_path, HOST_TIMELINE + 'title: "{{ host.__class__ }}"\n')
    with pytest.raises(SecurityError):
        action.title_for({"host": "BGIST-L"})


def test_a_template_cannot_change_a_param(tmp_path: Path) -> None:
    text = HOST_TIMELINE.replace("kind: string,", "kind: string, many: true,")
    action = _action(tmp_path, text + 'title: "{{ host.append(1) }}"\n')
    hosts = ["a", "b"]
    with pytest.raises(SecurityError):
        action.title_for({"host": hosts})
    assert hosts == ["a", "b"]
