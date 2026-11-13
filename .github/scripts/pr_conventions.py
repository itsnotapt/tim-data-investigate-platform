#!/usr/bin/env python3
"""Pull request convention checks run by .github/workflows/pr-conventions.yml.

`pr_conventions.py TITLE` checks that a squash-merged PR's title is a Conventional Commit,
because it becomes the release commit. See docs/RULES.md section 6.
"""

from __future__ import annotations

import argparse
import re
import sys

CONVENTIONAL = re.compile(
    r"^(feat|fix|docs|chore|refactor|test|build|ci|perf|style|revert)(\([^()\s]+\))?!?: \S"
)


def is_conventional(subject: str) -> bool:
    return CONVENTIONAL.match(subject) is not None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("title", help="the PR's title")
    title = parser.parse_args(argv).title
    if is_conventional(title):
        print("OK: the PR title is a Conventional Commit.")
        return 0
    print(
        f"PR title '{title}' is not a Conventional Commit "
        "(type(scope): description, e.g. 'feat(web): add export'). See docs/RULES.md section 6."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
