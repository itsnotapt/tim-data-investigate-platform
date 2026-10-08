#!/usr/bin/env python3
"""Release projection comment for a development -> main PR, posted by
.github/workflows/pr-conventions.yml (job release-projection).

Reads the output of `release-please release-pr --dry-run --target-branch development` and prints
a Markdown comment with the versions release-please would propose once the PR is merged.
See docs/RULES.md section 7 and docs/decisions/0016-release-versions.md.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

MARKER = "<!-- release-projection -->"
WOULD_OPEN = re.compile(r"^Would open (\d+) pull requests?$", re.MULTILINE)
# The merged release PR body has one <details> block per package release.
RELEASE = re.compile(r"<summary>([^:<]+): ([^<\s]+)</summary>")
# A frontend or backend release changes deploy/helm/tim/image-tags.yaml, so the next release PR
# releases a chart patch.
FOLLOW_UP = {"chart": ("frontend", "backend")}


def projected_versions(dry_run_output: str) -> dict[str, str] | None:
    """Package name -> proposed version; None if the dry-run did not finish."""
    if WOULD_OPEN.search(dry_run_output) is None:
        return None
    return dict(RELEASE.findall(dry_run_output))


def current_versions(config_path: Path, manifest_path: Path) -> dict[str, str]:
    """Package name -> version in the manifest, in config order."""
    config = json.loads(config_path.read_text())
    manifest = json.loads(manifest_path.read_text())
    return {
        settings["package-name"]: manifest.get(path, "unreleased")
        for path, settings in config["packages"].items()
    }


def comment(current: dict[str, str], projected: dict[str, str] | None, source: str) -> str:
    lines = [MARKER, "### Release projection", ""]
    if projected is None:
        lines += [
            "The release-please dry-run did not finish, so there is no projection. "
            "See the `release-projection` job log.",
        ]
    else:
        released = [name for name in current if name in projected]
        unreleased = [name for name in current if name not in projected]
        if released:
            lines += ["After this PR is merged, release-please would propose:", ""]
            lines += [f"- {name} {current[name]} → **{projected[name]}**" for name in released]
        else:
            lines += ["After this PR is merged, release-please would propose no release."]
        if unreleased:
            lines += ["", "No release: " + ", ".join(unreleased) + "."]
        for name, triggers in FOLLOW_UP.items():
            if name in unreleased and any(t in released for t in triggers):
                lines += [
                    "",
                    f"{name} then gets a patch release in the next release PR, "
                    "which pins the new image tags.",
                ]
    lines += [
        "",
        f"<sub>{source}. Informational only; this check never fails. "
        "See docs/RULES.md section 7.</sub>",
    ]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dry_run_output", type=Path, help="stdout of the release-please dry-run")
    parser.add_argument("--config", type=Path, default=Path("release-please-config.json"))
    parser.add_argument("--manifest", type=Path, default=Path(".release-please-manifest.json"))
    parser.add_argument("--source", default="release-please dry-run", help="footer text")
    args = parser.parse_args(argv)
    output = args.dry_run_output.read_text() if args.dry_run_output.exists() else ""
    current = current_versions(args.config, args.manifest)
    sys.stdout.write(comment(current, projected_versions(output), args.source))
    return 0


if __name__ == "__main__":
    sys.exit(main())
