from pathlib import Path
from typing import Any

import pytest
from app_factory import AuthKit, create_test_app
from fastapi.testclient import TestClient
from scripted_actions import Recording, Rows
from tim_actions import Column, Param, Provider


def test_a_providers_action_is_in_the_catalogue(auth: AuthKit) -> None:
    action = Rows(
        key="acme.sign_ins",
        name="Sign-ins",
        menu="Identity / Entra",
        description="Sign-ins for a user",
        params=(
            Param("user", "string", title="User", from_columns=("UserPrincipalName", "Upn")),
            Param("since", "datetime", required=False, default="2026-10-01T00:00:00Z"),
            Param("level", "string", many=True, choices=("low", "high"), help="Risk"),
        ),
        pivot="rows",
    )
    app = create_test_app(providers=[Provider(actions=[action])])
    auth.install(app)
    with TestClient(app, headers=auth.headers()) as client:
        response = client.get("/api/instance")
    assert response.status_code == 200
    assert response.json()["actions"] == [
        {
            "key": "acme.sign_ins",
            "kind": "query",
            "name": "Sign-ins",
            "description": "Sign-ins for a user",
            "menuPath": ["Identity", "Entra"],
            "connections": [],
            "params": [
                {
                    "name": "user",
                    "title": "User",
                    "kind": "string",
                    "required": True,
                    "many": False,
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
                {
                    "name": "level",
                    "title": "level",
                    "kind": "string",
                    "required": True,
                    "many": True,
                    "choices": ["low", "high"],
                    "help": "Risk",
                },
            ],
            "pivot": {"rows": "rows", "columns": [["UserPrincipalName", "Upn"]]},
        }
    ]


def get_instance(auth: AuthKit, providers: list[Provider] | None) -> dict[str, Any]:
    app = create_test_app(providers=providers)
    auth.install(app)
    with TestClient(app, headers=auth.headers()) as client:
        response = client.get("/api/instance")
    assert response.status_code == 200
    body: dict[str, Any] = response.json()
    return body


def test_the_instance_carries_its_limits(auth: AuthKit, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TIM_MAX_RESULT_ROWS", "5000")
    monkeypatch.setenv("TIM_MAX_RESULT_BYTES", "1048576")
    monkeypatch.setenv("TIM_RUN_TIMEOUT_SECONDS", "90")
    monkeypatch.setenv("TIM_ROWS_PAGE_SIZE", "250")
    monkeypatch.setenv("TIM_MAX_PIVOT_ROWS", "20")
    body = get_instance(auth, [])
    assert body["limits"] == {
        "maxResultRows": 5000,
        "maxResultBytes": 1048576,
        "maxPivotRows": 20,
        "rowsPageSize": 250,
        "runTimeoutSeconds": 90,
        "maxAnnotationIds": 10000,
        "annotationPollSeconds": 30,
    }
    assert (body["actions"], body["connections"]) == ([], [])


def test_an_action_that_does_not_pivot_has_a_null_pivot(auth: AuthKit) -> None:
    [action] = get_instance(auth, [Provider(actions=[Rows(key="a", name="A", pivot="none")])])[
        "actions"
    ]
    assert action["pivot"] is None
    assert action["menuPath"] == []
    assert "description" not in action
    assert "columns" not in action


def test_an_actions_declared_columns_are_in_the_catalogue(auth: AuthKit) -> None:
    columns = (
        Column("Timestamp", "datetime", sort="desc", pinned="left", width=180),
        Column("User", "string", title="User", group=True),
        Column("Raw", "json", hidden=True),
        Column("KiB", "number", calculated="[Bytes] / 1024"),
    )
    [action] = get_instance(
        auth, [Provider(actions=[Rows(key="a", name="A", pivot="none", columns=columns)])]
    )["actions"]
    assert action["columns"] == [
        {
            "name": "Timestamp",
            "type": "datetime",
            "hidden": False,
            "width": 180,
            "pinned": "left",
            "sort": "desc",
            "group": False,
        },
        {"name": "User", "type": "string", "title": "User", "hidden": False, "group": True},
        {"name": "Raw", "type": "json", "hidden": True, "group": False},
        {
            "name": "KiB",
            "type": "number",
            "hidden": False,
            "group": False,
            "calculated": "[Bytes] / 1024",
        },
    ]


def test_the_version_changes_with_the_catalogue(auth: AuthKit) -> None:
    one = [Provider(actions=[Rows(key="a", name="A", pivot="none")])]
    same = [Provider(actions=[Rows(key="a", name="A", pivot="none")])]
    renamed = [Provider(actions=[Rows(key="a", name="B", pivot="none")])]
    versions = [get_instance(auth, providers)["version"] for providers in (one, same, renamed)]
    assert versions[0] == versions[1] != versions[2]


def test_the_instance_needs_a_signed_in_analyst() -> None:
    with TestClient(create_test_app()) as client:
        assert client.get("/api/instance").status_code == 401


def test_the_instance_lists_its_connections_without_their_endpoints(
    auth: AuthKit, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "connections.yaml"
    path.write_text(
        """\
- name: security
  title: Security
  type: kusto
  auth: obo
  cluster: https://help.kusto.windows.net
  databases: [Samples, Security]
- name: ops
  title: Ops
  type: kusto
  auth: obo
  cluster: https://ops.kusto.windows.net
  scope: api://ops/.default
"""
    )
    monkeypatch.setenv("TIM_CONNECTIONS_FILE", str(path))
    instance = get_instance(auth, None)
    assert instance["connections"] == [
        {
            "name": "security",
            "type": "kusto",
            "title": "Security",
            "editor": "kql",
            "databases": ["Samples", "Security"],
        },
        {"name": "ops", "type": "kusto", "title": "Ops", "editor": "kql"},
    ]
    [run_kql] = [a for a in instance["actions"] if a["key"] == "tim.run_kql"]
    assert run_kql["connections"] == []
    assert [(p["name"], p["kind"]) for p in run_kql["params"]] == [
        ("connection", "connection"),
        ("database", "string"),
        ("kql", "kql"),
        ("idColumn", "string"),
    ]


def test_a_sink_is_in_the_catalogue_on_any_rows_and_resolves_nothing(auth: AuthKit) -> None:
    sink = Recording(key="acme.save_event", name="Save event", menu="Kusto / Events")
    app = create_test_app(providers=[Provider(actions=[sink])])
    auth.install(app)
    with TestClient(app, headers=auth.headers()) as client:
        actions = client.get("/api/instance").json()["actions"]
        resolved = client.post(
            "/api/actions/acme.save_event/resolve", json={"pivot": {"rows": [{"Host": "h-1"}]}}
        )
    assert actions == [
        {
            "key": "acme.save_event",
            "kind": "sink",
            "name": "Save event",
            "menuPath": ["Kusto", "Events"],
            "connections": [],
            "params": [],
            "pivot": {"rows": "rows", "columns": []},
        }
    ]
    assert resolved.status_code == 404
