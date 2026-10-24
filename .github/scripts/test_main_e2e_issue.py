"""Tests for main_e2e_issue.py: what a full e2e run on main does to the tracking issue."""

import unittest

import main_e2e_issue as mei

RUN = mei.Run(
    sha="c4aacbb0123456789abcdef0123456789abcdef0",
    message="fix(frontend): New menu clicks no longer miss while a folder opens (#175)\n\nfix: x",
    run_id="18765432101",
    run_url="https://github.com/itsnotapt/tim-data-investigate-platform/actions/runs/18765432101",
)


class TrackingIssue(unittest.TestCase):
    def test_a_failure_with_no_open_issue_opens_one(self):
        plan = mei.plan("failure", [], RUN)

        self.assertEqual(plan.action, "open")
        self.assertIsNone(plan.number)
        self.assertIn("c4aacbb0123456789abcdef0123456789abcdef0", plan.body)
        self.assertIn("#175", plan.body)
        self.assertIn(RUN.run_url, plan.body)
        self.assertIn("playwright-report", plan.body)
        self.assertIn("gh run view 18765432101 --log-failed", plan.body)

    def test_a_failure_comments_on_the_open_issue_with_exactly_that_title(self):
        issues = [
            {"number": 180, "title": "Full e2e failing on main in Firefox"},
            {"number": 181, "title": "Full e2e failing on main"},
        ]

        plan = mei.plan("failure", issues, RUN)

        self.assertEqual(plan.action, "comment")
        self.assertEqual(plan.number, 181)
        self.assertIn("gh run view 18765432101 --log-failed", plan.body)

    def test_a_pass_closes_the_open_issue_naming_the_commit(self):
        issues = [{"number": 181, "title": "Full e2e failing on main"}]

        plan = mei.plan("success", issues, RUN)

        self.assertEqual(plan.action, "close")
        self.assertEqual(plan.number, 181)
        self.assertIn("passed", plan.body)
        self.assertIn("c4aacbb0123456789abcdef0123456789abcdef0 (#175)", plan.body)
        self.assertIn(RUN.run_url, plan.body)
        self.assertNotIn("--log-failed", plan.body)

    def test_a_pass_with_no_open_issue_does_nothing(self):
        issues = [{"number": 180, "title": "Full e2e failing on main in Firefox"}]

        plan = mei.plan("success", issues, RUN)

        self.assertEqual(plan.action, "none")
        self.assertIsNone(plan.number)


if __name__ == "__main__":
    unittest.main()
