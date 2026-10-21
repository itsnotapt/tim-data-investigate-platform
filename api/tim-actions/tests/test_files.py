"""Loading action files: each YAML document becomes an action of the type it names."""

from collections.abc import Iterator, Mapping
from pathlib import Path
from typing import Annotated, Any

from tim_actions import Action, ActionDocument, Column, RunContext, Sidecar
from tim_actions.files import load_action_files


class QueryFile(ActionDocument):
    query: Annotated[str, Sidecar()]


class Query(Action):
    type_name = "query"
    File = QueryFile

    query: str

    def run(self, params: Mapping[str, Any], ctx: RunContext) -> Iterator[Mapping[str, Any]]:
        yield {"query": self.query}


TYPES: dict[str, type[Action]] = {"query": Query}


def test_a_sidecar_gives_the_field_its_text(tmp_path: Path) -> None:
    (tmp_path / "users.yaml").write_text(
        "type: query\nkey: users\nname: Users\npivot: none\nquery_file: users.kql\n"
    )
    (tmp_path / "users.kql").write_text("Users\n| take 10\n")
    loaded = load_action_files(tmp_path, TYPES)
    assert loaded.problems == []
    [item] = loaded.actions
    assert item.action == Query(key="users", name="Users", pivot="none", query="Users\n| take 10\n")
    assert item.location == f"{tmp_path / 'users.yaml'}:2"


def test_a_sidecar_must_sit_next_to_the_action_file(tmp_path: Path) -> None:
    (tmp_path / "users.yaml").write_text(
        "type: query\nkey: users\nname: Users\npivot: none\nquery_file: ../users.kql\n"
    )
    assert load_action_files(tmp_path, TYPES).problems == [
        f"{tmp_path / 'users.yaml'}:5: query_file: give the name of a file next to the action file"
    ]


def test_columns_and_id_alternatives_come_through(tmp_path: Path) -> None:
    (tmp_path / "users.yaml").write_text(
        """
type: query
key: users
name: Users
pivot: row
query: Users
id: [CorrelationId, RequestId]
columns:
  - {name: Timestamp, type: datetime, sort: desc, pinned: left}
  - {name: Kilobytes, type: number, calculated: "[Bytes] / 1024"}
"""
    )
    [item] = load_action_files(tmp_path, TYPES).actions
    assert item.action.id == ("CorrelationId", "RequestId")
    assert item.action.columns == (
        Column("Timestamp", "datetime", sort="desc", pinned="left"),
        Column("Kilobytes", "number", calculated="[Bytes] / 1024"),
    )


def test_an_empty_document_is_skipped(tmp_path: Path) -> None:
    (tmp_path / "users.yaml").write_text(
        "# comments only\n---\ntype: query\nkey: users\nname: Users\npivot: none\nquery: U\n---\n"
    )
    loaded = load_action_files(tmp_path, TYPES)
    assert (loaded.problems, [item.action.key for item in loaded.actions]) == ([], ["users"])


def test_a_sidecar_in_a_subdirectory_is_refused(tmp_path: Path) -> None:
    (tmp_path / "queries").mkdir()
    (tmp_path / "queries" / "users.kql").write_text("Users")
    (tmp_path / "users.yaml").write_text(
        "type: query\nkey: users\nname: Users\npivot: none\nquery_file: queries/users.kql\n"
    )
    assert load_action_files(tmp_path, TYPES).problems == [
        f"{tmp_path / 'users.yaml'}:5: query_file: give the name of a file next to the action file"
    ]


def test_problems_are_in_line_order(tmp_path: Path) -> None:
    (tmp_path / "users.yaml").write_text(
        "type: query\nkey: users\nname: Users\nmenu: a//b\npivot: none\npivot: row\nquery: U\n"
    )
    assert load_action_files(tmp_path, TYPES).problems == [
        f"{tmp_path / 'users.yaml'}:4: menu: every folder in the path must be non-blank",
        f"{tmp_path / 'users.yaml'}:6: pivot: given twice",
    ]


def test_the_files_read_are_named_relative_to_their_directory(tmp_path: Path) -> None:
    (tmp_path / "users.yaml").write_text(
        "type: query\nkey: users\nname: Users\npivot: none\nquery_file: users.kql\n"
    )
    (tmp_path / "users.kql").write_text("Users")
    assert [file.name for file in load_action_files(tmp_path, TYPES).files] == [
        "users.yaml",
        "users.kql",
    ]
