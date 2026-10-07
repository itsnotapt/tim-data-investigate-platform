# 0001. Rewrite TIM as React + Python

- **Status:** Accepted
- **Date:** 2026-09-29
- **Deciders:** the user (initial request, Q-000)
- **Related:** Q-000, Q-012, [architecture.md](../architecture.md)

## Context
The legacy TIM app is Vue 2.7 + Vuetify 2 (Vue 2 reached end of life on 2023-12-31) with a .NET 6 backend (also out of support). Neither has meaningful tests. The helm charts don't work as shipped, and there are known security issues (`docs/current-system/known-issues.md`, preserved at git tag `migration-complete`).

## Decision
Rebuild the frontend in **React (TypeScript)** and the backend in **Python (FastAPI)**. The first goal is **feature parity** with the legacy app, as documented in `docs/current-system/` and its screenshots. Legacy bugs and security issues are fixed rather than ported. The legacy code stays in the repo as a read-only reference until cut-over.

## Alternatives considered
| Option | Pros | Cons |
|---|---|---|
| Upgrade in place (Vue 3 + .NET 8) | Less rewrite | Not what the user wants; Vuetify 2→3 is itself close to a rewrite |
| React + Python (chosen) | User's choice; large ecosystems; good Azure SDKs (`msal`, `azure-kusto-data`) | Full rewrite; AG Grid/Monaco integration must be redone |

## Consequences
- Every legacy behaviour must be specified in the docs before it is rebuilt (see ADR-0002).
- Library choices inside each stack (UI kit, state management, datastore) are separate decisions (Q-001, Q-012, …).
