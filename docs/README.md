# TIM rewrite documentation

TIM ("triage and investigation") is a Kusto investigation platform: analysts run KQL, pivot between data sources using shared query templates, and tag and annotate events. This folder captures the **legacy system** (Vue 2 + .NET 6, now removed; historical archive in `current-system/`) and the rebuild as **React + Python** (`web/`, `api/`).

**Agents: read [RULES.md](RULES.md) first.**

## Status
| | |
|---|---|
| Phase | **5 — Verification: done except the CI-green confirmation** (P5-01…P5-05, P5-07…P5-16 done; P5-06 dropped). Legacy removed (P5-12); release automation retargeted to `tim-web`/`tim-api` (P5-11) |
| Last updated | 2026-10-01 |
| Done | Legacy explored; 42 screenshots + index; harness (`tools/legacy-screenshots/`, removed in P5-12); rules; all current-system docs; target architecture (Accepted); component mapping; work breakdown; ADRs 0001–0006; root `CLAUDE.md`. All Blocking questions answered (Q-001…Q-004, Q-019, Q-027) |
| Phase 1 | Done, except P1-05/06 (CI workflows) awaiting a green PR run. Images + compose verified with Docker 2026-09-30 |
| Phase 2 | Done (P2-01…P2-16): models, Entra JWT + OBO, cluster validation, Kusto query client, schema/query-run/template/tagged-event endpoints, PostgreSQL + Alembic, streaming tag ingestion, table-creation CLI, problem-details errors, OpenAPI snapshot + `web/src/lib/api/schema.d.ts`. 451 api tests |
| Phase 3 | Done (P3-01…P3-10): MSAL popup auth, typed API client + query-run polling, IndexedDB `tim` DB, time range, app shell, bootstrap, routing, draggable dialog |
| Phase 4 | Done (P4-01…P4-30): tab store, side tree, TabHost, New Query menu, ad-hoc tab (Monaco Kusto, time range, cluster), schema IntelliSense, query runs, AG Grid Enterprise grid + status/side bars, column views, detail panel, KQL template engine + template tab, pivots, tagging (quick tag, dialog, inline comment), share links, Query Manager, Export/Import, help menu. 463 web tests; browser smoke test (Playwright, mocked Kusto) of all main flows passed 2026-09-30. |
| Phase 5 | Playwright e2e (`npm run e2e`, 28 tests, flows W1–W14) with all 42 screens re-captured in `rewrite/screenshots/`; [parity-report.md](rewrite/parity-report.md) (14 fixes applied, bug-regression checklist for all 41 BUG/SEC IDs; P5-17 live side-by-side sweep added F-C01, fixed, and F-C02, open); load pass (row/byte caps, `TIM_MAX_CONCURRENT_RUNS`); production compose + nginx with CSP in `deploy/`, fresh deploy verified on Docker 2026-09-30 (P5-08); [security-review.md](rewrite/security-review.md): no High; insider-only findings accepted for trusted internal users (Q-030). 467 api tests, 471 web tests. dompurify override clears `npm audit --omit=dev` (P5-16). No production or users (Q-034): P5-10..P5-12 were repo/CI changes, executed together 2026-09-30 (see [cutover-plan.md](rewrite/cutover-plan.md)). Next: open a PR so CI (`build-api.yml`, `build-web.yml`, P1-05/06) runs green for the first time; on a first real deploy run the smoke checklist in cutover-plan section 4 |
| Decisions | PostgreSQL; AG Grid Enterprise only (trial by default, licence key optional, no Community build); popup + OBO; no data migration; `web/` + `api/` (ADR-0003…0006) |

## Map
| Path | Contents |
|---|---|
| [RULES.md](RULES.md) | How to work: sources of truth, questions, docs, engineering defaults, git |
| [open-questions.md](open-questions.md) | Question log: Blocking / Open / Assumed / Answered |
| **current-system/** | **Archive**: the removed legacy system (paths refer to commit `8a2ff2e`) |
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
| ├ [parity-report.md](rewrite/parity-report.md) | Legacy vs new screen comparison, fixes, bug-regression checklist |
| ├ [security-review.md](rewrite/security-review.md) | Security review of the new stack (S-A/S-W findings) |
| ├ [cutover-plan.md](rewrite/cutover-plan.md) | Replace-legacy plan: CI gate, release-please retarget, legacy removal (done 2026-09-30, P5-10..P5-12) |
| ├ [screenshots/](rewrite/screenshots/README.md) | New UI screens, same numbering as legacy (e2e captured) |
| ├ [../deploy/README.md](../deploy/README.md) | Production compose deployment and env vars |
| └ [work-breakdown.md](rewrite/work-breakdown.md) | Task board (phases P0–P5) |
| **[decisions/](decisions/README.md)** | ADRs |

## Legacy at a glance (historical, removed in P5-12; code at commit `8a2ff2e`)
- **Frontend** (`frontend/`): Vue 2.7, Vuetify 2, Vuex, AG Grid 29 (**Enterprise features**), Monaco with the Kusto language, MSAL popup auth. Investigations (tabs, results, column views) live **only in browser IndexedDB**.
- **Backend** (`backend/`): .NET 6, 13 endpoints. Stores query templates and async query runs in Couchbase, Mongo or Redis. Runs Kusto queries **on behalf of the user** (OBO). Writes tagged events to 3 append-only Kusto tables.
- **No meaningful tests** in either app.
