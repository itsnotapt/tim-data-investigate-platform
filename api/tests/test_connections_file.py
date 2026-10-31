"""The connections file (``TIM_CONNECTIONS_FILE``), checked offline by ``tim-api check``."""

import json
import os
from pathlib import Path

import pytest

from tim_api.cli import main


@pytest.fixture(autouse=True)
def _no_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in list(os.environ):
        if key.startswith("TIM_"):
            monkeypatch.delenv(key)


def connections_file(tmp_path: Path, text: str) -> Path:
    path = tmp_path / "connections.yaml"
    path.write_text(text)
    return path


def check(capsys: pytest.CaptureFixture[str], *args: str) -> tuple[int, str, str]:
    """``tim-api check`` with the installed providers: the built-ins, with Kusto and Snowflake."""
    code = main(["check", *args])
    out, err = capsys.readouterr()
    return code, out, err


SECURITY = """\
- name: security
  title: Security
  type: kusto
  auth: obo
  cluster: https://Help.Kusto.Windows.Net/
  databases: [Samples]
"""


WAREHOUSE = """\
- name: warehouse
  title: Warehouse
  type: snowflake
  auth: workload_identity
  account: myorg-myaccount
  warehouse: ANALYSTS
"""


def test_check_accepts_a_kusto_and_a_snowflake_connection(
    capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    path = connections_file(tmp_path, SECURITY + WAREHOUSE)
    code, out, err = check(capsys, "--connections", str(path))
    assert (code, out, err) == (0, "OK: 2 actions, 2 connections, 3 labels\n", "")


def test_check_reports_each_problem_at_its_line(
    capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    path = connections_file(
        tmp_path,
        SECURITY
        + """\
- name: Ops
  title: Ops
  type: kusto
  auth: obo
  cluster: https://ops.kusto.windows.net
- name: security
  title: Again
  type: kusto
  auth: obo
  cluster: https://other.kusto.windows.net
- name: lake
  title: Lake
  type: lake
  auth: obo
- name: logs
  title: Logs
  type: kusto
  auth: obo
  cluster: https://logs.kusto.windows.net/db
  database: Logs
""",
    )
    code, out, err = check(capsys, "--connections", str(path))
    assert (code, out) == (1, "")
    assert err.splitlines() == [
        "Invalid instance:",
        f"  - {path}:7: [1].name: String should match pattern '^[a-z0-9-]+$'",
        f"  - {path}:12: [2].name: duplicate connection name security",
        f"  - {path}:19: [3].type: unknown connection type 'lake' (installed connection "
        "types: kusto, snowflake)",
        f"  - {path}:25: [4].cluster: must not contain a path",
        f"  - {path}:26: [4].database: Extra inputs are not permitted",
    ]


def test_check_reports_a_connections_file_that_is_not_a_list(
    capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    path = connections_file(tmp_path, "security:\n  type: kusto\n")
    code, _, err = check(capsys, "--connections", str(path))
    assert (code, err) == (
        1,
        f"Invalid instance:\n  - {path}:1: the connections file is a list of connections\n",
    )


def test_check_without_connections_leaves_run_kql_and_run_sql_out(
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert check(capsys) == (
        0,
        "Action tim.run_kql left out: no kusto connection for its connection param\n"
        "Action tim.run_sql left out: no snowflake connection for its connection param\n"
        "OK: 0 actions, 0 connections, 3 labels\n",
        "",
    )


def test_schema_connections_describes_the_kusto_and_snowflake_types(
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert main(["schema", "connections"]) == 0
    schema = json.loads(capsys.readouterr().out)
    kusto, snowflake = schema["$defs"]["kusto"], schema["$defs"]["snowflake"]
    assert schema["type"] == "array"
    assert schema["items"]["discriminator"]["mapping"] == {
        "kusto": "#/$defs/kusto",
        "snowflake": "#/$defs/snowflake",
    }
    assert snowflake["required"] == ["name", "title", "type", "auth", "account", "warehouse"]
    assert kusto["properties"]["type"]["const"] == "kusto"
    assert kusto["properties"]["auth"]["enum"] == ["obo", "none"]
    assert kusto["required"] == ["name", "title", "type", "auth", "cluster"]
    assert kusto["additionalProperties"] is False
