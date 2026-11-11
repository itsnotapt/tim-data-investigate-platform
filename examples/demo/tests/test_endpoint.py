import re
from pathlib import Path

from tim_actions import Action
from tim_actions.kusto import KqlQuery
from tim_actions.testing import Connections, resolve_pivot, run_action
from tim_actions.testing.kusto import FakeKusto

CONFIG = Path(__file__).parents[1] / "config"

# A row of each kind the endpoint actions pivot from, as the demo's data has them.
ALERT = {
    "Timestamp": "2018-08-20T10:00:00Z",
    "Host": "BGIST-L",
    "Severity": "High",
    "Alert": "Backdoor.PsEmpire",
    "Product": "Symantec Endpoint Protection",
    "SHA256": "7A1367EFBA05B09E317909B040C3CDA972544212B4F9DB639237492351A3A405",
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
    "EventType": "NetworkConnect",
    "Summary": "powershell.exe created a network connection [tcp] from 192.168.70.186:60018 to 45.77.53.176:443",
    "Image": "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
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
    "EventType": "FileCreate",
    "Summary": "powershell.exe created file: C:\\Windows\\Temp\\hdoor.exe",
    "Image": "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
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


def test_the_endpoint_menu_holds_the_actions_that_follow_an_alert_on_its_endpoint(
    actions: dict[str, Action],
) -> None:
    endpoint = {key: action for key, action in actions.items() if action.menu == "Endpoint"}

    assert sorted(action.name for action in endpoint.values()) == [
        "Activity by user",
        "Child processes",
        "Connections to IP",
        "Descendant processes",
        "Filename seen on this host",
        "Hash seen anywhere",
        "Parent process",
        "Process activity",
        "Process creations",
        "Process tree",
        "Sibling processes",
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


def test_process_activity_holds_every_event_of_the_process(actions: dict[str, Action]) -> None:
    kql = actions["demo.process-activity"].kql

    legs = set(re.findall(r"(\w+)\(\)\)\s*\| where (\w+) == process", kql))

    assert legs == {
        ("ProcessCreations", "ParentProcessGuid"),
        ("FileCreateTimeChanges", "ProcessGuid"),
        ("NetworkConnections", "ProcessGuid"),
        ("ProcessTerminations", "ProcessGuid"),
        ("RemoteThreads", "SourceProcessGuid"),
        ("FileCreations", "ProcessGuid"),
        ("RegistryEvents", "ProcessGuid"),
        ("FileStreamCreations", "ProcessGuid"),
    }


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


def test_an_alert_pivots_to_every_event_holding_its_files_hash(actions: dict[str, Action]) -> None:
    resolved = resolve_pivot(actions["demo.hash-seen-anywhere"], [ALERT])
    assert (resolved.params, resolved.missing) == (
        {
            "hash": "7A1367EFBA05B09E317909B040C3CDA972544212B4F9DB639237492351A3A405",
            "around": "2018-08-20T10:00:00Z",
        },
        {},
    )


def test_a_row_with_only_an_md5_pivots_on_its_md5(
    actions: dict[str, Action],
) -> None:
    row = PROCESS | {"SHA256": ""}

    resolved = resolve_pivot(actions["demo.hash-seen-anywhere"], [row])

    assert resolved.params["hash"] == "95000560239032BC68B4C2FDFCDEF913"


def test_a_file_creation_pivots_to_every_event_on_its_host_that_names_the_file(
    actions: dict[str, Action], tim_connections: Connections, tim_kusto: FakeKusto
) -> None:
    filename_seen_on_host = actions["demo.filename-seen-on-host"]
    resolved = resolve_pivot(filename_seen_on_host, [FILE_CREATION])
    assert (resolved.params, resolved.missing) == (
        {
            "host": "FYODOR-L",
            "file": "C:\\Windows\\Temp\\hdoor.exe",
            "around": "2018-08-20T10:42:49Z",
        },
        {},
    )
    tim_kusto.respond([])

    run_action(filename_seen_on_host, resolved.params, connections=tim_connections)

    [call] = tim_kusto.calls
    assert call.parameters == {
        "host": "FYODOR-L",
        "file": "C:\\Windows\\Temp\\hdoor.exe",
        "around": "datetime(2018-08-20T10:42:49.0000000Z)",
        "window": "timespan(1.00:00:00)",
    }
    # The file's name, not its path, so a copy elsewhere or a script given to an interpreter counts.
    assert 'let name = tostring(split(file, "\\\\")[-1]);' in call.kql
    assert "CommandLine has name or ParentCommandLine has name" in call.kql


def test_a_row_of_other_activity_pivots_on_the_file_of_its_process(actions: dict[str, Action]) -> None:
    resolved = resolve_pivot(actions["demo.filename-seen-on-host"], [CONNECTION])

    assert resolved.params["file"] == "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"


def test_a_process_pivots_to_what_its_user_did_on_every_host_in_the_hour_around_it(
    actions: dict[str, Action], tim_connections: Connections, tim_kusto: FakeKusto
) -> None:
    by_user = actions["demo.activity-by-user"]
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
    assert set(re.findall(r"\b(\w+)\(\)", call.kql)) == {"ProcessCreations", "NetworkConnections"}
    assert call.kql.endswith("| take 10000\n")


def test_a_child_process_in_process_activity_pivots_to_its_parent(
    actions: dict[str, Action],
) -> None:
    activity = actions["demo.process-activity"]
    child = {
        "Timestamp": "2018-08-20T10:01:44Z",
        "Host": "FYODOR-L",
        "EventType": "ProcessCreate",
        "ProcessGuid": "{EBF7A186-C300-5B58-0000-001007E5CA01}",
        "ParentProcessGuid": "{EBF7A186-C2FD-5B58-0000-00107E5CCA01}",
    }

    resolved = resolve_pivot(actions["demo.parent-process"], [child])

    assert "ProcessCreations()" in activity.kql
    assert resolved.params["parent"] == "{EBF7A186-C2FD-5B58-0000-00107E5CCA01}"


# The params each pivot from a process takes from PROCESS, and the parameters it sends Kusto.
PROCESS_PARAMS = {
    "host": "FYODOR-L",
    "process": "{EBF7A186-C2FD-5B58-0000-00107E5CCA01}",
    "around": "2018-08-20T10:01:41Z",
}
PROCESS_PARAMETERS = {
    "host": "FYODOR-L",
    "process": "{EBF7A186-C2FD-5B58-0000-00107E5CCA01}",
    "around": "datetime(2018-08-20T10:01:41.0000000Z)",
    "window": "timespan(1.00:00:00)",
}
PROCESS_DECLARATION = (
    "declare query_parameters(host: string, process: string, around: datetime, window: timespan);\n"
)
PROCESS_WINDOW = (
    "ProcessCreations()\n"
    "    | where Host == host and Timestamp between ((around - window) .. (around + window));\n"
)


def pivot_from_process(action: Action, connections: Connections, kusto: FakeKusto) -> str:
    """Pivot the action from PROCESS, check the params it took and the parameters it sent, and give its KQL."""
    resolved = resolve_pivot(action, [PROCESS])
    assert (resolved.params, resolved.missing) == (PROCESS_PARAMS, {})
    kusto.respond([])

    run_action(action, resolved.params, connections=connections)

    [call] = kusto.calls
    assert (call.connection, call.database) == ("security", "Security")
    assert call.parameters == PROCESS_PARAMETERS
    assert call.kql.startswith(PROCESS_DECLARATION)
    assert PROCESS_WINDOW in call.kql
    assert call.kql.endswith("| take 10000\n")
    return call.kql


def test_a_process_pivots_to_its_descendants_at_every_depth(
    actions: dict[str, Action], tim_connections: Connections, tim_kusto: FakeKusto
) -> None:
    kql = pivot_from_process(actions["demo.descendant-processes"], tim_connections, tim_kusto)

    assert "| graph-match (root)-[spawned*1..50]->(descendant)\n" in kql
    assert "        where root.ProcessGuid == process\n" in kql
    assert "        project ProcessGuid = descendant.ProcessGuid, Depth = array_length(spawned);\n" in kql


def test_a_process_pivots_to_its_tree_of_up_to_five_generations_above_it(
    actions: dict[str, Action], tim_connections: Connections, tim_kusto: FakeKusto
) -> None:
    kql = pivot_from_process(actions["demo.process-tree"], tim_connections, tim_kusto)

    assert "| graph-match (ancestor)-[spawned*1..5]->(descendant)\n" in kql
    assert "        where descendant.ProcessGuid == process\n" in kql
    assert "        project ProcessGuid = ancestor.ProcessGuid, Depth = array_length(spawned)\n" in kql
    assert "| union (print ProcessGuid = process, Depth = tolong(0));\n" in kql


def test_a_process_pivots_to_the_other_processes_its_parent_started(
    actions: dict[str, Action], tim_connections: Connections, tim_kusto: FakeKusto
) -> None:
    kql = pivot_from_process(actions["demo.sibling-processes"], tim_connections, tim_kusto)

    assert (
        "| where ParentProcessGuid in ((creations | where ProcessGuid == process | distinct ParentProcessGuid))\n"
        "| where ProcessGuid != process\n"
    ) in kql


def test_every_event_of_a_process_pivots_to_its_tree_and_its_relatives(actions: dict[str, Action]) -> None:
    for key in ["demo.descendant-processes", "demo.process-tree", "demo.sibling-processes"]:
        resolved = resolve_pivot(actions[key], [CONNECTION])

        assert (resolved.params["process"], resolved.missing) == (CONNECTION["ProcessGuid"], {}), key
