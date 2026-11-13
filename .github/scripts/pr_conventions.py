#!/usr/bin/env python3
"""Pull request convention checks run by .github/workflows/pr-conventions.yml.

`pr BASE HEAD --title TITLE --labels LABELS` checks a squash-merged PR into main:
- the title is a Conventional Commit, because it becomes the release commit;
- a breaking title's scope names `tim-actions` when the PR changes its files;
- a breaking title that releases TIM carries the `major-release` label, because it majors TIM.

`release BASE HEAD --labels LABELS` checks release-please's release PR: a package whose major
version goes up carries the `major-release` label. It catches a major from any commit, such as a
`BREAKING CHANGE:` footer written into a squash body at merge.

See docs/RULES.md and docs/adr/0024-one-release-version.md.
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

MAJOR_RELEASE_LABEL = "major-release"
MANIFEST = ".release-please-manifest.json"


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


def all_packages_from_config(path: str | Path) -> Packages:
    """Every package, the root package (`.`, TIM) included."""
    config = json.loads(Path(path).read_text())
    return {
        pkg_path.strip("/") or ".": (
            settings["package-name"],
            [e.strip("/") for e in settings.get("exclude-paths", [])],
        )
        for pkg_path, settings in config["packages"].items()
    }


def packages_from_config(path: str | Path) -> Packages:
    """The packages below the root. A breaking title always majors the root package, TIM, so
    only these need naming."""
    return {p: v for p, v in all_packages_from_config(path).items() if p != "."}


def releases_root(files: list[str], root_excludes: list[str]) -> bool:
    """Whether a commit of `files` releases the root package: a file outside its exclude paths."""
    return any(not any(_under(file, e) for e in root_excludes) for file in files)


def labels_of(labels: str) -> set[str]:
    """The PR's labels, given comma-separated."""
    return {label.strip() for label in labels.split(",") if label.strip()}


def major_of(version: str) -> int:
    return int(version.split(".", 1)[0])


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


def repo_config() -> Path:
    return Path(git("rev-parse", "--show-toplevel").strip()) / "release-please-config.json"


def repo_packages() -> Packages:
    return packages_from_config(repo_config())


def check_title(title: str) -> list[str]:
    if is_conventional(title):
        return []
    return [
        f"PR title '{title}' is not a Conventional Commit "
        "(type(scope)!: description, e.g. 'feat(web): add export')."
    ]


def check_breaking_scope(title: str, base: str, head: str, packages: Packages) -> list[str]:
    """The PR as its squash commit: a breaking title makes a breaking release of every package the PR changes, so
    its scope must name each one below the root. Other scope entries are allowed."""
    if not is_breaking(title):
        return []
    files = git("diff", "--name-only", f"{base}...{head}").splitlines()
    missing = [p for p in packages_for_files(files, packages) if p not in scopes_of(title)]
    if not missing:
        return []
    return [
        f"PR title '{title}' is breaking and the PR changes files of "
        f"{', '.join(missing)}, which its scope does not name.\n"
        "    A breaking title makes a breaking release of every package whose files the PR changes.\n"
        "    Fix: name each package in the scope, e.g. 'feat(api,tim-actions)!: ...', or move "
        "the changes to packages that should not break into another PR."
    ]


def check_major_label(title: str, base: str, head: str, labels: set[str]) -> list[str]:
    """A breaking title majors TIM when the PR releases it, which only a deliberate major does."""
    if not is_breaking(title) or MAJOR_RELEASE_LABEL in labels:
        return []
    files = git("diff", "--name-only", f"{base}...{head}").splitlines()
    _, root_excludes = all_packages_from_config(repo_config())["."]
    if not releases_root(files, root_excludes):
        return []
    return [
        f"PR title '{title}' is breaking, so merging it makes a major release of TIM.\n"
        "    A major release is deliberate and rare (docs/RULES.md section 7).\n"
        f"    Fix: drop the '!' and say what breaks in the title, or add the "
        f"'{MAJOR_RELEASE_LABEL}' label if this PR makes the major."
    ]


def check_pr(args: argparse.Namespace) -> list[str]:
    return (
        check_title(args.title)
        + check_breaking_scope(args.title, args.base, args.head, repo_packages())
        + check_major_label(args.title, args.base, args.head, labels_of(args.labels))
    )


def manifest_at(commit: str) -> dict[str, str]:
    return dict(json.loads(git("show", f"{commit}:{MANIFEST}")))


def check_release(args: argparse.Namespace) -> list[str]:
    """Each package the release PR moves to a new major needs the major-release label."""
    if MAJOR_RELEASE_LABEL in labels_of(args.labels):
        return []
    before, after = manifest_at(args.base), manifest_at(args.head)
    names = {path: name for path, (name, _) in all_packages_from_config(repo_config()).items()}
    failures = []
    for path, version in after.items():
        old = before.get(path)
        if old is None or major_of(version) <= major_of(old):
            continue
        minor = f"{major_of(old)}.{int(old.split('.')[1]) + 1}.0"
        failures.append(
            f"The release PR makes a major release: {names.get(path, path)} {old} -> {version}.\n"
            "    A major release is deliberate and rare (docs/RULES.md section 7).\n"
            f"    Fix: if it is deliberate, add the '{MAJOR_RELEASE_LABEL}' label. If not, set "
            f'"release-as": "{minor}" on package "{path}" in release-please-config.json in a '
            "PR, and remove it in the PR after the release."
        )
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

    p = sub.add_parser("pr", help="check a PR's title and breaking scope")
    p.add_argument("base", help="base commit")
    p.add_argument("head", help="head commit")
    p.add_argument("--title", required=True)
    p.add_argument("--labels", default="", help="the PR's labels, comma-separated")
    p.set_defaults(func=lambda a: report(check_pr(a), "OK: all PR checks passed."))

    r = sub.add_parser("release", help="check a release PR's versions")
    r.add_argument("base", help="base commit")
    r.add_argument("head", help="head commit")
    r.add_argument("--labels", default="", help="the PR's labels, comma-separated")
    r.set_defaults(func=lambda a: report(check_release(a), "OK: the release makes no major."))

    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
