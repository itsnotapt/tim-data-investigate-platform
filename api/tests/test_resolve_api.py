from typing import Any, ClassVar

import pytest
from app_factory import AuthKit, create_test_app
from fastapi.testclient import TestClient
from scripted_actions import Rows
from tim_actions import Action, Param, PivotContext, Provider, Resolved


def client_for(auth: AuthKit, *actions: Action) -> TestClient:
    app = create_test_app(providers=[Provider(actions=list(actions))])
    auth.install(app)
    return TestClient(app, headers=auth.headers())


SIGN_INS = Rows(
    key="sign-ins",
    name="Sign-ins",
    params=(
        Param("users", "string", many=True, from_columns=("User", "Upn")),
        Param("at", "datetime", title="Timestamp", required=False, from_columns=("Timestamp",)),
        Param("limit", "number", default=10),
    ),
    pivot="rows",
)


def test_the_params_resolve_from_the_rows_by_their_from_columns(auth: AuthKit) -> None:
    with client_for(auth, SIGN_INS) as client:
        response = client.post(
            "/api/actions/sign-ins/resolve",
            json={
                "pivot": {
                    "rows": [
                        {"User": "alice", "Timestamp": "2026-01-01T00:00:00Z"},
                        {"Upn": "bob", "Timestamp": "2026-01-01T00:00:00Z"},
                    ],
                    "cell": {"column": "User", "value": "alice"},
                }
            },
        )
    assert response.status_code == 200
    assert response.json() == {
        "params": {"users": ["alice", "bob"], "at": "2026-01-01T00:00:00Z"},
        "missing": [],
        "reasons": {},
    }


def test_a_param_the_rows_disagree_on_is_missing_with_the_reason(auth: AuthKit) -> None:
    with client_for(auth, SIGN_INS) as client:
        response = client.post(
            "/api/actions/sign-ins/resolve",
            json={
                "pivot": {
                    "rows": [
                        {"User": "alice", "Timestamp": "2026-01-01T00:00:00Z"},
                        {"User": "alice", "Timestamp": "2026-01-02T00:00:00Z"},
                    ]
                }
            },
        )
    assert response.status_code == 200
    assert response.json() == {
        "params": {"users": ["alice"]},
        "missing": ["at"],
        "reasons": {"at": "The 2 selected rows have different Timestamp values"},
    }


class Window(Rows):
    """Resolves ``window`` from the earliest and latest ``Timestamp`` of the rows."""

    seen: ClassVar[list[PivotContext]] = []

    def pivot_columns(self) -> list[list[str]]:
        return [["Timestamp"]]

    def resolve(self, context: PivotContext) -> Resolved:
        self.seen.append(context)
        stamps = sorted(row["Timestamp"] for row in context.rows)
        return Resolved(params={"window": [stamps[0], stamps[-1]]}, missing={"host": None})


def test_an_overridden_resolve_sees_only_its_pivot_columns(auth: AuthKit) -> None:
    action = Window(
        key="window",
        name="Window",
        params=(Param("window", "datetime", many=True), Param("host", "string")),
        pivot="rows",
    )
    with client_for(auth, action) as client:
        response = client.post(
            "/api/actions/window/resolve",
            json={
                "pivot": {
                    "rows": [
                        {"Timestamp": "2026-01-02T00:00:00Z", "Host": "pc-1"},
                        {"Timestamp": "2026-01-01T00:00:00Z", "Host": "pc-2"},
                    ]
                }
            },
        )
    assert response.status_code == 200
    assert response.json() == {
        "params": {"window": ["2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"]},
        "missing": ["host"],
        "reasons": {},
    }
    assert [list(context.rows) for context in Window.seen] == [
        [{"Timestamp": "2026-01-02T00:00:00Z"}, {"Timestamp": "2026-01-01T00:00:00Z"}]
    ]


def test_more_rows_than_max_pivot_rows_are_refused(
    auth: AuthKit, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("TIM_MAX_PIVOT_ROWS", "2")
    with client_for(auth, SIGN_INS) as client:
        response = client.post(
            "/api/actions/sign-ins/resolve",
            json={"pivot": {"rows": [{"User": "a"}, {"User": "b"}, {"User": "c"}]}},
        )
    assert response.status_code == 422
    assert response.json()["errors"] == {"pivot.rows": ["At most 2 rows; 3 selected"]}


@pytest.mark.parametrize(
    ("pivot", "rows", "reason"),
    [
        ("row", [{"User": "a"}, {"User": "b"}], "Takes one row"),
        ("none", [{"User": "a"}], "Not offered as a pivot"),
    ],
)
def test_a_pivot_the_action_does_not_offer_is_refused(
    auth: AuthKit, pivot: Any, rows: list[dict[str, Any]], reason: str
) -> None:
    action = SIGN_INS.model_copy(update={"pivot": pivot})
    with client_for(auth, action) as client:
        response = client.post("/api/actions/sign-ins/resolve", json={"pivot": {"rows": rows}})
    assert response.status_code == 422
    assert response.json()["errors"] == {"pivot.rows": [reason]}


def test_an_unknown_action_is_not_found(auth: AuthKit) -> None:
    with client_for(auth, SIGN_INS) as client:
        response = client.post(
            "/api/actions/nope/resolve", json={"pivot": {"rows": [{"User": "a"}]}}
        )
    assert response.status_code == 404
