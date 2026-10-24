#!/usr/bin/env python3
"""The tracking issue for the full e2e suite on main, run by .github/workflows/build-web.yml.

`RESULT --sha SHA --message MESSAGE --run-id ID --run-url URL` takes the e2e job's result
(success or failure) on a push to main. One open issue titled TITLE tracks a failing suite:
- a failure opens it, or comments on it when it is already open;
- a pass comments on it and closes it.

See docs/development.md#ci-and-releases.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from typing import Literal

TITLE = "Full e2e failing on main"
LABELS = ["bug", "needs-triage"]
PR_NUMBER = re.compile(r"\(#(\d+)\)$")


@dataclass(frozen=True)
class Run:
    sha: str
    message: str
    run_id: str
    run_url: str


@dataclass(frozen=True)
class Plan:
    action: Literal["open", "comment", "close", "none"]
    number: int | None
    body: str


def _source(run: Run) -> str:
    """The commit, and the PR its subject line names: 'sha (#N)'."""
    pr = PR_NUMBER.search(run.message.split("\n", 1)[0])
    return f"{run.sha} (#{pr.group(1)})" if pr else run.sha


def _failure_body(run: Run) -> str:
    return (
        f"The full e2e job failed on main at {_source(run)}.\n\n"
        f"- Run: {run.run_url}, with the `playwright-report` artifact.\n"
        f"- Failures: `gh run view {run.run_id} --log-failed`."
    )


def _tracking_issue(open_issues: list[dict[str, object]]) -> int | None:
    for issue in open_issues:
        if issue["title"] == TITLE:
            return int(str(issue["number"]))
    return None


def plan(result: str, open_issues: list[dict[str, object]], run: Run) -> Plan:
    """What the run does to the tracking issue, given the repo's open issues."""
    number = _tracking_issue(open_issues)
    if result == "success":
        if number is None:
            return Plan("none", None, "")
        return Plan(
            "close", number, f"The full e2e suite passed on main at {_source(run)}: {run.run_url}"
        )
    if number is None:
        return Plan("open", None, _failure_body(run))
    return Plan("comment", number, _failure_body(run))


def gh(*args: str) -> str:
    return subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout  # noqa: S603, S607


def open_issues() -> list[dict[str, object]]:
    out = gh("issue", "list", "--state", "open", "--limit", "1000", "--json", "number,title")
    issues: list[dict[str, object]] = json.loads(out)
    return issues


def apply(step: Plan) -> None:
    if step.action == "open":
        label_args = [arg for label in LABELS for arg in ("--label", label)]
        print(gh("issue", "create", "--title", TITLE, "--body", step.body, *label_args), end="")
    elif step.action == "comment":
        print(gh("issue", "comment", str(step.number), "--body", step.body), end="")
    elif step.action == "close":
        gh("issue", "close", str(step.number), "--comment", step.body)
        print(f"Closed #{step.number}.")
    else:
        print("The full e2e suite passed and no tracking issue is open.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("result", choices=["success", "failure"], help="the e2e job's result")
    parser.add_argument("--sha", required=True)
    parser.add_argument("--message", required=True, help="the commit message")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--run-url", required=True)
    args = parser.parse_args(argv)

    run = Run(args.sha, args.message, args.run_id, args.run_url)
    apply(plan(args.result, open_issues(), run))
    return 0


if __name__ == "__main__":
    sys.exit(main())
