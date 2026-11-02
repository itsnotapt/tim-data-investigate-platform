import re
from pathlib import Path

from tim_actions import Action
from tim_actions.kusto import KqlQuery
from tim_actions.testing import load_actions

CONFIG = Path(__file__).parents[1] / "config"
FUNCTIONS = Path(__file__).parents[1] / "kusto" / "functions"
SHA256 = "7A1367EFBA05B09E317909B040C3CDA972544212B4F9DB639237492351A3A405"
MD5 = "95000560239032BC68B4C2FDFCDEF913"
# The functions that parse the Sysmon events, such as ProcessCreations.
ENDPOINT_FUNCTIONS = {
    match[1]
    for path in FUNCTIONS.glob("*.kql")
    if (match := re.match(r'\.create-or-alter function with \(folder = "Endpoint".*?\) (\w+)\(\)', path.read_text()))
}


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
        "hash": SHA256,
    }
    titles = {
        key: action.title_for({p.name: row.get(p.name) for p in action.params}, [])
        for key, action in actions.items()
        if action.pivot != "none"
    }
    assert titles == {
        "demo.activity-by-user": "Activity by user alice",
        "demo.child-processes": "Child processes of {a1} on BGIST-L",
        "demo.connections-to-ip": "Connections to IP 203.0.113.7",
        "demo.filename-seen-on-host": "Filename update.exe seen on BGIST-L",
        "demo.hash-seen-anywhere": f"Events related to SHA256 {SHA256}",
        "demo.host-logs": "Other logs for host BGIST-L",
        "demo.host-timeline": "Host timeline for BGIST-L",
        "demo.parent-process": "Parent process {a0} on BGIST-L",
        "demo.process-activity": "Process activity for {a1} on BGIST-L",
        "demo.process-creations": "Process creations on BGIST-L",
    }


def test_a_hash_titles_its_run_with_its_kind(actions: dict[str, Action]) -> None:
    hash_seen_anywhere = actions["demo.hash-seen-anywhere"]

    assert hash_seen_anywhere.title_for({"hash": MD5}) == f"Events related to MD5 {MD5}"


def over_endpoint_functions(actions: dict[str, Action]) -> dict[str, KqlQuery]:
    return {
        key: action
        for key, action in actions.items()
        if isinstance(action, KqlQuery) and re.search(rf"\b({'|'.join(ENDPOINT_FUNCTIONS)})\(\)", action.kql)
    }


def leading_columns(kql: str) -> list[str]:
    """The columns a query's rows start with: those of its last project-reorder, or else of the function it reads."""
    reorders = re.findall(r"\| project-reorder ([^|}]*)", kql)
    if not reorders:
        [function] = re.findall(rf"\b({'|'.join(ENDPOINT_FUNCTIONS)})\(\)", kql)
        [path] = [path for path in FUNCTIONS.glob("*.kql") if f") {function}()" in path.read_text()]
        reorders = re.findall(r"\| project-reorder ([^|}]*)", path.read_text())
    return [column.strip() for column in reorders[-1].split(",")]


def test_an_action_over_the_endpoint_functions_shows_every_field_they_return(
    actions: dict[str, Action],
) -> None:
    over_endpoint = over_endpoint_functions(actions)

    assert "ProcessCreations" in ENDPOINT_FUNCTIONS
    assert "demo.process-activity" in over_endpoint
    assert [key for key, action in over_endpoint.items() if re.search(r"\| project\s", action.kql)] == []


def test_an_action_over_the_endpoint_functions_declares_only_the_columns_its_rows_start_with(
    actions: dict[str, Action],
) -> None:
    # TIM shows the declared columns first, so declaring a later column would move it forward.
    for key, action in over_endpoint_functions(actions).items():
        declared = [column.name for column in action.columns]
        assert declared[:4] == ["Timestamp", "EventType", "Host", "Summary"], key
        assert declared == leading_columns(action.kql)[: len(declared)], key
