# TIM rewrite documentation

TIM ("triage and investigation") is a Kusto investigation platform: analysts run KQL, pivot between data sources using shared query templates, and tag and annotate events. This folder captures the **legacy system** (Vue 2 + .NET 6) and the plan for rebuilding it as **React + Python**.

**Agents: read [RULES.md](RULES.md) first.**

## Status
| | |
|---|---|
| Phase | **4 — Frontend features: done** (Phase 5 verification next) |
| Last updated | 2026-09-30 |
| Done | Legacy explored; 42 screenshots + index; harness (`tools/legacy-screenshots/`); rules; all current-system docs; target architecture (Accepted); component mapping; work breakdown; ADRs 0001–0006; root `CLAUDE.md`. All Blocking questions answered (Q-001…Q-004, Q-019, Q-027) |
| Phase 1 | Done, except P1-05/06 (CI workflows) awaiting a green PR run. Images + compose verified with Docker 2026-09-30 |
| Phase 2 | Done (P2-01…P2-16): models, Entra JWT + OBO, cluster validation, Kusto query client, schema/query-run/template/tagged-event endpoints, PostgreSQL + Alembic, streaming tag ingestion, table-creation CLI, problem-details errors, OpenAPI snapshot + `web/src/lib/api/schema.d.ts`. 451 api tests |
| Phase 3 | Done (P3-01…P3-10): MSAL popup auth, typed API client + query-run polling, IndexedDB `tim` DB, time range, app shell, bootstrap, routing, draggable dialog |
| Phase 4 | Done (P4-01…P4-30): tab store, side tree, TabHost, New Query menu, ad-hoc tab (Monaco Kusto, time range, cluster), schema IntelliSense, query runs, AG Grid Enterprise grid + status/side bars, column views, detail panel, KQL template engine + template tab, pivots, tagging (quick tag, dialog, inline comment), share links, Query Manager, Export/Import, help menu. 463 web tests; browser smoke test (Playwright, mocked Kusto) of all main flows passed 2026-09-30. Next: Phase 5 (P5-01 Playwright e2e harness) |
| Decisions | PostgreSQL; AG Grid Enterprise only (trial in dev, licence key in prod, no Community build); popup + OBO; no data migration; `web/` + `api/` (ADR-0003…0006) |

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
| ├ [target-architecture.md](rewrite/target-architecture.md) | Accepted React + FastAPI design |
| ├ [component-mapping.md](rewrite/component-mapping.md) | Legacy unit → new module |
| ├ [local-dev.md](rewrite/local-dev.md) | Running `api/`, `web/` and PostgreSQL locally |
| ├ [api-contract.md](rewrite/api-contract.md) | Every endpoint of the new API, schemas, deviations D1–D20 |
| └ [work-breakdown.md](rewrite/work-breakdown.md) | Task board (phases P0–P5) |
| **[decisions/](decisions/README.md)** | ADRs |
| [../tools/legacy-screenshots/](../tools/legacy-screenshots/README.md) | Harness that regenerates the screenshots |

## Legacy at a glance
- **Frontend** `frontend/`: Vue 2.7, Vuetify 2, Vuex, AG Grid 29 (**Enterprise features**), Monaco with the Kusto language, MSAL popup auth. Investigations (tabs, results, column views) live **only in browser IndexedDB**.
- **Backend** `backend/`: .NET 6, 13 endpoints. Stores query templates and async query runs in Couchbase, Mongo or Redis. Runs Kusto queries **on behalf of the user** (OBO). Writes tagged events to 3 append-only Kusto tables.
- **No meaningful tests** in either app.
