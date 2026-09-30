"""ID-titled regression tests for template bugs in docs/current-system/known-issues.md (P5-05)."""

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from tim_api.auth import Principal, get_current_principal
from tim_api.main import create_app

PRINCIPAL = Principal(oid="oid-1", name="alice@example.com", tenant_id="t", token=SecretStr("x"))
BASE = "/api/templates/queries"
U1 = "3f0c2a52-6d0e-4a1b-9a57-0d2d6b8f1c11"
U2 = "3f0c2a52-6d0e-4a1b-9a57-0d2d6b8f1c22"


def body(uuid: str = U1, **over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "uuid": uuid,
        "name": "Sign-ins",
        "queryType": "view",
        "menu": "Identity",
        "summary": "s",
        "path": ["Identity"],
        "cluster": "help",
        "database": "db",
        "query": "T | take 1",
    }
    return base | over


@pytest.fixture
def client() -> Iterator[TestClient]:
    app = create_app()
    app.dependency_overrides[get_current_principal] = lambda: PRINCIPAL
    with TestClient(app) as c:
        yield c


def test_bug_03_delete_missing_template_is_404_not_500(client: TestClient) -> None:
    r = client.delete(f"{BASE}/{U1}")
    assert r.status_code == 404


def test_bug_04_create_and_replace_return_the_template(client: TestClient) -> None:
    created = client.post(BASE, json=body())
    assert created.status_code == 201
    assert created.json()["uuid"] == U1
    assert created.headers["location"].endswith(U1)
    replaced = client.put(f"{BASE}/{U1}", json=body(name="New"))
    assert replaced.status_code == 200
    assert replaced.json()["name"] == "New"


def test_bug_04_unauthenticated_is_401_not_500() -> None:
    with TestClient(create_app()) as c:
        assert c.post(BASE, json=body()).status_code == 401


def test_bug_05_deleted_templates_excluded_unless_requested(client: TestClient) -> None:
    client.post(BASE, json=body(U1))
    client.post(BASE, json=body(U2))
    client.delete(f"{BASE}/{U1}")
    assert [t["uuid"] for t in client.get(BASE).json()] == [U2]
    everything = client.get(BASE, params={"includeDeleted": "true"}).json()
    assert {t["uuid"] for t in everything} == {U1, U2}


def test_bug_06_put_does_not_upsert_and_ignores_client_audit_fields(client: TestClient) -> None:
    assert client.put(f"{BASE}/{U1}", json=body()).status_code == 404
    assert client.get(f"{BASE}/{U1}").status_code == 404
    client.post(BASE, json=body())
    r = client.put(f"{BASE}/{U1}", json=body(createdBy="mallory", isDeleted=True))
    assert r.json()["createdBy"] == PRINCIPAL.name
    assert r.json()["isDeleted"] is False
