---
status: accepted
date: 2026-09-29
---

# Rewrite TIM as React + Python in `web/` and `api/`

The legacy TIM app is Vue 2.7 + Vuetify 2 with a .NET 6 backend, both out of support, so TIM is rebuilt with a **React (TypeScript)** frontend in `web/` and a **Python (FastAPI)** backend in `api/`, both at the repo root. The first goal is **feature parity** with the legacy app, with legacy bugs and security issues fixed rather than ported.

Vue 2 reached end of life on 2023-12-31, and .NET 6 is also out of support. Neither has meaningful tests. The helm charts don't work as shipped, and there are known security issues (`docs/current-system/known-issues.md`, preserved at git tag `migration-complete`). Parity is measured against `docs/current-system/` and its screenshots, also preserved at that tag.

Each app has its own README, tooling config and Dockerfile. CI has separate path-filtered workflows, `build-web.yml` and `build-api.yml`.

Decided by the user (initial request, Q-000; layout Q-019). Related: Q-000, Q-012, Q-019, [architecture.md](../architecture.md).

## Considered Options

| Option | Pros | Cons |
|---|---|---|
| Upgrade in place (Vue 3 + .NET 8) | Less rewrite | Not what the user wants; Vuetify 2→3 is itself close to a rewrite |
| React + Python, replacing `frontend/` and `backend/` in place | Keeps familiar paths | Loses the side-by-side reference; messy history |
| React + Python in separate repos | Independent CI | Harder to keep the docs and both apps in step |
| React + Python in `web/` and `api/` in one repo (chosen) | User's choice; large ecosystems; good Azure SDKs (`msal`, `azure-kusto-data`); clear names; one repo | Full rewrite; AG Grid/Monaco integration must be redone |

## Consequences

- Library choices inside each stack (UI kit, state management, datastore) are separate decisions (Q-001, Q-012, …).
