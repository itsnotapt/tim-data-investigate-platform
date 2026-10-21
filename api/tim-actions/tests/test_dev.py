"""The development actions, run as TIM runs them: params validated, then ``run`` with a context."""

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from tim_actions import Action, Analyst, Column, DetailValue, Hook, RunError, dev, validate_params
from tim_actions.files import load_action_files


class Context:
    """A run's context, recording what the action reports."""

    def __init__(self) -> None:
        self.details: dict[str, DetailValue] = {}
        self.deadline = datetime.now(UTC) + timedelta(seconds=10)
        self.analyst = Analyst("Alice", "alice@example.com")

    def hook(self, connection: str) -> Hook:
        raise ValueError(connection)

    def detail(self, key: str, value: DetailValue) -> None:
        self.details[key] = value

    def declare_columns(self, columns: Sequence[Column]) -> None:
        pass


def run(action: Action, values: Mapping[str, Any] | None = None) -> list[tuple[Any, Any]]:
    """Each row with its ``id``."""
    params = validate_params(action.params, values or {})
    row_id = action.row_id(params)
    return [(row_id(row) if row_id else None, dict(row)) for row in action.run(params, Context())]


def load(tmp_path: Path, text: str) -> Action:
    (tmp_path / "dev.yaml").write_text(text)
    loaded = load_action_files(tmp_path, {"dev_rows": dev.DevRows})
    assert loaded.problems == []
    [item] = loaded.actions
    return item.action


def problems(tmp_path: Path, text: str) -> list[str]:
    (tmp_path / "dev.yaml").write_text(text)
    return [
        problem.removeprefix(f"{tmp_path / 'dev.yaml'}:")
        for problem in load_action_files(tmp_path, {"dev_rows": dev.DevRows}).problems
    ]


def test_the_provider_has_dev_json_and_the_dev_rows_type() -> None:
    provider = dev.provider()
    assert [action.key for action in provider.actions] == ["tim.dev_json"]
    assert provider.action_types == [dev.DevRows]


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
    action = load(
        tmp_path,
        "type: dev_rows\nkey: g\nname: G\npivot: none\ngenerate: 2\nid: Host\ncolumns:\n"
        "  - {name: Host, type: string}\n  - {name: Bytes, type: number}\n"
        "  - {name: Blocked, type: boolean}\n  - {name: Seen, type: datetime}\n"
        "  - {name: Took, type: timespan}\n  - {name: Extra, type: json}\n",
    )
    assert run(action)[0] == (
        "Host-1",
        {
            "Host": "Host-1",
            "Bytes": 1,
            "Blocked": False,
            "Seen": "2026-01-01T00:01:00Z",
            "Took": "PT1S",
            "Extra": {"n": 1},
        },
    )


def test_dev_rows_params_with_from_columns_filter_the_rows(tmp_path: Path) -> None:
    action = load(
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


def test_dev_rows_reports_details_waits_and_fails(tmp_path: Path) -> None:
    action = load(
        tmp_path,
        "type: dev_rows\nkey: e\nname: E\npivot: none\ndelay: 0.01\nerror: Unavailable\n"
        "details: {cluster: dev}\nrows: [{n: 1}]\n",
    )
    ctx = Context()
    with pytest.raises(RunError, match=r"^Unavailable$"):
        list(action.run({}, ctx))
    assert ctx.details == {"cluster": "dev"}


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
    action = load(
        tmp_path,
        "type: dev_rows\nkey: b\nname: B\npivot: rows\nparams:\n"
        "  - {name: count, kind: number, required: false, from_columns: [Value]}\n"
        "  - {name: flag, kind: boolean, required: false, from_columns: [Value]}\n"
        "rows:\n  - {Value: true}\n  - {Value: 1}\n  - {Value: 1.0}\n",
    )
    assert [row for _, row in run(action, {"count": 1})] == [{"Value": 1}, {"Value": 1.0}]
    assert [row for _, row in run(action, {"flag": True})] == [{"Value": True}]
