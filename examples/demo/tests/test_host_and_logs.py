import re
from pathlib import Path

from tim_actions import Action
from tim_actions.kusto import KqlQuery
from tim_actions.testing import Connections, resolve_pivot, run_action
from tim_actions.testing.kusto import FakeKusto

SHA256SUMS = Path(__file__).parents[1] / "data" / "SHA256SUMS"

ALERT = {
    "Timestamp": "2018-08-20T10:00:00Z",
    "Host": "BGIST-L",
    "Severity": "High",
    "Alert": "Backdoor.PsEmpire",
    "Product": "Symantec Endpoint Protection",
    "EventId": "986c2f0e-9c88-45e1-af60-e4c2545dff54",
}
# A process creation: Sysmon's own time and FQDN beside the event's Timestamp and short Host.
PROCESS = {
    "Timestamp": "2018-08-20T10:02:13Z",
    "UtcTime": "2018-08-20T10:02:12.879Z",
    "Host": "BGIST-L",
    "Computer": "BGIST-L.froth.ly",
    "Image": "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    "ParentImage": "C:\\Windows\\System32\\browser_broker.exe",
    "EventId": "5b0f7c55-3f4e-4a6b-9a54-2a7f3c1f2e10",
}


def test_the_host_timeline_is_in_the_host_menu_and_pivots_from_an_alert(
    actions: dict[str, Action],
) -> None:
    timeline = actions["demo.host-timeline"]

    assert isinstance(timeline, KqlQuery)
    assert (timeline.name, timeline.menu, timeline.pivot) == ("Host timeline", "Host", "row")
    assert (timeline.connection, timeline.database, timeline.id) == (
        "security",
        "Security",
        "EventId",
    )
    assert resolve_pivot(timeline, [ALERT]).params == {
        "host": "BGIST-L",
        "at": "2018-08-20T10:00:00Z",
    }


def test_a_host_timeline_from_a_process_runs_on_its_short_host_around_its_timestamp(
    actions: dict[str, Action], tim_connections: Connections, tim_kusto: FakeKusto
) -> None:
    timeline = actions["demo.host-timeline"]
    tim_kusto.respond([])

    params = resolve_pivot(timeline, [PROCESS]).params
    run_action(timeline, params, connections=tim_connections)

    [call] = tim_kusto.calls
    assert (call.connection, call.database) == ("security", "Security")
    assert call.parameters == {
        "host": "BGIST-L",
        "at": "datetime(2018-08-20T10:02:13.0000000Z)",
        "window": "timespan(00:15:00)",
    }
    assert "Timestamp between ((at - window) .. (at + window))" in call.kql
    assert "top 5000 by abs(Timestamp - at) asc" in call.kql
    assert "order by Timestamp asc" in call.kql


def test_hosts_other_logs_is_in_the_host_menu_and_pivots_from_an_alert(
    actions: dict[str, Action],
) -> None:
    host_logs = actions["demo.host-logs"]

    assert isinstance(host_logs, KqlQuery)
    assert (host_logs.name, host_logs.menu, host_logs.pivot) == ("Host's other logs", "Host", "row")
    assert (host_logs.connection, host_logs.database, host_logs.id) == (
        "security",
        "Security",
        "EventId",
    )
    assert resolve_pivot(host_logs, [ALERT]).params == {
        "host": "BGIST-L",
        "at": "2018-08-20T10:00:00Z",
    }


def test_hosts_other_logs_from_a_process_runs_on_the_events_nearest_its_timestamp(
    actions: dict[str, Action], tim_connections: Connections, tim_kusto: FakeKusto
) -> None:
    host_logs = actions["demo.host-logs"]
    tim_kusto.respond([])

    run_action(host_logs, resolve_pivot(host_logs, [PROCESS]).params, connections=tim_connections)

    [call] = tim_kusto.calls
    assert (call.connection, call.database) == ("security", "Security")
    assert call.parameters == {"host": "BGIST-L", "at": "datetime(2018-08-20T10:02:13.0000000Z)"}
    assert "Timestamp between ((at - 1h) .. (at + 1h))" in call.kql
    assert "top 1000 by abs(Timestamp - at) asc" in call.kql
    assert "order by Timestamp asc" in call.kql


def test_every_action_keys_its_rows_by_eventid_so_an_annotation_follows_the_event(
    actions: dict[str, Action],
) -> None:
    assert {"demo.alerts", "demo.host-timeline", "demo.host-logs", "demo.raw-logs"} <= set(actions)
    assert {key: action.id for key, action in actions.items() if action.id != "EventId"} == {}


def file_name(sourcetype: str) -> str:
    """The dataset's file for a sourcetype, as data/README.md describes it."""
    return re.sub(r"[^a-z0-9_.-]", "_", sourcetype.lower()) + ".jsonl.gz"


def test_raw_logs_by_sourcetype_is_a_starting_point_that_can_pick_every_sourcetype(
    actions: dict[str, Action],
) -> None:
    raw = actions["demo.raw-logs"]

    assert isinstance(raw, KqlQuery)
    assert (raw.name, raw.menu, raw.pivot) == ("Raw logs by sourcetype", "Logs", "none")
    assert (raw.connection, raw.database, raw.id) == ("security", "Security", "EventId")
    [sourcetype] = [param for param in raw.params if param.name == "sourcetype"]
    assert sourcetype.required
    files = [line.split()[1] for line in SHA256SUMS.read_text().splitlines()]
    assert sorted(file_name(choice) for choice in sourcetype.choices or ()) == sorted(files)


def test_raw_logs_run_on_one_sourcetype_in_a_time_window_with_a_row_limit(
    actions: dict[str, Action], tim_connections: Connections, tim_kusto: FakeKusto
) -> None:
    raw = actions["demo.raw-logs"]
    tim_kusto.respond([])

    run_action(
        raw,
        {
            "sourcetype": "WinEventLog:Microsoft-Windows-PowerShell/Operational",
            "since": "2018-08-20T00:00:00Z",
            "until": "2018-08-21T00:00:00Z",
        },
        connections=tim_connections,
    )

    [call] = tim_kusto.calls
    assert (call.connection, call.database) == ("security", "Security")
    assert call.parameters == {
        "sourcetype": "WinEventLog:Microsoft-Windows-PowerShell/Operational",
        "since": "datetime(2018-08-20T00:00:00.0000000Z)",
        "until": "datetime(2018-08-21T00:00:00.0000000Z)",
    }
    assert "SourceType == sourcetype and Timestamp between (since .. until)" in call.kql
    assert call.kql.rstrip().endswith("| take 1000")


def test_raw_logs_without_a_time_window_use_the_kqls_window_over_the_whole_data(
    actions: dict[str, Action], tim_connections: Connections, tim_kusto: FakeKusto
) -> None:
    tim_kusto.respond([])

    run_action(actions["demo.raw-logs"], {"sourcetype": "cisco:asa"}, connections=tim_connections)

    [call] = tim_kusto.calls
    assert call.parameters == {"sourcetype": "cisco:asa"}
    assert call.kql.startswith(
        "declare query_parameters(sourcetype: string, "
        "since: datetime = datetime(2018-08-01), until: datetime = datetime(2018-09-01));"
    )
