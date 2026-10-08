"""Tests for pr_conventions.py: pure functions plus the CLI against temporary git repos."""

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

    def test_is_breaking(self):
        self.assertTrue(pc.is_breaking("feat!: x"))
        self.assertTrue(pc.is_breaking("feat(web)!: x\n\nbody"))
        self.assertTrue(pc.is_breaking("feat: x\n\nBREAKING CHANGE: gone"))
        self.assertTrue(pc.is_breaking("feat: x\n\nBREAKING-CHANGE: gone"))
        self.assertFalse(pc.is_breaking("feat: x\n\nmentions BREAKING CHANGE: inline"))
        self.assertFalse(pc.is_breaking("feat: add! bang"))

    def test_scopes_of(self):
        self.assertEqual(pc.scopes_of("feat(backend)!: x"), {"backend"})
        self.assertEqual(pc.scopes_of("feat(backend,chart)!: x"), {"backend", "chart"})
        self.assertEqual(pc.scopes_of("fix(web): x"), {"web"})
        self.assertEqual(pc.scopes_of("feat!: x"), set())
        self.assertEqual(pc.scopes_of("feat: x (backend)"), set())

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


class Pr(unittest.TestCase):
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
        self.git("checkout", "-q", "-b", "feat/x")

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
        self.git("commit", "-q", "-m", message)

    def pr(self, title):
        result = subprocess.run(  # noqa: S603
            [sys.executable, str(SCRIPT), "pr", self.base, "HEAD", "--title", title],
            cwd=self.repo,
            capture_output=True,
            text=True,
        )
        return result.returncode, result.stdout + result.stderr

    def test_feature_pr_passes(self):
        self.commit("wip", "web/src/a.ts")
        self.commit("feat(web)!: not squashed", "web/src/b.ts")
        code, out = self.pr("feat(web): add x")
        self.assertEqual(code, 0, out)

    def test_title_must_be_conventional(self):
        self.commit("feat: a", "web/src/a.ts")
        code, out = self.pr("Add x")
        self.assertEqual(code, 1)
        self.assertIn("PR title", out)

    def test_breaking_scope_must_name_every_package_the_pr_changes(self):
        self.commit("feat: a", "api/src/a.py")
        self.commit("docs: b", "deploy/helm/tim/values.yaml", "web/e2e/a.spec.ts")
        code, out = self.pr("feat(api)!: drop y")
        self.assertEqual(code, 1)
        self.assertIn("backend, chart", out)
        self.assertNotIn("frontend", out)
        code, out = self.pr("feat(backend)!: drop y")
        self.assertEqual(code, 1)
        self.assertIn("files of chart,", out)
        self.assertNotIn("files of backend", out)
        code, out = self.pr("feat(backend,chart)!: drop y")
        self.assertEqual(code, 0, out)

    def test_breaking_scope_may_name_more_than_the_pr_changes(self):
        self.commit("feat: a", "api/src/a.py")
        for title in ["feat(chart,backend)!: drop y", "feat(backend,frontend,docs)!: drop y"]:
            code, out = self.pr(title)
            self.assertEqual(code, 0, f"{title}: {out}")

    def test_breaking_without_scope_fails_when_a_package_changes(self):
        self.commit("feat: a", "web/src/a.ts", "docs/a.md")
        code, out = self.pr("feat!: drop y")
        self.assertEqual(code, 1)
        self.assertIn("files of frontend,", out)
        self.assertEqual(self.pr("feat(frontend)!: drop y")[0], 0)

    def test_breaking_scope_uses_package_names_not_directories(self):
        self.commit("feat: a", "web/src/a.ts")
        self.assertEqual(self.pr("feat(web)!: drop y")[0], 1)

    def test_non_breaking_scope_is_free_form(self):
        self.commit("feat: a", "web/src/a.ts", "api/src/a.py", "deploy/helm/tim/values.yaml")
        for title in ["feat: a", "feat(web): a", "fix(anything,else): a", "feat(chart): a"]:
            code, out = self.pr(title)
            self.assertEqual(code, 0, f"{title}: {out}")

    def test_breaking_title_outside_packages_passes(self):
        self.commit("docs: a", "docs/a.md", "api/tests/test_a.py")
        self.assertEqual(self.pr("docs!: rename")[0], 0)

    def test_files_on_main_since_the_branch_point_are_not_the_prs(self):
        self.commit("fix: a", "docs/a.md")
        self.git("checkout", "-q", "main")
        self.commit("feat: other", "web/src/other.ts")
        self.git("checkout", "-q", "feat/x")
        # The PR head is feat/x and its base is the new main tip.
        self.base = self.git("rev-parse", "main").strip()
        self.assertEqual(self.pr("fix!: a")[0], 0)


if __name__ == "__main__":
    unittest.main()
