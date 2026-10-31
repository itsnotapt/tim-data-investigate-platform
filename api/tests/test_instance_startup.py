"""Startup validation of the providers and the connections file: any problem stops the app
from starting."""

import logging
from pathlib import Path

import pytest
from app_factory import create_test_app
from fastapi.testclient import TestClient
from scripted_actions import (
    CancellableHook,
    FakeKustoHook,
    FileRows,
    OtherFileRows,
    OtherKustoHook,
    Rows,
    WaitUntilCancelled,
)
from tim_actions import Provider
from tim_actions.kusto import KustoHook

from tim_api.actions import InstanceConfigError
from tim_api.auth.obo import OboConfigError
from tim_api.config import SettingsError


def startup_problems(providers: list[Provider]) -> list[str]:
    with (
        pytest.raises(InstanceConfigError) as caught,
        TestClient(create_test_app(providers=providers)),
    ):
        pass
    return caught.value.problems


def test_a_duplicate_action_key_stops_startup() -> None:
    providers = [
        Provider(actions=[Rows(key="acme.users", name="Users", pivot="none")]),
        Provider(actions=[Rows(key="acme.users", name="Other users", pivot="none")]),
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
    assert startup_problems(
        [Provider(actions=[Rows(key="tim.users", name="Users", pivot="none")])]
    ) == ["providers[0]: action tim.users: the tim. prefix is reserved for TIM's built-ins"]


def test_an_action_built_without_validation_stops_startup() -> None:
    action = Rows.model_construct(key="Bad Key", name="Users", pivot="none")
    [problem] = startup_problems([Provider(actions=[action])])
    assert problem.startswith("providers[0]: action Bad Key: key: String should match pattern")


def test_every_problem_is_reported_at_once() -> None:
    providers = [
        Provider(
            actions=[
                Rows(key="tim.a", name="A", pivot="none"),
                Rows(key="b", name="B", pivot="none"),
            ]
        ),
        Provider(
            actions=[Rows(key="b", name="B", pivot="none")], hooks=[FakeKustoHook, OtherKustoHook]
        ),
    ]
    assert len(startup_problems(providers)) == 3


SECURITY = """\
- name: security
  title: Security
  type: kusto
  auth: obo
  cluster: https://help.kusto.windows.net
"""


@pytest.fixture
def connections(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """``TIM_CONNECTIONS_FILE``, with one Kusto connection, ``security``."""
    path = tmp_path / "connections.yaml"
    path.write_text(SECURITY)
    monkeypatch.setenv("TIM_CONNECTIONS_FILE", str(path))
    return path


def waits_on(connection: str) -> Provider:
    action = WaitUntilCancelled(key="acme.wait", name="Wait", pivot="none", connection=connection)
    return Provider(actions=[action], hooks=[CancellableHook, KustoHook])


@pytest.mark.usefixtures("connections")
def test_an_actions_missing_fixed_connection_stops_startup() -> None:
    assert startup_problems([waits_on("fake")]) == [
        "providers[0]: action acme.wait: no connection named fake"
    ]


@pytest.mark.usefixtures("connections")
def test_an_actions_fixed_connection_of_another_type_stops_startup() -> None:
    assert startup_problems([waits_on("security")]) == [
        "providers[0]: action acme.wait: connection security is kusto, not fake"
    ]


def test_a_connection_with_no_installed_hook_stops_startup(connections: Path) -> None:
    assert startup_problems([]) == [
        f"{connections}:3: [0].type: unknown connection type 'kusto' (installed connection "
        "types: none)"
    ]


def test_run_kql_is_left_out_without_a_kusto_connection(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.INFO), TestClient(create_test_app(providers=None)) as client:
        actions = client.app.state.actions  # type: ignore[attr-defined]
    assert "tim.run_kql" not in actions
    assert "Action tim.run_kql left out: no kusto connection for its connection param" in (
        caplog.messages
    )


def test_a_connections_file_that_does_not_exist_stops_startup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("TIM_CONNECTIONS_FILE", str(tmp_path / "missing.yaml"))
    with pytest.raises(SettingsError) as caught, TestClient(create_test_app()):
        pass
    assert (
        f"TIM_CONNECTIONS_FILE: invalid (Value error, no file {tmp_path / 'missing.yaml'})"
        in str(caught.value)
    )


def test_an_empty_connections_file_setting_means_none(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TIM_CONNECTIONS_FILE", "")
    with TestClient(create_test_app()) as client:
        assert client.app.state.instance.connections == []  # type: ignore[attr-defined]


def test_without_an_obo_connection_no_obo_credential_is_needed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("TIM_AUTH_CLIENT_SECRET")
    with TestClient(create_test_app()) as client:
        assert client.app.state.instance.connections == []  # type: ignore[attr-defined]


@pytest.mark.usefixtures("connections")
def test_an_obo_connection_without_an_obo_credential_stops_startup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("TIM_AUTH_CLIENT_SECRET")
    with (
        pytest.raises(OboConfigError, match="TIM_AUTH_CLIENT_SECRET"),
        TestClient(create_test_app(providers=None)),
    ):
        pass


EMULATOR = """\
- name: emulator
  title: Emulator
  type: kusto
  auth: none
  cluster: http://kusto:8080
"""


def test_a_connection_without_auth_stops_startup_in_production(
    connections: Path,
) -> None:
    connections.write_text(EMULATOR)
    assert startup_problems([Provider(hooks=[KustoHook])]) == [
        f"{connections}: connection emulator: auth none is not allowed when "
        "TIM_ENVIRONMENT=production"
    ]


def test_a_connection_without_auth_needs_no_obo_credential_in_development(
    connections: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    connections.write_text(EMULATOR)
    monkeypatch.setenv("TIM_ENVIRONMENT", "development")
    monkeypatch.delenv("TIM_AUTH_CLIENT_SECRET")
    with TestClient(create_test_app(providers=[Provider(hooks=[KustoHook])])) as client:
        [connection] = client.app.state.instance.connections  # type: ignore[attr-defined]
        assert connection.name == "emulator"
