"""Action files: YAML actions of file-capable action types, loaded at startup from providers'
package data and from ``TIM_ACTIONS_DIR``."""

import os
from pathlib import Path
from typing import Any

import pytest
from app_factory import AuthKit, create_test_app
from fastapi.testclient import TestClient
from scripted_actions import FileLines, FileRows, Rows
from tim_actions import Provider

from tim_api.actions import InstanceConfigError
from tim_api.config import SettingsError

FIXTURES = Path(__file__).parent / "fixtures" / "action_files"
FILE_TYPES = Provider(action_types=[FileRows, FileLines])


def get_instance(auth: AuthKit, providers: list[Provider]) -> dict[str, Any]:
    app = create_test_app(providers=providers)
    auth.install(app)
    with TestClient(app, headers=auth.headers()) as client:
        response = client.get("/api/instance")
    assert response.status_code == 200
    body: dict[str, Any] = response.json()
    return body


def test_actions_from_the_instance_directory_are_in_the_catalogue(
    auth: AuthKit, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("TIM_ACTIONS_DIR", str(FIXTURES / "instance"))
    actions = get_instance(auth, [FILE_TYPES])["actions"]
    assert actions == [
        {
            "key": "acme.users",
            "kind": "query",
            "name": "Users",
            "description": "Every user",
            "menuPath": ["Identity", "Entra"],
            "connections": [],
            "params": [],
            "pivot": None,
            "idColumn": "UserPrincipalName",
            "actionFile": False,
        },
        {
            "key": "acme.sign_ins",
            "kind": "query",
            "name": "Sign-ins",
            "menuPath": ["Identity", "Entra"],
            "connections": [],
            "params": [
                {
                    "name": "user",
                    "title": "User",
                    "kind": "string",
                    "required": True,
                    "many": True,
                    "fromColumns": ["UserPrincipalName", "Upn"],
                },
                {
                    "name": "since",
                    "title": "since",
                    "kind": "datetime",
                    "required": False,
                    "default": "2026-10-01T00:00:00Z",
                    "many": False,
                },
            ],
            "pivot": {"rows": "rows", "columns": [["UserPrincipalName", "Upn"]]},
            "idColumn": "CorrelationId",
            "actionFile": False,
            "columns": [
                {
                    "name": "Timestamp",
                    "type": "datetime",
                    "hidden": False,
                    "pinned": "left",
                    "sort": "desc",
                    "group": False,
                },
                {
                    "name": "IpAddress",
                    "type": "string",
                    "hidden": True,
                    "width": 120,
                    "group": False,
                },
            ],
        },
    ]


def test_actions_from_a_providers_package_data_are_in_the_catalogue(auth: AuthKit) -> None:
    provider = Provider(action_types=[FileLines], action_files=FIXTURES / "package")
    actions = get_instance(auth, [provider])["actions"]
    assert [action["key"] for action in actions] == ["acme.greetings"]


def test_package_data_and_the_instance_directory_load_together(
    auth: AuthKit, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("TIM_ACTIONS_DIR", str(FIXTURES / "instance"))
    packaged = Provider(action_files=FIXTURES / "package")
    actions = get_instance(auth, [FILE_TYPES, packaged])["actions"]
    assert [action["key"] for action in actions] == [
        "acme.greetings",
        "acme.users",
        "acme.sign_ins",
    ]


def startup_problems(case: str, providers: list[Provider] | None = None) -> list[str]:
    os.environ["TIM_ACTIONS_DIR"] = str(FIXTURES / case)
    with (
        pytest.raises(InstanceConfigError) as caught,
        TestClient(create_test_app(providers=providers or [FILE_TYPES])),
    ):
        pass
    return caught.value.problems


def at(case: str, line: int, file: str = "actions.yaml") -> str:
    return f"{FIXTURES / case / file}:{line}"


def test_an_unknown_type_stops_startup() -> None:
    assert startup_problems("unknown_type") == [
        f"{at('unknown_type', 1)}: type: unknown action type 'kql_querry' "
        "(installed action types: lines, rows)"
    ]


def test_an_unknown_field_stops_startup() -> None:
    assert startup_problems("unknown_field") == [
        f"{at('unknown_field', 8)}: params[0].from_column: Unexpected keyword argument"
    ]


def test_an_id_that_is_not_a_column_name_stops_startup() -> None:
    assert startup_problems("bad_id") == [f"{at('bad_id', 5)}: id: Input should be a valid string"]


def test_a_missing_sidecar_stops_startup() -> None:
    assert startup_problems("missing_sidecar") == [
        f"{at('missing_sidecar', 5)}: text_file: no file greetings.txt next to the action file"
    ]


def test_a_key_in_two_files_stops_startup() -> None:
    assert startup_problems("duplicate_key") == [
        f"{at('duplicate_key', 7, 'b.yaml')}: key: duplicate action key acme.users, also in "
        f"{at('duplicate_key', 2, 'a.yaml')}"
    ]


def test_a_key_in_a_file_and_a_python_action_stops_startup() -> None:
    python = Provider(actions=[Rows(key="acme.users", name="Users", pivot="none")])
    assert startup_problems("duplicate_key", [python, FILE_TYPES]) == [
        f"{at('duplicate_key', 2, 'a.yaml')}: key: duplicate action key acme.users, also in "
        "providers[0]",
        f"{at('duplicate_key', 7, 'b.yaml')}: key: duplicate action key acme.users, also in "
        "providers[0]",
    ]


def test_every_problem_in_a_file_is_reported_at_once() -> None:
    kinds = "'string', 'number', 'boolean', 'datetime', 'timespan', 'json', 'kql', 'sql' or "
    assert startup_problems("several_errors") == [
        f"{at('several_errors', 3)}: key: String should match pattern '^[a-z0-9_.-]+$'",
        f"{at('several_errors', 5)}: pivot: Input should be 'row', 'rows' or 'none'",
        f"{at('several_errors', 13)}: params[0].kind: Input should be {kinds}'connection'",
        f"{at('several_errors', 14)}: params[1]: schema_from is only for kind kql or sql",
        f"{at('several_errors', 23)}: text_file: give text or text_file, not both",
        f"{at('several_errors', 28)}: menu: every folder in the path must be non-blank",
        f"{at('several_errors', 30)}: pivot: given twice",
    ]


def test_a_file_that_is_not_yaml_stops_startup() -> None:
    [problem] = startup_problems("not_yaml")
    assert problem == f"{at('not_yaml', 4)}: not valid YAML: expected ',' or ']', but got ':'"


def test_the_tim_prefix_is_reserved_in_action_files(tmp_path: Path) -> None:
    (tmp_path / "tim.yaml").write_text("type: rows\nkey: tim.users\nname: Users\npivot: none\n")
    os.environ["TIM_ACTIONS_DIR"] = str(tmp_path)
    with (
        pytest.raises(InstanceConfigError) as caught,
        TestClient(create_test_app(providers=[FILE_TYPES])),
    ):
        pass
    assert caught.value.problems == [
        f"{tmp_path / 'tim.yaml'}:2: key: the tim. prefix is reserved for TIM's built-ins"
    ]


def test_an_actions_dir_that_does_not_exist_stops_startup(tmp_path: Path) -> None:
    os.environ["TIM_ACTIONS_DIR"] = str(tmp_path / "missing")
    with pytest.raises(SettingsError) as caught, TestClient(create_test_app()):
        pass
    assert f"TIM_ACTIONS_DIR: invalid (Value error, no directory {tmp_path / 'missing'})" in str(
        caught.value
    )


def test_the_version_changes_with_a_sidecar(auth: AuthKit, tmp_path: Path) -> None:
    (tmp_path / "greetings.yaml").write_text(
        "type: lines\nkey: acme.greetings\nname: Greetings\npivot: none\ntext_file: hi.txt\n"
    )
    provider = Provider(action_types=[FileLines], action_files=tmp_path)
    (tmp_path / "hi.txt").write_text("hello\n")
    before = get_instance(auth, [provider])["version"]
    (tmp_path / "hi.txt").write_text("goodbye\n")
    assert get_instance(auth, [provider])["version"] != before
