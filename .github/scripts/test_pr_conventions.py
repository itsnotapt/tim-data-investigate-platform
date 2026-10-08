"""Tests for pr_conventions.py: pure functions plus the CLI against temporary git repos."""

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import pr_conventions as pc

SCRIPT = Path(__file__).resolve().parent / "pr_conventions.py"
CONFIG = Path(__file__).resolve().parents[2] / "release-please-config.json"


class PureFunctions(unittest.TestCase):
    def test_conventional_subjects(self):
        for ok in [
            "feat: x",
            "fix(web): y",
            "feat(api)!: z",
            "chore(main): release frontend 1.6.0",
        ]:
            self.assertTrue(pc.is_conventional(ok), ok)
        for bad in [
            "Update stuff",
            "feat:x",
            "feat: ",
            "feature: x",
            "feat(a b): x",
            "Merge branch 'x'",
        ]:
            self.assertFalse(pc.is_conventional(bad), bad)

    def test_branch_names(self):
        for ok in [
            "feat/x",
            "fix/a-b",
            "release-please--branches--main--components--frontend",
            "dependabot/npm_and_yarn/x",
        ]:
            self.assertTrue(pc.is_valid_branch(ok), ok)
        for bad in ["rewrite-v4", "main", "feat/", "feature/x"]:
            self.assertFalse(pc.is_valid_branch(bad), bad)

    def test_is_breaking(self):
        self.assertTrue(pc.is_breaking("feat!: x"))
        self.assertTrue(pc.is_breaking("feat(web)!: x\n\nbody"))
        self.assertTrue(pc.is_breaking("feat: x\n\nBREAKING CHANGE: gone"))
        self.assertTrue(pc.is_breaking("feat: x\n\nBREAKING-CHANGE: gone"))
        self.assertFalse(pc.is_breaking("feat: x\n\nmentions BREAKING CHANGE: inline"))
        self.assertFalse(pc.is_breaking("feat: add! bang"))

    def test_release_as(self):
        self.assertTrue(pc.release_as("chore: x\n\nRelease-As: 2.0.0"))
        self.assertTrue(pc.release_as("chore: x\n\nrelease-as: 2.0.0"))
        self.assertFalse(pc.release_as("chore: x\n\nno footer"))

    def test_packages(self):
        packages = pc.packages_from_config(CONFIG)
        self.assertEqual(packages["web"], ("frontend", ["web/e2e"]))
        self.assertEqual(packages["api"][0], "backend")
        self.assertEqual(packages["deploy/helm/tim"][0], "chart")
        files = [
            "web/src/a.ts",
            "web/e2e/t.ts",
            "api/tests/t.py",
            "deploy/helm/tim/ci/v.yaml",
            "README.md",
        ]
        self.assertEqual(pc.packages_for_files(files, packages), ["frontend"])
        self.assertEqual(pc.packages_for_files(files[1:], packages), [])
        self.assertEqual(
            pc.packages_for_files(
                ["web/package.json", "deploy/helm/tim/image-tags.yaml"], packages
            ),
            ["frontend", "chart"],
        )
        self.assertEqual(pc.packages_for_files(["webx/a.ts"], packages), [])


class RepoCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.com")
        self.git("config", "commit.gpgsign", "false")
        shutil.copy(CONFIG, self.repo / "release-please-config.json")
        self.git("add", ".")
        self.git("commit", "-q", "-m", "chore: init")
        self.base = self.git("rev-parse", "HEAD").strip()

    def git(self, *args):
        return subprocess.run(  # noqa: S603
            ["git", *args],  # noqa: S607
            cwd=self.repo,
            check=True,
            capture_output=True,
            text=True,
        ).stdout

    def commit(self, message, *files):
        for name in files:
            path = self.repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(path.read_text() + "x\n" if path.exists() else "x\n")
        self.git("add", ".")
        extra = [] if files else ["--allow-empty"]
        self.git("commit", "-q", *extra, "-m", message)

    def run_cli(self, *args):
        result = subprocess.run(  # noqa: S603
            [sys.executable, str(SCRIPT), *args], cwd=self.repo, capture_output=True, text=True
        )
        return result.returncode, result.stdout + result.stderr

    def head(self):
        return self.git("rev-parse", "HEAD").strip()

    def breaking(self, labels=()):
        return self.run_cli(
            "breaking", self.base, self.head(), "--labels", json.dumps(list(labels))
        )


class Commits(RepoCase):
    def test_conventional_passes(self):
        self.commit("feat(web): x", "web/src/a.ts")
        self.assertEqual(self.run_cli("commits", self.base, self.head())[0], 0)

    def test_non_conventional_fails(self):
        self.commit("Update stuff", "web/src/a.ts")
        code, out = self.run_cli("commits", self.base, self.head())
        self.assertEqual(code, 1)
        self.assertIn("Update stuff", out)

    def test_merge_commits_are_excluded(self):
        self.git("checkout", "-q", "-b", "feat/x")
        self.commit("feat: a", "a.txt")
        self.git("checkout", "-q", "main")
        self.commit("fix: b", "b.txt")
        self.git("merge", "-q", "--no-ff", "-m", "Merge branch 'feat/x'", "feat/x")
        self.assertEqual(self.run_cli("commits", self.base, self.head())[0], 0)

    def test_dependabot_and_release_please_subjects(self):
        self.commit("build(deps): bump x from 1 to 2", "web/package.json")
        self.commit(
            "chore(main): release frontend 1.6.0",
            "web/package.json",
            "deploy/helm/tim/image-tags.yaml",
        )
        self.assertEqual(self.run_cli("commits", self.base, self.head())[0], 0)


class Branch(RepoCase):
    def test_branch_names(self):
        for name, code in [
            ("feat/x", 0),
            ("rewrite-v4", 1),
            ("release-please--branches--main--components--frontend", 0),
            ("dependabot/npm_and_yarn/x", 0),
        ]:
            self.assertEqual(self.run_cli("branch", name)[0], code, name)


class Breaking(RepoCase):
    def test_web_breaking_needs_label(self):
        self.commit("feat(web)!: x", "web/src/a.ts")
        code, out = self.breaking()
        self.assertEqual(code, 1)
        self.assertIn("release:major-frontend", out)
        self.assertEqual(self.breaking(["release:major-frontend"])[0], 0)

    def test_breaking_footer(self):
        self.commit("feat: x\n\nBREAKING CHANGE: gone", "api/src/a.py")
        code, out = self.breaking()
        self.assertEqual(code, 1)
        self.assertIn("release:major-backend", out)
        self.assertEqual(self.breaking(["release:major-backend"])[0], 0)

    def test_excluded_paths_are_not_package_changes(self):
        self.commit("feat(web)!: x", "web/e2e/a.spec.ts")
        self.commit("fix(api)!: x", "api/tests/test_a.py")
        self.commit("fix!: x", "deploy/helm/tim/ci/values.yaml")
        self.assertEqual(self.breaking()[0], 0)

    def test_multiple_packages_need_all_labels(self):
        self.commit("feat!: x", "web/src/a.ts", "deploy/helm/tim/values.yaml")
        self.assertEqual(self.breaking(["release:major-frontend"])[0], 1)
        self.assertEqual(self.breaking(["release:major-chart"])[0], 1)
        self.assertEqual(self.breaking(["release:major-frontend", "release:major-chart"])[0], 0)

    def test_empty_release_as_fails(self):
        self.commit("chore: release 2.0.0\n\nRelease-As: 2.0.0")
        code, out = self.breaking()
        self.assertEqual(code, 1)
        self.assertIn("Release-As", out)

    def test_release_as_on_package_files_passes(self):
        self.commit("chore: release 2.0.0\n\nRelease-As: 2.0.0", "api/src/a.py")
        self.assertEqual(self.breaking()[0], 0)

    def test_release_please_commit_passes(self):
        self.commit(
            "chore(main): release frontend 1.6.0",
            "web/package.json",
            "deploy/helm/tim/image-tags.yaml",
        )
        self.assertEqual(self.run_cli("commits", self.base, self.head())[0], 0)
        self.assertEqual(self.breaking()[0], 0)

    def test_dependabot_commit_passes(self):
        self.commit("build(deps): bump x from 1 to 2", "web/package.json")
        self.assertEqual(self.run_cli("commits", self.base, self.head())[0], 0)
        self.assertEqual(self.breaking()[0], 0)


if __name__ == "__main__":
    unittest.main()
