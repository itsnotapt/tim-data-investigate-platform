import runpy
from collections.abc import Callable
from pathlib import Path
from types import SimpleNamespace

import azure.kusto.data
import pytest

LOADER = Path(__file__).parents[1] / "kusto" / "load.py"
LICENCE = "https://aka.ms/adx.emulator.license"

# Runs the loader against an emulator with the given databases, with extra environment variables,
# and returns its log.
Start = Callable[..., str]


class FakeEmulator:
    """The Kusto emulator as the loader sees it: its databases, and an empty Events table."""

    def __init__(self, databases: list[str]) -> None:
        self.databases = databases

    def execute_mgmt(self, database: str, command: str) -> SimpleNamespace:
        if command.startswith(".show databases"):
            return result([[name] for name in self.databases])
        if command.startswith(".create database Security"):
            self.databases.append("Security")
        return result([])

    def execute_query(self, database: str, query: str) -> SimpleNamespace:
        return result([[0]])


def result(rows: list[list[object]]) -> SimpleNamespace:
    return SimpleNamespace(primary_results=[rows])


@pytest.fixture
def start(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> Start:
    def run(databases: list[str], **env: str) -> str:
        emulator = FakeEmulator(databases)
        monkeypatch.setattr(azure.kusto.data, "KustoClient", lambda _: emulator)
        monkeypatch.setenv("DEMO_KUSTO_CLUSTER", "http://kusto:8080")
        monkeypatch.setenv("DEMO_DATASET", "demo-data-v1")
        monkeypatch.setenv("DEMO_WEB_ADDRESS", "http://localhost:8081")
        monkeypatch.setenv("DEMO_WEB_HOST_IP", "127.0.0.1")
        for name, value in env.items():
            monkeypatch.setenv(name, value)
        caplog.clear()
        with caplog.at_level("INFO", logger="demo"):
            runpy.run_path(str(LOADER), run_name="__main__")
        return caplog.text

    return run


def test_the_first_start_says_it_accepts_the_emulators_licence(start: Start) -> None:
    log = start(databases=[])

    assert "Created the Security database." in log
    assert f"Starting the demo accepts Microsoft's licence for the Kusto emulator: {LICENCE}" in log


def test_a_later_start_does_not_repeat_the_licence(start: Start) -> None:
    log = start(databases=["Security"])

    assert "The Security database is already attached." in log
    assert LICENCE not in log


def test_listening_on_all_interfaces_warns_that_anyone_can_sign_in(start: Start) -> None:
    log = start(databases=["Security"], DEMO_WEB_HOST_IP="0.0.0.0")  # noqa: S104

    assert (
        "Warning: TIM listens on 0.0.0.0, so anyone who can reach it can sign in as anyone." in log
    )


def test_listening_on_this_machine_only_gives_no_warning(start: Start) -> None:
    log = start(databases=["Security"], DEMO_WEB_HOST_IP="127.0.0.1")

    assert "Warning" not in log
