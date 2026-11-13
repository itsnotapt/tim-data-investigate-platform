"""The demo instance's checks over HTTP, which smoke.sh runs once the demo has started.

Two analysts drive the api through the web container, with stub tokens:

- **Alerts:** Alice runs Alerts and finds the Backdoor.PsEmpire alert.
- **Pivot:** she pivots from it to its host's process creations, which have rows with every Sysmon field.
- **Host timeline:** she pivots from it to its host's timeline, which holds the alert and Sysmon events,
  each with a Summary.
- **Process tree:** the stager PowerShell on FYODOR-L pivots to its descendants and siblings, and the
  PowerShell that wrote hdoor.exe pivots to the five generations above it.
- **Annotations:** she labels the alert, and Bob reads her label.
- **Save to Kusto:** she saves the alert twice, and Saved events holds it once, by its EventId,
  saved by her.

Runs on the standard library. ``TIM_DEMO_PORT`` is the web container's port, 8081 by default.
"""

import json
import os
import sys
import time
import urllib.request
from typing import Any, NoReturn

BASE = f"http://127.0.0.1:{os.environ.get('TIM_DEMO_PORT', '8081')}/api"
ALICE = "alice@demo.example"
BOB = "bob@demo.example"
ALERT = "Backdoor.PsEmpire"
LABEL = "malicious"
RUN_TIMEOUT = 120
# The PowerShell stager that the browser started on FYODOR-L, and the PowerShell that wrote hdoor.exe,
# five generations below it.
STAGER = {
    "host": "FYODOR-L",
    "process_guid": "{EBF7A186-C2FD-5B58-0000-00107E5CCA01}",
    "around": "2018-08-20T10:01:41Z",
}
HDOOR_WRITER = {
    "host": "FYODOR-L",
    "process_guid": "{EBF7A186-C442-5B58-0000-00109914D901}",
    "around": "2018-08-20T10:42:49Z",
}


def call(analyst: str, method: str, path: str, body: object = None) -> Any:
    request = urllib.request.Request(  # noqa: S310 - a fixed http address
        BASE + path,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization": f"Bearer dev:{analyst}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
        return json.load(response)


def start_and_wait(analyst: str, action: str, body: dict[str, object]) -> dict[str, Any]:
    """Start a run of the action with ``body``, and give its status once it has succeeded."""
    started = call(analyst, "POST", "/runs", {"action": action, **body})
    deadline = time.monotonic() + RUN_TIMEOUT
    status = started
    while status["status"] == "running":
        if time.monotonic() > deadline:
            fail(f"{action} still runs after {RUN_TIMEOUT} seconds.")
        time.sleep(0.5)
        status = call(analyst, "GET", f"/runs/{started['runId']}")
    if status["status"] != "succeeded":
        fail(f"{action} ended {status['status']}: {status.get('error')}")
    return {**status, "runId": started["runId"]}


def run(analyst: str, action: str, params: dict[str, object]) -> list[dict[str, Any]]:
    """The rows of a run of the action, once it has succeeded."""
    status = start_and_wait(analyst, action, {"params": params})
    rows: list[dict[str, Any]] = []
    while len(rows) < status["rowCount"]:
        page = call(analyst, "GET", f"/runs/{status['runId']}/rows?startRow={len(rows)}")
        if not page["rows"]:
            fail(f"{action} has {status['rowCount']} rows, but its rows stop at {len(rows)}.")
        rows += [row["data"] for row in page["rows"]]
    return rows


def label_of(analyst: str, id_: str) -> dict[str, Any] | None:
    """The label the analyst sees on an ``id``, from the annotation change feed."""
    since, label = 0, None
    while True:
        page = call(analyst, "GET", f"/annotations/changes?since={since}")
        label = next((c["label"] for c in page["changes"] if c["id"] == id_), label)
        if not page["hasMore"]:
            return label
        since = page["next"]


def fail(message: str) -> NoReturn:
    print(f"FAILED: {message}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    alerts = run(ALICE, "demo.alerts", {})
    alert = next((row for row in alerts if row["Alert"] == ALERT), None)
    if alert is None:
        fail(f"Alerts has no {ALERT} alert, in {len(alerts)} rows.")
    print(f"Alerts: {len(alerts)} rows, with {ALERT} on {alert['Host']} at {alert['Timestamp']}.")

    pivot = {"Host": alert["Host"], "Timestamp": alert["Timestamp"]}
    resolved = call(
        ALICE, "POST", "/actions/demo.process-creations/resolve", {"pivot": {"rows": [pivot]}}
    )
    if resolved["missing"]:
        fail(f"The pivot to Process creations misses {resolved['missing']}: {resolved['reasons']}")
    processes = run(ALICE, "demo.process-creations", resolved["params"])
    if not processes:
        fail(f"Process creations on {alert['Host']} around {alert['Timestamp']} has no rows.")
    missing = {"Summary", "LogonGuid", "EventRecordId"} - processes[0].keys()
    if missing:
        fail(f"Process creations' rows have no {sorted(missing)}.")
    print(f"Process creations: {len(processes)} rows on {alert['Host']}.")

    resolved = call(ALICE, "POST", "/actions/demo.host-timeline/resolve", {"pivot": {"rows": [pivot]}})
    timeline = run(ALICE, "demo.host-timeline", resolved["params"])
    types = {row["EventType"] for row in timeline}
    if "Alert" not in types or types == {"Alert"}:
        fail(f"Host timeline on {alert['Host']} holds {sorted(types)}, not the alert and Sysmon events.")
    if any(not row["Summary"] for row in timeline):
        fail("Host timeline has a row without a Summary.")
    print(f"Host timeline: {len(timeline)} rows on {alert['Host']}, of {', '.join(sorted(types))}.")

    check_process_tree()

    call(ALICE, "PATCH", "/annotations", {"ids": [alert["EventId"]], "label": LABEL})
    label = label_of(BOB, alert["EventId"])
    if label is None or label["key"] != LABEL or label["by"] != ALICE:
        fail(f"Bob sees the label {label} on the alert, not {LABEL} by {ALICE}.")
    print(f"Annotations: Bob sees the {LABEL} label {ALICE} set on the alert.")

    columns = [{"name": name, "type": "string"} for name in alert]
    for _ in range(2):
        start_and_wait(ALICE, "demo.save-to-kusto", {"input": {"columns": columns, "rows": [alert]}})
    saved_events = run(ALICE, "demo.saved-events", {})
    saved = [row for row in saved_events if row["EventId"] == alert["EventId"]]
    if len(saved) != 1:
        fail(f"Saved events holds the alert {len(saved)} times, not once.")
    if (saved[0]["SavedBy"], saved[0]["Host"]) != (ALICE, alert["Host"]):
        fail(f"Saved events holds the alert saved by {saved[0]['SavedBy']} on {saved[0]['Host']}.")
    print(f"Save to Kusto: Saved events holds the alert once, saved by {ALICE}.")


def check_process_tree() -> None:
    descendants = run(ALICE, "demo.descendant-processes", STAGER)
    added_user = [row for row in descendants if "user /add svcvnc" in row["CommandLine"]]
    if not added_user or min(row["Depth"] for row in added_user) < 2:
        fail(f"Descendant processes of the stager has no grandchild adding svcvnc: {len(descendants)} rows.")

    tree = run(ALICE, "demo.process-tree", HDOOR_WRITER)
    if [row["Depth"] for row in tree] != [5, 4, 3, 2, 1, 0]:
        fail(f"Process tree of the hdoor.exe writer has the depths {[r['Depth'] for r in tree]}, not 5 to 0.")
    if tree[1]["ProcessGuid"] != STAGER["process_guid"]:
        fail(f"Process tree of the hdoor.exe writer has {tree[1]['ProcessGuid']} at depth 4, not the stager.")

    net = added_user[0]
    siblings = run(
        ALICE,
        "demo.sibling-processes",
        {"host": net["Host"], "process_guid": net["ProcessGuid"], "around": net["Timestamp"]},
    )
    if not siblings or net["ProcessGuid"] in {row["ProcessGuid"] for row in siblings}:
        fail(f"Sibling processes of the svcvnc net.exe has {len(siblings)} rows, or holds the process itself.")
    print(
        f"Process tree: {len(descendants)} descendants of the stager, {len(tree)} processes in the hdoor.exe "
        f"writer's tree, {len(siblings)} siblings of the svcvnc net.exe."
    )


if __name__ == "__main__":
    main()
