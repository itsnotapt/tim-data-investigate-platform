"""Tests for pr_conventions.py."""

import subprocess
import sys
import unittest
from pathlib import Path

import pr_conventions as pc

SCRIPT = Path(__file__).resolve().parent / "pr_conventions.py"


class Title(unittest.TestCase):
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

    def run_script(self, title):
        result = subprocess.run(  # noqa: S603
            [sys.executable, str(SCRIPT), title], capture_output=True, text=True, check=False
        )
        return result.returncode, result.stdout

    def test_a_conventional_title_passes(self):
        self.assertEqual(self.run_script("feat(web): add x")[0], 0)

    def test_any_other_title_fails_and_says_why(self):
        code, out = self.run_script("Add x")
        self.assertEqual(code, 1)
        self.assertIn("PR title 'Add x' is not a Conventional Commit", out)


if __name__ == "__main__":
    unittest.main()
