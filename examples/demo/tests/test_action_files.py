import re
from pathlib import Path

from tim_actions import Action
from tim_actions.kusto import KqlQuery
from tim_actions.testing import load_actions

CONFIG = Path(__file__).parents[1] / "config"


def test_every_action_is_bounded_by_a_time_window_and_a_row_limit() -> None:
    for action in load_actions(CONFIG / "actions", [KqlQuery]).values():
        assert isinstance(action, KqlQuery)
        assert "Timestamp between (" in action.kql, action.key
        assert re.search(r"^\| take 10000$", action.kql, re.MULTILINE), action.key


def test_every_action_keys_its_rows_by_eventid_so_an_annotation_follows_the_event(
    actions: dict[str, Action],
) -> None:
    assert {key: action.id for key, action in actions.items() if action.id != "EventId"} == {}


def test_every_pivot_is_titled_by_what_it_is_about(actions: dict[str, Action]) -> None:
    row = {
        "host": "BGIST-L",
        "process": "{a1}",
        "parent": "{a0}",
        "file": r"C:\Users\Public\update.exe",
        "user": "alice",
        "ip": "203.0.113.7",
        "hash": "9f86d081",
    }
    titles = {
        key: action.title_for({p.name: row.get(p.name) for p in action.params}, [])
        for key, action in actions.items()
        if action.pivot != "none"
    }
    assert titles == {
        "demo.by-user": "By user alice",
        "demo.child-processes": "Child processes BGIST-L {a1}",
        "demo.connections-to-ip": "Connections to IP 203.0.113.7",
        "demo.file-created-then-run": r"File created, then run? BGIST-L C:\Users\Public\update.exe",
        "demo.hash-seen-anywhere": "Hash seen anywhere 9f86d081",
        "demo.host-logs": "Host's other logs BGIST-L",
        "demo.host-timeline": "Host timeline BGIST-L",
        "demo.parent-process": "Parent process BGIST-L {a0}",
        "demo.process-activity": "Process activity BGIST-L {a1}",
        "demo.process-creations": "Process creations BGIST-L",
    }
