"""Tests for pr_conventions.py: pure functions plus the CLI against temporary git repos."""

import json
import os
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

    clock = 1_800_000_000

    def git(self, *args):
        # Every git call advances the clock, so commits are ordered by date as on GitHub.
        RepoCase.clock += 60
        date = f"@{RepoCase.clock} +0000"
        return subprocess.run(  # noqa: S603
            ["git", *args],  # noqa: S607
            cwd=self.repo,
            check=True,
            capture_output=True,
            text=True,
            env={**os.environ, "GIT_AUTHOR_DATE": date, "GIT_COMMITTER_DATE": date},
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

    def branch(self, name, start="main"):
        self.git("checkout", "-q", "-B", name, start)

    def merge(self, base, head, message=None):
        self.git("checkout", "-q", base)
        self.git(
            "merge", "-q", "--no-ff", "-m", message or f"Merge pull request #1 from o/{head}", head
        )

    def pr(self, base_ref, head_ref, title, labels=(), open_release_prs=0, base=None):
        return self.run_cli(
            "pr",
            base or self.git("rev-parse", base_ref).strip(),
            self.git("rev-parse", head_ref).strip(),
            "--base-ref",
            base_ref,
            "--head-ref",
            head_ref,
            "--title",
            title,
            "--labels",
            json.dumps(list(labels)),
            "--remote",
            "",
            "--open-release-prs",
            str(open_release_prs),
        )

    def breaking(self, labels=()):
        return self.run_cli(
            "breaking", self.base, self.head(), "--labels", json.dumps(list(labels))
        )


class FlowCase(RepoCase):
    """main and development as in docs/RULES.md section 6."""

    def setUp(self):
        super().setUp()
        self.branch("development")


class IntoDevelopment(FlowCase):
    def test_feature_pr_passes(self):
        self.branch("feat/x", "development")
        self.commit("wip", "web/src/a.ts")
        self.commit("feat(web)!: not squashed into development", "web/src/b.ts")
        code, out = self.pr("development", "feat/x", "feat(web): add x")
        self.assertEqual(code, 0, out)

    def test_title_must_be_conventional(self):
        self.branch("feat/x", "development")
        self.commit("feat: a", "web/src/a.ts")
        code, out = self.pr("development", "feat/x", "Add x")
        self.assertEqual(code, 1)
        self.assertIn("PR title", out)

    def test_branch_prefix(self):
        for name, code in [
            ("fix/x", 0),
            ("dependabot/npm_and_yarn/web/x", 0),
            ("feature/x", 1),
            ("rewrite-v4", 1),
        ]:
            self.branch(name, "development")
            self.commit("fix: a", f"web/src/{name.replace('/', '_')}.ts")
            self.assertEqual(self.pr("development", name, "fix: a")[0], code, name)

    def test_breaking_title_needs_label_for_every_file_in_the_pr(self):
        self.branch("feat/x", "development")
        self.commit("feat: a", "api/src/a.py")
        self.commit("docs: b", "deploy/helm/tim/values.yaml", "web/e2e/a.spec.ts")
        code, out = self.pr("development", "feat/x", "feat(api)!: drop y")
        self.assertEqual(code, 1)
        self.assertIn("release:major-backend", out)
        self.assertIn("release:major-chart", out)
        self.assertNotIn("release:major-frontend", out)
        labels = ["release:major-backend", "release:major-chart"]
        self.assertEqual(self.pr("development", "feat/x", "feat(api)!: drop y", labels)[0], 0)

    def test_breaking_title_outside_packages_passes(self):
        self.branch("docs/x", "development")
        self.commit("docs: a", "docs/a.md", "api/tests/test_a.py")
        self.assertEqual(self.pr("development", "docs/x", "docs!: rename")[0], 0)

    def test_files_on_development_since_the_branch_point_are_not_the_prs(self):
        self.branch("fix/x", "development")
        self.commit("fix: a", "docs/a.md")
        self.git("checkout", "-q", "development")
        self.commit("feat: other", "web/src/other.ts")
        self.assertEqual(self.pr("development", "fix/x", "fix!: a")[0], 0)

    def test_frozen_while_main_is_ahead(self):
        self.branch("feat/x", "development")
        self.commit("feat: a", "web/src/a.ts")
        self.git("checkout", "-q", "development")
        self.commit("fix: b (#2)", "web/src/b.ts")
        self.merge("main", "development")
        code, out = self.pr("development", "feat/x", "feat: a")
        self.assertEqual(code, 1)
        self.assertIn("frozen", out)
        self.merge("development", "main")
        self.assertEqual(self.pr("development", "feat/x", "feat: a")[0], 0)

    def test_frozen_while_a_release_pr_is_open(self):
        self.branch("feat/x", "development")
        self.commit("feat: a", "web/src/a.ts")
        code, out = self.pr("development", "feat/x", "feat: a", open_release_prs=1)
        self.assertEqual(code, 1)
        self.assertIn("release PR", out)

    def test_sync_from_main_passes_and_is_not_frozen(self):
        self.git("checkout", "-q", "main")
        self.commit("chore: release main", "web/package.json", "deploy/helm/tim/image-tags.yaml")
        code, out = self.pr(
            "development", "main", "chore: merge main into development", open_release_prs=1
        )
        self.assertEqual(code, 0, out)

    def test_other_targets_are_not_frozen(self):
        self.branch("feat/base", "development")
        self.branch("feat/x", "feat/base")
        self.commit("feat: a", "web/src/a.ts")
        self.git("checkout", "-q", "main")
        self.commit("chore: on main", "README.md")
        self.assertEqual(self.pr("feat/base", "feat/x", "feat: a")[0], 0)


class IntoMain(FlowCase):
    def squash(self, title, *files):
        self.git("checkout", "-q", "development")
        self.commit(title, *files)

    def test_development_passes(self):
        self.squash("feat(web): a (#2)", "web/src/a.ts")
        self.squash("build(deps): bump x from 1 to 2 (#3)", "web/package.json")
        code, out = self.pr("main", "development", "feat: release")
        self.assertEqual(code, 0, out)

    def test_only_development_and_release_branches(self):
        self.branch("feat/x", "main")
        self.commit("feat: a", "web/src/a.ts")
        code, out = self.pr("main", "feat/x", "feat: a")
        self.assertEqual(code, 1)
        self.assertIn("development or release-please--*", out)
        self.branch("release-please--branches--main", "main")
        self.commit("chore: release main", "web/package.json", "deploy/helm/tim/image-tags.yaml")
        code, out = self.pr("main", "release-please--branches--main", "chore: release main")
        self.assertEqual(code, 0, out)

    def test_per_commit_subjects(self):
        self.squash("Update stuff", "web/src/a.ts")
        code, out = self.pr("main", "development", "feat: release")
        self.assertEqual(code, 1)
        self.assertIn("Update stuff", out)

    def test_per_commit_breaking_needs_labels_not_the_title(self):
        self.squash("feat(api)!: drop y (#2)", "api/src/a.py")
        self.squash("feat(web): x (#3)", "web/src/a.ts")
        code, out = self.pr("main", "development", "feat!: release")
        self.assertEqual(code, 1)
        self.assertIn("release:major-backend", out)
        self.assertNotIn("release:major-frontend", out)
        code, out = self.pr("main", "development", "feat!: release", ["release:major-backend"])
        self.assertEqual(code, 0, out)

    def test_release_as_without_package_files_fails(self):
        self.squash("chore: x (#2)\n\nRelease-As: 2.0.0", "docs/a.md")
        self.assertEqual(self.pr("main", "development", "chore: release")[0], 1)

    def test_back_sync_merge_commits_are_ignored(self):
        self.squash("feat(web): a (#2)", "web/src/a.ts")
        self.merge("main", "development")
        self.git("checkout", "-q", "main")
        self.commit("chore: release main", "web/package.json", "deploy/helm/tim/image-tags.yaml")
        self.git("tag", "frontend-v1.6.0")
        self.merge("development", "main", "Merge pull request #4 from o/main")
        self.squash("fix(web): b (#5)", "web/src/b.ts")
        code, out = self.pr("main", "development", "fix: release")
        self.assertEqual(code, 0, out)

    def test_commit_older_than_the_last_release_fails(self):
        self.squash("feat(web): a (#2)", "web/src/a.ts")
        self.merge("main", "development")
        self.squash("fix(api): landed while the release PR was open (#3)", "api/src/b.py")
        self.squash("docs: not a package (#4)", "docs/b.md")
        self.git("checkout", "-q", "main")
        self.commit("chore: release main", "web/package.json", "api/pyproject.toml")
        self.git("tag", "frontend-v1.6.0")
        self.git("tag", "backend-v4.0.0")
        self.merge("development", "main", "Merge pull request #5 from o/main")
        self.squash("feat(web): c (#6)", "web/src/c.ts")
        code, out = self.pr("main", "development", "feat: release")
        self.assertEqual(code, 1)
        self.assertIn("landed while the release PR was open", out)
        self.assertIn("backend release", out)
        self.assertNotIn("not a package", out)
        self.assertNotIn("feat(web): c", out)


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
