---
status: accepted
date: 2026-09-29
---

# Rewrite TIM as React + Python

The legacy TIM app is Vue 2.7 + Vuetify 2 with a .NET 6 backend, both out of support, so TIM is rebuilt with a **React (TypeScript)** frontend and a **Python (FastAPI)** backend. The first goal is **feature parity** with the legacy app, with legacy bugs and security issues fixed rather than ported.

Vue 2 reached end of life on 2023-12-31, and .NET 6 is also out of support. Neither has meaningful tests. The helm charts don't work as shipped, and there are known security issues (`docs/current-system/known-issues.md`, preserved at git tag `migration-complete`). Parity is measured against `docs/current-system/` and its screenshots. The legacy code stays in the repo as a read-only reference until cut-over.

Decided by the user (initial request, Q-000). Related: Q-000, Q-012, [architecture.md](../architecture.md).

## Considered Options

| Option | Pros | Cons |
|---|---|---|
| Upgrade in place (Vue 3 + .NET 8) | Less rewrite | Not what the user wants; Vuetify 2→3 is itself close to a rewrite |
| React + Python (chosen) | User's choice; large ecosystems; good Azure SDKs (`msal`, `azure-kusto-data`) | Full rewrite; AG Grid/Monaco integration must be redone |

## Consequences

- Every legacy behaviour must be specified in the docs before it is rebuilt (see ADR-0002).
- Library choices inside each stack (UI kit, state management, datastore) are separate decisions (Q-001, Q-012, …).
