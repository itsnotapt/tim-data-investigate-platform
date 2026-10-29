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
            "chore(main): release tim 2.0.0",
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
        self.assertEqual(pc.scopes_of("feat(api)!: x"), {"api"})
        self.assertEqual(pc.scopes_of("feat(api,tim-actions)!: x"), {"api", "tim-actions"})
        self.assertEqual(pc.scopes_of("fix(web): x"), {"web"})
        self.assertEqual(pc.scopes_of("feat!: x"), set())
        self.assertEqual(pc.scopes_of("feat: x (api)"), set())

    def test_packages_are_those_below_the_root(self):
        packages = pc.packages_from_config(CONFIG)
        self.assertEqual(packages, {"api/tim-actions": ("tim-actions", ["api/tim-actions/tests"])})
        self.assertEqual(
            pc.packages_for_files(["api/tim-actions/src/tim_actions/action.py"], packages),
            ["tim-actions"],
        )
        self.assertEqual(pc.packages_for_files(["api/tim-actions/tests/t.py"], packages), [])
        files = ["api/uv.lock", "api/src/a.py", "web/src/a.ts", "deploy/helm/tim/values.yaml"]
        self.assertEqual(pc.packages_for_files(files, packages), [])


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

    def test_breaking_scope_must_name_tim_actions_when_the_pr_changes_it(self):
        self.commit("feat: a", "api/src/a.py", "api/tim-actions/src/tim_actions/a.py")
        for title in ["feat(api)!: drop y", "feat!: drop y"]:
            code, out = self.pr(title)
            self.assertEqual(code, 1, title)
            self.assertIn("files of tim-actions,", out)
        code, out = self.pr("feat(api,tim-actions)!: drop y")
        self.assertEqual(code, 0, out)

    def test_breaking_scope_is_free_form_without_tim_actions(self):
        self.commit("feat: a", "web/src/a.ts", "api/src/a.py", "deploy/helm/tim/values.yaml")
        for title in ["feat!: drop y", "feat(web)!: drop y", "feat(api,web,tim-actions)!: drop y"]:
            code, out = self.pr(title)
            self.assertEqual(code, 0, f"{title}: {out}")

    def test_tim_actions_tests_need_no_naming(self):
        self.commit("test: a", "api/tim-actions/tests/test_a.py")
        self.assertEqual(self.pr("feat(api)!: drop y")[0], 0)

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
        self.commit("feat: other", "api/tim-actions/src/tim_actions/other.py")
        self.git("checkout", "-q", "feat/x")
        # The PR head is feat/x and its base is the new main tip.
        self.base = self.git("rev-parse", "main").strip()
        self.assertEqual(self.pr("fix!: a")[0], 0)


if __name__ == "__main__":
    unittest.main()
