"""``POST /api/actions/{key}/declareStatement``: the statement an action declares its query
parameters with, shown above the query."""

from pathlib import Path
from typing import Any

import pytest
from app_factory import AuthKit, create_test_app
from fastapi.testclient import TestClient

# A connection for each of Run KQL and Run SQL, which no request reaches.
CONNECTIONS = """\
- name: security
  title: Security
  type: kusto
  auth: obo
  cluster: https://help.kusto.windows.net/
- name: warehouse
  title: Warehouse
  type: snowflake
  auth: workload_identity
  account: myorg-myaccount
  warehouse: ANALYSTS
"""


@pytest.fixture(autouse=True)
def connections(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "connections.yaml"
    path.write_text(CONNECTIONS)
    monkeypatch.setenv("TIM_CONNECTIONS_FILE", str(path))


def client_for(auth: AuthKit, **headers: str) -> TestClient:
    """A client of TIM with its built-in actions, signed in when given ``headers``."""
    app = create_test_app(providers=None)
    auth.install(app)
    return TestClient(app, headers=headers)


def declare(client: TestClient, key: str, parameters: list[dict[str, Any]]) -> Any:
    return client.post(f"/api/actions/{key}/declareStatement", json={"parameters": parameters})


def test_run_kql_declares_its_query_parameters(auth: AuthKit) -> None:
    with client_for(auth, **auth.headers()) as client:
        response = declare(
            client,
            "tim.run_kql",
            [{"name": "since", "type": "datetime"}, {"name": "limit", "type": "long"}],
        )
    assert response.status_code == 200
    assert response.json() == {
        "declareStatement": "declare query_parameters(since:datetime, limit:long);"
    }


@pytest.mark.parametrize(
    ("key", "parameters"),
    [("tim.run_kql", []), ("tim.run_sql", [{"name": "since", "type": "datetime"}])],
)
def test_nothing_to_declare_is_no_content(
    auth: AuthKit, key: str, parameters: list[dict[str, Any]]
) -> None:
    with client_for(auth, **auth.headers()) as client:
        response = declare(client, key, parameters)
    assert response.status_code == 204
    assert response.content == b""


@pytest.mark.parametrize(
    ("key", "parameter", "problem"),
    [
        (
            "tim.run_kql",
            {"name": "1st", "type": "string"},
            "1st: name must start with a letter or _ and hold only letters, digits and _",
        ),
        (
            "tim.run_sql",
            {"name": "within", "type": "timespan"},
            "within: type must be one of string, long, real, bool, datetime, dynamic",
        ),
    ],
)
def test_a_bad_name_or_a_type_the_action_doesnt_take_is_unprocessable(
    auth: AuthKit, key: str, parameter: dict[str, Any], problem: str
) -> None:
    with client_for(auth, **auth.headers()) as client:
        response = declare(client, key, [parameter])
    assert response.status_code == 422
    assert response.json()["errors"] == {"params.parameters": [problem]}


def test_an_unknown_action_is_not_found(auth: AuthKit) -> None:
    with client_for(auth, **auth.headers()) as client:
        response = declare(client, "nope", [{"name": "since", "type": "datetime"}])
    assert response.status_code == 404


def test_signed_out_is_unauthorised(auth: AuthKit) -> None:
    with client_for(auth) as client:
        response = declare(client, "tim.run_kql", [{"name": "since", "type": "datetime"}])
    assert response.status_code == 401
