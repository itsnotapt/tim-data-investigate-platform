"""``/api/presets``: saved actions with some params fixed, private or shared."""

from typing import Any

from app_factory import AuthKit, create_test_app
from fastapi.testclient import TestClient
from scripted_actions import Rows
from tim_actions import Param, Provider

ALICE = "alice@example.com"
BOB = "bob@example.com"

SIGN_INS = Rows(
    key="sign-ins",
    name="Sign-ins",
    params=(
        Param("users", "string", many=True, from_columns=("User", "Upn")),
        Param("limit", "number", default=10),
    ),
    pivot="rows",
)


def client_for(auth: AuthKit) -> TestClient:
    app = create_test_app(providers=[Provider(actions=[SIGN_INS])])
    auth.install(app)
    return TestClient(app, headers=auth.headers(ALICE, "oid-a"))


def as_bob(auth: AuthKit) -> dict[str, str]:
    return auth.headers(BOB, "oid-b")


def bookmark(**changes: Any) -> dict[str, Any]:
    return {
        "name": "Alice's sign-ins",
        "menuPath": ["Identity"],
        "visibility": "private",
        "action": "sign-ins",
        "params": {"limit": 5},
        "inputs": [{"name": "users", "source": "param", "fixed": True, "value": ["alice"]}],
        **changes,
    }


def test_a_saved_preset_is_listed_for_its_owner(auth: AuthKit) -> None:
    with client_for(auth) as client:
        created = client.post("/api/presets", json=bookmark())
        assert created.status_code == 201
        preset = created.json()
        assert created.headers["location"] == f"/api/presets/{preset['presetId']}"
        assert preset["owner"] == ALICE
        assert preset["hidden"] is False
        assert preset["createdAt"] == preset["updatedAt"]

        listed = client.get("/api/presets")

    assert listed.status_code == 200
    assert listed.json() == [preset]
    assert {k: preset[k] for k in bookmark()} == bookmark()


def test_others_see_shared_presets_but_not_private_ones(auth: AuthKit) -> None:
    with client_for(auth) as client:
        private = client.post("/api/presets", json=bookmark(name="Mine")).json()
        shared = client.post("/api/presets", json=bookmark(visibility="shared")).json()

        listed = client.get("/api/presets", headers=as_bob(auth))
        own = client.get(f"/api/presets/{shared['presetId']}")
        foreign_private = client.get(f"/api/presets/{private['presetId']}", headers=as_bob(auth))
        unknown = client.get("/api/presets/00000000-0000-0000-0000-000000000000")

    assert listed.status_code == 200
    assert listed.json() == [{**shared, "owned": False}]
    assert own.json() == shared
    assert foreign_private.status_code == 404
    assert unknown.status_code == 404


def test_each_analyst_is_told_whether_they_own_a_preset(auth: AuthKit) -> None:
    with client_for(auth) as client:
        created = client.post("/api/presets", json=bookmark(visibility="shared")).json()
        url = f"/api/presets/{created['presetId']}"

        alices = client.get("/api/presets").json()
        bobs = client.get("/api/presets", headers=as_bob(auth)).json()
        bobs_one = client.get(url, headers=as_bob(auth)).json()
        replaced = client.put(url, json=bookmark(visibility="shared")).json()

    assert created["owned"] is True
    assert [p["owned"] for p in alices] == [True]
    assert [p["owned"] for p in bobs] == [False]
    assert bobs_one["owned"] is False
    assert replaced["owned"] is True


def test_the_owner_replaces_a_preset_and_others_cannot(auth: AuthKit) -> None:
    with client_for(auth) as client:
        shared = client.post("/api/presets", json=bookmark(visibility="shared")).json()
        private = client.post("/api/presets", json=bookmark()).json()
        changed = bookmark(name="Renamed", visibility="shared", menuPath=["Identity", "Daily"])

        replaced = client.put(f"/api/presets/{shared['presetId']}", json=changed)
        by_bob = client.put(
            f"/api/presets/{shared['presetId']}", json=changed, headers=as_bob(auth)
        )
        bob_private = client.put(
            f"/api/presets/{private['presetId']}", json=changed, headers=as_bob(auth)
        )
        listed = client.get("/api/presets").json()

    assert replaced.status_code == 200
    body = replaced.json()
    assert {k: body[k] for k in changed} == changed
    assert body["presetId"] == shared["presetId"]
    assert body["owner"] == ALICE
    assert body["createdAt"] == shared["createdAt"]
    assert body["updatedAt"] >= shared["updatedAt"]
    assert by_bob.status_code == 403
    assert bob_private.status_code == 404
    assert [p["name"] for p in listed] == ["Renamed", bookmark()["name"]]


def test_the_owner_deletes_a_preset_and_others_cannot(auth: AuthKit) -> None:
    with client_for(auth) as client:
        shared = client.post("/api/presets", json=bookmark(visibility="shared")).json()
        url = f"/api/presets/{shared['presetId']}"

        by_bob = client.delete(url, headers=as_bob(auth))
        deleted = client.delete(url)
        again = client.delete(url)
        listed = client.get("/api/presets", headers=as_bob(auth)).json()

    assert by_bob.status_code == 403
    assert deleted.status_code == 204
    assert again.status_code == 404
    assert listed == []


def test_an_analyst_hides_and_unhides_a_preset_for_themselves(auth: AuthKit) -> None:
    with client_for(auth) as client:
        shared = client.post("/api/presets", json=bookmark(visibility="shared")).json()
        private = client.post("/api/presets", json=bookmark()).json()
        hidden_url = f"/api/presets/{shared['presetId']}/hidden"

        hidden = client.put(hidden_url, headers=as_bob(auth))
        bobs_view = client.get("/api/presets", headers=as_bob(auth)).json()
        alices_view = client.get("/api/presets").json()
        unhidden = client.delete(hidden_url, headers=as_bob(auth))
        bobs_view_after = client.get("/api/presets", headers=as_bob(auth)).json()
        foreign_private = client.put(
            f"/api/presets/{private['presetId']}/hidden", headers=as_bob(auth)
        )

    assert hidden.status_code == 204
    assert [p["hidden"] for p in bobs_view] == [True]
    assert [p["hidden"] for p in alices_view] == [False, False]
    assert unhidden.status_code == 204
    assert [p["hidden"] for p in bobs_view_after] == [False]
    assert foreign_private.status_code == 404


def test_a_preset_of_an_unknown_action_is_refused(auth: AuthKit) -> None:
    with client_for(auth) as client:
        created = client.post("/api/presets", json=bookmark(action="gone"))
        preset = client.post("/api/presets", json=bookmark()).json()
        replaced = client.put(f"/api/presets/{preset['presetId']}", json=bookmark(action="gone"))

    assert created.status_code == 422
    assert created.json()["errors"] == {"action": ["Unknown action"]}
    assert replaced.status_code == 422
    assert replaced.json()["errors"] == {"action": ["Unknown action"]}


def test_a_param_input_must_be_a_param_the_rows_can_fill(auth: AuthKit) -> None:
    inputs = [
        {"name": "users", "source": "param", "fixed": False, "fromColumns": ["User"]},
        {"name": "limit", "source": "param", "fixed": False, "fromColumns": ["Limit"]},
        {"name": "nope", "source": "param", "fixed": True, "value": 1},
    ]
    with client_for(auth) as client:
        response = client.post("/api/presets", json=bookmark(params={}, inputs=inputs))

    assert response.status_code == 422
    assert response.json()["errors"] == {
        "inputs.1.name": ["limit has no from_columns"],
        "inputs.2.name": ["Unknown param"],
    }
