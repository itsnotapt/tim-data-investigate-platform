"""Tests for docs_conventions.py: pure functions plus the CLI against temporary git repos."""

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import docs_conventions as dc

SCRIPT = Path(__file__).resolve().parent / "docs_conventions.py"
GLOSSARY = Path(__file__).resolve().parent / "fixtures" / "glossary.md"

ADR_BODY = "# {n}. Title\n\n- **Status:** {status}\n- **Date:** 2026-10-01\n"
ADR_README = """# ADRs

| ADR | Title | Status | Date |
|---|---|---|---|
{rows}
"""


class RepoCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.git("init", "-q", "-b", "main")

    def git(self, *args):
        return subprocess.run(  # noqa: S603
            ["git", *args],  # noqa: S607
            cwd=self.root,
            check=True,
            capture_output=True,
            text=True,
        ).stdout

    def write(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def files(self):
        self.git("add", "-A")
        return dc.git_markdown_files(self.root)

    def run_check(self, check):
        return check(self.root, self.files())

    def messages(self, failures):
        return [f"{f.path}:{f.line}: {f.message}" for f in failures]

    def run_cli(self, *args, env=None):
        self.git("add", "-A")
        result = subprocess.run(  # noqa: S603
            [sys.executable, str(SCRIPT), "--root", str(self.root), *args],
            capture_output=True,
            text=True,
            env={**{k: v for k, v in os.environ.items() if k != "GITHUB_ACTIONS"}, **(env or {})},
        )
        return result.returncode, result.stdout + result.stderr


class Slugs(unittest.TestCase):
    def test_slugify(self):
        self.assertEqual(dc.slugify("6. Git"), "6-git")
        self.assertEqual(dc.slugify("`docs/` is the source"), "docs-is-the-source")
        self.assertEqual(dc.slugify("Updating GLOSSARY.md"), "updating-glossarymd")
        self.assertEqual(dc.slugify("A [link](x.md) and more"), "a-link-and-more")
        self.assertEqual(dc.slugify("Snake_case - dash ##"), "snake_case---dash")
        self.assertEqual(dc.slugify("Ünïcode ß"), "ünïcode-ß")

    def test_anchors_with_duplicates_ids_and_fences(self):
        text = (
            "# A\n## B\n## B\n## B\n```\n# not a heading\n```\n"
            '<a id="custom"></a> <span name="other">\n'
        )
        self.assertEqual(dc.anchors_of(text), {"a", "b", "b-1", "b-2", "custom", "other"})


class LinkTargets(unittest.TestCase):
    def test_extraction(self):
        text = (
            '[a](one.md) ![img](two.png "title") [b](<three four.md>)\n'
            "`[no](code.md)` and ``[no](code2.md)``\n"
            "```\n[no](fence.md)\n```\n"
            "~~~\n[no](tilde.md)\n~~~\n"
            "[ref]: four.md\n"
            '[nested]: <five.md> "t"\n'
            "[![alt](badge.svg)](six.md)\n"
            "[paren](seven_(x).md)\n"
        )
        self.assertEqual(
            [t for _, t in dc.link_targets(text)],
            [
                "one.md",
                "two.png",
                "three four.md",
                "four.md",
                "five.md",
                "six.md",
                "badge.svg",
                "seven_(x).md",
            ],
        )


class Links(RepoCase):
    def test_valid_links(self):
        self.write("README.md", "# Top\n[d](docs/a.md#section-one) [r](/docs/a.md) [s](#top)\n")
        self.write(
            "docs/a.md", "# A\n## Section one\n[up](../README.md#top) [dir](.) [dir2](../docs/)\n"
        )
        self.write("docs/b.md", "[web](https://x.y/z) [m](mailto:a@b.c) [t](tel:1) [e](a%20b.md)\n")
        self.write("docs/a b.md", "x\n")
        self.assertEqual(self.run_check(dc.check_links), [])

    def test_missing_target_and_anchor(self):
        self.write("README.md", "[x](nope.md)\n[y](docs/a.md#missing)\n[z](#nothing)\n")
        self.write("docs/a.md", "# A\n")
        out = self.messages(self.run_check(dc.check_links))
        self.assertEqual(len(out), 3, out)
        self.assertIn("README.md:1:", out[0])
        self.assertIn("README.md:2:", out[1])
        self.assertIn("README.md:3:", out[2])

    def test_outside_root_fails(self):
        self.write("docs/a.md", "[x](../../README.md)\n")
        self.assertEqual(len(self.run_check(dc.check_links)), 1)

    def test_anchor_on_non_markdown_is_not_checked(self):
        self.write("README.md", "[x](a.yaml#whatever)\n")
        self.write("a.yaml", "k: v\n")
        self.assertEqual(self.run_check(dc.check_links), [])

    def test_changelog_excluded(self):
        self.write("api/CHANGELOG.md", "[x](nope.md)\n")
        self.assertEqual(self.run_check(dc.check_links), [])

    def test_untracked_ignored(self):
        self.write("README.md", "ok\n")
        self.git("add", "-A")
        self.write("node_modules/p/README.md", "[x](nope.md)\n")
        self.assertEqual(dc.check_links(self.root, dc.git_markdown_files(self.root)), [])


class Adr(RepoCase):
    def adr(self, number, slug="x", status="Accepted", body=None):
        self.write(f"docs/adr/{number}-{slug}.md", body or ADR_BODY.format(n=number, status=status))

    def index(self, *rows):
        self.write("docs/adr/README.md", ADR_README.format(rows="\n".join(rows)))

    def row(self, number, slug="x", status="Accepted", date="2026-10-01"):
        return f"| [{number}]({number}-{slug}.md) | T | {status} | {date} |"

    def good(self):
        self.write("docs/adr/0000-template.md", "# NNNN. Title\n- **Status:** Proposed | x\n")
        self.adr("0001")
        self.adr("0002", status="Superseded by [0003](0003-x.md)")
        self.adr("0003")
        self.index(
            self.row("0001"),
            self.row("0002", status="Superseded by 0003"),
            self.row("0003"),
        )

    def test_not_present(self):
        self.write("README.md", "x\n")
        self.assertEqual(self.run_check(dc.check_adr), [])

    def test_valid(self):
        self.good()
        self.assertEqual(self.messages(self.run_check(dc.check_adr)), [])

    def test_real_status_variants(self):
        self.adr("0001", status="Accepted; image tag rules superseded by [0002](0002-x.md)")
        self.adr("0002")
        self.index(
            self.row("0001", status="Accepted; image tag rules superseded by 0002"),
            self.row("0002"),
        )
        self.assertEqual(self.messages(self.run_check(dc.check_adr)), [])

    def test_bad_name_and_duplicate_number(self):
        self.good()
        self.write("docs/adr/4-bad.md", "x\n")
        self.write("docs/adr/0003-other.md", ADR_BODY.format(n="0003", status="Accepted"))
        out = " ".join(self.messages(self.run_check(dc.check_adr)))
        self.assertIn("4-bad.md", out)
        self.assertIn("also used by", out)

    def test_gap_is_allowed(self):
        # Numbers are never reused, so a removed ADR leaves a gap (docs/adr/README.md).
        self.good()
        self.adr("0005")
        out = " ".join(self.messages(self.run_check(dc.check_adr)))
        self.assertNotIn("missing", out)
        self.assertNotIn("gap", out)

    def test_header_problems(self):
        self.good()
        self.adr("0001", body="# 0009. Title\n\n- **Status:** Accepted\n- **Date:** 2026-10-01\n")
        self.adr("0002", body="# 0002. T\n- **Status:** Maybe\n- **Date:** 2026-02-30\n")
        self.adr("0003", body="No heading\n")
        out = self.messages(self.run_check(dc.check_adr))
        text = "\n".join(out)
        self.assertIn("title number 0009 is not 0001", text)
        self.assertIn("status 'Maybe'", text)
        self.assertIn("date '2026-02-30'", text)
        self.assertIn("0003-x.md:1: must start with a '# Title'", text)

    def test_template_content_skipped(self):
        self.good()
        self.write("docs/adr/0000-template.md", "garbage\n")
        self.assertEqual(self.run_check(dc.check_adr), [])

    def test_index_mismatches(self):
        self.good()
        self.index(
            self.row("0001", status="Proposed"),
            self.row("0002", status="Superseded by 0003", date="2026-01-01"),
            self.row("0003", slug="y"),
            self.row("0003"),
            self.row("0009"),
        )
        text = "\n".join(self.messages(self.run_check(dc.check_adr)))
        self.assertIn("status 'Proposed' does not match", text)
        self.assertIn("date '2026-01-01' does not match", text)
        self.assertIn("link must be (0003-x.md)", text)
        self.assertIn("0003 is listed twice", text)
        self.assertIn("row for 0009, which is not an ADR file", text)

    def test_missing_row(self):
        self.good()
        self.index(self.row("0001"), self.row("0002", status="Superseded by 0003"))
        text = "\n".join(self.messages(self.run_check(dc.check_adr)))
        self.assertIn("no table row for 0003-x.md", text)

    def test_frontmatter_variant(self):
        self.adr("0001", body="---\nstatus: accepted\n---\n\n# Short title\n\nBody\n")
        self.adr("0002", body="---\nStatus: Superseded by ADR-0003\n---\n# 0002. Another\n")
        self.adr("0003", body="# Plain title\n")
        self.index(
            self.row("0001", status="Accepted"),
            self.row("0002", status="superseded by 0003", date="2026-01-01"),
            self.row("0003", status="whatever", date="x"),
        )
        self.assertEqual(self.messages(self.run_check(dc.check_adr)), [])

    def test_invalid_frontmatter_status(self):
        self.adr("0001", body="---\nstatus: maybe\n---\n# Title\n")
        self.index(self.row("0001"))
        text = "\n".join(self.messages(self.run_check(dc.check_adr)))
        self.assertIn("docs/adr/0001-x.md:2: status 'maybe'", text)

    def test_bullet_list_index(self):
        self.adr("0001", body="# Title\n")
        self.adr("0002", body="# Title\n")
        self.write("docs/adr/README.md", "# ADRs\n\n- [First](0001-x.md)\n- [Second](0002-x.md)\n")
        self.assertEqual(self.run_check(dc.check_adr), [])
        self.write("docs/adr/README.md", "# ADRs\n\n- [First](0001-x.md)\n- [Gone](0007-y.md)\n")
        text = "\n".join(self.messages(self.run_check(dc.check_adr)))
        self.assertIn("no link to 0002-x.md", text)
        self.assertIn("0007-y.md, which is not an ADR file", text)

    def test_missing_index(self):
        self.adr("0001")
        text = "\n".join(self.messages(self.run_check(dc.check_adr)))
        self.assertIn("docs/adr/README.md:1: missing", text)


class Glossary(RepoCase):
    def test_real_sample_passes(self):
        self.assertEqual(self.messages(dc.check_glossary_text(GLOSSARY.read_text())), [])
        self.write("GLOSSARY.md", GLOSSARY.read_text())
        self.assertEqual(self.run_check(dc.check_glossary), [])

    def test_absent_is_skipped(self):
        self.write("README.md", "x\n")
        self.assertEqual(self.run_check(dc.check_glossary), [])

    def check(self, text):
        return "\n".join(self.messages(dc.check_glossary_text(text)))

    BASE = "# Ctx\n\nDescription.\n\n## Language\n\n"

    def test_structure(self):
        self.assertIn("line 1", self.check("Ctx\n\nd\n\n## Language\n"))
        self.assertIn("description", self.check("# Ctx\n\n## Language\n"))
        self.assertIn("## Language", self.check("# Ctx\n\nDesc.\n"))

    def test_term_needs_definition(self):
        self.assertIn(
            "needs a definition", self.check(self.BASE + "**Tab**:\n\n**Other**:\nDef.\n")
        )
        self.assertIn("needs a definition", self.check(self.BASE + "**Tab**:\n**Other**:\nDef.\n"))
        self.assertIn("needs a definition", self.check(self.BASE + "**Tab**:\n"))

    def test_extra_lines_fail(self):
        self.assertIn("expected a blank line", self.check(self.BASE + "**Tab**:\nDef.\nMore.\n"))
        self.assertIn("expected a blank line", self.check(self.BASE + "Loose text.\n"))

    def test_avoid_rules(self):
        self.assertEqual(self.check(self.BASE + "**Tab**:\nDef.\n_Avoid_: a, b\n"), "")
        self.assertIn("_Avoid_ needs", self.check(self.BASE + "**Tab**:\nDef.\n_Avoid_:\n"))
        self.assertIn("_Avoid_ must", self.check(self.BASE + "_Avoid_: a\n"))
        self.assertIn("_Avoid_ must", self.check(self.BASE + "**Tab**:\nDef.\n\n_Avoid_: a\n"))

    def test_sentences(self):
        self.assertEqual(self.check(self.BASE + "**Tab**:\nOne. Two, e.g. a thing, i.e. b.\n"), "")
        self.assertIn("two sentences", self.check(self.BASE + "**Tab**:\nOne. Two! Three?\n"))

    def test_duplicates(self):
        text = self.BASE + "**Tab**:\nD.\n\n**tab** / **Other**:\nD.\n"
        self.assertIn("duplicate term 'tab'", self.check(text))
        self.assertEqual(
            self.check(self.BASE + "**Query** (template type):\nD.\n\n**Other**:\nD.\n"), ""
        )

    def test_no_code_or_links(self):
        self.assertIn("code spans", self.check(self.BASE + "**Tab**:\nUses `x`.\n"))
        self.assertIn("links", self.check(self.BASE + "**Tab**:\nSee [x](y.md).\n"))
        self.assertIn("links", self.check(self.BASE + "**Tab**:\nSee <https://x.y>.\n"))

    def test_section_ends_at_next_h2(self):
        self.assertEqual(self.check(self.BASE + "**Tab**:\nD.\n\n## Other\n\nfree text\n"), "")


class Tooling(RepoCase):
    def flagged(self, text):
        return bool(dc.check_tooling_text(text, "x.md"))

    def test_flagged(self):
        for text in [
            "By Matt Pocock",
            "github.com/mattpocock/x",
            "see SKILL.md",
            "the Skill tool",
            "run `/triage`",
            "run /tdd now",
            "(/wayfinder)",
            '"/pr"',
            "/handoff",
            "use grill-me first",
            "setup-matt-pocock-skills",
            "`to-spec`",
            "/to-tickets",
            "```\nrun /tdd\n```",
        ]:
            self.assertTrue(self.flagged(text), text)

    def test_allowed(self):
        for text in [
            "docs/agents/triage-labels.md",
            "label wayfinder:map",
            "https://x/pr/1",
            "the /api/pr/ route",
            "see /tdd.md",
            "pre-grill-me",
            "an ordinary prototype and a review",
            "## Agent skills",
            "Skills are packaged instructions.",
        ]:
            self.assertFalse(self.flagged(text), text)

    def test_claude_md_with_agent_skills_heading(self):
        self.write("CLAUDE.md", "# TIM\n\n## Agent skills\n\nRead [docs](docs/README.md).\n")
        self.write("docs/README.md", "x\n")
        self.assertEqual(self.run_check(dc.check_tooling), [])

    def test_reports_line_and_excludes_changelog(self):
        self.write("a.md", "ok\nsee SKILL.md\n")
        self.write("web/CHANGELOG.md", "Pocock\n")
        out = self.messages(self.run_check(dc.check_tooling))
        self.assertEqual(len(out), 1)
        self.assertTrue(out[0].startswith("a.md:2:"), out)


class Index(RepoCase):
    def test_all_linked(self):
        self.write("docs/README.md", "[a](a.md) [d](sub/d.md#x) [adr](adr/README.md)\n")
        self.write("docs/a.md", "x\n")
        self.write("docs/sub/d.md", "x\n")
        self.write("docs/adr/0001-x.md", "x\n")
        self.assertEqual(self.run_check(dc.check_index), [])

    def test_unlinked_fails(self):
        self.write("docs/README.md", "[a](a.md)\n")
        self.write("docs/a.md", "x\n")
        self.write("docs/b.md", "x\n")
        out = self.messages(self.run_check(dc.check_index))
        self.assertEqual(len(out), 1)
        self.assertIn("docs/b.md is not linked", out[0])

    def test_no_docs(self):
        self.write("README.md", "x\n")
        self.assertEqual(self.run_check(dc.check_index), [])


class Cli(RepoCase):
    def test_ok_and_default_all(self):
        self.write("README.md", "# Top\n[x](#top)\n")
        code, out = self.run_cli()
        self.assertEqual(code, 0, out)
        self.assertIn("OK:", out)

    def test_failure_output_and_annotations(self):
        self.write("README.md", "ok\n[x](nope.md)\n")
        code, out = self.run_cli("links")
        self.assertEqual(code, 1)
        self.assertIn("README.md:2: link 'nope.md' does not exist", out)
        self.assertNotIn("::error", out)
        code, out = self.run_cli("links", env={"GITHUB_ACTIONS": "true"})
        self.assertIn("::error file=README.md,line=2::link 'nope.md' does not exist", out)

    def test_selected_checks_only(self):
        self.write("README.md", "[x](nope.md)\n")
        code, out = self.run_cli("tooling")
        self.assertEqual(code, 0, out)

    def test_unknown_check(self):
        self.write("README.md", "x\n")
        code, _ = self.run_cli("bogus")
        self.assertEqual(code, 2)


VALID_ADR = """---
status: accepted
date: 2026-10-01
---

# Short title

One sentence (with a note), e.g. a thing. Second sentence.

## Considered Options

- A
- B

## Consequences

Text.
"""


class AdrFormat(RepoCase):
    def failures(self, text, name="docs/adr/0001-x.md"):
        return "\n".join(self.messages(dc.check_adr_format_text(text, name)))

    def test_valid(self):
        self.assertEqual(self.failures(VALID_ADR), "")
        self.assertEqual(self.failures(VALID_ADR.split("## Considered")[0].rstrip() + "\n"), "")

    def test_template(self):
        template = VALID_ADR.replace("2026-10-01", "YYYY-MM-DD")
        self.assertEqual(self.failures(template, "docs/adr/0000-template.md"), "")
        self.assertIn("date", self.failures(template))

    def test_each_rule(self):
        cases = {
            "file name": (VALID_ADR, "docs/adr/1-X.md"),
            "exactly one newline": (VALID_ADR + "\n", None),
            "lines 1-4": (VALID_ADR.replace("---\n\n#", "\n\n#", 1), None),
            "exactly the keys": (VALID_ADR.replace("status", "state"), None),
            "status": (VALID_ADR.replace("accepted", "superseded by 7"), None),
            "date '2026-13-01'": (VALID_ADR.replace("2026-10-01", "2026-13-01"), None),
            "line 5 must be blank": (VALID_ADR.replace("---\n\n#", "---\nx\n#", 1), None),
            "without a number": (VALID_ADR.replace("# Short", "# 0001. Short"), None),
            "only one": (VALID_ADR + "\n# Again\n", None),
            "deeper": (VALID_ADR + "\n### Deep\n", None),
            "only sections": (VALID_ADR + "\n## Context\n", None),
            "order": (
                VALID_ADR.replace("Considered Options", "X")
                .replace("Consequences", "Considered Options")
                .replace("## X", "## Consequences"),
                None,
            ),
            "prose summary": (VALID_ADR.replace("One sentence", "- One sentence"), None),
            "0 sentences": (
                VALID_ADR.replace(
                    "One sentence (with a note), e.g. a thing. Second sentence.", "No end"
                ),
                None,
            ),
            "4 sentences": (VALID_ADR.replace("Second sentence.", "Two. Three. Four."), None),
        }
        for expected, (text, name) in cases.items():
            self.assertIn(expected, self.failures(text, name or "docs/adr/0001-x.md"), expected)

    def test_fenced_headings_ignored(self):
        text = VALID_ADR + "\n```\n### not a heading\n# nor this\n```\n"
        self.assertEqual(self.failures(text), "")

    def test_cli_explicit_fails_advisory_warns(self):
        self.write("docs/adr/0001-x.md", "# Old style\n\nText.\n")
        self.write("docs/adr/README.md", "[a](0001-x.md)\n")
        self.write("docs/README.md", "[a](adr/README.md)\n")
        code, out = self.run_cli("adr-format")
        self.assertEqual(code, 1, out)
        self.assertIn("docs/adr/0001-x.md:1: lines 1-4", out)
        code, out = self.run_cli("--advisory", "adr-format")
        self.assertEqual(code, 0, out)
        self.assertIn("docs/adr/0001-x.md:1: warning: lines 1-4", out)
        self.assertNotIn("::warning", out)
        code, out = self.run_cli("--advisory", "adr-format", env={"GITHUB_ACTIONS": "true"})
        self.assertEqual(code, 0, out)
        self.assertIn("::warning file=docs/adr/0001-x.md,line=1::lines 1-4", out)

    def test_not_in_default_set(self):
        self.write("docs/adr/0001-x.md", "# Old style\n\nText.\n")
        self.write("docs/adr/README.md", "[a](0001-x.md)\n")
        self.assertEqual(self.run_cli()[0], 0)
        self.write("docs/adr/0001-x.md", VALID_ADR)
        self.assertEqual(self.run_cli("adr-format")[0], 0)


if __name__ == "__main__":
    unittest.main()
