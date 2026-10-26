"""The development actions, run and loaded with ``tim_actions.testing``."""

from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest

from tim_actions import Action, RunError, Sink, dev
from tim_actions.testing import ActionFilesError, load_actions, run_action, run_sink


def run(action: Action, values: Mapping[str, Any] | None = None) -> list[tuple[Any, Any]]:
    """Each row with its ``id``."""
    result = run_action(action, values)
    return list(zip(result.ids, result.rows, strict=True))


def load(tmp_path: Path, text: str) -> Action | Sink:
    (tmp_path / "dev.yaml").write_text(text)
    [action] = load_actions(tmp_path, [dev.DevRows, dev.DevSink]).values()
    return action


def load_rows(tmp_path: Path, text: str) -> Action:
    action = load(tmp_path, text)
    assert isinstance(action, Action)
    return action


def load_sink(tmp_path: Path, text: str) -> Sink:
    sink = load(tmp_path, text)
    assert isinstance(sink, Sink)
    return sink


def problems(tmp_path: Path, text: str) -> list[str]:
    with pytest.raises(ActionFilesError) as raised:
        load(tmp_path, text)
    return [problem.removeprefix(f"{tmp_path / 'dev.yaml'}:") for problem in raised.value.problems]


def test_the_provider_has_dev_json_and_the_dev_rows_and_dev_sink_types() -> None:
    provider = dev.provider()
    assert [action.key for action in provider.actions] == ["tim.dev_json"]
    assert provider.action_types == [dev.DevRows, dev.DevSink]


def test_dev_json_yields_the_pasted_rows_with_ids_from_its_id_column() -> None:
    pasted = [{"Host": "h-1"}, {"Bytes": 3}]
    assert run(dev.DEV_JSON, {"rows": pasted, "idColumn": "Host"}) == [
        ("h-1", {"Host": "h-1"}),
        (None, {"Bytes": 3}),
    ]
    assert run(dev.DEV_JSON, {"rows": pasted}) == [(None, {"Host": "h-1"}), (None, {"Bytes": 3})]
    with pytest.raises(RunError, match="Rows must be a JSON array of objects"):
        run(dev.DEV_JSON, {"rows": {"Host": "h-1"}})


def test_dev_rows_generates_a_value_per_declared_column(tmp_path: Path) -> None:
    action = load_rows(
        tmp_path,
        "type: dev_rows\nkey: g\nname: G\npivot: none\ngenerate: 2\nid: Host\ncolumns:\n"
        "  - {name: Host, type: string}\n  - {name: Bytes, type: number}\n"
        "  - {name: Hash, type: bigint}\n  - {name: Blocked, type: boolean}\n"
        "  - {name: Seen, type: datetime}\n"
        "  - {name: Took, type: timespan}\n  - {name: Extra, type: json}\n",
    )
    assert run(action)[0] == (
        "Host-1",
        {
            "Host": "Host-1",
            "Bytes": 1,
            "Hash": 18446744073709551617,
            "Blocked": False,
            "Seen": "2026-01-01T00:01:00Z",
            "Took": "PT1S",
            "Extra": {"n": 1},
        },
    )


def test_dev_rows_generates_no_value_for_a_tim_column(tmp_path: Path) -> None:
    action = load_rows(
        tmp_path,
        "type: dev_rows\nkey: g\nname: G\npivot: none\ngenerate: 1\ncolumns:\n"
        "  - {name: Host, type: string}\n  - {name: 'tim:label', type: string, hidden: false}\n",
    )
    assert run(action) == [(None, {"Host": "Host-1"})]


def test_dev_rows_params_with_from_columns_filter_the_rows(tmp_path: Path) -> None:
    action = load_rows(
        tmp_path,
        "type: dev_rows\nkey: f\nname: F\npivot: rows\nparams:\n"
        "  - {name: user, kind: string, required: false, from_columns: [User, Upn]}\n"
        "rows:\n  - {User: alice}\n  - {User: '', Upn: alice}\n  - {User: bob, Upn: alice}\n",
    )
    assert [row for _, row in run(action, {"user": "alice"})] == [
        {"User": "alice"},
        {"User": "", "Upn": "alice"},
    ]
    assert len(run(action)) == 3


def test_dev_rows_reports_details(tmp_path: Path) -> None:
    action = load_rows(
        tmp_path,
        "type: dev_rows\nkey: d\nname: D\npivot: none\ndetails: {cluster: dev}\nrows: [{n: 1}]\n",
    )
    assert run_action(action).details == {"cluster": "dev"}


def test_dev_rows_waits_and_fails(tmp_path: Path) -> None:
    action = load_rows(
        tmp_path,
        "type: dev_rows\nkey: e\nname: E\npivot: none\ndelay: 0.01\nerror: Unavailable\n"
        "rows: [{n: 1}]\n",
    )
    with pytest.raises(RunError, match=r"^Unavailable$"):
        run_action(action)


@pytest.mark.parametrize(
    ("fields", "problem"),
    [
        ("rows: [{n: 1}]\ngenerate: 2\n", "1: give rows or generate, not both"),
        ("delay: true\n", "5: delay: Input should be a valid number"),
        ("generate: -1\n", "5: generate: Input should be greater than or equal to 0"),
        (
            "params: [{name: at, kind: datetime, from_columns: [At]}]\n",
            "5: params: from_columns filter only string, number and boolean params, "
            "not at (datetime)",
        ),
    ],
)
def test_dev_rows_files_are_validated(tmp_path: Path, fields: str, problem: str) -> None:
    assert problems(tmp_path, "type: dev_rows\nkey: x\nname: X\npivot: none\n" + fields) == [
        problem
    ]


def test_dev_rows_filters_never_match_a_boolean_with_a_number(tmp_path: Path) -> None:
    action = load_rows(
        tmp_path,
        "type: dev_rows\nkey: b\nname: B\npivot: rows\nparams:\n"
        "  - {name: count, kind: number, required: false, from_columns: [Value]}\n"
        "  - {name: flag, kind: boolean, required: false, from_columns: [Value]}\n"
        "rows:\n  - {Value: true}\n  - {Value: 1}\n  - {Value: 1.0}\n",
    )
    assert [row for _, row in run(action, {"count": 1})] == [{"Value": 1}, {"Value": 1.0}]
    assert [row for _, row in run(action, {"flag": True})] == [{"Value": True}]


def test_dev_sink_takes_the_rows_and_discards_them(tmp_path: Path) -> None:
    sink = load_sink(tmp_path, "type: dev_sink\nkey: s\nname: Save\nmenu: Dev / Sinks\n")
    assert sink.menu_path == ["Dev", "Sinks"]
    assert run_sink(sink, [{"Host": "h-1"}]).details == {}


def test_dev_sink_waits_then_fails(tmp_path: Path) -> None:
    sink = load_sink(tmp_path, "type: dev_sink\nkey: s\nname: S\ndelay: 0.01\nerror: Refused\n")
    with pytest.raises(RunError, match=r"^Refused$"):
        run_sink(sink, [{"n": 1}])


@pytest.mark.parametrize("field", ["pivot: rows", "params: []", "id: Host", "columns: []"])
def test_a_sink_file_has_no_query_fields(tmp_path: Path, field: str) -> None:
    [problem] = problems(tmp_path, f"type: dev_sink\nkey: s\nname: S\n{field}\n")
    assert problem.endswith("Extra inputs are not permitted")
