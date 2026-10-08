#!/usr/bin/env python3
"""Pull request convention checks run by .github/workflows/pr-conventions.yml.

`pr` runs every check that applies to a PR's target branch:
- into `development` (squash-merged): Conventional Commit title, branch name, a breaking
  title's scope naming every package whose files the PR changes, and the release freeze;
- into `main` (merge commit): a title release-please does not read as a commit, head
  `development` or `release-please--*`, every commit subject, Release-As footers per commit,
  and release order;
- `main` into `development` (the back-sync, merge commit): a title release-please does not
  read as a commit.

`commits`, `branch` and `release-as` run single checks.
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
SCOPE = re.compile(r"^\w+\(([^()\s]+)\)!?:")
BREAKING_FOOTER = re.compile(r"^BREAKING[ -]CHANGE:", re.MULTILINE)
# release-please reads every message paragraph that starts like this as a commit.
READ_AS_COMMIT = re.compile(
    r"^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.*?\))?: "
)
RELEASE_AS = re.compile(r"^release-as:[ \t]*\S", re.MULTILINE | re.IGNORECASE)
BRANCH = re.compile(r"^(feat|fix|docs|chore|refactor)/.+")
BRANCH_PREFIXES = ("release-please--", "dependabot/")
RELEASE_BRANCH_PREFIX = "release-please--"
DEVELOPMENT = "development"
MAIN = "main"

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


def scopes_of(subject: str) -> set[str]:
    """The comma-separated scope entries of a subject: 'feat(backend,chart)!: x'."""
    match = SCOPE.match(subject)
    return {s for s in match.group(1).split(",") if s} if match else set()


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


def repo_packages() -> Packages:
    root = Path(git("rev-parse", "--show-toplevel").strip())
    return packages_from_config(root / "release-please-config.json")


def commits_in(base: str, head: str) -> list[str]:
    return git("rev-list", "--no-merges", f"{base}..{head}").split()


def subject_of(sha: str) -> str:
    return git("log", "-1", "--format=%s", sha).strip()


def files_of(sha: str) -> list[str]:
    return git("diff-tree", "--no-commit-id", "--name-only", "-r", sha).splitlines()


def commit_time(rev: str) -> int:
    return int(git("log", "-1", "--format=%ct", rev).strip())


def check_title(title: str) -> list[str]:
    if is_conventional(title):
        return []
    return [
        f"PR title '{title}' is not a Conventional Commit "
        "(type(scope)!: description, e.g. 'feat(web): add export')."
    ]


def check_merge_title(title: str) -> list[str]:
    """A merge commit's message is 'Merge pull request #N from ...' and then the PR title."""
    if READ_AS_COMMIT.match(title) is None:
        return []
    return [
        f"PR title '{title}' becomes the body of the merge commit, and release-please reads it "
        "as a commit with every file of the merge.\n"
        "    Fix: use a title that does not start with a Conventional Commit type, "
        "e.g. 'Release: web export and api fixes'."
    ]


def check_commit_subjects(base: str, head: str) -> list[str]:
    bad = [(sha, subject_of(sha)) for sha in commits_in(base, head)]
    bad = [(sha, subject) for sha, subject in bad if not is_conventional(subject)]
    if not bad:
        return []
    return [
        "\n".join(f"{sha[:7]} {subject}" for sha, subject in bad)
        + "\n    These commits are not Conventional Commits "
        "(type(scope)!: description, e.g. 'feat(web): add export')."
    ]


def check_branch(name: str) -> list[str]:
    if is_valid_branch(name):
        return []
    return [
        f"Branch name '{name}' must be feat/<name>, fix/<name>, docs/<name>, "
        "chore/<name> or refactor/<name> (bots: release-please--*, dependabot/*)."
    ]


def check_release_as(base: str, head: str, packages: Packages) -> list[str]:
    """Each commit as release-please reads it: a Release-As footer needs package files."""
    failures: list[str] = []
    for sha in commits_in(base, head):
        message = git("log", "-1", "--format=%B", sha)
        if release_as(message) and not packages_for_files(files_of(sha), packages):
            failures.append(
                f"{sha[:7]} {message.split(chr(10), 1)[0]}\n"
                "    has a Release-As footer but touches no package files, so it is ignored.\n"
                "    Fix: put the Release-As footer on a commit that changes files of that package."
            )
    return failures


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


def check_release_order(base: str, head: str, packages: Packages) -> list[str]:
    """release-please reads history newest first by commit date and stops at a package's
    last release, so a commit older than that release is never released."""
    last_release: dict[str, int] = {}
    for name, _ in packages.values():
        tags = git("tag", "--merged", base, "--list", f"{name}-v*").split()
        if tags:
            last_release[name] = max(commit_time(tag) for tag in tags)
    failures = []
    for sha in commits_in(base, head):
        late = [
            name
            for name in packages_for_files(files_of(sha), packages)
            if name in last_release and commit_time(sha) < last_release[name]
        ]
        if late:
            failures.append(
                f"{sha[:7]} {subject_of(sha)}\n"
                f"    is older than the last {', '.join(late)} release on {MAIN}, "
                "so release-please will skip it.\n"
                "    It landed on development while a release was pending. Fix: re-land the change "
                "in a new PR into development (revert and re-apply), or accept that it is "
                "missing from the release notes and version."
            )
    return failures


def check_freeze(remote: str, open_release_prs: int) -> list[str]:
    """Nothing lands on development between a development -> main merge and the back-sync.

    Uses the fetched branch tips, not the event's base commit, so a re-run sees the back-sync."""
    ahead = int(git("rev-list", "--count", f"{remote}{DEVELOPMENT}..{remote}{MAIN}").strip())
    if not ahead and not open_release_prs:
        return []
    return [
        f"{DEVELOPMENT} is frozen: "
        + (f"{open_release_prs} release PR(s) are open; " if open_release_prs else "")
        + (f"{MAIN} has {ahead} commit(s) that {DEVELOPMENT} does not; " if ahead else "")
        + f"a commit merged now would be older than the release and release-please would skip "
        f"it.\n    Fix: merge the release PR(s) into {MAIN}; release-please.yml then merges "
        f"{MAIN} into {DEVELOPMENT}. Re-run this check afterwards."
    ]


def check_pr(args: argparse.Namespace) -> list[str]:
    packages = repo_packages()
    release_pr = args.head_ref.startswith(RELEASE_BRANCH_PREFIX)
    sync = args.base_ref == DEVELOPMENT and args.head_ref == MAIN
    if args.base_ref == MAIN or sync:
        failures = [] if release_pr else check_merge_title(args.title)
    else:
        failures = check_title(args.title)
    if args.base_ref == MAIN:
        if args.head_ref != DEVELOPMENT and not release_pr:
            failures.append(
                f"PRs into {MAIN} come from {DEVELOPMENT} or release-please--* only, "
                f"not '{args.head_ref}'. Open the PR against {DEVELOPMENT}."
            )
        failures += check_commit_subjects(args.base, args.head)
        failures += check_release_as(args.base, args.head, packages)
        failures += check_release_order(args.base, args.head, packages)
        return failures
    if sync:
        return failures
    failures += check_branch(args.head_ref)
    failures += check_breaking_scope(args.title, args.base, args.head, packages)
    if args.base_ref == DEVELOPMENT:
        failures += check_freeze(args.remote, args.open_release_prs)
    return failures


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

    p = sub.add_parser("pr", help="run every check for a PR's target branch")
    p.add_argument("base", help="base commit")
    p.add_argument("head", help="head commit")
    p.add_argument("--base-ref", required=True, help="target branch name")
    p.add_argument("--head-ref", required=True, help="source branch name")
    p.add_argument("--title", required=True)
    p.add_argument("--remote", default="origin/", help="prefix of the fetched branch refs")
    p.add_argument("--open-release-prs", type=int, default=0, help="open release-please PRs")
    p.set_defaults(func=lambda a: report(check_pr(a), "OK: all PR checks passed."))

    p = sub.add_parser("commits", help="check commit subjects")
    p.add_argument("base")
    p.add_argument("head")
    p.set_defaults(
        func=lambda a: report(
            check_commit_subjects(a.base, a.head), "All commit subjects are Conventional Commits."
        )
    )

    p = sub.add_parser("branch", help="check the branch name")
    p.add_argument("name")
    p.set_defaults(func=lambda a: report(check_branch(a.name), f"Branch name '{a.name}' is valid."))

    p = sub.add_parser("release-as", help="check Release-As footers per commit")
    p.add_argument("base")
    p.add_argument("head")
    p.set_defaults(
        func=lambda a: report(
            check_release_as(a.base, a.head, repo_packages()),
            "OK: every Release-As footer is on a commit that changes package files.",
        )
    )

    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
