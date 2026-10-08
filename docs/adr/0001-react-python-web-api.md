---
status: accepted
date: 2026-09-29
---

# TIM is React + Python in `web/` and `api/`

TIM has a **React (TypeScript)** frontend in `web/` and a **Python (FastAPI)** backend in `api/`, both at the repo root. The previous app (Vue 2.7 + Vuetify 2 with a .NET 6 backend) ran on stacks that are out of support, without meaningful tests, and with known security issues.

Vue 2 reached end of life on 2023-12-31, and .NET 6 is also out of support. Each app has its own README, tooling config and Dockerfile. CI has separate path-filtered workflows, `build-web.yml` and `build-api.yml`.

Decided by the user. Related: [architecture.md](../architecture.md).

## Considered Options

| Option | Pros | Cons |
|---|---|---|
| Upgrade Vue and .NET in place (Vue 3 + .NET 8) | Less new code | Not what the user wants; Vuetify 2 to 3 means redoing most of the UI |
| React + Python in separate repos | Independent CI | Harder to keep the docs and both apps in step |
| React + Python in `web/` and `api/` in one repo (chosen) | User's choice; large ecosystems; good Azure SDKs (`msal`, `azure-kusto-data`); clear names; one repo | AG Grid and Monaco integration had to be built again |

## Consequences

- Library choices inside each stack (UI kit, state management, datastore) are separate decisions.
