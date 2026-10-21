from typing import Any

import pytest
from app_factory import AuthKit, create_test_app
from fastapi.testclient import TestClient
from scripted_actions import Rows
from tim_actions import Param, Provider


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


def get_instance(auth: AuthKit, providers: list[Provider]) -> dict[str, Any]:
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
    monkeypatch.setenv("TIM_QUERY_TIMEOUT_SECONDS", "90")
    body = get_instance(auth, [])
    assert body["limits"] == {
        "maxResultRows": 5000,
        "maxResultBytes": 1048576,
        "runTimeoutSeconds": 90,
    }
    assert (body["actions"], body["connections"], body["labels"]) == ([], [], [])


def test_an_action_without_a_pivot_has_a_null_pivot(auth: AuthKit) -> None:
    [action] = get_instance(auth, [Provider(actions=[Rows(key="a", name="A")])])["actions"]
    assert action["pivot"] is None
    assert action["menuPath"] == []
    assert "description" not in action


def test_the_version_changes_with_the_catalogue(auth: AuthKit) -> None:
    one = [Provider(actions=[Rows(key="a", name="A")])]
    same = [Provider(actions=[Rows(key="a", name="A")])]
    renamed = [Provider(actions=[Rows(key="a", name="B")])]
    versions = [get_instance(auth, providers)["version"] for providers in (one, same, renamed)]
    assert versions[0] == versions[1] != versions[2]


def test_the_instance_needs_a_signed_in_analyst() -> None:
    with TestClient(create_test_app()) as client:
        assert client.get("/api/instance").status_code == 401
