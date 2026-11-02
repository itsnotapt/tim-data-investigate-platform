"""Run titles: an action's ``title`` template, rendered from a run's resolved params."""

from collections.abc import Iterator, Mapping
from pathlib import Path
from typing import Any

import pytest
from jinja2.exceptions import SecurityError, UndefinedError

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
    assert action.title_for({"host": "BGIST-L"}, []) == "Host timeline BGIST-L"


def test_a_template_names_a_column_of_the_pivot_row(tmp_path: Path) -> None:
    action = _action(tmp_path, HOST_TIMELINE + 'title: "{{ action_name }} {{ row.Image }}"\n')
    rows = [{"Host": "BGIST-L", "Image": "powershell.exe"}]
    assert action.title_for({"host": "BGIST-L"}, rows) == "Host timeline powershell.exe"


SIGN_INS = """
type: query
key: sign-ins
name: Sign-ins
pivot: rows
query: SigninLogs
params:
  - {name: users, kind: string, many: true, from_columns: [Upn]}
"""

PIVOT_ROWS: list[dict[str, Any]] = [
    {"Upn": "alice", "App": "Teams", "Host": "BGIST-L"},
    {"Upn": "bob", "App": "Outlook", "Host": "BGIST-L"},
    {"Upn": "carol", "App": "Teams", "Host": None},
]


def test_cols_lists_a_columns_distinct_values_in_the_pivot_rows(tmp_path: Path) -> None:
    action = _action(tmp_path, SIGN_INS + "title: \"{{ cols.App | join(', ') }}\"\n")
    assert action.title_for({"users": ["alice", "bob", "carol"]}, PIVOT_ROWS) == "Teams, Outlook"


def test_row_holds_only_the_values_the_pivot_rows_agree_on(tmp_path: Path) -> None:
    title = "title: \"{{ row.Host }} {{ row.App | default('several apps') }}\"\n"
    action = _action(tmp_path, SIGN_INS + title)
    assert action.title_for({"users": ["alice", "bob", "carol"]}, PIVOT_ROWS) == (
        "BGIST-L several apps"
    )


def test_a_column_named_like_a_method_is_the_columns_value(tmp_path: Path) -> None:
    title = 'title: "{{ row.values }} {{ cols.items | first }} {{ row.get | default(host) }}"\n'
    action = _action(tmp_path, HOST_TIMELINE + title)
    rows = [{"values": "v", "items": "i"}]
    assert action.title_for({"host": "BGIST-L"}, rows) == "v i BGIST-L"


def test_without_pivot_rows_a_column_is_undefined(tmp_path: Path) -> None:
    action = _action(tmp_path, HOST_TIMELINE + 'title: "{{ row.Image | default(host) }}"\n')
    assert action.title_for({"host": "BGIST-L"}, []) == "BGIST-L"
    bare = _action(tmp_path, HOST_TIMELINE + 'title: "{{ cols.Image | first }}"\n')
    with pytest.raises(UndefinedError):
        bare.title_for({"host": "BGIST-L"}, [])


def test_a_column_no_pivot_row_has_a_value_for_is_undefined(tmp_path: Path) -> None:
    action = _action(tmp_path, HOST_TIMELINE + 'title: "{{ cols.Image | default(host) }}"\n')
    rows: list[dict[str, Any]] = [{"Image": None}, {"Image": ""}]
    assert action.title_for({"host": "BGIST-L"}, rows) == "BGIST-L"


def test_basename_gives_the_last_segment_of_a_windows_or_posix_path(tmp_path: Path) -> None:
    title = "title: \"{{ cols.Image | map('basename') | join(', ') }}\"\n"
    action = _action(tmp_path, HOST_TIMELINE + title)
    rows = [
        {"Image": r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"},
        {"Image": "/usr/bin/bash"},
        {"Image": "cmd.exe"},
    ]
    assert action.title_for({"host": "BGIST-L"}, rows) == "powershell.exe, bash, cmd.exe"


def test_without_a_template_the_title_is_the_actions_name(tmp_path: Path) -> None:
    assert _action(tmp_path, HOST_TIMELINE).title_for({"host": "BGIST-L"}, []) == "Host timeline"


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


def test_the_title_columns_are_those_the_template_names_under_row_and_cols(
    tmp_path: Path,
) -> None:
    title = "title: \"{{ row.Image }} {{ row['Command Line'] }} {{ cols.Host | first }}\"\n"
    action = _action(tmp_path, HOST_TIMELINE + title)
    assert action.title_columns == ("Command Line", "Host", "Image")


def test_a_template_without_row_or_cols_has_no_title_columns(tmp_path: Path) -> None:
    assert _action(tmp_path, HOST_TIMELINE + 'title: "{{ host }}"\n').title_columns == ()
    assert _action(tmp_path, HOST_TIMELINE).title_columns == ()


@pytest.mark.parametrize(
    "template",
    ["{{ row[host] }}", "{{ cols | length }}", "{% for c in row %}{{ c }}{% endfor %}"],
)
def test_a_template_names_a_column_of_row_or_cols_only_literally(
    tmp_path: Path, template: str
) -> None:
    assert _problems(tmp_path, HOST_TIMELINE + f'title: "{template}"\n') == [
        f"{tmp_path / 'actions.yaml'}:9: title: uses row or cols other than as row.Column,"
        " row['Column'], cols.Column or cols['Column']"
    ]


def test_a_param_may_not_be_named_action_name(tmp_path: Path) -> None:
    text = HOST_TIMELINE + "  - {name: action_name, kind: string}\n"
    assert _problems(tmp_path, text) == [
        f"{tmp_path / 'actions.yaml'}:7: params: action_name is the action's name in its title"
    ]


@pytest.mark.parametrize("name", ["row", "cols"])
def test_a_param_may_not_be_named_row_or_cols(tmp_path: Path, name: str) -> None:
    text = HOST_TIMELINE + f"  - {{name: {name}, kind: string}}\n"
    assert _problems(tmp_path, text) == [
        f"{tmp_path / 'actions.yaml'}:7: params: {name} is the pivot rows' values in its title"
    ]


def test_a_template_cannot_reach_python_internals(tmp_path: Path) -> None:
    action = _action(tmp_path, HOST_TIMELINE + 'title: "{{ host.__class__ }}"\n')
    with pytest.raises(SecurityError):
        action.title_for({"host": "BGIST-L"}, [])


def test_a_template_cannot_change_a_param(tmp_path: Path) -> None:
    text = HOST_TIMELINE.replace("kind: string,", "kind: string, many: true,")
    action = _action(tmp_path, text + 'title: "{{ host.append(1) }}"\n')
    hosts = ["a", "b"]
    with pytest.raises(SecurityError):
        action.title_for({"host": hosts}, [])
    assert hosts == ["a", "b"]
