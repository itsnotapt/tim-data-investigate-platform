# 0007. Docs describe the current system; rationale lives in ADRs

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** the user
- **Related:** supersedes [0002](0002-docs-as-source-of-truth.md); [RULES.md](../RULES.md)

## Context
ADR-0002 set up `docs/` to drive the move from the Vue 2 + .NET 6 app to React + Python: a task board, a question log, an archive of the old system's behaviour and a parity report. That work is finished. The old system is gone, there is no data to migrate and no compatibility to keep, so those documents only describe history. Mixing history into the working docs makes it harder to tell what the system does today.

The migration-era documents are preserved at git tag `migration-complete` (`git show migration-complete:docs/<path>`).

## Decision
- `docs/` describes the system as it is: architecture, API, configuration, development, operations and deployment. Docs and code comments contain no history, task IDs or justification.
- Rationale and history are recorded only in ADRs in `docs/decisions/`.
- The code is the source of truth. Docs are updated in the same change as the code; where they disagree, the doc is fixed.
- Work is tracked outside the docs (issues, PRs); there is no in-repo task board or question log.
- Working rules are in [RULES.md](../RULES.md).

## Alternatives considered
| Option | Pros | Cons |
|---|---|---|
| Keep the migration docs alongside current docs | Nothing lost from the tree | Stale, contradictory guidance; readers must filter history |
| Delete migration docs, keep them reachable via a git tag (chosen) | Docs are short and current; history still recoverable | History needs a `git show` to read |

## Consequences
- `docs/rewrite/`, `docs/current-system/` and `docs/open-questions.md` are removed from the tree.
- ADR references to those files point at the `migration-complete` tag.
