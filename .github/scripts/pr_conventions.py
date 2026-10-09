#!/usr/bin/env python3
"""Pull request convention checks run by .github/workflows/pr-conventions.yml.

`pr BASE HEAD --title TITLE` checks a squash-merged PR into main:
- the title is a Conventional Commit, because it becomes the release commit;
- a breaking title's scope names every package whose files the PR changes.

See docs/RULES.md and docs/adr/0016-release-versions.md.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

CONVENTIONAL = re.compile(
    r"^(feat|fix|docs|chore|refactor|test|build|ci|perf|style|revert)(\([^()\s]+\))?!?: \S"
)
BREAKING_SUBJECT = re.compile(r"^\w+(\([^()\s]+\))?!:")
SCOPE = re.compile(r"^\w+\(([^()\s]+)\)!?:")
BREAKING_FOOTER = re.compile(r"^BREAKING[ -]CHANGE:", re.MULTILINE)

Packages = dict[str, tuple[str, list[str]]]  # path -> (package name, exclude paths)


def is_conventional(subject: str) -> bool:
    return CONVENTIONAL.match(subject) is not None


def is_breaking(message: str) -> bool:
    subject = message.split("\n", 1)[0]
    return (
        BREAKING_SUBJECT.match(subject) is not None or BREAKING_FOOTER.search(message) is not None
    )


def scopes_of(subject: str) -> set[str]:
    """The comma-separated scope entries of a subject: 'feat(backend,chart)!: x'."""
    match = SCOPE.match(subject)
    return {s for s in match.group(1).split(",") if s} if match else set()


def packages_from_config(path: str | Path) -> Packages:
    config = json.loads(Path(path).read_text())
    return {
        pkg_path.strip("/"): (
            settings["package-name"],
            [e.strip("/") for e in settings.get("exclude-paths", [])],
        )
        for pkg_path, settings in config["packages"].items()
    }


def _under(file: str, directory: str) -> bool:
    return file == directory or file.startswith(directory + "/")


def packages_for_files(files: list[str], packages: Packages) -> list[str]:
    """Names of the packages that any of the files belongs to, in config order."""
    touched = []
    for pkg_path, (name, excludes) in packages.items():
        if any(
            file.startswith(pkg_path + "/") and not any(_under(file, e) for e in excludes)
            for file in files
        ):
            touched.append(name)
    return touched


def git(*args: str) -> str:
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout  # noqa: S603, S607


def repo_packages() -> Packages:
    root = Path(git("rev-parse", "--show-toplevel").strip())
    return packages_from_config(root / "release-please-config.json")


def check_title(title: str) -> list[str]:
    if is_conventional(title):
        return []
    return [
        f"PR title '{title}' is not a Conventional Commit "
        "(type(scope)!: description, e.g. 'feat(web): add export')."
    ]


def check_breaking_scope(title: str, base: str, head: str, packages: Packages) -> list[str]:
    """The PR as its squash commit: a breaking title majors every package the PR changes, so
    its scope must name each of them. Other scope entries are allowed."""
    if not is_breaking(title):
        return []
    files = git("diff", "--name-only", f"{base}...{head}").splitlines()
    missing = [p for p in packages_for_files(files, packages) if p not in scopes_of(title)]
    if not missing:
        return []
    return [
        f"PR title '{title}' is breaking and the PR changes files of "
        f"{', '.join(missing)}, which its scope does not name.\n"
        "    A breaking title majors every package whose files the PR changes.\n"
        "    Fix: name each package in the scope, e.g. 'feat(backend,chart)!: ...', or move "
        "the changes to packages that should not go major into another PR."
    ]


def check_pr(args: argparse.Namespace) -> list[str]:
    return check_title(args.title) + check_breaking_scope(
        args.title, args.base, args.head, repo_packages()
    )


def report(failures: list[str], ok: str) -> int:
    if failures:
        print("\n\n".join(failures))
        print(f"\nFAILED: {len(failures)} problem(s). See docs/RULES.md sections 6 and 7.")
        return 1
    print(ok)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("pr", help="check a PR's title and breaking scope")
    p.add_argument("base", help="base commit")
    p.add_argument("head", help="head commit")
    p.add_argument("--title", required=True)
    p.set_defaults(func=lambda a: report(check_pr(a), "OK: all PR checks passed."))

    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
