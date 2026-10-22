"""Development actions: ``tim.dev_json`` and the ``dev_rows`` action type, registered only with
``TIM_DEV_ACTIONS``, through ``GET /api/instance`` and ``/api/runs``."""

from __future__ import annotations

import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import pytest
from app_factory import AuthKit, create_test_app
from fastapi.testclient import TestClient

from tim_api.actions import InstanceConfigError
from tim_api.config import SettingsError


def test_production_refuses_to_start_with_dev_actions(
    auth: AuthKit, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("TIM_ENVIRONMENT", "production")
    monkeypatch.setenv("TIM_DEV_ACTIONS", "true")
    app = create_test_app()
    with pytest.raises(SettingsError, match="TIM_DEV_ACTIONS"), TestClient(app):
        pass


SIGN_INS = """\
type: dev_rows
key: dev-sign-ins
name: Sign-ins
menu: Development
pivot: rows
id: CorrelationId
rows:
  - {CorrelationId: c-1, User: alice}
"""


@pytest.fixture
def dev_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """Development settings with TIM_DEV_ACTIONS on and an empty action files directory."""
    monkeypatch.setenv("TIM_ENVIRONMENT", "development")
    monkeypatch.setenv("TIM_DEV_ACTIONS", "true")
    monkeypatch.setenv("TIM_ACTIONS_DIR", str(tmp_path))
    return tmp_path


def catalogue(auth: AuthKit) -> list[dict[str, Any]]:
    with started(auth) as client:
        response = client.get("/api/instance")
    assert response.status_code == 200
    actions: list[dict[str, Any]] = response.json()["actions"]
    return actions


def test_the_catalogue_lists_the_dev_actions(auth: AuthKit, dev_env: Path) -> None:
    (dev_env / "sign-ins.yaml").write_text(SIGN_INS)
    actions = catalogue(auth)
    assert [action["key"] for action in actions] == ["tim.dev_json", "dev-sign-ins"]
    assert actions[0] == {
        "key": "tim.dev_json",
        "kind": "query",
        "name": "JSON (development)",
        "description": "Rows pasted as JSON. As a pivot, the selected rows.",
        "menuPath": ["Development"],
        "connections": [],
        "params": [
            {
                "name": "rows",
                "title": "Rows",
                "kind": "json",
                "required": True,
                "many": False,
                "help": "A JSON array of objects, one per row",
            },
            {
                "name": "idColumn",
                "title": "Id column",
                "kind": "string",
                "required": False,
                "many": False,
                "help": "The column that gives each row its id",
            },
        ],
        "pivot": {"rows": "rows", "columns": []},
    }


def test_without_the_flag_there_are_no_dev_actions(
    auth: AuthKit, monkeypatch: pytest.MonkeyPatch, dev_env: Path
) -> None:
    monkeypatch.delenv("TIM_DEV_ACTIONS")
    assert catalogue(auth) == []
    (dev_env / "sign-ins.yaml").write_text(SIGN_INS)
    with pytest.raises(InstanceConfigError, match="unknown action type 'dev_rows'"):
        catalogue(auth)


@contextmanager
def started(auth: AuthKit) -> Iterator[TestClient]:
    """A client of the app, started with the action files written so far."""
    app = create_test_app(race_seconds=0.2)
    auth.install(app)
    with TestClient(app, headers=auth.headers()) as client:
        yield client


def run(client: TestClient, action: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """Start a run and poll it until it ends."""
    response = client.post("/api/runs", json={"action": action, "params": params or {}})
    assert response.status_code in (200, 202), response.text
    body: dict[str, Any] = response.json()
    deadline = time.monotonic() + 10
    while body["status"] == "running":
        assert time.monotonic() < deadline
        time.sleep(0.02)
        body = client.get(f"/api/runs/{body['runId']}").json()
    return body


def rows(client: TestClient, run_id: str) -> list[dict[str, Any]]:
    response = client.get(f"/api/runs/{run_id}/rows")
    assert response.status_code == 200
    page: list[dict[str, Any]] = response.json()["rows"]
    return page


def test_dev_json_yields_the_pasted_rows_with_their_ids(auth: AuthKit, dev_env: Path) -> None:
    pasted = [{"Host": "h-1", "Bytes": 10}, {"Host": "h-2", "Bytes": None}, {"Bytes": 3}]
    with started(auth) as client:
        body = run(client, "tim.dev_json", {"rows": pasted, "idColumn": "Host"})
        assert body["status"] == "succeeded"
        assert body["rowCount"] == 3
        assert rows(client, body["runId"]) == [
            {"row": 0, "id": "h-1", "data": {"Host": "h-1", "Bytes": 10}},
            {"row": 1, "id": "h-2", "data": {"Host": "h-2", "Bytes": None}},
            {"row": 2, "id": None, "data": {"Bytes": 3}},
        ]
        without_ids = run(client, "tim.dev_json", {"rows": pasted})
        assert {row["id"] for row in rows(client, without_ids["runId"])} == {None}


@pytest.mark.parametrize("pasted", [{"Host": "h-1"}, [{"Host": "h-1"}, "h-2"], "[]"])
def test_dev_json_rows_must_be_an_array_of_objects(
    auth: AuthKit, dev_env: Path, pasted: Any
) -> None:
    with started(auth) as client:
        body = run(client, "tim.dev_json", {"rows": pasted})
    assert body["status"] == "error"
    assert body["error"] == "Rows must be a JSON array of objects"


def test_dev_rows_yields_its_rows_with_ids_columns_and_details(
    auth: AuthKit, dev_env: Path
) -> None:
    (dev_env / "sign-ins.yaml").write_text(
        SIGN_INS
        + """\
  - {CorrelationId: c-2, User: bob, Count: 5}
columns:
  - {name: User, type: string, title: Analyst}
details:
  cluster: dev
  scanned: 12
"""
    )
    with started(auth) as client:
        body = run(client, "dev-sign-ins")
        assert body["status"] == "succeeded"
        assert body["details"] == {
            "duration": body["details"]["duration"],
            "rowCount": 2,
            "cluster": "dev",
            "scanned": 12,
        }
        assert body["columns"] == [
            {"name": "User", "type": "string", "declared": True},
            {"name": "CorrelationId", "type": "string", "declared": False},
            {"name": "Count", "type": "number", "declared": False},
        ]
        assert [(row["id"], row["data"]["User"]) for row in rows(client, body["runId"])] == [
            ("c-1", "alice"),
            ("c-2", "bob"),
        ]


def test_dev_rows_generates_rows_from_its_columns(auth: AuthKit, dev_env: Path) -> None:
    (dev_env / "generated.yaml").write_text("""\
type: dev_rows
key: dev-generated
name: Generated
pivot: rows
id: Host
generate: 3
columns:
  - {name: Host, type: string}
  - {name: Bytes, type: number}
  - {name: Blocked, type: boolean}
  - {name: Seen, type: datetime}
  - {name: Took, type: timespan}
  - {name: Extra, type: json}
---
type: dev_rows
key: dev-numbered
name: Numbered
pivot: none
generate: 2
""")
    with started(auth) as client:
        generated = run(client, "dev-generated")
        assert rows(client, generated["runId"])[1] == {
            "row": 1,
            "id": "Host-2",
            "data": {
                "Host": "Host-2",
                "Bytes": 2,
                "Blocked": True,
                "Seen": "2026-01-01T00:02:00Z",
                "Took": "PT2S",
                "Extra": {"n": 2},
            },
        }
        assert generated["rowCount"] == 3
        numbered = run(client, "dev-numbered")
        assert [row["data"] for row in rows(client, numbered["runId"])] == [{"n": 1}, {"n": 2}]


def test_dev_rows_takes_rows_or_generate_not_both(auth: AuthKit, dev_env: Path) -> None:
    (dev_env / "both.yaml").write_text(SIGN_INS + "generate: 2\n")
    with pytest.raises(InstanceConfigError, match=r"both.yaml:1: give rows or generate, not both"):
        catalogue(auth)


FILTERED = """\
type: dev_rows
key: dev-filtered
name: Filtered
pivot: rows
params:
  - {name: users, kind: string, many: true, required: false, from_columns: [User, Upn]}
  - {name: blocked, kind: boolean, required: false, from_columns: [Blocked]}
  - {name: note, kind: string, required: false}
rows:
  - {User: alice, Blocked: true}
  - {Upn: bob, Blocked: true}
  - {User: "", Upn: alice, Blocked: false}
  - {User: carol, Upn: alice, Blocked: true}
"""


@pytest.mark.parametrize(
    ("params", "kept"),
    [
        ({}, [0, 1, 2, 3]),
        ({"users": ["alice"]}, [0, 2]),
        ({"users": ["alice", "bob"], "blocked": True}, [0, 1]),
        ({"blocked": False, "note": "not a filter"}, [2]),
        ({"users": ["dave"]}, []),
    ],
)
def test_dev_rows_params_with_from_columns_filter_its_rows(
    auth: AuthKit, dev_env: Path, params: dict[str, Any], kept: list[int]
) -> None:
    (dev_env / "filtered.yaml").write_text(FILTERED)
    with started(auth) as client:
        body = run(client, "dev-filtered", params)
        assert body["status"] == "succeeded"
        everything = run(client, "dev-filtered")
        all_rows = [row["data"] for row in rows(client, everything["runId"])]
        assert [row["data"] for row in rows(client, body["runId"])] == [all_rows[i] for i in kept]


def test_dev_rows_filters_only_on_string_number_and_boolean_params(
    auth: AuthKit, dev_env: Path
) -> None:
    (dev_env / "filtered.yaml").write_text(FILTERED.replace("kind: boolean", "kind: datetime"))
    with pytest.raises(
        InstanceConfigError,
        match=r"filtered.yaml:5: params: from_columns filter only string, number and boolean "
        r"params, not blocked \(datetime\)",
    ):
        catalogue(auth)


def test_dev_rows_delay_holds_the_run_and_can_be_cancelled(auth: AuthKit, dev_env: Path) -> None:
    (dev_env / "slow.yaml").write_text("""\
type: dev_rows
key: dev-slow
name: Slow
pivot: none
delay: 0.5
rows: [{n: 1}]
---
type: dev_rows
key: dev-stuck
name: Stuck
pivot: none
delay: 600
rows: [{n: 1}]
""")
    with started(auth) as client:
        slow = client.post("/api/runs", json={"action": "dev-slow", "params": {}})
        assert (slow.status_code, slow.json()["status"]) == (202, "running")
        assert run(client, "dev-slow")["rowCount"] == 1

        stuck = client.post("/api/runs", json={"action": "dev-stuck", "params": {}}).json()
        asked = time.monotonic()
        cancelled = client.post(f"/api/runs/{stuck['runId']}/cancel")
        assert cancelled.json()["status"] == "cancelled"
        assert time.monotonic() - asked < 5


def test_dev_rows_error_ends_the_run_in_error(auth: AuthKit, dev_env: Path) -> None:
    (dev_env / "failing.yaml").write_text(
        SIGN_INS + "error: The sign-in log is unavailable\ndetails: {cluster: dev}\n"
    )
    with started(auth) as client:
        body = run(client, "dev-sign-ins")
    assert body["status"] == "error"
    assert body["error"] == "The sign-in log is unavailable"
    assert body["details"]["cluster"] == "dev"
    assert "rowCount" not in body


@pytest.fixture
def dev_kql_connection(
    monkeypatch: pytest.MonkeyPatch, tmp_path_factory: pytest.TempPathFactory
) -> None:
    """A connections file with one ``dev_kql`` connection, ``dev``."""
    connections = tmp_path_factory.mktemp("connections") / "connections.yaml"
    connections.write_text(
        "- {name: dev, title: Development, type: dev_kql, auth: workload_identity}\n"
    )
    monkeypatch.setenv("TIM_CONNECTIONS_FILE", str(connections))


@pytest.mark.usefixtures("dev_kql_connection")
def test_without_the_flag_there_is_no_dev_kql_connection_type(
    auth: AuthKit, monkeypatch: pytest.MonkeyPatch, dev_env: Path
) -> None:
    monkeypatch.delenv("TIM_DEV_ACTIONS")
    with pytest.raises(InstanceConfigError, match="unknown connection type 'dev_kql'"):
        catalogue(auth)


@pytest.mark.usefixtures("dev_kql_connection")
def test_dev_kql_connections_answer_a_fixed_schema_for_any_database(
    auth: AuthKit, dev_env: Path
) -> None:
    with started(auth) as client:
        answered = client.post("/api/connections/dev/schema", json={"scope": {"database": "Logs"}})
        without_database = client.post("/api/connections/dev/schema", json={"scope": {}})
    assert answered.status_code == 200, answered.text
    assert answered.json() == {
        "kind": "kql",
        "schema": {
            "Databases": {
                "Logs": {
                    "Name": "Logs",
                    "Tables": {
                        "SignIns": {
                            "Name": "SignIns",
                            "OrderedColumns": [
                                {"Name": "TimeGenerated", "CslType": "datetime"},
                                {"Name": "UserPrincipalName", "CslType": "string"},
                                {"Name": "ResultType", "CslType": "string"},
                            ],
                        }
                    },
                    "Functions": {},
                }
            }
        },
    }
    assert without_database.status_code == 204
