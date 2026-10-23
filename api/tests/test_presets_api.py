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

AD_HOC = Rows(
    key="ad-hoc",
    name="Ad hoc",
    params=(Param("kql", "kql"), Param("parameters", "json", required=False)),
    pivot="none",
)


def client_for(auth: AuthKit) -> TestClient:
    app = create_test_app(providers=[Provider(actions=[SIGN_INS, AD_HOC])])
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
        assert "location" not in created.headers
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
        alices = client.get("/api/presets").json()

    assert listed.status_code == 200
    assert listed.json() == [{**shared, "owned": False}]
    assert alices == [private, shared]


def test_each_analyst_is_told_whether_they_own_a_preset(auth: AuthKit) -> None:
    with client_for(auth) as client:
        created = client.post("/api/presets", json=bookmark(visibility="shared")).json()
        url = f"/api/presets/{created['presetId']}"

        alices = client.get("/api/presets").json()
        bobs = client.get("/api/presets", headers=as_bob(auth)).json()
        replaced = client.put(url, json=bookmark(visibility="shared")).json()

    assert created["owned"] is True
    assert [p["owned"] for p in alices] == [True]
    assert [p["owned"] for p in bobs] == [False]
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


def test_a_param_input_takes_its_type_from_the_param_so_a_sent_type_is_dropped(
    auth: AuthKit,
) -> None:
    inputs = [{"name": "users", "source": "param", "type": "long", "fixed": True, "value": ["a"]}]
    with client_for(auth) as client:
        created = client.post("/api/presets", json=bookmark(inputs=inputs))

    assert created.status_code == 201
    assert created.json()["inputs"] == [
        {"name": "users", "source": "param", "fixed": True, "value": ["a"]}
    ]


QUERY_PARAMETER_INPUTS = [
    {
        "name": "Upn",
        "source": "queryParameter",
        "type": "string",
        "fixed": False,
        "fromColumns": ["UserPrincipalName", "Upn"],
    },
    {
        "name": "Since",
        "source": "queryParameter",
        "type": "datetime",
        "fixed": True,
        "value": "2026-10-01T00:00:00Z",
    },
    {
        "name": "Hosts",
        "source": "queryParameter",
        "type": "dynamic",
        "fixed": False,
        "fromColumns": [],
    },
]


def ad_hoc(**changes: Any) -> dict[str, Any]:
    return bookmark(
        action="ad-hoc",
        params={"kql": "SigninLogs | where UserPrincipalName == Upn and TimeGenerated > Since"},
        **{"inputs": QUERY_PARAMETER_INPUTS, **changes},
    )


def test_a_preset_keeps_its_query_parameter_inputs(auth: AuthKit) -> None:
    with client_for(auth) as client:
        created = client.post("/api/presets", json=ad_hoc())
        listed = client.get("/api/presets").json()

    assert created.status_code == 201
    assert listed[0]["inputs"] == QUERY_PARAMETER_INPUTS


def test_query_parameter_inputs_need_an_action_that_takes_them_and_unique_names(
    auth: AuthKit,
) -> None:
    upn = {"name": "Upn", "source": "queryParameter", "type": "string", "fixed": True, "value": "a"}
    with client_for(auth) as client:
        no_parameters = client.post("/api/presets", json=bookmark(inputs=[upn]))
        twice = client.post("/api/presets", json=ad_hoc(inputs=[upn, upn]))
        bad_name = client.post("/api/presets", json=ad_hoc(inputs=[{**upn, "name": "a b"}]))
        bad_type = client.post("/api/presets", json=ad_hoc(inputs=[{**upn, "type": "int64"}]))

    assert (no_parameters.status_code, no_parameters.json()["errors"]) == (
        422,
        {"inputs.0.source": ["Sign-ins takes no query parameters"]},
    )
    assert (twice.status_code, twice.json()["errors"]) == (
        422,
        {"inputs.1.name": ["Upn is already an input"]},
    )
    assert (bad_name.status_code, bad_name.json()["errors"]) == (
        422,
        {
            "inputs.0.name": [
                "A query parameter's name starts with a letter or _ and holds only letters, "
                "digits and _"
            ]
        },
    )
    assert bad_type.status_code == 400
