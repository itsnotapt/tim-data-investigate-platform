# Work breakdown

> Companion to [target-architecture.md](target-architecture.md) and [component-mapping.md](component-mapping.md). Rules: [../RULES.md](../RULES.md). Legacy specs: [../current-system/](../current-system/). Questions: [../open-questions.md](../open-questions.md).

## How to use this file

**Statuses:** `todo` → `in-progress (agent/date)` → `review` → `done`.
- Set `in-progress (<agent>/<YYYY-MM-DD>)` when you start; `review` when the work is finished and awaiting check; `done` only after review and after the docs are updated (RULES §5).
- **Pick the lowest-numbered `todo` task whose *Depends on* tasks are all `done`** and whose *Blocked by* questions are Answered (or Assumed with a default that is not Blocking). Do not start a task another agent marked `in-progress`.
- "Lowest-numbered" means phase first, then number (P1-01 before P1-02 before P2-01).
- If a task's *Blocked by* question is still **Blocking**, skip it and pick the next eligible one; do not guess.
- Tasks are sized at a few hours to a day. If one is bigger than that, split it here (new IDs are appended with a letter suffix, e.g. `P4-12a`) before starting.
- Each task includes its own tests and doc updates. Cite bug IDs fixed in the PR (`BUG-xx`, `SEC-xx`).
- Legacy doc references use the file name plus section (e.g. `frontend-components.md#kustopivot`).

Paths: `web/` = React app, `api/` = Python app (see target-architecture.md). Branch per task: `rewrite/<task-id>-short-name`.

---

## Phase 0: discovery and documentation

| ID | Task | Depends on | Blocked by | Acceptance criteria | Status |
|---|---|---|---|---|---|
| P0-01 | Explore legacy backend and frontend; write findings | – | – | All controllers, components, helpers, store modules inventoried | done |
| P0-02 | Capture 42 legacy screenshots (`tools/legacy-screenshots/`, removed in P5-12; at commit 8a2ff2e) | P0-01 | – | PNGs in `docs/current-system/screenshots/`, regenerable by script | done |
| P0-03 | Write current-system docs (overview, backend-api, frontend-architecture, frontend-components, workflows, infrastructure, known-issues) | P0-01 | – | Files exist and cite `file:line` | done |
| P0-04 | Write `RULES.md`, `README.md`, `open-questions.md` | P0-03 | – | Rules and question log exist | done |
| P0-05 | Write `rewrite/target-architecture.md` | P0-03 | – | File exists with layout and conventions | done |
| P0-06 | Write `rewrite/component-mapping.md` | P0-03 | – | Every legacy unit mapped or dropped | done |
| P0-07 | Write `rewrite/work-breakdown.md` (this file) | P0-06 | – | Phased tasks with IDs and dependencies | done |
| P0-08 | Write ADRs 0000 (template), 0001 (React + Python), 0002 (docs as source of truth) and `decisions/README.md` | P0-04 | – | Files exist; 0001 and 0002 Accepted | done |
| P0-09 | Write `current-system/data-models.md` (every entity, field names, types, validation) from `backend-api.md` and `Models/**` | P0-03 | – | Every entity in `Models/**` and the IndexedDB records has a table; linked from overview | done |
| P0-10 | Write `current-system/screenshots/README.md` index (file, what it shows, related component) | P0-02 | – | All 42 PNGs indexed | done |
| P0-11 | Root `CLAUDE.md` pointing agents at `docs/RULES.md` | P0-04 | – | File exists, under 30 lines | done |
| P0-12 | Get answers to Blocking questions Q-001..Q-004; move to Answered with date | P0-04 | – | All four moved to Answered (2026-09-29); Q-002 spawned Q-027 (production licence), answered 2026-09-29: licence will be obtained, Enterprise only | done |
| P0-13 | Write ADR-0003 repo layout (`web/`, `api/`, shared tooling, release-please packages) | P0-05 | – | ADR Accepted; RULES §3 updated to drop "confirm in ADR-0003" | done |
| P0-14 | Write ADR-0004 persistence choice (PostgreSQL) | P0-12 | – | ADR Accepted; `api/` storage section of target-architecture updated | done |
| P0-15 | Write ADR-0005 auth model (popup login kept, single Entra app + OBO, BUG-22/23 fixes, OBO scope) | P0-12 | – | ADR Accepted | done |
| P0-16 | Create `rewrite/api-contract.md` listing every endpoint with request/response shapes and every intentional deviation from legacy (Q-008) | P0-09 | Q-008 | Each of the 13 endpoints + health documented; deviations have reasons; used as the source for P2 tests and P3 client types | done |
| P0-17 | Write ADR-0006 AG Grid Enterprise (unlicensed during development; optional licence key via config; production licence is Q-027) | P0-12 | – | ADR Accepted | done |

---

## Phase 1: scaffolding

| ID | Task | Depends on | Blocked by | Acceptance criteria | Status |
|---|---|---|---|---|---|
| P1-01 | Create `web/` skeleton: Vite + React + TS strict, MUI, folder layout from target-architecture (`src/app`, `src/features/*`, `src/lib/*`, `src/components`), hash router with the 5 routes as placeholder pages | P0-13 | – | `npm run dev` serves the shell; `npm run build` passes; routes render placeholders | done |
| P1-02 | `web/` lint/type/test tooling: ESLint, Prettier, `tsc --noEmit`, Vitest + Testing Library + jsdom, one smoke test | P1-01 | – | `npm run lint`, `npm run typecheck`, `npm test` all pass locally | done |
| P1-03 | Create `api/` skeleton with uv: `pyproject.toml`, `src/tim_api/{main.py,config.py}` and empty packages `auth/ kusto/ templates/ query_runs/ tagged_events/ storage/`; `GET /api/healthChecks/liveness` returns 204 | P0-13 | – | `uv run uvicorn tim_api.main:app` starts; liveness returns 204 | done |
| P1-04 | `api/` tooling: ruff (lint+format), mypy strict (or pyright), pytest + httpx `TestClient`, coverage; one smoke test | P1-03 | – | `uv run ruff check`, `uv run mypy`, `uv run pytest` pass | done |
| P1-05 | CI workflow `build-web.yml`: lint, typecheck, test, build on PRs touching `web/**` (see infrastructure.md#ci) | P1-02 | – | Workflow green on a PR | review (needs green PR run) |
| P1-06 | CI workflow `build-api.yml`: ruff, mypy, pytest, docker build on PRs touching `api/**` | P1-04 | – | Workflow green on a PR | review (needs green PR run) |
| P1-07 | Update release-please config for `web` and `api` packages (keep legacy packages until P5) | P1-01, P1-03 | – | `release-please-config.json` + manifest include both; no change to legacy entries | done |
| P1-08 | Runtime config, backend: `config.py` pydantic-settings for all env vars in `backend-api.md#configuration` that survive (auth, Kusto, PostgreSQL DSN, CORS, OBO scope); `api/.env.example`; fail fast with a clear message | P1-04 | – | Unit tests: missing required var raises; defaults applied; no secrets logged | done |
| P1-09 | Runtime config, frontend: `public/config.js` + `lib/config/runtimeConfig.ts` (zod-validated, all keys from `frontend-architecture.md#runtime-config`, `VITE_` env fallbacks; `agGridLicenseKey` optional) | P1-02 | – | Vitest: config.js values override env; missing required key throws readable error; BUG-33, BUG-41 fixed | done |
| P1-10 | Dockerfiles: `api/Dockerfile` (uv, non-root; also enable the commented `docker-build` job marked `TODO(P1-10)` in `.github/workflows/build-api.yml`) and `web/Dockerfile` (build + nginx, entrypoint generates `config.js` and nginx conf from env, validates required vars, JSON-escapes values) | P1-08, P1-09 | Q-016 | Both images build; `web` container serves `/config.js` from env; missing env exits 1 with message | done (images built + compose smoke-tested 2026-09-30) |
| P1-11 | Dev `compose.yaml` at repo root: api, web (Vite or nginx image), PostgreSQL service (ADR-0004), env from `.env` | P1-10, P0-14 | – | `docker compose up` brings up the stack; docs list required env | done (compose up + migrate + CRUD smoke 2026-09-30) |
| P1-12 | Mock/dev auth switch: `TIM_AUTH_DISABLED` style dev mode in api (fixed fake user, **refuses to start in production mode**) and stub auth in web for Playwright/dev | P1-08, P1-09 | – | Tests prove prod mode rejects the flag; documented in READMEs | done |

---

## Phase 2: backend parity

Reference: `backend-api.md`, `rewrite/api-contract.md` (P0-16).

| ID | Task | Depends on | Blocked by | Acceptance criteria | Status |
|---|---|---|---|---|---|
| P2-01 | Pydantic models: templates (`QueryTemplate`, `QueryParam`, `QueryField`), query runs, tagged events, schema request; JSON names identical to legacy (`backend-api.md`, `data-models.md`) | P1-04, P0-09 | – | Round-trip tests using sample JSON from the legacy screenshot mocks (`tools/legacy-screenshots/mocks.mjs`, removed; at commit 8a2ff2e); validation rules ported | done |
| P2-02 | Auth: JWT validation (`auth/jwt.py`): JWKS fetch + cache, `aud == api://{clientId}`, issuer set, expiry, username claim fallback `unique_name`→`upn`→`preferred_username`; `get_current_user` dependency | P1-08 | Q-014 | Tests with locally signed tokens: valid, wrong aud, wrong issuer, expired, bad signature, v1 and v2 claims; unauthenticated → 401 | done |
| P2-03 | Auth: OBO exchange (`auth/obo.py`) behind an interface; cached `ConfidentialClientApplication`; secret or client-assertion credential; scope from config/cluster | P2-02 | Q-013 | Unit tests with a fake MSAL: correct scope, app instance reused, failure maps to 401/502 (BUG-09) | done |
| P2-04 | Cluster URL validation helper (`kusto/validation.py`): https only, absolute, host allow-list/suffix policy from config | P1-08 | – | Table-driven tests incl. `http://`, `file:`, IP, userinfo, lookalike hosts; used by schema and query (SEC-01) | done |
| P2-05 | Kusto query client (`kusto/query_client.py`) behind `KustoQueryClient` protocol: V2 frames, concat primary results, stats row, value serialisation parity, `StartTime`/`EndTime` parameters, unexpected-frame error | P2-01, P2-04 | – | Tests with recorded/fake frames: multi-table concat, datetime/timespan/dynamic/null/guid, stats, progressive frame → error | done |
| P2-06 | `POST /api/kusto/schema` (`kusto/router.py`): validate cluster, OBO, `.show schema as json`, return rows; verify column name | P2-03, P2-04, P2-05 | Q-018 | Endpoint tests: happy path, bad cluster 400, unauthenticated 401, Kusto error mapped; Q-018 resolved or recorded | done |
| P2-07 | Storage interfaces (`storage/base.py`) + in-memory implementation for tests/dev | P2-01 | – | Contract test suite parametrised over implementations; memory impl passes | done |
| P2-08 | PostgreSQL storage (`storage/postgres.py`): SQLAlchemy async + asyncpg, Alembic migrations, TTL/retention job for runs | P2-07, P0-14 | – | Contract suite passes against a real Postgres (CI service container / docker-compose, no mocks); retention removes expired runs; BUG-01, BUG-07, BUG-08 not reproduced | done |
| P2-09 | Query runs: `POST /api/kusto/query` + `GET /api/kusto/query/{id}` with async runner (asyncio task, 1 s race → 200/202, explicit timeout, `timedOut` status, sanitised errors, stale-run cleanup at startup, owner check) | P2-05, P2-07, P2-04 | Q-007 | Tests: fast query 200; slow query 202 then 200; error stays `status:"error"` without stack trace; another user's run → 404; timeout sets `timedOut`; malformed uuid 4xx; start>end 400 (SEC-01, SEC-02, SEC-04, BUG-02) | done |
| P2-10 | Templates: list/get (`since`, `includeDeleted` default false) | P2-07, P2-02 | Q-008 | Tests: filtering, 404, auth required (BUG-05) | done |
| P2-11 | Templates: create/replace/patch/delete (soft) with server-set audit fields, JSON Patch re-validation | P2-10 | Q-008 | Tests: duplicate uuid 400, uuid mismatch 400, PUT on missing 404, PATCH restore and invalid patch 400, DELETE missing 404, `createdBy` ignored from body (BUG-03, BUG-04, BUG-06) | done |
| P2-12 | Tagged events: models + ingest client interface + `POST savedEvents/tags/comments` (204, empty array 400, server-set `createdBy`/`dateTimeUtc`) | P2-01, P2-02 | – | Tests with fake ingest client assert NDJSON rows and mapping names; client-supplied identity ignored (SEC-03) | done |
| P2-13 | Tagged events: real ingestion via `azure-kusto-ingest` with JSON mappings (`SavedEvent`, `EventTag`, `EventComment`) | P2-12 | – | Integration test marked `kusto` (skipped without env) or fake-server test of request shape | done |
| P2-14 | Table-creation CLI (`python -m tim_api.tagged_events.cli create-tables`): tables + mappings (also enable streaming ingestion policy on the 3 tables), idempotent, errors surfaced not swallowed | P2-13 | Q-015 | Unit tests on generated control commands (columns identical to `backend-api.md#kusto-tables`); documented in `api/README.md` | done |
| P2-15 | Health endpoints (`liveness` 204, `readiness` checks storage) + global exception handler (sanitised 500) + CORS from config + request logging | P2-07 | – | Tests: readiness fails when storage down; unhandled error → 500 without trace (SEC-04, SEC-05) | done |
| P2-16 | Contract conformance test: run the OpenAPI schema through a snapshot; check it matches `api-contract.md`; generate `web/src/lib/api/openapi.json` for the client | P2-06, P2-09, P2-11, P2-12, P2-15 | – | Snapshot test passes; documented regeneration command | done |

---

## Phase 3: frontend foundations

| ID | Task | Depends on | Blocked by | Acceptance criteria | Status |
|---|---|---|---|---|---|
| P3-01 | `lib/auth`: msal-react provider, popup login (ADR-0005), MSAL init + pending-response handling, cached account and `acquireTokenSilent`/`ssoSilent` before any popup, single in-flight interactive request, retryable sign-in failure, `useAuth`, logout | P1-09 | – | Vitest with mocked MSAL: silent success, fallback to popup, concurrent calls share one request (BUG-23), failed sign-in can be retried (BUG-22) | done |
| P3-02 | `lib/api`: typed fetch client (auth header, base URL, `ApiError`, 401 → re-auth, abort/timeout) + endpoint modules for templates, kusto schema, query runs, tagged events using types from P2-16 | P3-01, P2-16 | – | Vitest with `msw`: headers, error mapping, no `requestedBy`/`createdBy` in bodies (SEC-03, BUG-40) | done |
| P3-03 | `lib/api/queryRuns.ts`: 202 + poll loop (500 ms, double every 3 polls, cap 30 s, max 11 min), cancellable, typed timeout error, `handleResult` | P3-02 | Q-007 | Vitest with fake timers: 200 immediate, 202→200, error status, timeout error, abort (BUG-30) | done |
| P3-04 | `lib/storage`: IndexedDB (`idb`) creating the new `tim` database at v1 with the four stores; DAOs for display components, row results, column views, query options. Never reads the legacy `localforage` DB (Q-004: no migration) | P1-02 | – | Vitest with `fake-indexeddb`: DB `tim` v1 created with 4 stores, CRUD, missing row results return empty (BUG-27); no access to a `localforage` DB | done (zod read-validation + `meta` store deferred) |
| P3-05 | `lib/time-range`: `TimeRange`, relative "ago" ranges, presets, custom date/period parsing and validation, UTC formatting/labels | P1-02 | – | Vitest: presets, custom period NaN rejected (BUG-39), start<end, label strings match legacy (`frontend-components.md#timeselection`) | done |
| P3-06 | `lib/uuid`, `lib/isEmpty`, `components/SnackbarHost` + `useNotify` (FIFO queue, link, Dismiss) | P1-02 | – | Component test: queue order, timeout advance, link button | done |
| P3-07 | App shell: `AppShell`, `Toolbar` (hamburger menu, TIM link, Help menu, Settings menu, Account menu), theme, `AuthGate` messages (`frontend-components.md#appvue-m`) | P3-01, P3-06 | Q-012 | Component tests for auth states (not signed in, loading, error, signed in); logout snackbar | done |
| P3-08 | Bootstrap hook `useBootstrap`: login → templates → column views → tabs; retry after failure; error alerts (incl. `interaction_in_progress` text) | P3-07, P3-02, P3-04 | – | Test: failed first sign-in then successful retry proceeds to loaded state (BUG-22) | done |
| P3-09 | Routing: hash routes, catch-all redirect, lazy pages, `Welcome` page with "Get Started" placeholder | P3-07 | – | Route tests for the 5 routes; unknown hash → `/` | done |
| P3-10 | `components/DraggableDialog` (clamped drag by title, no polling) | P1-02 | – | Component test: drag moves, clamps to viewport | done |

---

## Phase 4: frontend features

Order follows dependencies. Legacy refs: `frontend-components.md`, `workflows.md`, screenshots by number.

| ID | Task | Depends on | Blocked by | Acceptance criteria | Status |
|---|---|---|---|---|---|
| P4-01 | Tab store (`features/tabs`): types for `KustoQueryResult`/`TemplateQueryResult` tabs, reducer/selectors, persistence (debounced), cascade delete, convert, `triggerRowData`, load ordering | P3-04 | – | Vitest: create child, cascade remove of subtree and row results (BUG-32), serialisable errors only (BUG-38), reload preserves order | done |
| P4-02 | Side tree (`features/tree`): drawer (mini variant/hover expand), node labels (`[draft]`, `[new]`), status icons and badges, click → visited + navigate, active highlight on load | P4-01, P3-09 | – | Component tests for each status icon/prefix; active highlighted after initial load (BUG-21); screens 16, 27 | done |
| P4-03 | Tree selection logic (`useTreeSelection`) and Remove selected; Reload templates button | P4-02 | – | Unit tests for check/uncheck cascade rules; removing a parent removes descendants; route `/` if active removed (W11) | done |
| P4-04 | `TabHost` at `/view/:uuid`: render active tab, keep visited tabs mounted (LRU 100), redirect only after load, remount on convert | P4-01, P4-02 | – | Test: hard load of `/view/:uuid` renders the tab (BUG-20); unknown uuid redirects to `/` after load | done |
| P4-05 | `NewQueryMenu` + `TemplateSubMenu` with search and path-keyed tree (`templateMenuTree.ts`) | P4-01, P3-02 | – | Unit test: same segment name in different paths does not collide (BUG-35); search case-insensitive over menu+summary; hidden options excluded; screens 05, 06, 31 | done |
| P4-06 | Ad-hoc tab shell (`KustoQueryTab`): toolbar, edit/view modes, Summary field, error alert, clone, default query text (`defaultNewQuery`) | P4-04, P4-05 | – | Test: new draft opens in edit; Save vs Save & Run vs Cancel; clone creates root "Copy of …"; W2, W10 | done |
| P4-07 | Time range picker UI (`TimeRangePicker`, custom date dialog, custom period dialog) using `lib/time-range`; persisted in tab state | P3-05, P3-10, P4-06 | – | Component tests for presets, custom date, custom period, validation messages; screens 08–10 | done |
| P4-08 | Cluster/database selection (`ClusterSelect`) from `defaultClusters`, freeSolo, required rules; `normalizeClusterUrl` | P4-06, P1-09 | – | Test: grouped options, free text, no forced `.kusto.windows.net` (BUG-29); screen 11 | done |
| P4-09 | Monaco wrapper (`CodeEditor`) + Kusto editor loader with monaco-kusto workers via Vite; dispose on unmount | P1-01 | – | Test/harness: editor mounts, disposes; production build includes workers | done |
| P4-10 | Kusto schema hook (`useKustoSchema`): fetch on cluster/db change incl. initial, cache, error notify, `setSchemaFromShowSchema`, race safety | P4-09, P4-08, P2-06 | Q-017, Q-018 | Test with mocked worker: initial load, change, error path, stale response ignored (BUG-28); suggestions enabled per Q-017 default | done |
| P4-11 | Ad-hoc run: `runKustoQuery` (set executing, poll, store stats and rows, mark unvisited, trigger row data, serialisable error), Run Query button, snackbar "Executing query..." | P4-06, P4-07, P3-03, P3-04 | – | Vitest with mock API: success stores rowCount/stats/rows; error stores message and deletes rows; abort on tab removal | done |
| P4-12 | Query Help dialog (`QueryHelperDialog`) with corrected samples | P4-06 | – | Renders sections; sample KQL snapshot-tested; BUG-41 items fixed; screens 13–14 | done |
| P4-13 | Grid core (`features/grid`): `ag-grid-react` + `ag-grid-enterprise` (ADR-0006: trial in development, `agGridLicenseKey` required in production), columns from union of row keys, template `columns` overrides, default column def, row id, determination row colours, missing-rows-safe loader | P4-11, P0-12 | – | Tests: columns derived from all rows (BUG-36); no throw when no stored rows (BUG-27); row class per determination; screen 15 | done |
| P4-14 | Grid status bar + `ExecutionStatusPanel` (time, CPU, memory MB) and totals (total/filtered/selected) | P4-13 | – | Component test of the panel formatting; screen 15 | done |
| P4-15 | Grid side bar (columns, filters), quick filter input, multi-filter defaults, row grouping with `dcount` aggregation, copy/copy with headers/export menu items | P4-13 | – | Test: quick filter filters; `dcount` agg unit test; screens 17–19 | done |
| P4-16 | Column views (`ColumnViewBar`, store, rename/delete dialogs), save/restore column state on tab hide/show | P4-13, P3-04 | – | Tests: add/apply/rename/delete/save; state restored after switching tabs; confirm text correct (BUG-41); screen 20 | done |
| P4-17 | Template engine (`lib/kql-templates`): `QueryTemplate` types, `getDefaultParams`, `buildParams`, `isDataComplete`, isolated Handlebars env, `array` helper with escaping, `getTagEvents` partial, `buildSummary/Cluster/Query` | P1-02 | Q-006 | Vitest, at least 30 cases incl. multiple/match/plain fields, optional params, falsy defaults consistent (BUG-34), quote escaping and injection attempts (SEC-06), partial output equals legacy KQL text | done |
| P4-18 | Template tab, form: `TemplateQueryTab` shell, `ParamField` for array/match/multiple/boolean/string, required rules, summary regenerate, persisted edit mode, preview, validation error snackbar | P4-17, P4-06 | – | Port the 11 legacy widget cases plus new ones; W5; screens 28, 29, 32 | done |
| P4-19 | Template tab, run/clone/convert: `runTemplateQuery` (no time range, Q-009), clone as sibling not auto-run, Convert dialog → ad-hoc tab with rendered KQL | P4-18, P4-11 | Q-009 | Tests: run stores results; clone parent same; convert produces `KustoQueryResult` with rendered KQL and remounts; screen 30 | done |
| P4-20 | Pivots: context menu building from query templates by path, `buildParams` from clicked/selected rows, child tab creation, auto-run if `isDataComplete` else edit mode + navigate, Shift suppresses auto-run | P4-19, P4-15, P4-01 | – | Tests: nested path menu sorted; multi-select → `multiple` field; incomplete data opens edit mode; W4; screens 21, 23, 26 | done |
| P4-21 | Tagging: quick tag (Malicious/Suspicious/Benign): save unsaved events → create comments → update rows returned; menu disabled unless rows have `EventId` and `EventTime`; snackbars | P4-20, P2-12 | – | Tests with mocked API: call order, lowercase determination, rows recoloured in grid, failure messages; screen 22 | done |
| P4-22 | Tag dialog logic (`tagDialogLogic.ts`, `tagSets.ts`): validation messages, modification preview, request building for Override/Append/Remove incl. remove-determination | P4-21 | – | Vitest: every validation message; each action combination yields expected `savedEvents`/`comments`/`tags` payloads | done |
| P4-23 | Tag dialog UI (`TagDialog`, draggable) wired to grid via `TagDialogContext`; stays open on error; grid updated with returned rows | P4-22, P3-10 | – | Component test: submit success updates grid rows (BUG-25); error keeps dialog open (BUG-26); screen 25 | done |
| P4-24 | Inline comment edit: only `TagEvent.Comment` editable; other columns read-only; save via comments API for saved rows with determination | P4-21 | – | Tests: comment edit persists, non-saved rows not editable, "Comment successfully quick saved." (BUG-42) | done |
| P4-25 | Detail panel (`DetailPanel` drawer 900px, YAML for objects, follows focused cell, visible close) and "Show details" menu item | P4-13 | – | Component test: opens from context, follows focus, empty values hidden; screen 24 | done |
| P4-26 | Share: link generation (Unicode-safe), `SharePage` (missing template / params errors, recreate tab, `execute=1` runs), Share Link button | P4-19 | – | Tests: round trip with emoji params (BUG-31), legacy links decode, error texts, `execute` flag; W8; screens 41, 00 | done |
| P4-27 | Export/Import page (W13): export the new app's own tabs as JSON to textarea + clipboard, import with schema validation and in-place store reload (no legacy data involved) | P4-01 | – | Tests: export→import round trip; invalid JSON disables Import; imported tabs appear without refresh; screen 40 | done |
| P4-28 | Query Manager list page: table, Show deleted, filter, selection, bulk Delete/Restore | P3-02, P3-09 | – | Tests: restore button state correct (BUG-24), delete disabled if managed selected; screens 33, 34 | done |
| P4-29 | Create/Edit template dialog: form, YAML editors, path chips, validation, save via POST/PUT, managed read-only | P4-28, P4-09 | – | Tests: create/edit save calls correct verb; invalid YAML shows error under editor; managed template fully disabled (incl. Fields); network error shown (BUG-40); screens 35–39 | done |
| P4-30 | Help menu (Wiki, Report a bug from config) and final toolbar wiring; Settings → Export/Import | P3-07, P4-27, P4-12 | – | Links open in new tab from config; screen 03 | done |

---

## Phase 5: verification, migration, deployment, cut-over

| ID | Task | Depends on | Blocked by | Acceptance criteria | Status |
|---|---|---|---|---|---|
| P5-01 | Playwright e2e harness for `web/` with mocked API (route interception) and stubbed auth, modelled on `tools/legacy-screenshots/{flow,mocks}.mjs` (removed; at commit 8a2ff2e); reuse the same mock data | P4-11, P3-08 | – | `npm run e2e` runs headless in CI; one smoke scenario (sign in, new query, run) passes | done |
| P5-02 | E2E flows W1–W7 with screenshots saved to `docs/rewrite/screenshots/` (same numbering as legacy) | P5-01, P4-25, P4-24, P4-23, P4-16, P4-15, P4-14, P4-10, P4-07, P4-03 | – | Screens counterpart to legacy 01–26 captured; each flow asserts key UI text | done |
| P5-03 | E2E flows W8–W14 with screenshots (share, convert, clone, manage tabs, query manager, export/import, help) | P5-01, P4-26, P4-27, P4-29, P4-30, P4-19 | – | Screens counterpart to legacy 27–41 captured | done |
| P5-04 | Parity review: side-by-side comparison of legacy and new screenshots, table of differences in `docs/rewrite/parity-report.md`; each difference marked accepted/fix | P5-02, P5-03 | – | Report covers all 42 legacy screens; every "fix" has a follow-up task | done |
| P5-05 | Bug-regression checklist: an automated test (or documented manual check) per fixed BUG/SEC ID | P5-04, P2-16 | – | Table in `parity-report.md` maps each ID to a test name | done |
| P5-06 | ~~Data migration tooling (legacy templates export/import, legacy IndexedDB import)~~ | – | – | Not needed: no legacy data is migrated (Q-004); new app uses its own `tim` IndexedDB and PostgreSQL | dropped (Q-004) |
| P5-07 | Backend load/robustness pass: large result sets, row/size cap decision, concurrent runs | P2-09 | – | Documented limits; test with 100k-row fake result stays within memory budget | done |
| P5-08 | Deployment artefacts: production images, compose for prod, chosen deploy target (Helm or other), env docs incl. `agGridLicenseKey` (required in production, Q-027); fix BUG-10 class issues (env names consistent, `/api` path preserved) | P1-10, P2-16 | Q-016 | Fresh environment deploy follows README and passes readiness; ingress routes `/api` correctly | done (verified 2026-09-30 on Docker 29.8.1: fresh compose deploy, readiness 204 via nginx, `/api` preserved, headers, 413 limits, non-root, BUG-43 fail-fast, idempotent re-up; subnet made configurable, Q-114. Real Entra/Kusto/TLS unverified) |
| P5-09 | Security review of the new stack (auth, OBO, cluster validation, template injection, CORS, headers, dependency audit) | P5-05 | – | Findings triaged in docs; no High open | done |
| P5-10 | Replace-legacy plan ([cutover-plan.md](cutover-plan.md)); no production, users, migration or rollback (Q-034) | P5-08, P5-09 | – | Plan documented and agreed by the user | done (no production, Q-034; plan in cutover-plan.md) |
| P5-11 | Retarget release automation to new packages: release-please config/manifest and `release-please.yml` build `web`/`api` (tim-web/tim-api images); disable legacy workflows. Needs CI green on a real PR (user opens it) | P5-10 | – | Release workflows build web/api; legacy pipelines disabled | done (2026-09-30): release workflow retargeted to tim-web/tim-api, legacy pipelines removed; CI green on a real PR still pending |
| P5-12 | Remove legacy: delete `frontend/`, `backend/`, `helm/`, legacy compose/workflows; revise RULES §3 and CLAUDE.md; mark `docs/current-system/` as historical archive; fix links | P5-11 | – | Repo builds and CI green without legacy folders; `docs/README.md` Status updated; RULES §3 revised | done (2026-09-30): legacy folders removed, RULES §3 revised; CI green on a real PR still pending |
| P5-13 | Parity fixes: editor and toolbar (F-A01, F-A02, F-A03, F-A04, F-B06 in `parity-report.md`) | P5-04 | – | Fixes applied, affected screens re-captured, report rows marked fixed | done |
| P5-14 | Parity fixes: layout, tree, tagging, Query Manager, export (F-A06, F-A07, F-B01–F-B05, F-B07) | P5-04 | – | Fixes applied, affected screens re-captured, report rows marked fixed | done |
| P5-15 | ~~Security follow-ups, API (S-A01, S-A02, S-A04, S-A07)~~ | – | – | Accepted risk for trusted internal users (Q-029, Q-030) | dropped (Q-030) |
| P5-16 | Dependency maintenance: bump monaco-editor and @kusto/monaco-kusto together to clear the dompurify advisories (S-W06); other web/deploy findings accepted (Q-030) | P5-09 | – | `npm audit --omit=dev` clean of moderate+; e2e green | done (no compatible bump: monaco-kusto 15.0.1 pins monaco-editor ^0.55; npm `overrides` dompurify ^3.4.15 → audit 0 vulnerabilities; e2e 28/28) |
| P5-17 | Live parity sweep: legacy (`8a2ff2e`) and new app side by side on shared mocks, pixel and text/role diffs for screens 00–41; fix what it finds | P5-13, P5-14 | – | New differences recorded in parity-report.md; regressions fixed or open with a decision | done (2026-10-01): F-C01 checkbox column pinned (screens 21–27 re-captured), stale P5-13 verdicts updated; F-C02 (export metadata) open for a decision |
