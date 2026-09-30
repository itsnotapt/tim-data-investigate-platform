# Target architecture: React + FastAPI

Status: **Accepted** (2026-09-29): Q-001…Q-004 and Q-019 answered; see ADR-0003…0006. Remaining Open questions use their proposed defaults until answered.

Decisions taken: PostgreSQL ([ADR-0004](../decisions/0004-postgresql-persistence.md)), AG Grid Enterprise only, trial during development and licensed in production ([ADR-0006](../decisions/0006-ag-grid-enterprise.md), Q-027; no Community build), popup login with single Entra app + OBO ([ADR-0005](../decisions/0005-auth-entra-popup-obo.md)), no legacy data migration (Q-004), `web/` + `api/` layout ([ADR-0003](../decisions/0003-repo-layout.md)). Every choice that still depends on an open question cites its Q-ID and the proposed default from [open-questions.md](../open-questions.md). Questions this doc raised are Q-020…Q-026 (Q-023, Q-025 and Q-026 are now moot).

Related: [current-system/overview.md](../current-system/overview.md) (legacy diagram, glossary), [backend-api.md](../current-system/backend-api.md), [frontend-architecture.md](../current-system/frontend-architecture.md), [known-issues.md](../current-system/known-issues.md). Companions: [component-mapping.md](component-mapping.md), [work-breakdown.md](work-breakdown.md), `api-contract.md` (to write).

---

## 1. Goals and non-goals

**Goals (phase 1 = parity first, per RULES §6)**
- Same features and workflows W1-W14, recognisably the same UI (screenshots 00-41).
- Same wire contract as legacy where possible; deviations recorded in `api-contract.md` (Q-008).
- Fix the known security and correctness bugs (section 6) rather than port them.
- Testable: typed code, mocked Kusto/Entra behind interfaces, CI running tests (legacy has none).
- Reversible: legacy `frontend/` and `backend/` stay untouched until cut-over.

**Non-goals (phase 1)**
- Visual redesign, new features, server-side investigations (Q-005 default: browser-only).
- Template time-range support (Q-009 default: no).
- Suppressions (Q-010 default: drop), `/api/user/authenticate` (Q-011 default: drop).
- Multi-database support (Q-001: PostgreSQL only).
- SSE/WebSocket, durable job workers (Q-007 default: 202 + poll, in-process task).
- Helm charts (Q-016 default: compose first, Helm later).

---

## 2. System diagram

```
 Browser (React SPA, Vite build, hash routes)                     Azure
 ┌──────────────────────────────────────────┐  MSAL popup     ┌────────────────────┐
 │ web/                                     │────────────────►│ Entra ID           │
 │  React + MUI + AG Grid + Monaco(Kusto)   │  token          │ (1 app reg, Q-003) │
 │  Zustand stores (tabs, templates, ui)    │  aud api://<id> └─────────▲──────────┘
 │  lib/kql-templates (Handlebars, escaped) │                           │ OBO
 │  IndexedDB (idb): tabs, rows,            │                           │ (msal, cached)
 │    column views, query options (Q-005)   │                           │
 └───────────────┬──────────────────────────┘                ┌──────────┴─────────┐
   /config.js    │ HTTPS  /api/*                             │ api/  FastAPI      │
   (runtime cfg) └──────────────────────────────────────────►│  auth (JWT verify) │
                                                             │  kusto (OBO client)│
                                                             │  templates         │
                                                             │  query_runs        │
                                                             │  tagged_events     │
                                                             │  storage (repo)    │
                                                             └──┬──────┬───────┬──┘
                        user OBO token                          │      │       │ app identity
                    ┌───────────────────────────────────────────┘      │       ▼
                    ▼                                                  │  ┌────────────────────────┐
        ┌────────────────────┐        templates + query runs (Q-001)    │  │ Tag cluster/db         │
        │ Kusto clusters the │        ┌─────────────────────────┐ ◄─────┘  │ SavedEvent, EventTag,  │
        │ user queries       │        │ PostgreSQL (JSONB)      │          │ EventComment (append)  │
        └────────────────────┘        │ (one store, ADR-0004)   │          └───────────▲────────────┘
                                      └─────────────────────────┘                      │ read by user's own
                                                                                       │ KQL (getTagEvents)
```

Unchanged from legacy: templates render in the browser, tags round-trip through Kusto, investigations are browser-only.

---

## 3. Frontend architecture (`web/`)

### 3.1 Stack

| Concern | Choice | Notes |
|---|---|---|
| Build | Vite, TypeScript `strict` | Function components + hooks only |
| Routing | React Router with **`createHashRouter`** | Single `react-router` package (v8; `RouterProvider` from `react-router/dom`). Keeps `#/share/:uuid`, `#/view/:uuid`, `#/queries`, `#/exportimport` so existing share links keep working |
| UI | MUI (Q-012 default) | Closest to Vuetify/Material look |
| Grid | AG Grid React + `ag-grid-enterprise` only; trial during development, licence key in production (Q-002, Q-027, ADR-0006) | No Community build or fallback (BUG-43 avoided by design); grid config lives in `features/grid` |
| Auth | `@azure/msal-react` + `@azure/msal-browser`, popup login (Q-003, ADR-0005) | One `lib/auth` module |
| Browser storage | IndexedDB via `idb`, own DB `tim` (Q-004, Q-005: browser-only) | See 3.6 |
| Editor | `@monaco-editor/react` + `@kusto/monaco-kusto` | Q-017 default: enable suggestions |
| Templating | Handlebars (Q-006 default: keep) with escaping | SEC-06 |
| YAML | `js-yaml` | Template params/fields/columns editors |
| Tests | Vitest + Testing Library (+ MSW for API mocks) | |

### 3.2 Folder layout

```
web/src/
  app/                 shell: providers, router, toolbar, auth gate, snackbar host, dialog host
  features/
    tabs/              tab node model, OpenTriage host, keep-alive cache, convert/clone
    tree/              side tree (selection cascade), status icons, remove-with-descendants
    kusto-query/       KustoQueryResult, TimeSelection, ClusterSelection, Monaco Kusto editor, QueryHelper
    template-query/    TemplateQueryResult, param form widgets, preview, share, convert
    grid/              KustoPivot wrapper, column defs, context menu, ColumnView, DetailSidePanel, status panel
    tagging/           TagEventDialog, quick-tag, comment edit, tag API calls
    templates-admin/   Query Manager list + CreateQueryDialog (YAML editors)
    export-import/     Export/Import tabs JSON
    share/             ShareQuery route (decode, validate, create tab)
  lib/
    api/               single typed client (fetch), error mapping, DTO types
    auth/              MSAL instance, useToken(), login gate
    storage/           IndexedDB schema, migrations, repositories
    kql-templates/     QueryTemplate class, buildParams/buildQuery/buildSummary, Handlebars setup, getTagEvents partial
    time-range/        presets, custom range, validation
    config/            reads window.appConfig, typed + validated
  components/          shared: NewQueryButton + submenu, draggable dialog, MonacoEditor, ConfirmDialog
```

Rules: `features/*` may import `lib/*` and `components/*`, never each other's internals (use store actions). All HTTP goes through `lib/api`; all tokens through `lib/auth` (mirrors `apiClient.js` / `auth.js`).

### 3.3 State management: recommendation is **Zustand**

The legacy store is 3 Vuex modules (`displayComponent`, `queries`, `columnViews`) plus a Vue-instance event bus (snackbar, dialog launch, tree refresh, detail panel).

| | Zustand (recommended) | Redux Toolkit |
|---|---|---|
| Fit to 3 small domain stores | 3 stores, ~one file each | 3 slices plus store wiring |
| Persist-on-write to IndexedDB | Plain async actions call the repository | Thunks or listener middleware |
| Replacing the event bus | Small `ui` store (snackbar queue, dialog request, detail row) removes the bus entirely | Same, more ceremony |
| Reading state from non-React code (poll loop) | `store.getState()` works directly | Works via store instance |
| Devtools, time travel | Optional middleware | Built in |
| Team familiarity / ecosystem | Less prescriptive | More prescriptive |

Reasons for Zustand: small surface for a 3-module store, no boilerplate for async persist-then-set actions, and no global bus (fixes BUG-37 listener leaks). Choose RTK instead only if the team already standardises on it; the store boundaries below are the same either way.

| Store | Replaces | Contents |
|---|---|---|
| `useTabsStore` | `displayComponent` | normalised `{[uuid]: TabNode}`, `order`, actions: create, updateState/Params/Title, convert, triggerRows, remove (**cascades to descendants**, BUG-32), loadAll, export/import |
| `useTemplatesStore` | `queries` | templates (deleted dropped), `queryOptions`, load/reload (failed load is **not** cached) |
| `useColumnViewsStore` | `columnViews` | global named AG Grid column states |
| `useUiStore` | event bus | snackbar queue, tag dialog request `{events, onSuccess}`, detail panel row, "tab created" / "results updated" signals |

Tabs load from IndexedDB **before** the router renders `/view/:uuid` (fixes BUG-20); the shell shows a loading state until `loadAll` resolves. Only serialisable errors (`{message, code}`) go into state (BUG-38).

### 3.4 Tab model

Same shape as legacy so Export/Import JSON stays trivial:

```ts
interface TabNode {
  componentUuid: string;
  componentName: 'KustoQueryResult' | 'TemplateQueryResult';
  parentUuid: string | null;
  title: string;
  params: KustoParams | TemplateParams;   // template tabs keep the full template snapshot
  state: { isVisited; error?: {message}; rowCount; isExecuting; executionTime; cpuUsage; memoryUsage; editQuery? };
  rowDataTrigger: number | null;
  displayComponentIndex: number;          // parents before children
}
```

`children` is derived (selector), not stored.

### 3.5 Data flow: run, poll, pivot, tag

```
Run (KustoQueryResult / TemplateQueryResult)
  build KQL (template tabs: kql-templates.buildQuery, escaped)  ─ time range only for ad-hoc (Q-009)
  tabs.setState(isExecuting)
  api.executeQuery ──► 200 {completed|error}  ─┐
                  └──► 202 {id} ─► poll GET /api/kusto/query/{id}   (500 ms, x2 every 3 polls, cap 30 s)
                                     until completed|error|timedOut|client deadline (AbortController)
  completed: rows ─► IndexedDB row_results[uuid]; state {rowCount, executionTime, cpu, memory}
             ─► tabs.triggerRows(uuid) ─► grid reloads rows from IndexedDB
  error/timeout: state.error = {message}; delete rows; grid shows empty (BUG-27, BUG-30)

Pivot (grid context menu)
  selected rows (or clicked row) + query template ─► buildParams (defaults, multiple, match, row[field])
  ─► tabs.create child TemplateQueryResult; isDataComplete ? run + stay : edit mode + navigate
  (Shift in template tab = no auto-run, as legacy)

Tag (quick / customise / inline comment)
  rows lacking IsSaved ─► POST savedEvents ─► POST comments / tags ─► patch grid rows in place
  (fix BUG-25: apply the returned mutation to the live grid rows; BUG-26: keep dialog open on error)
```

Polling is a plain async function in `features/tabs` (not a component effect) so a run survives tab switching. Each poll is cancellable; removing a tab aborts its poll (BUG-30). The client deadline is a config value (default 11 min, same as legacy) and must be at least the server timeout (7.).

### 3.6 Per-tab grid caching (legacy `keep-alive max=100`)

Legacy keeps up to 100 mounted tab components alive, restoring column state on activate. React has no keep-alive, so:

- `TabHost` renders **only the active tab** plus caches, per tab uuid, the *non-DOM* state needed to restore it: AG Grid column state, filter model, quick filter text, scroll/focused cell, selected row ids, `editQuery`, unsaved form edits.
- Cache is an LRU of 100 entries in memory (`Map`), written through to `useTabsStore` on tab switch; column state also lives in IndexedDB so a reload restores it.
- Row data is **not** cached in memory per tab: the grid loads from IndexedDB `row_results` on mount (fast enough for typical sizes) and on `rowDataTrigger` change.
- Remount on Template to Kusto conversion (key includes `componentName`).
- Alternative if switching proves slow: keep last N grids mounted but `display:none`. Decide in a spike; API of `TabHost` does not change.

### 3.7 IndexedDB schema and versioning

The new app uses its **own IndexedDB database named `tim`**, versioned from v1. It never reads the legacy `localforage` DB, and no legacy data is migrated (Q-004). Store names are kept from legacy (`display_components`, `row_results`, `column_views`, `query_options`) for familiarity only. Export/Import (W13) is kept for the new app's own data.

| Store | Key | Value |
|---|---|---|
| `display_components` | component uuid | `TabNode` without children |
| `row_results` | component uuid | row array |
| `column_views` | view uuid | `{uuid, name, columnState}` |
| `query_options` | template uuid | `{hide}` |
| `meta` (new) | `schemaVersion` | integer |

Versioning: `tim` is opened at an explicit version starting at v1, with a forward-only migration list in `lib/storage/migrations.ts`; v1 creates the stores above and stamps `meta.schemaVersion = 1`. Unknown newer version: refuse to write, show a banner. Values are validated on read (zod or hand-written guards); a corrupt record is skipped and reported, not thrown.

### 3.8 Template rendering and safety (SEC-06, BUG-31, BUG-34)

- Handlebars kept (Q-006). Compile with escaping **on for KQL string contexts**: params are rendered through helpers that emit KQL string literals (escape `\` and quotes); `array` helper escapes quotes. Exact escaping rules and how existing templates using raw `{{x}}` are handled go in `api-contract.md`/a follow-up ADR (Q-024).
- Share links: Unicode-safe encoding (`TextEncoder` + base64url) with fallback decode of legacy `btoa` links (BUG-31). Params are validated against the template's declared params; `execute=1` requires a confirmation prompt (SEC-06).
- One `getDefaultParams` semantics shared with `buildParams` (BUG-34).

### 3.9 Auth on the SPA (Q-003, ADR-0005)

- MSAL popup login (`@azure/msal-browser` + `@azure/msal-react`). Initialise MSAL and handle any pending response on load; restore the cached account and try `acquireTokenSilent` / `ssoSilent` before any popup, so there is no prompt on every load; allow a single in-flight interactive request (fixes BUG-23).
- Sign-in failure is retryable (BUG-22). The popup still returns to a registered SPA redirect URI (`redirectUri` config), but the main window never navigates, so no hash-route redirect handling is needed (Q-025 moot) and `#/share/...` deep links are unaffected. Tip: point `redirectUri` at a blank page (e.g. `/blank.html`) so the popup doesn't boot the whole SPA. Browsers must allow popups; the sign-in error text keeps the legacy hint.
- Token scope `api://<clientId>/user_impersonation`. The unused Kusto token scope (`getKustoToken`) is dropped.
- 401 from the API triggers a single re-acquire, then the login gate (no `Bearer null`, BUG-22).

### 3.10 Runtime config

`index.html` loads `/config.js` synchronously (kept). `lib/config` parses `window.appConfig` with a schema and fails loudly on missing required keys. Keys as legacy (`auth.clientId`, `auth.authority`, `redirectUri`, `apiEndpoint`, `agGridLicenseKey`, `wikiUri`, `issueUri`, `tagCluster`, `tagDatabase`, `defaultClusters`); `nodeEnv` dropped (BUG-33). `apiEndpoint` may be empty or have/lack a trailing slash (normalised).

---

## 4. Backend architecture (`api/`)

### 4.1 Stack

Python 3.12, FastAPI, Pydantic v2, `pydantic-settings`, `uv` (lockfile + venv), `ruff`, `mypy` (strict on `src/`), `pytest` + `pytest-asyncio` + `httpx`. Libraries: `PyJWT[crypto]` (JWKS validation), `msal`, `azure-kusto-data`, `azure-kusto-ingest`, `azure-identity`, plus `sqlalchemy[asyncio]` 2.x, `asyncpg` and `alembic` for PostgreSQL (ADR-0004, proposed tooling).

### 4.2 Module layout

```
api/
  pyproject.toml  uv.lock
  src/tim_api/
    main.py            app factory, lifespan (init store, optional table check), routers, error handlers, CORS
    config.py          Settings (pydantic-settings)
    auth/              jwt validation dependency `get_current_principal`, `Principal`, OBO token provider + cache
    kusto/             KustoGateway protocol, real client (OBO), schema, frame parsing, value serialisation, cluster validator
    templates/         router, schemas, service (JSON Patch), repository use
    query_runs/        router, schemas, runner (asyncio tasks), service (ownership, timeout, retention)
    tagged_events/     router, schemas, ingestion gateway (protocol + Kusto impl)
    storage/           Repository protocols + PostgreSQL implementation (+ in-memory for tests)
  tests/               unit (fakes), api (TestClient), contract, integration (optional, real PostgreSQL)
```

Dependencies point inward: routers -> services -> protocols (`KustoGateway`, `TokenProvider`, `IngestGateway`, repositories). Implementations are injected with FastAPI `Depends`, so tests swap fakes (RULES §6: Kusto and Azure AD mocked behind interfaces).

### 4.3 Request flow

```
Request ─► CORS (configured origins) ─► auth dependency: verify JWT ─► Principal{oid, name, tenant_id, token}
        ─► router (Pydantic validation, 422->400 mapping per contract)
        ─► service ─► repository / KustoGateway / IngestGateway
        ─► response model (no internals)     errors ─► global handler: RFC 7807 problem (api-contract.md, Q-102); stack to server log only
```

### 4.4 Auth

- **Inbound**: validate the bearer JWT against the tenant JWKS (cached, refreshed on unknown `kid`). Checks: signature, `exp/nbf`, `aud == api://{clientId}`, `iss` in {`https://sts.windows.net/{tid}/`, `https://login.microsoftonline.com/{tid}/v2.0`, ...} (Q-014: accept v1 and v2). `Principal.name` from `unique_name` -> `upn` -> `preferred_username`; `oid` is the stable id.
- **Outbound OBO**: `msal.ConfidentialClientApplication` created **once**, with its in-memory token cache (`SerializableTokenCache` if multi-replica needs it later). Credential: client secret if set, else federated/managed-identity assertion. Scope derived per cluster and configurable (Q-013 default), not hard-coded to `help.kusto.windows.net` (BUG-09). MSAL calls are blocking, so run them via `asyncio.to_thread`.
- Token used for Kusto is never logged or stored with a run.
- `/api/user/authenticate` and `SIGNING_KEY`/`AUTH_USERNAME`/`AUTH_PASSWORD` removed; app no longer needs them to boot (SEC-07, Q-011).

### 4.5 Kusto client handling

- `KustoGateway` protocol: `get_schema(user_token, cluster, database)`, `run_query(user_token, cluster, database, query, params) -> QueryResult`.
- **Cluster validation** (`kusto/cluster.py`) runs for schema **and** query, before any token is sent: absolute `https` URL, no userinfo, host allow-listed if `ALLOWED_KUSTO_HOSTS` is set, otherwise host must end in a configured suffix list (default `.kusto.windows.net`, `.kusto.fabric.microsoft.com`; Q-022). Rejected with 400 (SEC-01).
- Query: `azure-kusto-data` (sync) in a worker thread, V2 response; concatenate all `PrimaryResult` tables into one `list[dict]` (legacy parity); `QueryCompletionInformation` Stats row -> execution metrics (`execution_time`, `resource_usage.cpu['total cpu']`, `resource_usage.memory.peak_per_node`). Progressive frames -> error.
- `StartTime`/`EndTime` passed as Kusto **client request properties / query parameters** (legacy parity, KQL must `declare query_parameters`).
- Value serialisation matches legacy for grid parity: datetime -> ISO string, timespan -> `hh:mm:ss`, dynamic -> nested JSON, null -> null, guid -> string.
- Row/size cap: configurable `MAX_RESULT_ROWS`/`MAX_RESULT_BYTES` (values to be decided, Q-021); exceeding it yields `status:"error"` with a clear message instead of a stuck run (BUG-02).
- Schema: `.show schema as json`; the column name (`ClusterSchema` vs `DatabaseSchema`) is verified against a real cluster during the Kusto task (Q-018). Returned as a parsed object `{schema: <object>}` (api-contract.md D8, Q-028).

### 4.6 Query runs

Keeps the 202 + poll contract (Q-007).

```
POST /api/kusto/query
  validate (query required, start<=end, cluster) ─► run{id, owner=oid, status=created, expiresAt}
  spawn asyncio task (tracked in a registry; strong refs kept)
  wait up to 1 s ─► finished ? 200 (completed|error) : 202 (created)
task: OBO token ─► run_query with timeout (QUERY_TIMEOUT_SECONDS) ─► completed | error | timedOut ─► persist
GET /api/kusto/query/{id}: 404 if missing OR owner != caller (no existence leak) ─► 200/202
```

- Explicit timeout sets `timedOut` (status finally used, BUG-02). Client polling deadline > server timeout.
- Retention: every run has `expiresAt` set at creation and refreshed on completion (`RUN_RETENTION_SECONDS`, default 1 day, BUG-01). Cleanup: a periodic asyncio task deletes rows past `expires_at` (PostgreSQL has no native TTL).
- Startup recovery: on boot, runs still `created` and older than the timeout are marked `error` ("interrupted"); in-process tasks do not survive restarts (accepted limitation of Q-007 default; the durable worker alternative is deferred).
- Single replica or sticky assumptions: with N replicas the poll may hit a different pod, but state is in the shared store, so this works; only the *running task* is pod-local.
- Errors carry `mainError` only; the stack trace is logged, not returned (SEC-04).

### 4.7 Templates

Endpoints as legacy (section 5). Service rules: `createdBy/updatedBy` from token (SEC-03); `updated = now(UTC)`; PUT only updates an existing record's mutable fields (BUG-06) or is explicit upsert per `api-contract.md`; PATCH (RFC 6902, `jsonpatch`) is applied then **re-validated** and may not touch `createdBy`, `uuid`; missing uuid on DELETE -> 404 (BUG-03); list filtering (`since`, `includeDeleted`) done in the store query, not in memory.

### 4.8 Tagged events and ingestion

- Body: non-empty JSON array of `SavedEvent` / `EventTag` / `EventComment`; server **overwrites** `createdBy` (from token) and `dateTimeUtc` (server clock) (SEC-03).
- `IngestGateway` writes NDJSON with the JSON mappings `<Table>Mapping` using `azure-kusto-ingest` under the **app identity** (`azure-identity` `DefaultAzureCredential`), same as legacy; tables stay append-only with `isDeleted` rows.
- Table/mapping creation moves out of app startup into a CLI command `python -m tim_api.cli init-kusto` (Q-015 default). Startup only verifies reachability and logs a warning.

### 4.9 Persistence abstraction

```python
class TemplateRepository(Protocol):
    async def get(self, uuid: UUID) -> QueryTemplate | None
    async def list(self, *, since: datetime | None, include_deleted: bool) -> list[QueryTemplate]
    async def upsert(self, t: QueryTemplate) -> None

class QueryRunRepository(Protocol):
    async def create(self, run: QueryRun) -> None
    async def get(self, id: UUID) -> QueryRun | None
    async def update(self, run: QueryRun) -> None
    async def delete_expired(self, now: datetime) -> int
```

Decision (Q-001, ADR-0004): **one store, PostgreSQL**, no runtime `DATABASE_TYPE` switch. Proposed tooling: SQLAlchemy 2.x async with `asyncpg`, Alembic migrations run via CLI (not at import time), tests against a real Postgres (testcontainers or the compose service). Templates: scalar columns for list/filter fields plus JSONB for `path`, `params`, `fields`, `columns` (JSON field names identical to the API, mapped in the Pydantic layer). Runs: `expires_at` column, JSONB `kusto_query`/`execution_metrics`/`result_data` (or compressed `bytea` if size demands) and a size cap. A periodic cleanup task deletes runs past `expires_at`. An in-memory repository backs unit tests.

---

## 5. API contract summary

Full field-level contract will live in `docs/rewrite/api-contract.md` (to be created). Paths and JSON field names stay as legacy so the same SPA logic and Export/Import work. Per Q-008 (proposed default: fix where the frontend is rewritten anyway), the "Fixed" rows below are proposals to be confirmed.

| # | Endpoint | Legacy quirk | Decision | Ref |
|---|---|---|---|---|
| 1 | `POST /api/user/authenticate` | dead login | **Removed** | SEC-07, Q-011 |
| 2 | `POST /api/kusto/schema` | JSON string inside JSON row list (`data[0].ClusterSchema`) | **Fixed**: `{schema: <object>}` (the React client is new, no parity constraint; api-contract.md D8) | Q-008, Q-018, Q-028 |
| 3 | `POST /api/kusto/query` | `requestedBy` in body | **Fixed**: field ignored/absent, owner from token | SEC-03 |
| 3 | same | cluster validation skipped | **Fixed** | SEC-01 |
| 3-4 | query errors returned as 200 `status:"error"` | **Kept** (frontend reads `status`); revisit under Q-008 | Q-008 |
| 3-4 | `stackTrace` in body | **Removed** | SEC-04 |
| 4 | `GET /api/kusto/query/{id}` | any user reads any run | **Fixed**: 404 unless owner | SEC-02 |
| 4 | `timedOut` never set | **Fixed**: set on timeout | BUG-02 |
| 5 | `GET /api/templates/queries` | `includeDeleted` absent = included | **Fixed**: absent = excluded; SPA passes `true` explicitly for the Query Manager | BUG-05, Q-008 |
| 6 | `GET .../{uuid}` | 404 | **Kept** | |
| 7-8 | POST / PUT return 200 empty | **Fixed**: 201/204 (SPA ignores body); 409 on duplicate POST | BUG-04, Q-008 |
| 8 | PUT blind upsert, trusts `createdBy`/`isDeleted` | **Fixed**: server-owned fields | BUG-06 |
| 9 | PATCH not re-validated | **Fixed** | BUG-06 |
| 10 | DELETE missing uuid = 500 | **Fixed**: 404 | BUG-03 |
| 11-13 | tagged events: client `createdBy`/`dateTimeUtc` | **Fixed**: server-set | SEC-03 |
| 11-13 | 204 on success, empty array = 400 | **Kept** | |
| all | 400 shapes (`ValidationProblemDetails` vs plain string) | **Unified** to one RFC 7807-style problem envelope (api-contract.md D17, Q-102); SPA client maps it once (BUG-40) | Q-008 |
| all | 500 empty body | **Fixed**: envelope | SEC-04 |
| all | CORS any origin | **Fixed**: configurable | SEC-05 |
| health | `/api/healthChecks/readiness`, `/liveness` | always 204 | **Kept** paths; readiness probes the store | |
| ops | `/metrics`, swagger at `/api/swagger` | | **Kept** (`/api/docs`/OpenAPI served by FastAPI; `/metrics` via `prometheus-fastapi-instrumentator`); `/metrics` should not be public via ingress | |

JSON: field names byte-identical to legacy DTOs; Kusto column names as dictionary keys are never re-cased; enums serialise as legacy `EnumMember` strings.

---

## 6. Security fixes

| ID | Legacy issue | Fix in target | Where |
|---|---|---|---|
| SEC-01 | Cluster URL unvalidated; OBO token sent anywhere | https + host allow-list / suffix check before any token acquisition | `kusto/cluster.py`, 4.5 |
| SEC-02 | No run ownership check | `owner_oid` stored on run; non-owner gets 404 | `query_runs/service.py`, 4.6 |
| SEC-03 | `createdBy`/`requestedBy`/`dateTimeUtc` client-supplied | Identity from validated token, timestamps server-side; fields removed/ignored in schemas | `auth/`, `tagged_events/`, `templates/` |
| SEC-04 | Stack traces returned | Global handler + `mainError` only; trace to server log with `traceId` (problem envelope, api-contract.md) | `main.py` |
| SEC-05 | CORS `*` | `CORS_ALLOWED_ORIGINS` list, default none (same-origin behind proxy) | `main.py`, `config.py` |
| SEC-06 | Handlebars `noEscape`, unescaped `array`, share-link params run as victim | KQL-literal-escaping helpers; params validated vs template; `execute=1` confirmation | `web/lib/kql-templates`, `web/features/share` |
| SEC-07 | Dead auth endpoint and secrets required at boot | Removed (Q-011 default) | `auth/` |
| BUG-01 | Inconsistent run retention | `expiresAt` + cleanup | 4.6 |
| BUG-02 | Runs stuck in `created`, no timeout | Timeout, `timedOut`, startup recovery, result cap | 4.6 |
| BUG-03/04/05/06 | Template endpoint quirks | see section 5 | `templates/` |
| BUG-07/08 | Redis `KEYS`, Mongo `Id` filter | Not applicable (PostgreSQL only, ADR-0004) | `storage/` |
| BUG-09 | Hard-coded OBO scope, per-request MSAL app | Configurable scope (Q-013), one cached MSAL app | `auth/` |
| BUG-10 | Helm env mismatch, ingress strips `/api` | New deploy assets validated in CI (Q-016) | `deploy/` |
| BUG-20..23 | Refresh redirect, popup on every load, stuck login | Load tabs before routing; popup login with silent SSO first, retryable sign-in, single in-flight interactive request (ADR-0005) | `web/app`, `web/lib/auth` |
| BUG-25/26/27 | Tag dialog and row-load bugs | Live-row mutation; dialog stays open on error; empty rows tolerated | `web/features/tagging`, `grid` |
| BUG-29 | `formatCluster` forces `.kusto.windows.net` | Accept full URLs and short names; suffix only for bare names via config | `web/lib/kql-templates`, `api/kusto` |
| BUG-30/32 | Poll timeout null, orphan tabs | Typed poll result + abort; cascade delete | `web/features/tabs` |
| BUG-31/34/35/36 | Share encoding, defaults, path collisions, columns from row 0 | Unicode-safe base64url; one defaults fn; tree keyed by full path; columns from union of first N rows | `web/*` |
| BUG-33/37/38/42 | Vuex strict, listener leaks, raw errors, editable-everything | Removed by design (no bus, serialisable errors); only `TagEvent.Comment` editable, others read-only | `web/*` |
| BUG-41 | Cosmetics/typos | Fixed as encountered | `web/*` |

---

## 7. Configuration and environment variables

### Backend (`pydantic-settings`, env only, no secrets in repo)

| Legacy name | New name | Notes |
|---|---|---|
| `AUTH_TENANT_ID` | `TIM_AUTH_TENANT_ID` | required |
| `AUTH_CLIENT_ID` | `TIM_AUTH_CLIENT_ID` | required; audience `api://{id}` |
| `AUTH_CLIENT_SECRET` | `TIM_AUTH_CLIENT_SECRET` | optional; else federated/managed-identity assertion |
| *(none)* | `TIM_AUTH_AUTHORITY_HOST` | optional, default `https://login.microsoftonline.com`; sovereign clouds |
| *(none)* | `TIM_AUTH_DISABLED` | dev only (P1-12); rejected when `TIM_ENVIRONMENT=production` |
| *(none)* | `TIM_ENVIRONMENT` | `development` \| `production` (default `production`) |
| `SIGNING_KEY`, `AUTH_USERNAME`, `AUTH_PASSWORD` | *(removed)* | SEC-07 |
| *(hard-coded scope)* | `TIM_KUSTO_OBO_SCOPE` | Q-013; default derived per cluster |
| *(none)* | `TIM_ALLOWED_KUSTO_HOSTS` / `TIM_ALLOWED_KUSTO_SUFFIXES` | SEC-01; see Q-022 |
| `KUSTO_CLUSTER_URI` | `TIM_TAG_CLUSTER_URI` | tag cluster (admin + ingest) |
| `KUSTO_DATABASE_NAME` (default `Research`) | `TIM_TAG_DATABASE` | |
| `KUSTO_INGEST_URL` | `TIM_TAG_INGEST_URL` | optional; unused in legacy, derived from the cluster URI when unset |
| `AZURE_CLIENT_ID/TENANT_ID/CLIENT_SECRET` | same (read by `azure-identity`) | app identity for ingest/admin |
| `DATABASE_TYPE` | *(removed)* | Q-001, ADR-0004: PostgreSQL only |
| `COUCHBASE_*`, `MONGO_*`, `REDIS_CONNECTION_STRING` | `TIM_DATABASE_URL` | one PostgreSQL URL (`postgresql+asyncpg://…`, ADR-0004) |
| *(none)* | `TIM_QUERY_TIMEOUT_SECONDS` (default 600) | Q-007, Q-021 |
| *(none)* | `TIM_RUN_RETENTION_SECONDS` (default 86400) | Q-007 |
| *(none)* | `TIM_MAX_RESULT_ROWS` (100000) / `TIM_MAX_RESULT_BYTES` (64 MB) | Q-021 |
| *(any origin)* | `TIM_CORS_ALLOWED_ORIGINS` | SEC-05 |
| *(none)* | `TIM_LOG_LEVEL` | |

### Frontend runtime (`/config.js` generated at container start)

| Legacy `.docker` env | `window.appConfig` key | New container env |
|---|---|---|
| `AUTH_CLIENT_ID` | `auth.clientId` | `AUTH_CLIENT_ID` |
| `AUTH_TENANT_ID` | `auth.authority` (full URL, `https://login.microsoftonline.com/<tenant>`) | `AUTH_TENANT_ID` (entrypoint builds the URL); dev fallback env is `VITE_AUTH_AUTHORITY` |
| `REDIRECT_URI` | `redirectUri` | kept: MSAL popup returns to this SPA redirect URI (must be registered in Entra) |
| `API_BASEPATH` | `apiEndpoint` | `API_BASEPATH` (normalised) |
| `AGGRID_LICENSE` | `agGridLicenseKey` | `AGGRID_LICENSE` (optional in development (trial); required in production, Q-027, ADR-0006) |
| `KUSTO_CLUSTER_URI` | `tagCluster` + default cluster | `TAG_CLUSTER` |
| `KUSTO_DATABASE_NAME` | `tagDatabase` + default database | `TAG_DATABASE` |
| *(hard-coded)* | `wikiUri`, `issueUri` | `HELP_WIKI_URI`, `HELP_ISSUE_URI` (typo fixed) |
| *(none)* | `defaultClusters` | optional JSON `DEFAULT_CLUSTERS` |
| `BACKEND_URI` | *(nginx only)* | unchanged if nginx proxy is kept (Q-016) |

`.env.example` names are corrected (LICENSE vs LICENCE, BUG-41).

---

## 8. Testing strategy

| Layer | Tooling | What is tested | Gate |
|---|---|---|---|
| web unit | Vitest | `kql-templates` (buildParams, isDataComplete, escaping, summary), `time-range`, tree selection cascade, tag-dialog decision logic, share encode/decode incl. legacy links, IndexedDB migrations (`fake-indexeddb`), poll backoff (fake timers) | CI required |
| web component | Testing Library + MSW | TemplateQueryResult param widgets (revive the 11 legacy cases), TagEventDialog validation, NewQueryButton search, Query Manager | CI required |
| web e2e | Playwright against the built app with mocked API + stubbed auth | W1-W14 smoke; reuse `tools/legacy-screenshots/` harness ideas for visual parity captures into `docs/rewrite/screenshots/` | nightly / pre-cut-over |
| api unit | pytest | cluster validator (SEC-01), claim parsing (Q-014), run state machine incl. timeout/recovery, JSON Patch re-validation, value serialisation | CI required |
| api endpoint | FastAPI `TestClient` + fakes for Kusto/Token/Ingest/repos | every endpoint: happy path + main error (RULES §6); ownership (SEC-02); identity-from-token (SEC-03); no traces (SEC-04) | CI required |
| contract | pytest against recorded legacy responses / `api-contract.md` examples | field names and shapes identical where marked Kept | CI required |
| integration | real store in a container; Kusto emulator/`help.kusto.windows.net` sample optional | repository behaviour, TTL cleanup, Kusto frame parsing (Q-018 check) | optional job |
| static | `tsc --noEmit`, eslint, `ruff`, `mypy` | | CI required |

### CI

`.github/workflows/build-web.yml` (Node 24: `npm ci`, lint, `format:check`, typecheck, test, build) and `build-api.yml` (uv: `sync --locked`, ruff check, ruff format --check, mypy, pytest) run on PRs and pushes to main touching `web/**` / `api/**` respectively; least-privilege permissions, superseded runs cancelled. The api docker-build job is commented out until P1-10. `release-please-config.json` has `web` (node) and `api` (python) packages at 0.1.0; no image publishing until P5.

Coverage is not a numeric gate initially; the gate is that every bug ID marked "Fixed" has a regression test named after it.

---

## 9. Deployment (Q-016)

Proposed default: **two images + Docker Compose; Helm later.**

| Item | Proposal |
|---|---|
| `web` image | multi-stage Node build -> `nginx-unprivileged` (port 8080, `TIM_ENVIRONMENT` selects development/production, default production); entrypoint renders `config.js` (and `nginx.conf` proxying `/api/` to `BACKEND_URI`); Monaco assets bundled by Vite, no `prepublish` copy step; single build with AG Grid Enterprise; licence key supplied at runtime via `config.js` (required in production, Q-027) |
| `api` image | `python:3.12-slim`, `uv sync --locked --no-dev`, port 8080, `uvicorn tim_api.main:app` (workers = 1 per container so the task registry and TTL sweeper stay simple), non-root, `/api/healthChecks/*` probes |
| Compose | `web`, `api`, `postgres` (ADR-0004); a one-shot `init` service runs the DB migration and `init-kusto` CLI (Q-015) |
| Ingress | routes `/api` **without** rewrite (BUG-10); `/metrics` not exposed |
| CI | path-filtered workflows for `web/**` and `api/**` (lint, type-check, tests, image build); release-please gets `web` and `api` packages when they ship; legacy workflows stay until cut-over |
| Alternative | single container (API serves built SPA, `config.js` as a dynamic route); simpler, but couples release cadence. Not chosen; decided by Q-016 |

---

## 10. Cut-over (Q-004: no data migration)

Decision (Q-004): **no legacy data is migrated.** There is no template import CLI (Q-026 moot) and no IndexedDB migration (Q-023 moot).

| Data | Path | Notes |
|---|---|---|
| Templates | Not migrated; created afresh in the new app | New PostgreSQL store starts empty |
| Query runs | Not migrated | Ephemeral |
| Tag tables in Kusto | Unchanged; both apps read/write the same tables | Zero migration; new backend keeps column names and mappings |
| Users' tabs, rows, column views | Not migrated | New app uses its own IndexedDB `tim` (v1) and never reads the legacy `localforage` DB. Export/Import (W13) stays for the new app's own data |
| Share links | `#/share/<uuid>?p=...` decode still supported (legacy `btoa` decode) | Links to legacy template uuids resolve only if those templates are re-created with the same uuids |

Cut-over:
1. Build `web` + `api` alongside legacy (legacy untouched, ADR-0003).
2. Verify with the workflow checklist W1-W14. Production deploy needs the AG Grid licence key configured (Q-027).
3. Deploy the new stack and retire the legacy deployment.
4. Delete `frontend/` and `backend/` in one change (work-breakdown P5).


## 11. Risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | AG Grid Enterprise runs on the trial until the licence arrives (Q-002, Q-027) | Watermark and console warning in dev; production can't go live without the key | Licence procurement tracked outside the repo; prod entrypoint requires `AGGRID_LICENSE`; no Community fallback (ADR-0006) |
| R2 | MSAL popup blocked or re-prompting (BUG-22/23) | Users cannot sign in | Silent token first, single in-flight request, retryable sign-in, popup hint text; test sign-in explicitly |
| R3 | Handlebars escaping breaks existing templates (Q-006, SEC-06) | Templates render differently | Escape only at literal boundaries, snapshot-test rendered output of all shipped templates before/after |
| R4 | Kusto client is synchronous, MSAL is blocking | Event-loop stalls under load | Thread offload, bounded worker pool, load test |
| R5 | In-process tasks lost on restart (Q-007) | Interrupted runs | Startup recovery, client shows retry; durable worker is a later option |
| R6 | Large results (no cap in legacy) | Memory, store size, browser IndexedDB limits | Row/byte cap (Q-021), compression, clear error message |
| R7 | Kusto schema column name unverified (Q-018) | Monaco IntelliSense fails | Verify against a real cluster early; tolerate both names |
| R8 | Keep-alive replacement slower or lossier than Vue keep-alive | Tab-switch UX regressions | State-cache design 3.6, spike with 100 tabs of 50k rows |
| R9 | Parity drift from undocumented legacy behaviour (no legacy tests; `data-models.md` and screenshot README still missing) | Missed features | Component mapping doc, W1-W14 e2e checklist, code wins over docs (RULES §2) |
| R10 | Dropping features by default (suppressions, `/authenticate`) | An unknown consumer breaks | Q-010/Q-011 confirmations before removal in production |
| R11 | Users lose legacy tabs and templates (Q-004: no migration) | Users must recreate work | Accepted by the user; announce before cut-over; Export/Import for the new app's own data |
| R12 | PostgreSQL schema/tooling still proposed (ADR-0004) | Rework in storage module | Repository protocol + in-memory impl isolates the store |

---

## Questions raised by this doc

Logged in [open-questions.md](../open-questions.md) as Q-020…Q-026 (Q-023, Q-025 and Q-026 are moot and answered; the rest are Open with proposed defaults). Copied here for context; the log is authoritative.

| ID (proposed) | Question | Why it matters | Proposed default |
|---|---|---|---|
| Q-020 | **Tag ingestion identity**: keep writing tags under the app identity while recording the user from the token as `createdBy` (SEC-03 fix), or ingest with the user's OBO token? | Kusto permissions model; the tag cluster needs ingest rights for every user otherwise | App identity, `createdBy` from token |
| Q-021 | **Query result limits and retention values**: max rows / bytes per run, query timeout, run retention | Store size, browser memory, BUG-02 | 100 000 rows, 64 MB, 10 min timeout (poll deadline 11 min), 1 day retention |
| Q-022 | **Cluster allow-list policy** (SEC-01): explicit host allow-list required, or https + known suffix list? | Sovereign clouds, Fabric, BUG-29 | https + suffix list (`.kusto.windows.net`, `.kusto.fabric.microsoft.com`), optional strict allow-list env |
| Q-023 | ~~IndexedDB reuse~~ | **Moot (answered)**: Q-004 = no migration; new DB `tim` from v1, no legacy read | n/a |
| Q-024 | **Handlebars escaping semantics** (Q-006 follow-up): what happens to existing templates that use raw `{{x}}` inside KQL strings, and does `array` change output for values with quotes? | Existing templates may render differently | Escape only in explicit string-literal helpers; raw `{{x}}` unchanged but linted; `array` escapes quotes |
| Q-025 | ~~MSAL redirect URI vs hash routing~~ | **Moot (answered)**: Q-003 keeps popup login | n/a |
| Q-026 | ~~Template migration privileges~~ | **Moot (answered)**: Q-004 = no migration | n/a |
