"""Startup validation of the providers: any problem stops the app from starting."""

import pytest
from app_factory import create_test_app
from fastapi.testclient import TestClient
from scripted_actions import FakeKustoHook, FileRows, OtherFileRows, OtherKustoHook, Rows
from tim_actions import Provider

from tim_api.actions import ActionsConfigError


def startup_problems(providers: list[Provider]) -> list[str]:
    with (
        pytest.raises(ActionsConfigError) as caught,
        TestClient(create_test_app(providers=providers)),
    ):
        pass
    return caught.value.problems


def test_a_duplicate_action_key_stops_startup() -> None:
    providers = [
        Provider(actions=[Rows(key="acme.users", name="Users")]),
        Provider(actions=[Rows(key="acme.users", name="Other users")]),
    ]
    assert startup_problems(providers) == [
        "duplicate action key acme.users: providers[0] and providers[1]"
    ]


def test_a_duplicate_action_type_stops_startup() -> None:
    providers = [Provider(action_types=[FileRows]), Provider(action_types=[OtherFileRows])]
    assert startup_problems(providers) == [
        "duplicate action type rows: providers[0] and providers[1]"
    ]


def test_a_duplicate_connection_type_stops_startup() -> None:
    providers = [Provider(hooks=[FakeKustoHook]), Provider(hooks=[OtherKustoHook])]
    assert startup_problems(providers) == [
        "duplicate connection type kusto: providers[0] and providers[1]"
    ]


def test_the_tim_prefix_is_reserved_for_the_built_ins() -> None:
    assert startup_problems([Provider(actions=[Rows(key="tim.users", name="Users")])]) == [
        "providers[0]: action tim.users: the tim. prefix is reserved for TIM's built-ins"
    ]


def test_an_action_built_without_validation_stops_startup() -> None:
    action = Rows.model_construct(key="Bad Key", name="Users")
    [problem] = startup_problems([Provider(actions=[action])])
    assert problem.startswith("providers[0]: action Bad Key: key: String should match pattern")


def test_every_problem_is_reported_at_once() -> None:
    providers = [
        Provider(actions=[Rows(key="tim.a", name="A"), Rows(key="b", name="B")]),
        Provider(actions=[Rows(key="b", name="B")], hooks=[FakeKustoHook, OtherKustoHook]),
    ]
    assert len(startup_problems(providers)) == 3
