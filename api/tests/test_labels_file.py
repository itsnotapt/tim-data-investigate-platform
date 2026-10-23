"""The labels file (``TIM_LABELS_FILE``): the instance's labels in ``GET /api/instance``, its
startup validation and ``tim-api schema labels`` / ``tim-api check --labels``."""

import json
from pathlib import Path
from typing import Any

import jsonschema
import pytest
import yaml
from app_factory import AuthKit, create_test_app
from fastapi.testclient import TestClient

from tim_api.actions import InstanceConfigError
from tim_api.cli import main
from tim_api.config import SettingsError

DEFAULT_LABELS = [
    {"key": "malicious", "name": "Malicious", "colour": "red", "symbol": "skull"},
    {"key": "suspicious", "name": "Suspicious", "colour": "amber", "symbol": "warning"},
    {"key": "benign", "name": "Benign", "colour": "green", "symbol": "check"},
]

LABELS = """\
- key: tp
  name: True positive
  colour: red
  symbol: skull
- key: fp
  name: False positive
  colour: blue
"""


def labels_file(tmp_path: Path, text: str) -> Path:
    path = tmp_path / "labels.yaml"
    path.write_text(text)
    return path


def instance_labels(auth: AuthKit) -> list[dict[str, Any]]:
    app = create_test_app()
    auth.install(app)
    with TestClient(app, headers=auth.headers()) as client:
        response = client.get("/api/instance")
    assert response.status_code == 200
    labels: list[dict[str, Any]] = response.json()["labels"]
    return labels


def test_without_a_labels_file_the_instance_has_the_three_default_labels(auth: AuthKit) -> None:
    assert instance_labels(auth) == DEFAULT_LABELS


def test_the_labels_file_gives_the_instances_labels_in_file_order(
    auth: AuthKit, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("TIM_LABELS_FILE", str(labels_file(tmp_path, LABELS)))
    assert instance_labels(auth) == [
        {"key": "tp", "name": "True positive", "colour": "red", "symbol": "skull"},
        {"key": "fp", "name": "False positive", "colour": "blue"},
    ]


def test_the_version_changes_with_the_labels_file(
    auth: AuthKit, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def version() -> str:
        app = create_test_app()
        auth.install(app)
        with TestClient(app, headers=auth.headers()) as client:
            value: str = client.get("/api/instance").json()["version"]
        return value

    path = labels_file(tmp_path, LABELS)
    monkeypatch.setenv("TIM_LABELS_FILE", str(path))
    before = version()
    path.write_text(LABELS.replace("False positive", "Benign"))
    assert version() != before


BAD_LABELS = """\
- key: tp
  name: True positive
  colour: crimson
- key: tp
  name: Again
  colour: red
  symbol: rocket
- name: No key
  colour: red
"""


def bad_file_problems(path: Path) -> list[str]:
    return [
        f"{path}:3: [0].colour: Input should be 'red', 'amber', 'green', 'teal', 'blue', "
        "'purple', 'pink' or 'grey'",
        f"{path}:7: [1].symbol: Input should be 'skull', 'warning', 'check', 'flag', 'star', "
        "'question', 'block', 'bug' or 'eye'",
        f"{path}:8: [2].key: Field required",
    ]


def test_a_bad_labels_file_stops_startup_with_each_problems_file_and_line(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = labels_file(tmp_path, BAD_LABELS)
    monkeypatch.setenv("TIM_LABELS_FILE", str(path))
    with pytest.raises(InstanceConfigError) as caught, TestClient(create_test_app()):
        pass
    assert caught.value.problems == bad_file_problems(path)


def test_a_duplicate_label_key_stops_startup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = labels_file(tmp_path, LABELS + "- key: tp\n  name: Again\n  colour: green\n")
    monkeypatch.setenv("TIM_LABELS_FILE", str(path))
    with pytest.raises(InstanceConfigError) as caught, TestClient(create_test_app()):
        pass
    assert caught.value.problems == [f"{path}:8: [2].key: duplicate label key tp"]


@pytest.mark.parametrize(
    ("text", "problem"),
    [
        ("[]\n", "1: the labels file lists at least one label"),
        ("key: tp\n", "1: the labels file is a list of labels"),
    ],
)
def test_a_labels_file_that_is_not_a_list_of_labels_stops_startup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, text: str, problem: str
) -> None:
    path = labels_file(tmp_path, text)
    monkeypatch.setenv("TIM_LABELS_FILE", str(path))
    with pytest.raises(InstanceConfigError) as caught, TestClient(create_test_app()):
        pass
    assert caught.value.problems == [f"{path}:{problem}"]


def test_a_labels_file_that_does_not_exist_stops_startup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("TIM_LABELS_FILE", str(tmp_path / "missing.yaml"))
    with pytest.raises(SettingsError) as caught, TestClient(create_test_app()):
        pass
    assert f"TIM_LABELS_FILE: invalid (Value error, no file {tmp_path / 'missing.yaml'})" in str(
        caught.value
    )


def test_check_validates_a_labels_file(capsys: pytest.CaptureFixture[str], tmp_path: Path) -> None:
    good = labels_file(tmp_path, LABELS)
    assert main(["check", "--labels", str(good)], providers=[]) == 0
    assert capsys.readouterr().out == "OK: 0 actions, 0 connections, 2 labels\n"

    bad = labels_file(tmp_path, BAD_LABELS)
    assert main(["check", "--labels", str(bad)], providers=[]) == 1
    out, err = capsys.readouterr()
    assert out == ""
    assert [line.removeprefix("  - ") for line in err.splitlines()[1:]] == bad_file_problems(bad)


def test_check_refuses_a_labels_file_that_does_not_exist(
    capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    missing = tmp_path / "missing.yaml"
    assert main(["check", "--labels", str(missing)], providers=[]) == 2
    assert capsys.readouterr().err == f"error: --labels: no file {missing}\n"


def test_the_labels_schema_accepts_a_good_file_and_rejects_a_bad_one(
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert main(["schema", "labels"], providers=[]) == 0
    validator = jsonschema.Draft202012Validator(json.loads(capsys.readouterr().out))
    assert list(validator.iter_errors(yaml.safe_load(LABELS))) == []
    assert list(validator.iter_errors(yaml.safe_load(BAD_LABELS))) != []
