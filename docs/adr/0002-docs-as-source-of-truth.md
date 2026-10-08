---
status: superseded by ADR-0007
date: 2026-09-29
---

# `docs/` is the source of truth for the rewrite

Many agents and sessions will work on the rewrite, each starting without context, and re-reading the legacy source every time is slow and lets answers drift between sessions. So `docs/` in the repo is the source of truth, and docs are updated in the same change as the code.

This decision is superseded by [0007](0007-docs-describe-current-state.md).

- `docs/RULES.md` defines how to work; `docs/README.md` holds current status; `docs/open-questions.md` logs every question with a permanent ID; ADRs record decisions; `docs/rewrite/work-breakdown.md` is the task board.
- Priority order: user answers > Accepted ADRs > documented legacy behaviour > legacy code > judgement (RULES §2 at the time).
- Where docs and legacy code disagree, the code wins and the doc gets fixed.

Decided by the user (asked for "a doc set of rules to allow future agents to continue the work"). Related: [RULES.md](../RULES.md). The files named above (`open-questions.md`, `rewrite/work-breakdown.md`) are preserved at git tag `migration-complete`.

## Considered Options

| Option | Pros | Cons |
|---|---|---|
| Issue tracker (GitHub Issues) | Familiar tooling | Not versioned with the code; agents may not have access |
| Docs in repo (chosen) | Versioned, reviewable, available offline to any agent | Needs discipline to keep current |

## Consequences

Each task's definition of done includes doc updates. A stale README Status is treated as a bug.
