"""``tim-api schema actions`` and ``tim-api check``: the startup validation, offline."""

import json
import os
from pathlib import Path
from typing import Any

import jsonschema
import pytest
import yaml
from scripted_actions import FileRows
from test_action_files import FILE_TYPES, FIXTURES, startup_problems
from tim_actions import Provider

from tim_api.cli import main


@pytest.fixture(autouse=True)
def _no_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """The commands need no database, credentials or other settings."""
    for key in list(os.environ):
        if key.startswith("TIM_"):
            monkeypatch.delenv(key)


def check(capsys: pytest.CaptureFixture[str], *args: str) -> tuple[int, str, str]:
    code = main(["check", *args], providers=[FILE_TYPES])
    out, err = capsys.readouterr()
    return code, out, err


def test_check_accepts_good_action_files(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, err = check(capsys, "--actions", str(FIXTURES / "instance"))
    assert (code, out, err) == (0, "OK: 2 actions, 0 connections, 3 labels\n", "")


def test_check_reports_the_same_problems_as_startup(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    code, out, err = check(capsys, "--actions", str(FIXTURES / "several_errors"))
    assert (code, out) == (1, "")
    reported = [line.removeprefix("  - ") for line in err.splitlines()[1:]]
    assert err.splitlines()[0] == "Invalid instance:"
    with monkeypatch.context() as patch:
        for key, value in {
            "TIM_AUTH_TENANT_ID": "tenant-id",
            "TIM_AUTH_CLIENT_ID": "client-id",
            "TIM_AUTH_CLIENT_SECRET": "client-secret",
            "TIM_TAG_CLUSTER_URI": "https://tags.westeurope.kusto.windows.net",
            "TIM_DATABASE_URL": "postgresql+asyncpg://tim:pw@localhost:5432/tim",
        }.items():
            patch.setenv(key, value)
        assert reported == startup_problems("several_errors")
    assert len(reported) == 7


def test_check_without_actions_checks_the_providers(capsys: pytest.CaptureFixture[str]) -> None:
    assert check(capsys) == (0, "OK: 0 actions, 0 connections, 3 labels\n", "")


def test_check_refuses_a_directory_that_does_not_exist(
    capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    code, out, err = check(capsys, "--actions", str(tmp_path / "missing"))
    assert (code, out, err) == (2, "", f"error: --actions: no directory {tmp_path / 'missing'}\n")


def schema(capsys: pytest.CaptureFixture[str], providers: list[Provider]) -> dict[str, Any]:
    assert main(["schema", "actions"], providers=providers) == 0
    printed: dict[str, Any] = json.loads(capsys.readouterr().out)
    return printed


def documents(*paths: Path) -> list[Any]:
    return [doc for path in paths for doc in yaml.safe_load_all(path.read_text()) if doc]


def test_the_schema_accepts_the_example_files(capsys: pytest.CaptureFixture[str]) -> None:
    validator = jsonschema.Draft202012Validator(schema(capsys, [FILE_TYPES]))
    examples = documents(
        FIXTURES / "instance" / "identity.yaml", FIXTURES / "package" / "greetings.yml"
    )
    assert len(examples) == 3
    for document in examples:
        validator.validate(document)


@pytest.mark.parametrize(
    "document",
    [
        {"type": "kql_querry", "key": "a", "name": "A", "pivot": "none"},
        {"type": "rows", "key": "a", "name": "A", "pivot": "none", "colour": "red"},
        {"type": "rows", "key": "a", "name": "A", "pivot": "none", "id": {"columns": ["X"]}},
        {"type": "rows", "key": "a", "name": "A", "pivot": "none", "id": []},
        {"type": "rows", "key": "a", "name": "A", "pivot": "none", "id": ""},
        {"type": "lines", "key": "a", "name": "A", "pivot": "none"},
        {"type": "lines", "key": "a", "name": "A", "pivot": "none", "text": "x", "text_file": "y"},
    ],
)
def test_the_schema_rejects_what_startup_rejects(
    capsys: pytest.CaptureFixture[str], document: dict[str, Any]
) -> None:
    validator = jsonschema.Draft202012Validator(schema(capsys, [FILE_TYPES]))
    assert not validator.is_valid(document)


def test_the_schema_covers_only_installed_types(capsys: pytest.CaptureFixture[str]) -> None:
    validator = jsonschema.Draft202012Validator(schema(capsys, [Provider(action_types=[FileRows])]))
    assert validator.is_valid({"type": "rows", "key": "a", "name": "A", "pivot": "none"})
    assert not validator.is_valid({"type": "lines", "key": "a", "name": "A", "pivot": "none"})


def test_the_schema_does_not_load_action_files(
    capsys: pytest.CaptureFixture[str],
) -> None:
    broken = Provider(action_types=[FileRows], action_files=FIXTURES / "several_errors")
    validator = jsonschema.Draft202012Validator(schema(capsys, [broken]))
    assert validator.is_valid({"type": "rows", "key": "a", "name": "A", "pivot": "none"})


def test_with_no_file_capable_types_the_schema_accepts_no_file(
    capsys: pytest.CaptureFixture[str],
) -> None:
    validator = jsonschema.Draft202012Validator(schema(capsys, []))
    assert not validator.is_valid({"type": "rows", "key": "a", "name": "A", "pivot": "none"})


DEV_ROWS = {"type": "dev_rows", "key": "dev-a", "name": "A", "pivot": "none", "generate": 2}


def test_check_with_dev_actions_accepts_dev_action_files(
    capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    (tmp_path / "dev.yaml").write_text(yaml.safe_dump(DEV_ROWS))
    code, _, err = check(capsys, "--actions", str(tmp_path))
    assert code == 1
    assert "unknown action type 'dev_rows'" in err
    assert check(capsys, "--dev-actions", "--actions", str(tmp_path)) == (
        0,
        "OK: 2 actions, 0 connections, 3 labels\n",
        "",
    )


def test_the_schema_with_dev_actions_covers_dev_rows(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["schema", "actions", "--dev-actions"], providers=[]) == 0
    validator = jsonschema.Draft202012Validator(json.loads(capsys.readouterr().out))
    assert validator.is_valid(DEV_ROWS)
    assert not validator.is_valid({**DEV_ROWS, "delay": "soon"})
