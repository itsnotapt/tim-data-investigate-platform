# TIM rewrite documentation

TIM ("triage and investigation") is a Kusto investigation platform: analysts run KQL, pivot between data sources using shared query templates, and tag and annotate events. This folder captures the **legacy system** (Vue 2 + .NET 6) and the plan for rebuilding it as **React + Python**.

**Agents: read [RULES.md](RULES.md) first.**

## Status
| | |
|---|---|
| Phase | **0 — Discovery & documentation** (wrapping up; Blocking questions answered 2026-09-29) |
| Last updated | 2026-09-29 |
| Done | Legacy explored; 42 screenshots + index; harness (`tools/legacy-screenshots/`); rules; all current-system docs (overview, data models, API, frontend, workflows, infra, known issues); target architecture (Proposed); component mapping; work breakdown; ADRs 0001–0006; root `CLAUDE.md` |
| Next | Phase 0 wrap-up: P0-16 (`rewrite/api-contract.md`), then **Phase 1 scaffolding** (`web/`, `api/`, tooling, CI, compose with Postgres). Decisions so far: PostgreSQL, AG Grid Enterprise unlicensed in dev, popup + OBO, no data migration, `web/` + `api/` (ADR-0003…0006). Only Blocking question: Q-027 (production AG Grid licence, blocks deploy only) |

## Map
| Path | Contents |
|---|---|
| [RULES.md](RULES.md) | How to work: sources of truth, questions, docs, engineering defaults, git |
| [open-questions.md](open-questions.md) | Question log: Blocking / Open / Assumed / Answered |
| **current-system/** | What exists today |
| ├ [backend-api.md](current-system/backend-api.md) | Every endpoint, auth, persistence, Kusto tables, config |
| ├ [frontend-architecture.md](current-system/frontend-architecture.md) | Bootstrap, routes, store, IndexedDB, event bus, auth, polling, templates, Monaco, config |
| ├ [frontend-components.md](current-system/frontend-components.md) | Per-component inventory with UI text, behaviour and complexity |
| ├ [workflows.md](current-system/workflows.md) | End-to-end user workflows W1–W14 |
| ├ [infrastructure.md](current-system/infrastructure.md) | Docker, nginx, compose, Helm, CI, Azure dependencies |
| ├ [known-issues.md](current-system/known-issues.md) | SEC-/BUG- IDs and dead code; don't port these |
| └ [screenshots/](current-system/screenshots/) | 42 PNGs of the legacy UI (mocked data) |
| ├ [overview.md](current-system/overview.md) | Architecture diagram, tech stack, glossary |
| ├ [data-models.md](current-system/data-models.md) | Every server and browser entity, field by field |
| **rewrite/** | The new system |
| ├ [target-architecture.md](rewrite/target-architecture.md) | Proposed React + FastAPI design |
| ├ [component-mapping.md](rewrite/component-mapping.md) | Legacy unit → new module |
| └ [work-breakdown.md](rewrite/work-breakdown.md) | Task board (phases P0–P5) |
| **[decisions/](decisions/README.md)** | ADRs |
| [../tools/legacy-screenshots/](../tools/legacy-screenshots/README.md) | Harness that regenerates the screenshots |

## Legacy at a glance
- **Frontend** `frontend/`: Vue 2.7, Vuetify 2, Vuex, AG Grid 29 (**Enterprise features**), Monaco with the Kusto language, MSAL popup auth. Investigations (tabs, results, column views) live **only in browser IndexedDB**.
- **Backend** `backend/`: .NET 6, 13 endpoints. Stores query templates and async query runs in Couchbase, Mongo or Redis. Runs Kusto queries **on behalf of the user** (OBO). Writes tagged events to 3 append-only Kusto tables.
- **No meaningful tests** in either app.
