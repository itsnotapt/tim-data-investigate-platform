#!/usr/bin/env python3
"""Decides whether .github/workflows/demo-smoke.yml boots the demo instance for a PR.

`should-run BASE HEAD --head-ref REF` prints `run=true` or `run=false`, for $GITHUB_OUTPUT, and
logs the reason to stderr. It runs on:

- release-please's release PRs;
- PRs that change the Kusto emulator's image in examples/demo/compose.yaml, compared with the
  PR's branch point;
- PRs that change the smoke test itself.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys

RELEASE_BRANCH = "release-please--"
COMPOSE = "examples/demo/compose.yaml"
# The smoke test's own files.
SMOKE_TEST = [
    ".github/workflows/demo-smoke.yml",
    ".github/scripts/demo_smoke.py",
    "examples/demo/smoke.sh",
    "examples/demo/smoke.py",
]
EMULATOR_IMAGE = re.compile(r"^\s*image:\s*(\S*/kustainer-linux\S*)", re.MULTILINE)


def git(*args: str) -> str:
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout  # noqa: S603, S607


def emulator_at(commit: str) -> str | None:
    """The emulator image the demo's Compose file pins at a commit, ``None`` when there is none."""
    shown = subprocess.run(  # noqa: S603
        ["git", "show", f"{commit}:{COMPOSE}"],  # noqa: S607
        capture_output=True,
        text=True,
    )
    match = EMULATOR_IMAGE.search(shown.stdout) if shown.returncode == 0 else None
    return match.group(1) if match else None


def reason_to_run(base: str, head: str, head_ref: str) -> str | None:
    """Why the PR runs the smoke test, or ``None`` when it doesn't."""
    if head_ref.startswith(RELEASE_BRANCH):
        return f"{head_ref} is a release PR."
    branch_point = git("merge-base", base, head).strip()
    before, after = emulator_at(branch_point), emulator_at(head)
    if before != after:
        return f"The PR changes the emulator from {before} to {after}."
    changed = set(git("diff", "--name-only", f"{branch_point}..{head}").splitlines())
    if smoke_test := [name for name in SMOKE_TEST if name in changed]:
        return f"The PR changes the smoke test: {', '.join(smoke_test)}."
    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("should-run", help="whether the PR runs the demo smoke test")
    p.add_argument("base", help="base commit")
    p.add_argument("head", help="head commit")
    p.add_argument("--head-ref", required=True, help="the PR's branch")
    args = parser.parse_args(argv)

    reason = reason_to_run(args.base, args.head, args.head_ref)
    print(
        reason or "Not a release PR, and the emulator and the smoke test are unchanged.",
        file=sys.stderr,
    )
    print(f"run={'true' if reason else 'false'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
