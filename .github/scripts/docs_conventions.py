#!/usr/bin/env python3
"""Documentation convention checks run by .github/workflows/lint-docs.yml.

Markdown files come from `git ls-files` (so untracked and ignored directories such as
node_modules are skipped); every CHANGELOG.md is excluded from all checks.

- `links`: relative links and reference definitions resolve to a file or directory inside the
  repository, and `#anchor`s match a heading (GitHub's slug rules) or an HTML `id`/`name`;
- `adr`: docs/adr/ file names, numbering, header lines and the README table;
- `glossary`: GLOSSARY.md structure (terms, one short definition each, optional _Avoid_ line,
  no code spans or links);
- `tooling`: docs name no external agent tooling;
- `index`: every doc under docs/ (except docs/adr/) is linked from docs/README.md;
- `adr-format` (not in the default set): the strict ADR layout of docs/adr/*.md, that is
  frontmatter with `status` and `date`, an unnumbered title, a summary of one to three
  sentences and optional `Considered Options` and `Consequences` sections.

Usage: docs_conventions.py [--root DIR] [--advisory CHECK ...] [CHECK ...]
With no CHECK, every check except `adr-format` runs. Failures print as `path:line: message`;
with GITHUB_ACTIONS=true they also print as `::error` annotations. Checks named by
`--advisory` also run, but print `path:line: warning: message` (`::warning` annotations) and do
not change the exit code.
"""

from __future__ import annotations

import argparse
import datetime
import os
import re
import subprocess
import sys
import unicodedata
from collections.abc import Callable
from pathlib import Path
from typing import NamedTuple
from urllib.parse import unquote


class Failure(NamedTuple):
    path: str
    line: int
    message: str


# Names of external agent tooling the docs must not depend on. The hyphenated names are
# forbidden as plain tokens and as slash commands; the single words are forbidden only as
# slash commands (as plain words they are ordinary English).
TOOLING_NAMES = (
    "setup-matt-pocock-skills",
    "improve-codebase-architecture",
    "git-guardrails-claude-code",
    "setup-pre-commit",
    "writing-for-agents",
    "grill-with-docs",
    "grill-me",
    "ask-matt",
    "domain-modeling",
    "codebase-design",
    "diagnosing-bugs",
    "implement-spec",
    "to-spec",
    "to-tickets",
    "to-questionnaire",
    "wait-what",
    "loop-me",
    "chief-of-staff",
    "claude-handoff",
    "scaffold-exercises",
    "migrate-to-shoehorn",
    "setup-ts-deep-modules",
    "writing-fragments",
    "writing-beats",
    "writing-shape",
)
TOOLING_COMMAND_ONLY = (
    "triage",
    "tdd",
    "wayfinder",
    "retro",
    "pr",
    "prototype",
    "code-review",
    "research",
    "handoff",
    "teach",
    "grilling",
    "wizard",
    "implement",
)

CHECKS = ("links", "adr", "glossary", "tooling", "index")
OPT_IN_CHECKS = ("adr-format",)

FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
CODE_SPAN = re.compile(r"(?<!`)(`+)(?!`).+?(?<!`)\1(?!`)")
INLINE_LINK = re.compile(
    r"!?\[((?:[^\[\]\\]|\\.|\[[^\[\]]*\])*)\]"
    r"\(\s*(<[^<>\n]*>|(?:[^\s()\\]|\\.|\([^\s()]*\))*)"
    r"(?:\s+(?:\"[^\"]*\"|'[^']*'|\([^)]*\)))?\s*\)"
)
REFERENCE_DEFINITION = re.compile(r"^ {0,3}\[([^\]]+)\]:[ \t]*(<[^<>]*>|\S+)")
URL_SCHEME = re.compile(r"^[A-Za-z][A-Za-z0-9+.\-]*:")
HEADING = re.compile(r"^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*$")
HTML_ANCHOR = re.compile(r"""\b(?:id|name)\s*=\s*["']([^"']+)["']""")

ADR_NAME = re.compile(r"^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$")
ADR_STATUSES = ("proposed", "accepted", "deprecated", "superseded")
ADR_STATUS_LINE = re.compile(r"^- \*\*Status:\*\*[ \t]*(.*?)[ \t]*$", re.MULTILINE)
ADR_DATE_LINE = re.compile(r"^- \*\*Date:\*\*[ \t]*(.*?)[ \t]*$", re.MULTILINE)
ADR_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ADR_ROW_LINK = re.compile(r"^\[(\d{4})\]\(([^)]*)\)$")
MARKDOWN_LINK = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")

TERM_LINE = re.compile(r"^\*\*.*:$")
BOLD = re.compile(r"\*\*([^*]+)\*\*")
GLOSSARY_LINK = re.compile(
    r"!?\[[^\]]*\]\([^)]*\)|\[[^\]]+\]\[[^\]]*\]|^\s*\[[^\]]+\]:\s|<[A-Za-z][A-Za-z0-9+.\-]*:[^>\s]*>"
)


def git_markdown_files(root: Path) -> list[str]:
    out = subprocess.run(
        ["git", "ls-files", "-z", "--", "*.md"],  # noqa: S607
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    files = [f for f in out.split("\0") if f and Path(f).name != "CHANGELOG.md"]
    return sorted(f for f in files if (root / f).is_file())


def read(root: Path, rel: str) -> str:
    return (root / rel).read_text(encoding="utf-8", errors="replace")


def prose_lines(text: str):
    """(line number, line) outside fenced code blocks, fence lines excluded."""
    fence: str | None = None
    for number, line in enumerate(text.splitlines(), 1):
        match = FENCE.match(line)
        if fence is None:
            if match:
                fence = match.group(1)
                continue
            yield number, line
        elif match and match.group(1)[0] == fence[0] and len(match.group(1)) >= len(fence):
            fence = None


def mask_code_spans(line: str) -> str:
    return CODE_SPAN.sub(lambda m: " " * len(m.group(0)), line)


def link_targets(text: str) -> list[tuple[int, str]]:
    """(line, target) of inline links, images and reference definitions outside code."""
    found: list[tuple[int, str]] = []

    def scan(line: str, number: int) -> None:
        for match in INLINE_LINK.finditer(line):
            target = match.group(2)
            if target.startswith("<") and target.endswith(">"):
                target = target[1:-1]
            found.append((number, target))
            scan(match.group(1), number)  # an image inside a link's text

    for number, line in prose_lines(text):
        definition = REFERENCE_DEFINITION.match(line)
        if definition and not definition.group(1).startswith("^"):
            target = definition.group(2)
            found.append((number, target[1:-1] if target.startswith("<") else target))
            continue
        scan(mask_code_spans(line), number)
    return found


def slugify(heading: str) -> str:
    """GitHub's heading anchor: links reduced to their text, lowercase, only letters, numbers,
    `_`, `-` and spaces kept, spaces turned into hyphens."""
    heading = re.sub(r"\s+#+$", "", heading)
    heading = MARKDOWN_LINK.sub(r"\1", heading)
    heading = re.sub(r"\[([^\]]*)\]\[[^\]]*\]", r"\1", heading).lower()
    kept = "".join(c for c in heading if c in "_- " or unicodedata.category(c)[0] in "LNM")
    return kept.replace(" ", "-")


def anchors_of(text: str) -> set[str]:
    anchors: set[str] = set()
    seen: dict[str, int] = {}
    for _, line in prose_lines(text):
        heading = HEADING.match(line)
        if heading:
            slug = slugify(heading.group(2))
            count = seen.get(slug, 0)
            seen[slug] = count + 1
            anchors.add(slug if count == 0 else f"{slug}-{count}")
        anchors.update(HTML_ANCHOR.findall(line))
    return anchors


def check_links(root: Path, files: list[str]) -> list[Failure]:
    failures: list[Failure] = []
    root_resolved = os.path.normpath(root.resolve())
    anchor_cache: dict[str, set[str]] = {}

    def anchors_for(path: str) -> set[str]:
        if path not in anchor_cache:
            text = Path(path).read_text(encoding="utf-8", errors="replace")
            anchor_cache[path] = anchors_of(text)
        return anchor_cache[path]

    for rel in files:
        text = read(root, rel)
        base = os.path.dirname(os.path.join(root_resolved, rel))
        for number, raw in link_targets(text):
            if not raw or URL_SCHEME.match(raw) or raw.startswith("//"):
                continue
            path_part, _, anchor = raw.partition("#")
            path_part = unquote(path_part.partition("?")[0])
            anchor = unquote(anchor)
            if path_part:
                start = root_resolved if path_part.startswith("/") else base
                target = os.path.normpath(os.path.join(start, path_part.lstrip("/")))
                if target != root_resolved and not target.startswith(root_resolved + os.sep):
                    failures.append(Failure(rel, number, f"link '{raw}' leaves the repository"))
                    continue
                if not os.path.exists(target):
                    failures.append(Failure(rel, number, f"link '{raw}' does not exist"))
                    continue
            else:
                target = os.path.join(root_resolved, rel)
            if not anchor or not (os.path.isfile(target) and target.endswith(".md")):
                continue
            known = anchors_for(target)
            if anchor not in known and anchor.lower() not in known:
                failures.append(
                    Failure(rel, number, f"link '{raw}': no heading or id '{anchor}' in the target")
                )
    return failures


def parse_adr_table(text: str) -> tuple[int, dict[str, int], list[tuple[int, list[str]]]]:
    """(header line, column index by lowercase name, [(line, cells)]) of the ADR table."""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        cells = split_row(line)
        names = [c.lower() for c in cells]
        if line.lstrip().startswith("|") and "adr" in names:
            columns = {
                name: names.index(name)
                for name in ("adr", "title", "status", "date")
                if name in names
            }
            rows = []
            for j in range(i + 2, len(lines)):
                if not lines[j].lstrip().startswith("|"):
                    break
                rows.append((j + 1, split_row(lines[j])))
            return i + 1, columns, rows
    return 0, {}, []


def split_row(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def status_word(value: str) -> str:
    words = re.findall(r"[A-Za-z]+", MARKDOWN_LINK.sub(r"\1", value))
    return words[0].lower() if words else ""


def check_adr(root: Path, files: list[str]) -> list[Failure]:
    if not (root / "docs" / "adr").is_dir():
        return []
    failures: list[Failure] = []
    adrs: dict[str, str] = {}  # number -> file name
    for rel in sorted(files):
        directory, name = os.path.split(rel)
        if directory != "docs/adr" or name == "README.md":
            continue
        match = ADR_NAME.match(name)
        if not match:
            failures.append(
                Failure(rel, 1, "ADR file names are NNNN-kebab-slug.md (four digits, lowercase)")
            )
            continue
        number = match.group(1)
        if number in adrs:
            failures.append(Failure(rel, 1, f"ADR number {number} is also used by {adrs[number]}"))
            continue
        adrs[number] = name

    numbers = sorted(int(n) for n in adrs if n != "0000")
    for expected in range(1, (numbers[-1] if numbers else 0) + 1):
        if expected not in numbers:
            failures.append(
                Failure("docs/adr", 1, f"ADR numbers have a gap: {expected:04d} is missing")
            )

    details: dict[str, tuple[str, str]] = {}  # number -> (status, date), "" when absent
    for number, name in sorted(adrs.items()):
        if number == "0000":
            continue
        rel = f"docs/adr/{name}"
        failures += check_adr_text(read(root, rel), rel, number, details)

    failures += check_adr_index(root, adrs, details)
    return failures


def adr_frontmatter(lines: list[str]) -> tuple[dict[str, tuple[int, str]], int]:
    """(lowercase key -> (line, value), index of the first line after the frontmatter)."""
    if not lines or lines[0].strip() != "---":
        return {}, 0
    for end in range(1, len(lines)):
        if lines[end].strip() == "---":
            values = {}
            for i in range(1, end):
                key, sep, value = lines[i].partition(":")
                if sep:
                    values[key.strip().lower()] = (i + 1, value.strip().strip("\"'"))
            return values, end + 1
    return {}, 0


def check_adr_text(
    text: str, rel: str, number: str, details: dict[str, tuple[str, str]]
) -> list[Failure]:
    """One ADR: a '# Title' heading, and optional status and date, either in YAML frontmatter
    (`status:`, `date:`) or as '- **Status:**' and '- **Date:**' bullets."""
    failures: list[Failure] = []
    lines = text.splitlines()
    front, body_start = adr_frontmatter(lines)
    title_index = next((i for i in range(body_start, len(lines)) if lines[i].strip()), None)
    title = lines[title_index] if title_index is not None else ""
    if not title.startswith("# ") or not title[2:].strip():
        failures.append(Failure(rel, (title_index or 0) + 1, "must start with a '# Title' heading"))
    else:
        numbered = re.match(r"^# (\d{4})\.", title)
        if numbered and numbered.group(1) != number:
            failures.append(
                Failure(rel, title_index + 1, f"title number {numbered.group(1)} is not {number}")
            )

    status, status_line = "", 1
    if "status" in front:
        status_line, status = front["status"]
    elif match := ADR_STATUS_LINE.search(text):
        status, status_line = match.group(1), text[: match.start()].count("\n") + 1
    if status and status_word(status) not in ADR_STATUSES:
        failures.append(
            Failure(
                rel,
                status_line,
                f"status '{status}' must start with Proposed, Accepted, Deprecated or Superseded",
            )
        )

    date, date_line = "", 1
    if "date" in front:
        date_line, date = front["date"]
    elif match := ADR_DATE_LINE.search(text):
        date, date_line = match.group(1), text[: match.start()].count("\n") + 1
    if date:
        try:
            if not ADR_DATE.match(date):
                raise ValueError(date)
            datetime.date.fromisoformat(date)
        except ValueError:
            failures.append(Failure(rel, date_line, f"date '{date}' must be a valid YYYY-MM-DD"))
    details[number] = (status, date)
    return failures


def adr_index_links(text: str, adrs: dict[str, str], readme: str) -> list[Failure]:
    """An index without a table: a link to every ADR file anywhere in the README."""
    linked: set[str] = set()
    failures: list[Failure] = []
    for line, raw in link_targets(text):
        name = unquote(raw.partition("#")[0]).removeprefix("./")
        match = ADR_NAME.match(name)
        if not match or name == "0000-template.md":
            continue
        if adrs.get(match.group(1)) != name:
            failures.append(Failure(readme, line, f"link to {name}, which is not an ADR file"))
        linked.add(match.group(1))
    for number in sorted(set(adrs) - linked - {"0000"}):
        failures.append(Failure(readme, 1, f"no link to {adrs[number]}"))
    return failures


def check_adr_index(
    root: Path, adrs: dict[str, str], details: dict[str, tuple[str, str]]
) -> list[Failure]:
    readme = "docs/adr/README.md"
    if not (root / readme).is_file():
        return [Failure(readme, 1, "missing; it indexes the ADRs")] if details else []
    text = read(root, readme)
    header_line, columns, rows = parse_adr_table(text)
    if "adr" not in columns:
        return adr_index_links(text, adrs, readme)
    failures: list[Failure] = []
    listed: set[str] = set()
    for line, cells in rows:
        if len(cells) < len(columns):
            failures.append(Failure(readme, line, "row has too few cells"))
            continue
        link = ADR_ROW_LINK.match(cells[columns["adr"]])
        if not link:
            failures.append(Failure(readme, line, "first cell must be [NNNN](NNNN-slug.md)"))
            continue
        number, href = link.groups()
        if number == "0000" or number not in adrs:
            failures.append(Failure(readme, line, f"row for {number}, which is not an ADR file"))
            continue
        if number in listed:
            failures.append(Failure(readme, line, f"ADR {number} is listed twice"))
            continue
        listed.add(number)
        if href != adrs[number]:
            failures.append(Failure(readme, line, f"link must be ({adrs[number]}), not ({href})"))
        status, date = details.get(number, ("", ""))
        if "status" in columns and status:
            row_status = cells[columns["status"]]
            if status_word(row_status) != status_word(status):
                failures.append(
                    Failure(
                        readme,
                        line,
                        f"status '{row_status}' does not match {adrs[number]} ('{status}')",
                    )
                )
        if "date" in columns and date and cells[columns["date"]] != date:
            failures.append(
                Failure(
                    readme,
                    line,
                    f"date '{cells[columns['date']]}' does not match {adrs[number]} ('{date}')",
                )
            )
    for number in sorted(set(adrs) - listed - {"0000"}):
        failures.append(Failure(readme, header_line or 1, f"no table row for {adrs[number]}"))
    return failures


ADR_FORMAT_NAME = re.compile(r"^\d{4}-[a-z0-9]+(-[a-z0-9]+)*\.md$")
ADR_FORMAT_STATUS = re.compile(r"^(proposed|accepted|deprecated|superseded by ADR-\d{4})$")
ADR_FORMAT_H2 = ("Considered Options", "Consequences")
ADR_SUMMARY_STRIP = re.compile(r"`[^`]*`|\([^)]*\)|\b(?:e\.g|i\.e|etc|vs)\.")


def check_adr_format(root: Path, files: list[str]) -> list[Failure]:
    return [
        f
        for rel in sorted(files)
        if os.path.dirname(rel) == "docs/adr" and os.path.basename(rel) != "README.md"
        for f in check_adr_format_text(read(root, rel), rel)
    ]


def check_adr_format_text(text: str, rel: str) -> list[Failure]:
    """The strict layout: '---', status, date, '---', blank, '# Title', summary, optional
    '## Considered Options' and '## Consequences', one final newline."""
    failures: list[Failure] = []
    name = os.path.basename(rel)

    def fail(line: int, message: str) -> None:
        failures.append(Failure(rel, line, message))

    if not ADR_FORMAT_NAME.match(name):
        fail(1, "file name must be NNNN-kebab-slug.md")
    if not text.endswith("\n") or text.endswith("\n\n"):
        fail(max(text.count("\n"), 1), "must end with exactly one newline")
    lines = text.split("\n")
    if len(lines) < 6 or lines[0] != "---" or lines[3] != "---":
        fail(1, "lines 1-4 must be '---', 'status: ...', 'date: ...', '---'")
        return failures
    pairs = [line.partition(":") for line in lines[1:3]]
    if [key for key, _, _ in pairs] != ["status", "date"]:
        fail(2, "frontmatter must hold exactly the keys status and date, in that order")
        return failures
    status, date = pairs[0][2].strip(), pairs[1][2].strip()
    if not ADR_FORMAT_STATUS.match(status):
        fail(
            2, f"status '{status}' must be proposed, accepted, deprecated or superseded by ADR-NNNN"
        )
    if name == "0000-template.md":
        if date != "YYYY-MM-DD":
            fail(3, "the template's date must be the literal YYYY-MM-DD")
    elif not ADR_DATE.match(date):
        fail(3, f"date '{date}' must be YYYY-MM-DD")
    else:
        try:
            datetime.date.fromisoformat(date)
        except ValueError:
            fail(3, f"date '{date}' is not a valid date")

    if lines[4] != "":
        fail(5, "line 5 must be blank")
    if not lines[5].startswith("# ") or re.match(r"# \d", lines[5]):
        fail(6, "line 6 must be '# Title' without a number prefix")

    h2: list[str] = []
    for number, line in prose_lines(text):
        if number <= 6:
            continue
        heading = re.match(r"^(#{1,6}) (.*)$", line)
        if not heading:
            continue
        level = len(heading.group(1))
        if level == 1:
            fail(number, "only one '# Title' heading is allowed")
        elif level > 2:
            fail(number, "headings deeper than '##' are not allowed")
        elif heading.group(2).strip() not in ADR_FORMAT_H2:
            fail(number, "the only sections are '## Considered Options' and '## Consequences'")
        else:
            h2.append(heading.group(2).strip())
    if h2 != [h for h in ADR_FORMAT_H2 if h in h2]:
        fail(1, "sections must be in the order Considered Options, Consequences, each once")

    summary_line = next((i for i in range(6, len(lines)) if lines[i].strip()), None)
    summary: list[str] = []
    for line in lines[summary_line:] if summary_line is not None else []:
        if not line.strip():
            break
        summary.append(line)
    first = summary[0] if summary else ""
    if not summary or first[0] in "-*|#>" or first[0].isdigit():
        fail((summary_line or 6) + 1, "the title is followed by a prose summary paragraph")
    else:
        cleaned = ADR_SUMMARY_STRIP.sub("", " ".join(summary))
        count = len(re.findall(r"[.!?](?=\s|$)", cleaned))
        if not 1 <= count <= 3:
            fail(summary_line + 1, f"the summary has {count} sentences; use one to three")
    return failures


def sentence_count(definition: str) -> int:
    text = re.sub(r"\b(e\.g\.|i\.e\.)", "eg", definition, flags=re.IGNORECASE)
    return len(re.findall(r"[.!?](?=\s|$)", text))


def check_glossary_text(text: str, path: str = "GLOSSARY.md") -> list[Failure]:
    failures: list[Failure] = []
    lines = text.splitlines()
    if not lines or not re.match(r"^# \S", lines[0]):
        failures.append(Failure(path, 1, "line 1 must be '# <context name>'"))

    language = None
    description = False
    for i, line in enumerate(lines[1:], 2):
        if line.startswith("## "):
            if line.rstrip() == "## Language" and language is None:
                language = i
            if not description and language is None:
                break
            continue
        if language is None and line.strip() and not line.startswith("#"):
            description = True
    if not description:
        failures.append(Failure(path, 2, "a description paragraph must follow the title"))
    if language is None:
        failures.append(Failure(path, 1, "missing a '## Language' section"))

    for number, line in enumerate(lines, 1):
        if "`" in line:
            failures.append(
                Failure(path, number, "no code spans: the glossary holds definitions only")
            )
        if GLOSSARY_LINK.search(line):
            failures.append(Failure(path, number, "no links: the glossary holds definitions only"))

    if language is not None:
        failures += glossary_language(lines, language, path)
    return failures


def glossary_language(lines: list[str], start: int, path: str) -> list[Failure]:
    failures: list[Failure] = []
    seen: dict[str, int] = {}
    state = "idle"  # idle | term | definition | avoid
    term_line = 0

    def missing_definition() -> None:
        failures.append(Failure(path, term_line, "term line needs a definition on the next line"))

    for number in range(start + 1, len(lines) + 1):
        line = lines[number - 1]
        if line.startswith("## "):
            break
        if not line.strip() or line.startswith("### "):
            if state == "term":
                missing_definition()
            state = "idle"
        elif line.startswith("#"):
            failures.append(Failure(path, number, "only '###' subheadings are allowed here"))
        elif line.startswith("_Avoid_:"):
            if state != "definition":
                failures.append(
                    Failure(path, number, "_Avoid_ must directly follow a term's definition")
                )
            elif not line[len("_Avoid_:") :].strip():
                failures.append(Failure(path, number, "_Avoid_ needs a comma-separated list"))
            if state == "term":
                missing_definition()
            state = "avoid"
        elif TERM_LINE.match(line) and BOLD.search(line):
            if state == "term":
                missing_definition()
            for term in BOLD.findall(line):
                key = term.strip().lower()
                if key in seen:
                    failures.append(
                        Failure(
                            path, number, f"duplicate term '{term}' (first on line {seen[key]})"
                        )
                    )
                seen.setdefault(key, number)
            state, term_line = "term", number
        elif state == "term":
            if sentence_count(line) > 2:
                failures.append(Failure(path, number, "a definition is at most two sentences"))
            state = "definition"
        else:
            failures.append(
                Failure(
                    path,
                    number,
                    "expected a blank line, a '###' subheading or a term line "
                    "(**Term**:) with one definition line",
                )
            )
            state = "idle"
    if state == "term":
        missing_definition()
    return failures


def check_glossary(root: Path, files: list[str]) -> list[Failure]:
    if not (root / "GLOSSARY.md").is_file():
        return []
    return check_glossary_text(read(root, "GLOSSARY.md"))


def _tooling_patterns() -> list[tuple[re.Pattern[str], str]]:
    plain = r"(?<![A-Za-z0-9_-])(?:{})(?![A-Za-z0-9_-])"
    command = r"""(?:^|(?<=[\s`("]))/(?:{})(?![A-Za-z0-9_/-]|\.[A-Za-z0-9])"""
    names = "|".join(re.escape(n) for n in sorted(TOOLING_NAMES, key=len, reverse=True))
    commands = "|".join(
        re.escape(n) for n in sorted(TOOLING_NAMES + TOOLING_COMMAND_ONLY, key=len, reverse=True)
    )
    return [
        (re.compile(r"pocock", re.IGNORECASE), "names external agent tooling"),
        (re.compile(r"SKILL\.md"), "names external agent tooling (SKILL.md)"),
        (re.compile(r"Skill tool"), "names external agent tooling (Skill tool)"),
        (re.compile(plain.format(names)), "names external agent tooling"),
        (re.compile(command.format(commands)), "names an external agent command"),
    ]


TOOLING_PATTERNS = _tooling_patterns()


def check_tooling_text(text: str, path: str) -> list[Failure]:
    failures = []
    for number, line in enumerate(text.splitlines(), 1):
        for pattern, message in TOOLING_PATTERNS:
            match = pattern.search(line)
            if match:
                failures.append(
                    Failure(path, number, f"'{match.group(0)}' {message}; docs must stand alone")
                )
    return failures


def check_tooling(root: Path, files: list[str]) -> list[Failure]:
    return [f for rel in files for f in check_tooling_text(read(root, rel), rel)]


def check_index(root: Path, files: list[str]) -> list[Failure]:
    docs = [
        f
        for f in files
        if f.startswith("docs/") and f != "docs/README.md" and not f.startswith("docs/adr/")
    ]
    if not docs:
        return []
    index = "docs/README.md"
    if index not in files:
        return [Failure(index, 1, "missing; it must link every document under docs/")]
    base = os.path.dirname(os.path.join(os.path.normpath(root.resolve()), index))
    linked = set()
    for _, raw in link_targets(read(root, index)):
        if URL_SCHEME.match(raw):
            continue
        path_part = unquote(raw.partition("#")[0])
        if path_part:
            linked.add(os.path.normpath(os.path.join(base, path_part)))
    root_resolved = os.path.normpath(root.resolve())
    return [
        Failure(index, 1, f"{doc} is not linked from {index}")
        for doc in docs
        if os.path.join(root_resolved, doc) not in linked
    ]


RUNNERS: dict[str, Callable[[Path, list[str]], list[Failure]]] = {
    "links": check_links,
    "adr": check_adr,
    "glossary": check_glossary,
    "tooling": check_tooling,
    "index": check_index,
    "adr-format": check_adr_format,
}


def escape_annotation(message: str) -> str:
    return message.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".", help="repository root (default: current directory)")
    parser.add_argument(
        "--advisory",
        nargs="+",
        default=[],
        metavar="CHECK",
        choices=[*CHECKS, *OPT_IN_CHECKS],
        help="checks that run but only warn",
    )
    parser.add_argument(
        "checks",
        nargs="*",
        metavar="CHECK",
        choices=[*CHECKS, *OPT_IN_CHECKS],
        help=", ".join([*CHECKS, *OPT_IN_CHECKS]),
    )
    args = parser.parse_args(argv)
    root = Path(args.root)
    selected = args.checks or list(CHECKS)
    files = git_markdown_files(root)
    annotate = os.environ.get("GITHUB_ACTIONS") == "true"

    def show(failure: Failure, level: str) -> None:
        label = "warning: " if level == "warning" else ""
        print(f"{failure.path}:{failure.line}: {label}{failure.message}")
        if annotate:
            message = escape_annotation(failure.message)
            print(f"::{level} file={failure.path},line={failure.line}::{message}")

    failures = [f for name in selected for f in RUNNERS[name](root, files)]
    warnings = [f for name in args.advisory for f in RUNNERS[name](root, files)]
    for failure in failures:
        show(failure, "error")
    for warning in warnings:
        show(warning, "warning")
    if failures:
        print(f"\nFAILED: {len(failures)} problem(s). See docs/RULES.md.")
        return 1
    suffix = f" ({len(warnings)} warning(s) from {', '.join(args.advisory)})" if warnings else ""
    print(f"OK: {', '.join(selected)} passed for {len(files)} Markdown files.{suffix}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
