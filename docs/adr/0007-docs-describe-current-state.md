---
status: accepted
date: 2026-10-06
---

# Docs describe the current system; rationale lives in ADRs

`docs/` describes only the current system, rationale and history live in ADRs, and the working documents of the previous Vue 2 + .NET 6 app (task board, question log, archive of its behaviour) are not in the tree. Mixing them into the working docs made it hard to tell what the system does today. The old working documents remain available at the [`migration-complete` tag](https://github.com/itsnotapt/tim-data-investigate-platform/tree/migration-complete).

The previous app is gone, there is no data to carry over and no compatibility to keep.

- `docs/` describes the system as it is: architecture, API, configuration, development, operations and deployment. Docs and code comments contain no history, task IDs or justification.
- Rationale and history are recorded only in ADRs in `docs/adr/`.
- Docs live in the repo, versioned and reviewed with the code, and are updated in the same change as the code. A stale doc is treated as a bug.
- Work is tracked outside the docs (issues, PRs); there is no in-repo task board or question log.
- Working rules are in [RULES.md](../RULES.md).

Decided by the user. Related: [RULES.md](../RULES.md).

## Considered Options

| Option | Pros | Cons |
|---|---|---|
| Track work and decisions in an issue tracker (GitHub Issues) | Familiar tooling | Not versioned with the code; agents may not have access |
| Keep the old docs alongside current docs | Nothing lost from the tree | Stale, contradictory guidance; readers must filter history |
| Delete the old docs from the tree (chosen) | Docs are short and current | Their content is no longer at hand in the tree |

## Consequences

- ADRs state their reasons in full and don't cite the old working documents.
