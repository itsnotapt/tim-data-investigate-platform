"""The demo instance's checks over HTTP, which smoke.sh runs once the demo has started.

Two analysts drive the api through the web container, with stub tokens:

- **Alerts:** Alice runs Alerts and finds the Backdoor.PsEmpire alert.
- **Pivot:** she pivots from it to its host's process creations, which have rows.
- **Annotations:** she labels the alert, and Bob reads her label.

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


def call(analyst: str, method: str, path: str, body: object = None) -> Any:
    request = urllib.request.Request(  # noqa: S310 - a fixed http address
        BASE + path,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization": f"Bearer dev:{analyst}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
        return json.load(response)


def run(analyst: str, action: str, params: dict[str, object]) -> list[dict[str, Any]]:
    """The rows of a run of the action, once it has succeeded."""
    started = call(analyst, "POST", "/runs", {"action": action, "params": params})
    deadline = time.monotonic() + RUN_TIMEOUT
    status = started
    while status["status"] == "running":
        if time.monotonic() > deadline:
            fail(f"{action} still runs after {RUN_TIMEOUT} seconds.")
        time.sleep(0.5)
        status = call(analyst, "GET", f"/runs/{started['runId']}")
    if status["status"] != "succeeded":
        fail(f"{action} ended {status['status']}: {status.get('error')}")
    rows: list[dict[str, Any]] = []
    while len(rows) < status["rowCount"]:
        page = call(analyst, "GET", f"/runs/{started['runId']}/rows?startRow={len(rows)}")
        if not page["rows"]:
            fail(f"{action} has {status['rowCount']} rows, but its rows stop at {len(rows)}.")
        rows += [row["data"] for row in page["rows"]]
    return rows


def label_of(analyst: str, event_id: str) -> dict[str, Any] | None:
    """The label the analyst sees on an id, from the annotation change feed."""
    since, label = 0, None
    while True:
        page = call(analyst, "GET", f"/annotations/changes?since={since}")
        label = next((c["label"] for c in page["changes"] if c["id"] == event_id), label)
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
    print(f"Process creations: {len(processes)} rows on {alert['Host']}.")

    call(ALICE, "PATCH", "/annotations", {"ids": [alert["EventId"]], "label": LABEL})
    label = label_of(BOB, alert["EventId"])
    if label is None or label["key"] != LABEL or label["by"] != ALICE:
        fail(f"Bob sees the label {label} on the alert, not {LABEL} by {ALICE}.")
    print(f"Annotations: Bob sees the {LABEL} label {ALICE} set on the alert.")


if __name__ == "__main__":
    main()
