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


class GitRepo(unittest.TestCase):
    """A temporary repo with the release-please config, on a feature branch off main."""

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

    def run_script(self, *args):
        result = subprocess.run(  # noqa: S603
            [sys.executable, str(SCRIPT), *args],
            cwd=self.repo,
            capture_output=True,
            text=True,
        )
        return result.returncode, result.stdout + result.stderr

    def pr(self, title, labels=""):
        return self.run_script("pr", self.base, "HEAD", "--title", title, "--labels", labels)

    def major(self, title):
        """The PR with the label a deliberate major release carries."""
        return self.pr(title, labels=f"documentation,{pc.MAJOR_RELEASE_LABEL}")


class Pr(GitRepo):
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
        code, out = self.major("feat(api,tim-actions)!: drop y")
        self.assertEqual(code, 0, out)

    def test_breaking_scope_is_free_form_without_tim_actions(self):
        self.commit("feat: a", "web/src/a.ts", "api/src/a.py", "deploy/helm/tim/values.yaml")
        for title in ["feat!: drop y", "feat(web)!: drop y", "feat(api,web,tim-actions)!: drop y"]:
            code, out = self.major(title)
            self.assertEqual(code, 0, f"{title}: {out}")

    def test_tim_actions_tests_need_no_naming(self):
        self.commit("test: a", "api/tim-actions/tests/test_a.py")
        self.assertEqual(self.major("feat(api)!: drop y")[0], 0)

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

    def test_a_breaking_title_that_releases_tim_needs_the_major_release_label(self):
        self.commit("feat: a", "web/src/a.ts")
        for title in ["feat!: drop y", "feat(web)!: drop y"]:
            code, out = self.pr(title, labels="documentation")
            self.assertEqual(code, 1, title)
            self.assertIn("major-release", out)
        self.assertEqual(self.major("feat!: drop y")[0], 0)

    def test_a_breaking_title_that_releases_nothing_needs_no_label(self):
        self.commit("docs: a", "docs/a.md", "examples/demo/a.yaml", ".github/workflows/a.yml")
        self.assertEqual(self.pr("docs!: rename")[0], 0)


class Release(GitRepo):
    """release-please's release PR: its manifest at the base and at the head."""

    def manifest(self, versions):
        (self.repo / ".release-please-manifest.json").write_text(json.dumps(versions))
        self.git("add", ".")
        self.git("commit", "-q", "-m", "chore: release main")

    def release(self, labels=""):
        return self.run_script("release", self.base, "HEAD", "--labels", labels)

    def setUp(self):
        super().setUp()
        self.git("checkout", "-q", "main")
        self.manifest({".": "2.0.0", "api/tim-actions": "0.1.0"})
        self.base = self.git("rev-parse", "HEAD").strip()
        self.git("checkout", "-q", "-b", "release-please--branches--main")

    def test_minor_and_patch_releases_pass(self):
        self.manifest({".": "2.1.0", "api/tim-actions": "0.1.1"})
        code, out = self.release()
        self.assertEqual(code, 0, out)

    def test_a_major_release_needs_the_major_release_label(self):
        self.manifest({".": "3.0.0", "api/tim-actions": "0.2.0"})
        code, out = self.release(labels="autorelease: pending")
        self.assertEqual(code, 1)
        self.assertIn("tim 2.0.0 -> 3.0.0", out)
        self.assertIn('"release-as": "2.1.0"', out)
        self.assertNotIn("tim-actions", out)
        code, out = self.release(labels=f"autorelease: pending,{pc.MAJOR_RELEASE_LABEL}")
        self.assertEqual(code, 0, out)

    def test_tim_actions_1_0_needs_the_label_too(self):
        self.manifest({".": "2.1.0", "api/tim-actions": "1.0.0"})
        code, out = self.release()
        self.assertEqual(code, 1)
        self.assertIn("tim-actions 0.1.0 -> 1.0.0", out)

    def test_a_package_new_in_the_release_is_no_major(self):
        self.manifest({".": "2.1.0", "api/tim-actions": "0.1.1", "new": "1.0.0"})
        self.assertEqual(self.release()[0], 0)


if __name__ == "__main__":
    unittest.main()
