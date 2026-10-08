#!/usr/bin/env python3
"""Pull request convention checks run by .github/workflows/pr-conventions.yml.

Subcommands: commits (Conventional Commit subjects), branch (branch name) and
breaking (breaking changes and Release-As footers against release-please packages).
See docs/RULES.md and docs/decisions/0016-release-versions.md.
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
BREAKING_FOOTER = re.compile(r"^BREAKING[ -]CHANGE:", re.MULTILINE)
RELEASE_AS = re.compile(r"^release-as:[ \t]*\S", re.MULTILINE | re.IGNORECASE)
BRANCH = re.compile(r"^(feat|fix|docs|chore|refactor)/.+")
BRANCH_PREFIXES = ("release-please--", "dependabot/")

Packages = dict[str, tuple[str, list[str]]]  # path -> (package name, exclude paths)


def is_conventional(subject: str) -> bool:
    return CONVENTIONAL.match(subject) is not None


def is_valid_branch(name: str) -> bool:
    return BRANCH.match(name) is not None or name.startswith(BRANCH_PREFIXES)


def is_breaking(message: str) -> bool:
    subject = message.split("\n", 1)[0]
    return (
        BREAKING_SUBJECT.match(subject) is not None or BREAKING_FOOTER.search(message) is not None
    )


def release_as(message: str) -> bool:
    return RELEASE_AS.search(message) is not None


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


def commits_in(base: str, head: str) -> list[str]:
    return git("rev-list", "--no-merges", f"{base}..{head}").split()


def subject_of(sha: str) -> str:
    return git("log", "-1", "--format=%s", sha).strip()


def cmd_commits(args: argparse.Namespace) -> int:
    bad = [(sha, subject_of(sha)) for sha in commits_in(args.base, args.head)]
    bad = [(sha, subject) for sha, subject in bad if not is_conventional(subject)]
    for sha, subject in bad:
        print(f"{sha[:7]} {subject}")
    if bad:
        print(
            "\nThese commits are not Conventional Commits "
            "(type(scope)!: description, e.g. 'feat(web): add export'). "
            "Reword them (git rebase -i; not a squash) and force-push."
        )
        return 1
    print("All commit subjects are Conventional Commits.")
    return 0


def cmd_branch(args: argparse.Namespace) -> int:
    if is_valid_branch(args.name):
        print(f"Branch name '{args.name}' is valid.")
        return 0
    print(
        f"Branch name '{args.name}' must be feat/<name>, fix/<name>, docs/<name>, "
        "chore/<name> or refactor/<name> (bots: release-please--*, dependabot/*)."
    )
    return 1


def cmd_breaking(args: argparse.Namespace) -> int:
    labels = set(json.loads(args.labels))
    packages = packages_from_config(
        Path(git("rev-parse", "--show-toplevel").strip()) / "release-please-config.json"
    )
    failures: list[str] = []
    checked = 0
    for sha in commits_in(args.base, args.head):
        message = git("log", "-1", "--format=%B", sha)
        subject = message.split("\n", 1)[0]
        wants_release = is_breaking(message) or release_as(message)
        if not wants_release:
            continue
        checked += 1
        files = git("diff-tree", "--no-commit-id", "--name-only", "-r", sha).splitlines()
        touched = packages_for_files(files, packages)
        if release_as(message) and not touched:
            failures.append(
                f"{sha[:7]} {subject}\n"
                "    has a Release-As footer but touches no package files, so it is ignored.\n"
                "    Fix: put the Release-As footer on a commit that changes files of that package."
            )
        if is_breaking(message):
            for name in touched:
                label = f"release:major-{name}"
                if label not in labels:
                    failures.append(
                        f"{sha[:7]} {subject}\n"
                        f"    is breaking and touches package '{name}'; the PR needs '{label}'.\n"
                        f"    Fix: add the label, or move the breaking change out of {name}."
                    )
    if failures:
        print("\n\n".join(failures))
        print(f"\nFAILED: {len(failures)} problem(s) in {checked} breaking/Release-As commit(s).")
        return 1
    print(f"OK: {checked} breaking/Release-As commit(s) checked, all required labels present.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("commits", help="check commit subjects")
    p.add_argument("base")
    p.add_argument("head")
    p.set_defaults(func=cmd_commits)

    p = sub.add_parser("branch", help="check the branch name")
    p.add_argument("name")
    p.set_defaults(func=cmd_branch)

    p = sub.add_parser("breaking", help="check breaking changes and Release-As footers")
    p.add_argument("base")
    p.add_argument("head")
    p.add_argument("--labels", default="[]", help="PR label names as a JSON array")
    p.set_defaults(func=cmd_breaking)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
