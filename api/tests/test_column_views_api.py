"""``/api/columnViews``: named grid states, private or shared."""

from typing import Any

from app_factory import AuthKit, create_test_app
from fastapi.testclient import TestClient

ALICE = "alice@example.com"
BOB = "bob@example.com"


def client_for(auth: AuthKit) -> TestClient:
    app = create_test_app()
    auth.install(app)
    return TestClient(app, headers=auth.headers(ALICE, "oid-a"))


def as_bob(auth: AuthKit) -> dict[str, str]:
    return auth.headers(BOB, "oid-b")


STATE = {
    "version": "35.0.0",
    "partialColumnState": True,
    "columnOrder": {"orderedColIds": ["User", "Host", "tim:label"]},
    "columnVisibility": {"hiddenColIds": ["Host"]},
    "filter": {"filterModel": {"User": {"filterType": "text", "type": "contains", "filter": "a"}}},
}


def view(**changes: Any) -> dict[str, Any]:
    return {
        "name": "Triage",
        "visibility": "private",
        "savedFrom": {"action": "sign-ins"},
        "state": STATE,
        **changes,
    }


def test_a_saved_view_is_listed_for_its_owner(auth: AuthKit) -> None:
    with client_for(auth) as client:
        created = client.post("/api/columnViews", json=view())
        assert created.status_code == 201
        saved = created.json()
        assert "location" not in created.headers
        assert saved["owner"] == ALICE
        assert saved["owned"] is True
        assert saved["hidden"] is False
        assert saved["createdAt"] == saved["updatedAt"]

        listed = client.get("/api/columnViews")

    assert listed.status_code == 200
    assert listed.json() == [saved]
    assert {k: saved[k] for k in view()} == view()


def test_others_see_shared_views_but_not_private_ones(auth: AuthKit) -> None:
    with client_for(auth) as client:
        private = client.post("/api/columnViews", json=view(name="Mine")).json()
        shared = client.post("/api/columnViews", json=view(visibility="shared")).json()

        bobs = client.get("/api/columnViews", headers=as_bob(auth))
        alices = client.get("/api/columnViews").json()

    assert bobs.status_code == 200
    assert bobs.json() == [{**shared, "owned": False}]
    assert alices == [private, shared]


def test_a_view_saved_from_a_preset_keeps_the_preset(auth: AuthKit) -> None:
    saved_from = {"action": "tim.run_kql", "presetId": "6f1c2a7e-8d0b-4c3e-9a51-2b7d4e6f8a90"}
    with client_for(auth) as client:
        created = client.post("/api/columnViews", json=view(savedFrom=saved_from)).json()
        listed = client.get("/api/columnViews").json()

    assert created["savedFrom"] == saved_from
    assert listed[0]["savedFrom"] == saved_from


def test_the_owner_replaces_a_view_but_not_where_it_was_saved_from(auth: AuthKit) -> None:
    with client_for(auth) as client:
        shared = client.post("/api/columnViews", json=view(visibility="shared")).json()
        private = client.post("/api/columnViews", json=view()).json()
        changed = {"name": "Renamed", "visibility": "shared", "state": {"columnOrder": {}}}

        replaced = client.put(
            f"/api/columnViews/{shared['viewId']}",
            json={**changed, "savedFrom": {"action": "other"}},
        )
        by_bob = client.put(
            f"/api/columnViews/{shared['viewId']}", json=changed, headers=as_bob(auth)
        )
        bob_private = client.put(
            f"/api/columnViews/{private['viewId']}", json=changed, headers=as_bob(auth)
        )
        listed = client.get("/api/columnViews").json()

    assert replaced.status_code == 200
    body = replaced.json()
    assert {k: body[k] for k in changed} == changed
    assert body["savedFrom"] == {"action": "sign-ins"}
    assert body["viewId"] == shared["viewId"]
    assert body["owner"] == ALICE
    assert body["createdAt"] == shared["createdAt"]
    assert body["updatedAt"] >= shared["updatedAt"]
    assert by_bob.status_code == 403
    assert bob_private.status_code == 404
    assert [v["name"] for v in listed] == ["Renamed", "Triage"]


def test_the_owner_deletes_a_view_and_others_cannot(auth: AuthKit) -> None:
    with client_for(auth) as client:
        shared = client.post("/api/columnViews", json=view(visibility="shared")).json()
        url = f"/api/columnViews/{shared['viewId']}"

        by_bob = client.delete(url, headers=as_bob(auth))
        deleted = client.delete(url)
        again = client.delete(url)
        listed = client.get("/api/columnViews", headers=as_bob(auth)).json()

    assert by_bob.status_code == 403
    assert deleted.status_code == 204
    assert again.status_code == 404
    assert listed == []


def test_an_analyst_hides_and_unhides_a_view_for_themselves(auth: AuthKit) -> None:
    with client_for(auth) as client:
        shared = client.post("/api/columnViews", json=view(visibility="shared")).json()
        private = client.post("/api/columnViews", json=view()).json()
        hidden_url = f"/api/columnViews/{shared['viewId']}/hidden"

        hidden = client.put(hidden_url, headers=as_bob(auth))
        bobs_hidden = client.get("/api/columnViews", headers=as_bob(auth)).json()
        alices = client.get("/api/columnViews").json()
        unhidden = client.delete(hidden_url, headers=as_bob(auth))
        bobs_after = client.get("/api/columnViews", headers=as_bob(auth)).json()
        bob_private = client.put(
            f"/api/columnViews/{private['viewId']}/hidden", headers=as_bob(auth)
        )

    assert hidden.status_code == 204
    assert [v["hidden"] for v in bobs_hidden] == [True]
    assert [v["hidden"] for v in alices] == [False, False]
    assert unhidden.status_code == 204
    assert [v["hidden"] for v in bobs_after] == [False]
    assert bob_private.status_code == 404


def test_the_state_must_be_a_json_object(auth: AuthKit) -> None:
    with client_for(auth) as client:
        as_list = client.post("/api/columnViews", json=view(state=["columnOrder"]))
        missing = client.post(
            "/api/columnViews", json={"name": "No state", "savedFrom": {"action": "a"}}
        )
        listed = client.get("/api/columnViews").json()

    assert as_list.status_code == 422
    assert missing.status_code == 422
    assert listed == []


def test_names_are_not_unique(auth: AuthKit) -> None:
    with client_for(auth) as client:
        first = client.post("/api/columnViews", json=view())
        second = client.post("/api/columnViews", json=view())

    assert first.status_code == second.status_code == 201
    assert first.json()["viewId"] != second.json()["viewId"]
