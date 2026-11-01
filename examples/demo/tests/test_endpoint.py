import re
from pathlib import Path

import pytest
import yaml
from tim_actions import Action
from tim_actions.kusto import KqlQuery, KustoConnection
from tim_actions.testing import Connections, load_actions, resolve_pivot, run_action
from tim_actions.testing.kusto import FakeKusto

CONFIG = Path(__file__).parents[1] / "config"

# A row of each kind the endpoint actions pivot from, as the demo's data has them.
ALERT = {
    "Timestamp": "2018-08-20T10:00:00Z",
    "Host": "BGIST-L",
    "Severity": "High",
    "Alert": "Backdoor.PsEmpire",
    "Product": "Symantec Endpoint Protection",
    "EventId": "986c2f0e-9c88-45e1-af60-e4c2545dff54",
}
# The encoded PowerShell that browser_broker.exe launched on FYODOR-L, from Process creations.
PROCESS = {
    "Timestamp": "2018-08-20T10:01:41Z",
    "Host": "FYODOR-L",
    "User": "AzureAD\\FyodorMalteskesko",
    "Image": "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    "CommandLine": (
        '"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" '
        "powershell -noP -sta -w 1 -enc ..."
    ),
    "ParentImage": "C:\\Windows\\System32\\browser_broker.exe",
    "ProcessId": 7756,
    "ParentProcessId": 8204,
    "ProcessGuid": "{EBF7A186-C2FD-5B58-0000-00107E5CCA01}",
    "ParentProcessGuid": "{EBF7A186-C2DA-5B58-0000-0010B74CC801}",
    "SHA256": "D3F8FADE829D2B7BD596C4504A6DAE5C034E789B6A3DEFBE013BDA7D14466677",
    "MD5": "95000560239032BC68B4C2FDFCDEF913",
    "Computer": "FYODOR-L.froth.ly",
    "UtcTime": "2018-08-20T10:01:41.243Z",
    "EventId": "8b993439-6f47-4e41-9950-ec9b11ac815b",
}
# A connection of that PowerShell's child, from Process activity.
CONNECTION = {
    "Timestamp": "2018-08-20T10:01:46Z",
    "Host": "FYODOR-L",
    "Activity": "Network connection",
    "Image": "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    "Detail": "tcp 45.77.53.176:443",
    "User": "AzureAD\\FyodorMalteskesko",
    "ProcessGuid": "{EBF7A186-C300-5B58-0000-001007E5CA01}",
    "DestinationIp": "45.77.53.176",
    "DestinationPort": 443,
    "TargetFilename": "",
    "TargetObject": "",
    "SHA256": "",
    "MD5": "",
    "EventId": "923608ff-ee0d-4599-94e5-53a15c373b9f",
}
# A file a PowerShell created on FYODOR-L, from Process activity.
FILE_CREATION = {
    "Timestamp": "2018-08-20T10:42:49Z",
    "Host": "FYODOR-L",
    "Activity": "File created",
    "Image": "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    "Detail": "C:\\Windows\\Temp\\hdoor.exe",
    "User": "",
    "ProcessGuid": "{EBF7A186-C442-5B58-0000-00109914D901}",
    "DestinationIp": "",
    "DestinationPort": None,
    "TargetFilename": "C:\\Windows\\Temp\\hdoor.exe",
    "TargetObject": "",
    "SHA256": "",
    "MD5": "",
    "EventId": "4b4d3ab4-522b-425e-97b3-825e786a0d5e",
}


@pytest.fixture
def actions(tim_connections: Connections) -> dict[str, Action]:
    [security] = yaml.safe_load((CONFIG / "connections.yaml").read_text())
    tim_connections.add(KustoConnection.model_validate(security))
    return load_actions(CONFIG / "actions", [KqlQuery])


def test_the_endpoint_menu_holds_the_pivots_that_follow_an_alert_on_its_endpoint(
    actions: dict[str, Action],
) -> None:
    endpoint = {key: action for key, action in actions.items() if action.menu == "Endpoint"}

    assert sorted(action.name for action in endpoint.values()) == [
        "By user",
        "Child processes",
        "Connections to IP",
        "File created, then run?",
        "Hash seen anywhere",
        "Parent process",
        "Process activity",
        "Process creations",
    ]
    for action in endpoint.values():
        assert isinstance(action, KqlQuery)
        assert (action.pivot, action.connection, action.database, action.id) == (
            "row",
            "security",
            "Security",
            "EventId",
        )
        assert [column.name for column in action.columns][0] == "Timestamp"
        assert "EventId" in [column.name for column in action.columns]


def test_every_action_is_bounded_by_a_time_window_and_a_row_limit(
    actions: dict[str, Action],
) -> None:
    for action in actions.values():
        assert isinstance(action, KqlQuery)
        assert "Timestamp between (" in action.kql, action.key
        assert re.search(r"^\| take \d+$", action.kql, re.MULTILINE), action.key


def test_an_alert_pivots_to_its_hosts_process_creations_in_the_hour_around_it(
    actions: dict[str, Action], tim_connections: Connections, tim_kusto: FakeKusto
) -> None:
    process_creations = actions["demo.process-creations"]
    resolved = resolve_pivot(process_creations, [ALERT])
    assert (resolved.params, resolved.missing) == (
        {"host": "BGIST-L", "around": "2018-08-20T10:00:00Z"},
        {},
    )
    tim_kusto.respond([])

    run_action(process_creations, resolved.params, connections=tim_connections)

    [call] = tim_kusto.calls
    assert (call.connection, call.database) == ("security", "Security")
    assert call.parameters == {
        "host": "BGIST-L",
        "around": "datetime(2018-08-20T10:00:00.0000000Z)",
        "window": "timespan(01:00:00)",
    }
    assert call.kql.startswith(
        "declare query_parameters(host: string, around: datetime, window: timespan);\n"
        "ProcessCreations()\n"
        "| where Host == host and Timestamp between ((around - window) .. (around + window))\n"
    )
    assert call.kql.endswith("| take 10000\n")


def test_a_process_pivots_to_its_activity_on_its_host(
    actions: dict[str, Action], tim_connections: Connections, tim_kusto: FakeKusto
) -> None:
    process_activity = actions["demo.process-activity"]
    resolved = resolve_pivot(process_activity, [PROCESS])
    assert (resolved.params, resolved.missing) == (
        {
            "host": "FYODOR-L",
            "process": "{EBF7A186-C2FD-5B58-0000-00107E5CCA01}",
            "around": "2018-08-20T10:01:41Z",
        },
        {},
    )
    tim_kusto.respond([])

    run_action(process_activity, resolved.params, connections=tim_connections)

    [call] = tim_kusto.calls
    assert call.parameters == {
        "host": "FYODOR-L",
        "process": "{EBF7A186-C2FD-5B58-0000-00107E5CCA01}",
        "around": "datetime(2018-08-20T10:01:41.0000000Z)",
        "window": "timespan(1.00:00:00)",
    }
    assert call.kql.startswith(
        "declare query_parameters(host: string, process: string, "
        "around: datetime, window: timespan);\n"
    )
    assert "Timestamp between ((around - window) .. (around + window))" in call.kql
    assert call.kql.endswith("| take 10000\n")


def test_a_process_pivots_to_its_child_processes(
    actions: dict[str, Action], tim_connections: Connections, tim_kusto: FakeKusto
) -> None:
    child_processes = actions["demo.child-processes"]
    resolved = resolve_pivot(child_processes, [PROCESS])
    assert (resolved.params, resolved.missing) == (
        {
            "host": "FYODOR-L",
            "process": "{EBF7A186-C2FD-5B58-0000-00107E5CCA01}",
            "around": "2018-08-20T10:01:41Z",
        },
        {},
    )
    tim_kusto.respond([])

    run_action(child_processes, resolved.params, connections=tim_connections)

    [call] = tim_kusto.calls
    assert call.parameters == {
        "host": "FYODOR-L",
        "process": "{EBF7A186-C2FD-5B58-0000-00107E5CCA01}",
        "around": "datetime(2018-08-20T10:01:41.0000000Z)",
        "window": "timespan(1.00:00:00)",
    }
    assert call.kql.startswith(
        "declare query_parameters(host: string, process: string, "
        "around: datetime, window: timespan);\n"
        "ProcessCreations()\n"
        "| where Host == host and Timestamp between ((around - window) .. (around + window))\n"
        "| where ParentProcessGuid == process\n"
    )
    assert call.kql.endswith("| take 10000\n")


def test_a_process_pivots_to_its_parent_process(
    actions: dict[str, Action], tim_connections: Connections, tim_kusto: FakeKusto
) -> None:
    parent_process = actions["demo.parent-process"]
    resolved = resolve_pivot(parent_process, [PROCESS])
    assert (resolved.params, resolved.missing) == (
        {
            "host": "FYODOR-L",
            "parent": "{EBF7A186-C2DA-5B58-0000-0010B74CC801}",
            "around": "2018-08-20T10:01:41Z",
        },
        {},
    )
    tim_kusto.respond([])

    run_action(parent_process, resolved.params, connections=tim_connections)

    [call] = tim_kusto.calls
    assert call.parameters == {
        "host": "FYODOR-L",
        "parent": "{EBF7A186-C2DA-5B58-0000-0010B74CC801}",
        "around": "datetime(2018-08-20T10:01:41.0000000Z)",
        "window": "timespan(1.00:00:00)",
    }
    assert call.kql.startswith(
        "declare query_parameters(host: string, parent: string, "
        "around: datetime, window: timespan);\n"
        "ProcessCreations()\n"
        "| where Host == host and Timestamp between ((around - window) .. (around + window))\n"
        "| where ProcessGuid == parent\n"
    )
    assert call.kql.endswith("| take 10000\n")


def test_a_connection_pivots_to_every_connection_to_its_ip(
    actions: dict[str, Action], tim_connections: Connections, tim_kusto: FakeKusto
) -> None:
    connections_to_ip = actions["demo.connections-to-ip"]
    resolved = resolve_pivot(connections_to_ip, [CONNECTION])
    assert (resolved.params, resolved.missing) == (
        {"ip": "45.77.53.176", "around": "2018-08-20T10:01:46Z"},
        {},
    )
    tim_kusto.respond([])

    run_action(connections_to_ip, resolved.params, connections=tim_connections)

    [call] = tim_kusto.calls
    assert call.parameters == {
        "ip": "45.77.53.176",
        "around": "datetime(2018-08-20T10:01:46.0000000Z)",
        "window": "timespan(1.00:00:00)",
    }
    assert call.kql.startswith(
        "declare query_parameters(ip: string, around: datetime, window: timespan);\n"
        "NetworkConnections()\n"
        "| where DestinationIp == ip"
        " and Timestamp between ((around - window) .. (around + window))\n"
    )
    assert call.kql.endswith("| take 10000\n")


def test_a_process_pivots_to_every_event_holding_its_hash(
    actions: dict[str, Action], tim_connections: Connections, tim_kusto: FakeKusto
) -> None:
    hash_seen_anywhere = actions["demo.hash-seen-anywhere"]
    resolved = resolve_pivot(hash_seen_anywhere, [PROCESS])
    assert (resolved.params, resolved.missing) == (
        {
            "hash": "D3F8FADE829D2B7BD596C4504A6DAE5C034E789B6A3DEFBE013BDA7D14466677",
            "around": "2018-08-20T10:01:41Z",
        },
        {},
    )
    tim_kusto.respond([])

    run_action(hash_seen_anywhere, resolved.params, connections=tim_connections)

    [call] = tim_kusto.calls
    assert call.parameters == {
        "hash": "D3F8FADE829D2B7BD596C4504A6DAE5C034E789B6A3DEFBE013BDA7D14466677",
        "around": "datetime(2018-08-20T10:01:41.0000000Z)",
        "window": "timespan(1.00:00:00)",
    }
    assert call.kql.startswith(
        "declare query_parameters(hash: string, around: datetime, window: timespan);\n"
        "Events\n"
        "| where Timestamp between ((around - window) .. (around + window))\n"
        "| where Raw has hash\n"
    )
    assert call.kql.endswith("| take 10000\n")


def test_a_row_with_only_an_md5_pivots_on_its_md5(
    actions: dict[str, Action],
) -> None:
    row = PROCESS | {"SHA256": ""}

    resolved = resolve_pivot(actions["demo.hash-seen-anywhere"], [row])

    assert resolved.params["hash"] == "95000560239032BC68B4C2FDFCDEF913"


def test_a_file_creation_pivots_to_the_runs_of_the_file_after_it(
    actions: dict[str, Action], tim_connections: Connections, tim_kusto: FakeKusto
) -> None:
    file_created_then_run = actions["demo.file-created-then-run"]
    resolved = resolve_pivot(file_created_then_run, [FILE_CREATION])
    assert (resolved.params, resolved.missing) == (
        {
            "host": "FYODOR-L",
            "file": "C:\\Windows\\Temp\\hdoor.exe",
            "created": "2018-08-20T10:42:49Z",
        },
        {},
    )
    tim_kusto.respond([])

    run_action(file_created_then_run, resolved.params, connections=tim_connections)

    [call] = tim_kusto.calls
    assert call.parameters == {
        "host": "FYODOR-L",
        "file": "C:\\Windows\\Temp\\hdoor.exe",
        "created": "datetime(2018-08-20T10:42:49.0000000Z)",
        "window": "timespan(1.00:00:00)",
    }
    assert call.kql.startswith(
        "declare query_parameters(host: string, file: string, "
        "created: datetime, window: timespan);\n"
        "ProcessCreations()\n"
        "| where Host == host and Timestamp between (created .. (created + window))\n"
        "| where Image =~ file\n"
    )
    assert call.kql.endswith("| take 10000\n")


def test_a_row_of_other_activity_leaves_the_file_to_fill_in(actions: dict[str, Action]) -> None:
    resolved = resolve_pivot(actions["demo.file-created-then-run"], [CONNECTION])

    assert resolved.missing == {"file": None}


def test_a_process_pivots_to_what_its_user_did_on_every_host_in_the_hour_around_it(
    actions: dict[str, Action], tim_connections: Connections, tim_kusto: FakeKusto
) -> None:
    by_user = actions["demo.by-user"]
    resolved = resolve_pivot(by_user, [PROCESS])
    assert (resolved.params, resolved.missing) == (
        {"user": "AzureAD\\FyodorMalteskesko", "around": "2018-08-20T10:01:41Z"},
        {},
    )
    tim_kusto.respond([])

    run_action(by_user, resolved.params, connections=tim_connections)

    [call] = tim_kusto.calls
    assert call.parameters == {
        "user": "AzureAD\\FyodorMalteskesko",
        "around": "datetime(2018-08-20T10:01:41.0000000Z)",
        "window": "timespan(01:00:00)",
    }
    assert call.kql.startswith(
        "declare query_parameters(user: string, around: datetime, window: timespan);\n"
    )
    assert "User == user and Timestamp between ((around - window) .. (around + window))" in call.kql
    assert call.kql.endswith("| take 10000\n")
