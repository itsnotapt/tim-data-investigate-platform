"""Tests for demo_smoke.py: the CLI against temporary git repos."""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import demo_smoke

SCRIPT = Path(__file__).resolve().parent / "demo_smoke.py"
WORKFLOW = Path(__file__).resolve().parents[1] / "workflows" / "demo-smoke.yml"
COMPOSE = "examples/demo/compose.yaml"
EMULATOR = "mcr.microsoft.com/azuredataexplorer/kustainer-linux"
TIM = "ghcr.io/itsnotapt/tim-data-investigate-platform"


def compose(emulator_tag, tim_version="2.0.0"):
    return f"""name: tim-demo
services:
  kusto:
    image: {EMULATOR}:{emulator_tag}@sha256:{emulator_tag[:1] * 64}
  postgres:
    image: postgres:17-alpine@sha256:{"0" * 64}
  migrate:
    image: {TIM}/api:{tim_version} # x-release-please-version
"""


class Workflow(unittest.TestCase):
    def test_its_paths_filter_lets_through_every_file_that_runs_it(self):
        paths = {
            line.strip().removeprefix("- ")
            for line in WORKFLOW.read_text().splitlines()
            if line.startswith("      - ")
        }
        for name in [demo_smoke.COMPOSE, *demo_smoke.SMOKE_TEST]:
            self.assertIn(name, paths)


class ShouldRun(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.com")
        self.git("config", "commit.gpgsign", "false")
        self.write(COMPOSE, compose("2026.10.29"))
        self.write("api/src/a.py", "x\n")
        self.git("add", ".")
        self.git("commit", "-q", "-m", "chore: init")
        self.base = self.git("rev-parse", "HEAD").strip()
        self.git("checkout", "-q", "-b", "feat/x")

    def git(self, *args):
        return subprocess.run(  # noqa: S603
            ["git", *args],  # noqa: S607
            cwd=self.repo,
            check=True,
            capture_output=True,
            text=True,
        ).stdout

    def write(self, name, text):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def commit(self, files):
        for name, text in files.items():
            self.write(name, text)
        self.git("add", ".")
        self.git("commit", "-q", "-m", "change")

    def should_run(self, head_ref="feat/x"):
        """The job's output line, and the log, which says why."""
        result = subprocess.run(  # noqa: S603
            [sys.executable, str(SCRIPT), "should-run", self.base, "HEAD", "--head-ref", head_ref],
            cwd=self.repo,
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout, result.stderr

    def test_a_release_pr_runs_it(self):
        self.commit({COMPOSE: compose("2026.10.29", tim_version="2.1.0")})
        out, log = self.should_run("release-please--branches--main--components--tim")
        self.assertEqual(out, "run=true\n", log)
        self.assertIn("release PR", log)

    def test_a_pr_that_bumps_the_emulator_runs_it(self):
        self.commit({COMPOSE: compose("2026.11.26")})
        out, log = self.should_run("dependabot/docker_compose/examples/demo/demo-compose-1a2b3c")
        self.assertEqual(out, "run=true\n", log)
        self.assertIn(f"{EMULATOR}:2026.11.26", log)

    def test_a_pr_that_changes_the_compose_file_but_not_the_emulator_does_not(self):
        self.commit({COMPOSE: compose("2026.10.29").replace("0" * 64, "1" * 64)})
        out, log = self.should_run()
        self.assertEqual(out, "run=false\n", log)

    def test_the_emulator_is_compared_with_the_branch_point(self):
        self.commit({"api/src/a.py": "y\n"})
        self.git("checkout", "-q", "main")
        self.commit({COMPOSE: compose("2026.11.26")})
        self.git("checkout", "-q", "feat/x")
        # The PR's base is the new main tip, which bumped the emulator since the branch point.
        self.base = self.git("rev-parse", "main").strip()
        out, log = self.should_run()
        self.assertEqual(out, "run=false\n", log)

    def test_a_pr_that_changes_the_smoke_test_runs_it(self):
        for name in [
            ".github/workflows/demo-smoke.yml",
            ".github/scripts/demo_smoke.py",
            "examples/demo/smoke.sh",
            "examples/demo/smoke.py",
        ]:
            with self.subTest(name):
                self.commit({name: f"{name}\n"})
                out, log = self.should_run()
                self.assertEqual(out, "run=true\n", log)
                self.assertIn(name, log)
                self.git("reset", "-q", "--hard", self.base)

    def test_a_pr_that_changes_other_files_does_not(self):
        self.commit({"api/src/a.py": "y\n"})
        out, log = self.should_run()
        self.assertEqual(out, "run=false\n", log)


if __name__ == "__main__":
    unittest.main()
