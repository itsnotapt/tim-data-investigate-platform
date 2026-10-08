from collections.abc import Iterator
from typing import Any

import pytest
from app_factory import AuthKit, create_test_app
from fastapi.testclient import TestClient

CALLER = "alice@example.com"
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
def client(auth: AuthKit) -> Iterator[TestClient]:
    app = create_test_app()
    auth.install(app)
    with TestClient(app, headers=auth.headers(CALLER)) as c:
        yield c


def test_auth_required() -> None:
    with TestClient(create_test_app()) as c:
        for method, url in [
            ("get", BASE),
            ("get", f"{BASE}/{U1}"),
            ("post", BASE),
            ("put", f"{BASE}/{U1}"),
            ("patch", f"{BASE}/{U1}"),
            ("delete", f"{BASE}/{U1}"),
        ]:
            assert c.request(method, url).status_code == 401


def test_create_and_get(client: TestClient) -> None:
    r = client.post(
        BASE, json=body(createdBy="mallory", updatedBy="mallory", updated="2000-01-01T00:00:00Z")
    )
    assert r.status_code == 201
    assert r.headers["location"] == f"{BASE}/{U1}"
    data = r.json()
    assert data["createdBy"] == data["updatedBy"] == "alice@example.com"
    assert data["updated"] > "2020"
    assert data["isDeleted"] is False
    assert client.get(f"{BASE}/{U1}").json() == data


def test_duplicate_409(client: TestClient) -> None:
    assert client.post(BASE, json=body()).status_code == 201
    r = client.post(BASE, json=body())
    assert r.status_code == 409
    assert r.json()["type"] == "urn:tim:problem:conflict"


def test_create_invalid_and_deleted_flag(client: TestClient) -> None:
    r = client.post(BASE, json=body(queryType="query"))
    assert r.status_code == 400
    assert "fields" in r.json()["errors"]
    r = client.post(BASE, json=body(isDeleted=True))
    assert r.status_code == 400
    assert "isDeleted" in r.json()["errors"]


def test_get_missing_and_malformed(client: TestClient) -> None:
    assert client.get(f"{BASE}/{U1}").status_code == 404
    assert client.get(f"{BASE}/nope").status_code == 400


def test_list_filtering(client: TestClient) -> None:
    client.post(BASE, json=body(U1))
    client.post(BASE, json=body(U2))
    assert client.delete(f"{BASE}/{U1}").status_code == 204
    assert [t["uuid"] for t in client.get(BASE).json()] == [U2]
    both = client.get(BASE, params={"includeDeleted": "true"}).json()
    assert [t["uuid"] for t in both] == [U2, U1]
    newest = max(t["updated"] for t in both)
    params = {"includeDeleted": "true", "since": newest}
    assert client.get(BASE, params=params).json() == []  # strict
    params["since"] = "2000-01-01T00:00:00Z"
    assert len(client.get(BASE, params=params).json()) == 2
    assert client.get(BASE, params={"since": "garbage"}).status_code == 400
    assert client.get(BASE, params={"includeDeleted": "maybe"}).status_code == 400


def test_put(client: TestClient) -> None:
    client.post(BASE, json=body())
    r = client.put(f"{BASE}/{U1}", json=body(name="New", createdBy="mallory", isDeleted=True))
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "New"
    assert data["createdBy"] == "alice@example.com"
    assert data["isDeleted"] is False


def test_put_missing_404(client: TestClient) -> None:
    assert client.put(f"{BASE}/{U1}", json=body()).status_code == 404
    assert client.get(f"{BASE}/{U1}").status_code == 404


def test_put_uuid_mismatch_400(client: TestClient) -> None:
    client.post(BASE, json=body())
    r = client.put(f"{BASE}/{U1}", json=body(U2))
    assert r.status_code == 400
    assert r.json()["errors"] == {"uuid": ["UUIDs don't match"]}


def test_put_invalid_has_field_errors(client: TestClient) -> None:
    client.post(BASE, json=body())
    r = client.put(f"{BASE}/{U1}", json=body(name=" ", fields={"a": {"type": "multiple"}}))
    assert r.status_code == 400
    assert r.headers["content-type"].startswith("application/problem+json")
    errors = r.json()["errors"]
    assert "name" in errors
    assert "fields.a.from" in errors


def patch(client: TestClient, ops: Any, uuid: str = U1) -> Any:
    return client.patch(
        f"{BASE}/{uuid}",
        content=__import__("json").dumps(ops),
        headers={"Content-Type": "application/json-patch+json"},
    )


def test_patch_restore(client: TestClient) -> None:
    client.post(BASE, json=body())
    client.delete(f"{BASE}/{U1}")
    r = patch(client, [{"op": "replace", "path": "/isDeleted", "value": False}])
    assert r.status_code == 200
    assert r.json()["isDeleted"] is False
    assert [t["uuid"] for t in client.get(BASE).json()] == [U1]


def test_patch_fields_and_audit(client: TestClient) -> None:
    client.post(BASE, json=body())
    r = patch(client, [{"op": "replace", "path": "/name", "value": "Renamed"}])
    assert r.status_code == 200
    assert r.json()["name"] == "Renamed"
    assert r.json()["updatedBy"] == "alice@example.com"


@pytest.mark.parametrize(
    "path", ["/uuid", "/createdBy", "/updatedBy", "/updated", "/uuid/x", "name"]
)
def test_patch_protected_path_400(client: TestClient, path: str) -> None:
    client.post(BASE, json=body())
    r = patch(client, [{"op": "replace", "path": path, "value": "x"}])
    assert r.status_code == 400
    assert "errors" in r.json()


def test_patch_invalid_patch_400(client: TestClient) -> None:
    client.post(BASE, json=body())
    for ops in (
        [],
        [{"op": "move", "from": "/name", "path": "/menu"}],
        [{"op": "replace", "path": "/nope/deeper", "value": 1}],
        [{"op": "test", "path": "/name", "value": "other"}],
        [{"op": "remove", "path": "/missing"}],
        [{"op": "add", "path": "/-/x", "value": 1}],
        {"op": "replace"},
    ):
        r = patch(client, ops)
        assert r.status_code == 400, ops
        assert r.json()["type"] == "urn:tim:problem:validation"


def test_patch_invalid_result_400(client: TestClient) -> None:
    client.post(BASE, json=body())
    r = patch(client, [{"op": "replace", "path": "/queryType", "value": "query"}])
    assert r.status_code == 400
    assert "fields" in r.json()["errors"]
    r = patch(client, [{"op": "replace", "path": "/name", "value": ""}])
    assert r.status_code == 400
    assert "name" in r.json()["errors"]
    # nothing was persisted
    assert client.get(f"{BASE}/{U1}").json()["name"] == "Sign-ins"


def test_patch_missing_404(client: TestClient) -> None:
    assert patch(client, [{"op": "replace", "path": "/name", "value": "x"}]).status_code == 404


def test_delete(client: TestClient) -> None:
    client.post(BASE, json=body())
    assert client.delete(f"{BASE}/{U1}").status_code == 204
    first = client.get(f"{BASE}/{U1}").json()
    assert first["isDeleted"] is True
    assert client.delete(f"{BASE}/{U1}").status_code == 204
    assert client.get(f"{BASE}/{U1}").json() == first


def test_delete_missing_404(client: TestClient) -> None:
    assert client.delete(f"{BASE}/{U1}").status_code == 404


def test_create_and_replace_return_the_template(client: TestClient) -> None:
    created = client.post(BASE, json=body())
    assert created.status_code == 201
    assert created.json()["uuid"] == U1
    assert created.headers["location"].endswith(U1)
    replaced = client.put(f"{BASE}/{U1}", json=body(name="New"))
    assert replaced.status_code == 200
    assert replaced.json()["name"] == "New"


def test_unauthenticated_create_is_401() -> None:
    with TestClient(create_test_app()) as c:
        assert c.post(BASE, json=body()).status_code == 401


def test_deleted_templates_excluded_unless_requested(client: TestClient) -> None:
    client.post(BASE, json=body(U1))
    client.post(BASE, json=body(U2))
    client.delete(f"{BASE}/{U1}")
    assert [t["uuid"] for t in client.get(BASE).json()] == [U2]
    everything = client.get(BASE, params={"includeDeleted": "true"}).json()
    assert {t["uuid"] for t in everything} == {U1, U2}


def test_put_does_not_upsert_and_ignores_client_audit_fields(client: TestClient) -> None:
    assert client.put(f"{BASE}/{U1}", json=body()).status_code == 404
    assert client.get(f"{BASE}/{U1}").status_code == 404
    client.post(BASE, json=body())
    r = client.put(f"{BASE}/{U1}", json=body(createdBy="mallory", isDeleted=True))
    assert r.json()["createdBy"] == CALLER
    assert r.json()["isDeleted"] is False
