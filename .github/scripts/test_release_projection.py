"""Tests for release_projection.py."""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import release_projection as rp

SCRIPT = Path(__file__).resolve().parent / "release_projection.py"
ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "release-please-config.json"
CURRENT = {"frontend": "1.5.6", "backend": "3.0.4", "chart": "0.1.0"}


def dry_run(*releases: tuple[str, str]) -> str:
    """Shaped like `release-please release-pr --dry-run` output (17.6.0)."""
    if not releases:
        return "✔ Building pull requests\nWould open 0 pull requests\n"
    details = "\n\n".join(
        f"<details><summary>{name}: {version}</summary>\n\n## [{version}](...)\n</details>"
        for name, version in releases
    )
    return (
        "\u276f Fetching release-please-config.json from branch development\n"
        "✔ Merging 3 pull requests\nWould open 1 pull requests\nfork: false\n"
        "title: chore: release development\nbranch: release-please--branches--development\n"
        f"body: :robot: I have created a release *beep* *boop*\n---\n\n\n{details}\n\n---\n"
        "updates: 19\n✔ updating from 1.5.6 to 1.6.0\n"
    )


class Parse(unittest.TestCase):
    def test_projected_versions(self):
        out = dry_run(("frontend", "1.6.0"), ("backend", "4.0.0"), ("chart", "1.0.0"))
        self.assertEqual(
            rp.projected_versions(out), {"frontend": "1.6.0", "backend": "4.0.0", "chart": "1.0.0"}
        )

    def test_no_release(self):
        self.assertEqual(rp.projected_versions(dry_run()), {})

    def test_unfinished_dry_run(self):
        self.assertIsNone(rp.projected_versions("✖ Error: Bad credentials\n"))

    def test_current_versions_follow_the_config(self):
        current = rp.current_versions(CONFIG, ROOT / ".release-please-manifest.json")
        self.assertEqual(list(current), ["frontend", "backend", "chart"])


class Comment(unittest.TestCase):
    def test_every_package_releases(self):
        projected = {"frontend": "1.6.0", "backend": "4.0.0", "chart": "1.0.0"}
        text = rp.comment(CURRENT, projected, "src")
        self.assertTrue(text.startswith(rp.MARKER))
        self.assertIn("- frontend 1.5.6 → **1.6.0**", text)
        self.assertIn("- backend 3.0.4 → **4.0.0**", text)
        self.assertIn("- chart 0.1.0 → **1.0.0**", text)
        self.assertNotIn("No release", text)
        self.assertNotIn("patch release", text)

    def test_component_release_notes_the_chart_patch(self):
        text = rp.comment(CURRENT, {"frontend": "1.5.7"}, "src")
        self.assertIn("No release: backend, chart.", text)
        self.assertIn("chart then gets a patch release in the next release PR", text)

    def test_chart_only_release(self):
        text = rp.comment(CURRENT, {"chart": "0.2.0"}, "src")
        self.assertIn("No release: frontend, backend.", text)
        self.assertNotIn("patch release", text)

    def test_nothing_releases(self):
        text = rp.comment(CURRENT, {}, "src")
        self.assertIn("would propose no release", text)
        self.assertIn("No release: frontend, backend, chart.", text)

    def test_unfinished_dry_run(self):
        text = rp.comment(CURRENT, None, "src")
        self.assertTrue(text.startswith(rp.MARKER))
        self.assertIn("did not finish", text)


class Cli(unittest.TestCase):
    def run_cli(self, output: str | None) -> subprocess.CompletedProcess[str]:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = Path(tmp.name) / "dry-run.txt"
        if output is not None:
            path.write_text(output)
        manifest = Path(tmp.name) / "manifest.json"
        manifest.write_text(
            json.dumps({"web": "1.5.6", "api": "3.0.4", "deploy/helm/tim": "0.1.0"})
        )
        return subprocess.run(  # noqa: S603
            [
                sys.executable,
                str(SCRIPT),
                str(path),
                "--config",
                str(CONFIG),
                "--manifest",
                str(manifest),
                "--source",
                "release-please 17.6.0",
            ],
            capture_output=True,
            text=True,
            check=False,
        )

    def test_prints_the_comment(self):
        result = self.run_cli(dry_run(("frontend", "1.6.0"), ("backend", "4.0.0")))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("- backend 3.0.4 → **4.0.0**", result.stdout)
        self.assertIn("No release: chart.", result.stdout)
        self.assertIn("release-please 17.6.0", result.stdout)

    def test_missing_output_never_fails(self):
        result = self.run_cli(None)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("did not finish", result.stdout)


if __name__ == "__main__":
    unittest.main()
