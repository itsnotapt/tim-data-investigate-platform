import re
from pathlib import Path

import pytest
import yaml
from tim_actions import Action
from tim_actions.kusto import KqlQuery, KustoConnection
from tim_actions.testing import Connections, load_actions, resolve_pivot, run_action
from tim_actions.testing.kusto import FakeKusto

CONFIG = Path(__file__).parents[1] / "config"
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


@pytest.fixture
def actions(tim_connections: Connections) -> dict[str, Action]:
    [security] = yaml.safe_load((CONFIG / "connections.yaml").read_text())
    tim_connections.add(KustoConnection.model_validate(security))
    return load_actions(CONFIG / "actions", [KqlQuery])


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
    assert "order by Timestamp asc" in call.kql


def test_hosts_other_logs_is_in_the_host_menu_and_pivots_from_an_alert(
    actions: dict[str, Action],
) -> None:
    logs = actions["demo.host-logs"]

    assert isinstance(logs, KqlQuery)
    assert (logs.name, logs.menu, logs.pivot) == ("Host's other logs", "Host", "row")
    assert (logs.connection, logs.database) == ("security", "Security")
    assert resolve_pivot(logs, [ALERT]).params == {"host": "BGIST-L", "at": "2018-08-20T10:00:00Z"}


def test_a_process_shows_in_hosts_other_logs_with_the_same_id(
    actions: dict[str, Action], tim_connections: Connections, tim_kusto: FakeKusto
) -> None:
    logs = actions["demo.host-logs"]
    raw = {
        "Timestamp": PROCESS["Timestamp"],
        "Host": "BGIST-L",
        "SourceType": "XmlWinEventLog:Microsoft-Windows-Sysmon/Operational",
        "Source": "WinEventLog:Microsoft-Windows-Sysmon/Operational",
        "Raw": "<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'>…</Event>",
        "EventId": PROCESS["EventId"],
    }
    tim_kusto.respond([raw])

    result = run_action(logs, resolve_pivot(logs, [PROCESS]).params, connections=tim_connections)

    [call] = tim_kusto.calls
    assert call.parameters == {"host": "BGIST-L", "at": "datetime(2018-08-20T10:02:13.0000000Z)"}
    assert "order by Timestamp asc" in call.kql
    assert logs.id == "EventId"
    assert [row[logs.id] for row in result.rows] == [PROCESS["EventId"]]


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
