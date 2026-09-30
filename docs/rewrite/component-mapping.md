# Component mapping: legacy → new

> Status: **Proposed** (Phase 0). Companion to [target-architecture.md](target-architecture.md) (layout and conventions) and [work-breakdown.md](work-breakdown.md) (tasks). Legacy specs: [../current-system/](../current-system/). Bug IDs are from [known-issues.md](../current-system/known-issues.md). Complexity S/M/L is the React/Python effort estimate. Open questions are in [../open-questions.md](../open-questions.md).

Conventions:
- Frontend paths are relative to `web/src/`; backend paths relative to `api/src/tim_api/`.
- Legacy paths are relative to `frontend/src/` or `backend/Tim.Backend/`.
- A "hook" lives next to its feature (`features/<x>/use*.ts`). Feature state uses React context + reducer unless target-architecture.md says otherwise.
- Hash routes are kept: `#/`, `#/queries/`, `#/view/:uuid`, `#/share/:uuid?p=&execute=`, `#/exportimport/`.

## (a) Frontend

### a1. Entry, shell, views

| Legacy | New location | Notes / behaviour changes | Bugs fixed | Cx |
|---|---|---|---|---|
| `main.js` | `app/main.tsx` | Mount React, MsalProvider, ThemeProvider, router, runtime-config bootstrap. AG Grid Enterprise module registration + optional licence key from runtime config (ADR-0006: runs unlicensed in development; no `sed` build trick, single build). | BUG-43 | S |
| `plugins/vuetify.js` | `app/theme.ts` | MUI theme approximating Vuetify defaults (primary/accent colours, dense toolbar). Q-012. | – | S |
| `router/index.js` | `app/routes.tsx` | `createHashRouter`; same 5 routes; add catch-all redirect to `/`; lazy routes. | – | S |
| `App.vue` (shell, auth gate, toolbar) | `app/AppShell.tsx`, `app/Toolbar.tsx`, `app/AuthGate.tsx`, `app/useBootstrap.ts` | Toolbar: hamburger menu (Query Manager), TIM link, Help menu, Settings menu, Account menu. Bootstrap = login → load templates → load column views → load tabs. Popup login + silent SSO first (ADR-0005). Retry after a failed first sign-in re-runs bootstrap. | BUG-22, BUG-23 | M |
| `App.vue` draggable dialogs (mousedown on `.v-card__title`, 100 ms interval) | `components/DraggableDialog.tsx` (wraps MUI `Dialog` + `react-draggable` or pointer handlers) | Replaces global DOM hack + interval; clamped to viewport via handler, no polling. Used by TagEventDialog and TimeSelection. | BUG-37 | S |
| `views/Welcome.vue` | `app/routes/WelcomePage.tsx` | Landing text + "Get Started" `NewQueryMenu`. | – | S |
| `views/OpenTriage.vue` | `features/tabs/TabHost.tsx` (route `/view/:uuid`) | Renders the active tab; keeps visited tabs mounted (hidden) to emulate `keep-alive max=100` (LRU cap 100 to bound memory). Redirect to `/` only **after** tabs are loaded. Remount when a template tab is converted to a Kusto tab. Hosts `DetailPanel` and `TagDialog`. | BUG-20 | M |
| `views/QueryEditor.vue` | `features/templates-admin/QueryManagerPage.tsx` (+ `useTemplates.ts`) | MUI DataGrid or table; Show deleted, Filter, bulk Delete/Restore. Restore disabled-state uses the restore count. Timestamps formatted (legacy shows raw ISO). | BUG-24 | M |
| `views/ExportImport.vue` | `features/export-import/ExportImportPage.tsx`, `features/export-import/exportImport.ts` | Same JSON of tabs. Import validates schema (zod or hand-written), writes IndexedDB and reloads store in place (no manual refresh). Column views/options/rows still excluded. Covers the new app's own data only; legacy data is never imported. | – | S |
| `views/ShareQuery.vue` | `features/share/SharePage.tsx`, `features/share/shareLink.ts` | Same URL format. Unicode-safe base64 (`TextEncoder` + `btoa`; decode accepts legacy links). Params from URL validated against template param definitions; values escaped by the template engine. `execute=1` still runs (see SEC-06 note in ADR / Q-006 assumption). | BUG-31, SEC-06 | S |
| `components/DefaultSnackbar.vue` | `components/SnackbarHost.tsx` + `lib/notify.ts` (`useNotify()`) | FIFO queue, icon, optional link, Dismiss; replaces event `show:snackbar`. | – | S |
| `components/NewQueryButton.vue` | `features/tree/NewQueryMenu.tsx` | Button + MUI Menu; "New query" item, "Search queries" field, Views and Queries submenus. | – | M |
| `components/TemplateQuerySubMenu.vue` | `features/tree/TemplateSubMenu.tsx` | Recursive nested list (Collapse). Leaf click opens template tab in edit mode (no auto-run). Uses path-keyed tree so submenu names may collide safely. | BUG-35 | S |
| `components/SideQueryTree.vue` | `features/tree/SideTree.tsx` (+ `useTreeSelection.ts`, `TreeNodeLabel.tsx`) | Collapsible drawer (mini variant, expands on hover, width 700). Header: new, reload templates, remove selected. Status icons/badges/prefixes `[draft]`/`[new]`. Active tab highlighted on first load. Selection semantics (see below). | BUG-21, BUG-32 | L |
| `components/VTreeviewIndependantParent.vue` | `features/tree/useTreeSelection.ts` (pure reducer, unit-tested) | Check node → checks descendants; uncheck → unchecks descendants and ancestors. Removing a tab always removes its whole subtree (store enforces, not only UI). | BUG-32 | M |
| `components/KustoQueryResult.vue` | `features/kusto-query/KustoQueryTab.tsx` (+ `KustoQueryToolbar.tsx`, `KustoQueryEditForm.tsx`, `useRunKustoQuery.ts`) | Toolbar Run/Clone/Edit/Save & Run/Save/Cancel; error alert with `<pre>`; result grid. Legacy forces edit mode on every mount; new: edit mode persisted per tab, default edit only for drafts. Time range persisted in tab state. | – | M |
| `components/TemplateQueryResult.vue` | `features/template-query/TemplateQueryTab.tsx` (+ `TemplateParamForm.tsx`, `ParamField.tsx`, `QueryPreview.tsx`, `ConvertDialog.tsx`, `useRunTemplateQuery.ts`) | Param form by type (array, match, multiple, boolean, string), preview, share, convert, clone (sibling). Template snapshot semantics kept. Share encodes Unicode safely. Preview and run use the same rendering code path and escaping. | BUG-31, BUG-34, SEC-06 | L |
| `components/grids/KustoPivot.vue` | `features/grid/ResultsGrid.tsx` (+ `gridOptions.ts`, `columnDefs.ts`, `rowClass.ts`, `contextMenu.ts`, `useGridState.ts`, `useRowData.ts`) | AG Grid React. Columns derived from the **union of keys across rows**. Missing stored rows handled as empty result. Only `TagEvent.Comment` is editable; other columns non-editable. Context menu items built in `contextMenu.ts`; pivots call `features/template-query`, tagging calls `features/tagging`. Column state saved/restored on tab hide/show. | BUG-25, BUG-27, BUG-36, BUG-42 | L |
| `helpers/aghelper.js` (`createMenuContext`) | `features/grid/contextMenu.ts` | Builds nested AG Grid menu items from templates by `path`; path-keyed tree, sorted. | BUG-35 | S |
| `components/ColumnView.vue` | `features/grid/ColumnViewBar.tsx` (+ `useColumnViews.ts`, `RenameColumnViewDialog.tsx`, `DeleteColumnViewDialog.tsx`) | Autocomplete + Apply/Rename/Delete/Save; confirm text corrected. Global column views kept (parity). | BUG-41 | M |
| `components/ExecutionStatusPanelComponent.vue` | `features/grid/ExecutionStatusPanel.tsx` | AG Grid status-bar panel: execution time, CPU time, memory MB. | – | S |
| `components/TagEventDialog.vue` | `features/tagging/TagDialog.tsx` (+ `tagDialogLogic.ts` pure, `TagActionRow.tsx`, `useSaveTagEvents.ts`) | Determination/Comment/Tags rows with action selects, modifications preview, validation messages unchanged. Dialog stays open on error (shows message). Null-safe determination lookup. | BUG-26 | L |
| `components/DetailSidePanel.vue` | `features/grid/DetailPanel.tsx` | MUI right Drawer 900px, visible close icon, `Result Details` accordion, objects as YAML (`js-yaml`), follows focused cell. Opened from context menu via context/callback, not event bus. | BUG-41 | S |
| `components/TimeSelection.vue` | `lib/time-range/` (`timeRange.ts`, `presets.ts`) + `features/kusto-query/TimeRangePicker.tsx` (+ `CustomDateRangeDialog.tsx`, `CustomPeriodDialog.tsx`) | Pure time-range model (absolute or relative-ago, evaluated at run time) with Vitest tests; NaN/invalid custom periods rejected. Default Last 15 minutes. UTC. | BUG-39 | M |
| `components/ClusterSelection.vue` | `features/kusto-query/ClusterSelect.tsx` | Two MUI Autocomplete (freeSolo), grouped by config `defaultClusters`. | – | S |
| `components/KustoMonacoEditor.vue` | `features/kusto-query/KustoEditor.tsx` (+ `useKustoSchema.ts`, `lib/monaco/loadMonacoKusto.ts`) | Controlled Monaco; disposes on unmount; schema loaded for initial and changed cluster/db, cached per cluster+db, errors surfaced via notify; race-free. Q-017 default: suggestions enabled. | BUG-28, BUG-37 | M |
| `components/MonacoEditor.vue` | `components/CodeEditor.tsx` | Generic Monaco wrapper (language prop), disposes on unmount. | BUG-37 | S |
| `helpers/loadMonacoKusto.js` | `lib/monaco/loadMonacoKusto.ts` (in `features/kusto-query` if not shared: keep under `features/kusto-query/monaco/`) | Load `monaco-editor` + `@monaco-kusto` via Vite (workers via `?worker`) instead of runtime script injection into `public/monaco-editor`; no `prepublish` copy step. | – | M |
| `components/QueryHelperDialog.vue` | `features/kusto-query/QueryHelperDialog.tsx` | Static help content. Fix stray `}` and `GetTagEvents` casing. Tag cluster/db come from runtime config. | BUG-41 | S |
| `components/CreateQueryDialog.vue` | `features/templates-admin/TemplateDialog.tsx` (+ `templateForm.ts` validation, `TemplateYamlEditor.tsx`) | Fields and hints unchanged. Managed templates fully read-only (including Fields editor). Error message read from the correct response shape; network errors handled. | BUG-40 | M |
| `components/SuppressionDialog.vue`, `components/DetailCellRenderer.vue` | – | Dropped (see section c). | – | – |

### a2. Helpers

| Legacy | New location | Notes | Bugs fixed | Cx |
|---|---|---|---|---|
| `helpers/apiClient.js` | `lib/api/client.ts` (fetch wrapper + auth header + error mapping), `lib/api/kusto.ts`, `lib/api/templates.ts`, `lib/api/taggedEvents.ts`, `lib/api/types.ts` | Single typed client. Token from `lib/auth`. Typed `ApiError`; 401 triggers re-auth; timeouts + `AbortSignal`. **No** `requestedBy`/`createdBy`/`dateTimeUtc` sent (server derives from token). `createSuppression` and `queryRetrieveById` dropped. | SEC-03, BUG-40 | M |
| `helpers/auth.js` | `lib/auth/msalConfig.ts`, `lib/auth/AuthProvider.tsx`, `lib/auth/useAuth.ts`, `lib/auth/getApiToken.ts` | msal-react popup login (ADR-0005); MSAL init + pending-response handling; cached account + `acquireTokenSilent`/`ssoSilent` before any popup (no prompt on every load); single in-flight interactive request; sign-in failure retryable. API scope `api://<clientId>/user_impersonation`. `getKustoToken` dropped. Logout clears cache. | BUG-22, BUG-23 | M |
| `helpers/runtimeConfig.js` | `lib/config/runtimeConfig.ts` (+ `public/config.js` loaded before app, zod-validated) | `window.appConfig` overrides `import.meta.env`; all env vars `VITE_`-prefixed; `nodeEnv` dropped (use `import.meta.env.MODE`); tag cluster/db keys work in dev; issueUri typo fixed; licence var spelling fixed. | BUG-33, BUG-41 | S |
| `helpers/eventBus.js` | Removed (see event table a4) | Replaced by React context and callbacks. | BUG-37 | – |
| `helpers/displayComponent.js` (`convertToCustomQuery`, `defaultNewQuery`, `createNewQueryComponent`, `runNewQuery`, `runTemplateQuery`, `templateQueriesAsObject`, `createNewTemplateQueryComponent`) | `features/tabs/tabActions.ts` (create/convert), `features/kusto-query/defaultQuery.ts`, `features/kusto-query/runKustoQuery.ts`, `features/template-query/runTemplateQuery.ts`, `features/tree/templateMenuTree.ts` (`buildTemplateMenuTree`) | Run functions store **serialisable error objects** `{message, code?}` only. Menu tree keyed by full path. | BUG-35, BUG-38 | M |
| `helpers/queries.js` (`formatCluster`, `runKustoQueryPoll`, `handleResult`) | `lib/api/queryRuns.ts` (`runQuery` with poll loop), `lib/kql-templates/cluster.ts` (`normalizeClusterUrl`) | Poll backoff kept (500 ms, doubling every 3 polls, cap 30 s, max 11 min) but timeout throws a typed `QueryTimeoutError`; cancellable via `AbortSignal`; `queryRunId` check fixed. Cluster normalisation only prepends `https://` when no scheme; does not force `.kusto.windows.net`; same function used for schema and query calls. | BUG-29, BUG-30 | M |
| `helpers/kustoQueries.js` (`QueryTemplate`, `getDefaultParams`, `buildParams`, `isDataComplete`, `buildSummary/Cluster/Query`, `getTagEvents` partial, `array` helper, `validateData`) | `lib/kql-templates/queryTemplate.ts` (types + class or pure functions), `params.ts` (`getDefaultParams`, `buildParams`, `isDataComplete`), `render.ts` (Handlebars env), `helpers.ts` (`array` helper with quote escaping), `partials/getTagEvents.kql.ts`, tests `*.test.ts` | Handlebars kept (Q-006). Rendering uses an isolated `Handlebars.create()` instance. Values interpolated into KQL string literals are escaped. `getDefaultParams` consistent with `buildParams` for falsy defaults. `validateData` dropped. | SEC-06, BUG-34 | L |
| `helpers/localStorage.js` (`saveDataStore`, `loadDataStore`, `deleteDataStore`) | `lib/storage/rowResults.ts` | IndexedDB store `row_results` via `idb`. Returns `[]`/`undefined` explicitly for missing keys. | BUG-27 | S |
| (localforage instances in `store/modules/*.js`) | `lib/storage/db.ts` (open new DB `tim`, v1, versioned schema), `lib/storage/displayComponents.ts`, `lib/storage/columnViews.ts`, `lib/storage/queryOptions.ts` | Same 4 object stores in the new `tim` DB, v1; DB version upgrade hook for future schema changes. Never reads the legacy `localforage` DB; no migration of legacy data. | – | M |
| `helpers/tags.js` (`tagsFromData`, `tagsDiff`, `tagsIntersect`, `retrieveRecentTags`) | `features/tagging/tagSets.ts` (+ tests) | `retrieveRecentTags` stub dropped; the "Recent tag" dialog subtitle only if implemented later. | – | S |
| `helpers/utils.js` (`generateUuidv4`, `generateURL`, `isEmptyValue`, `timeAgo`, `TimeRange`, `TimeAgoRange`) | `lib/uuid.ts` (`crypto.randomUUID()`), `lib/time-range/timeRange.ts` (`TimeRange`, `TimeAgoRange` types/functions), `lib/isEmpty.ts`, `features/share/shareLink.ts` (`generateUrl`) | `isEmptyValue` handles empty array/object correctly. | BUG-41 | S |
| `helpers/aghelper.js` | see a1 (`features/grid/contextMenu.ts`) | | | |

### a3. Vuex modules

> The state library follows [target-architecture.md §3](target-architecture.md), which recommends **Zustand** stores (tabs, templates, column views, UI). The file names below still apply; read "reducer/Provider" as "Zustand store + hooks" unless an ADR says otherwise.

| Legacy | New location | Notes | Bugs fixed | Cx |
|---|---|---|---|---|
| `store/index.js` | `app/providers.tsx` (composes providers) | No strict-mode equivalent; development uses React StrictMode. | BUG-33 | S |
| `store/modules/displayComponent.js` | `features/tabs/tabStore.ts` (reducer + selectors), `features/tabs/TabsProvider.tsx`, `features/tabs/useTabs.ts`, `features/tabs/persistence.ts` | State `{tabs: Record<uuid, Tab>, order, index}`; roots and children derived (memoised selectors: `selectRoots`, `selectChildren`, `selectParent`, `selectTab`). Actions: create, updateState/Params/Title, convert, triggerRowData, save (children stripped), remove (**cascades to descendants** and deletes row results), removeAll, loadAll (ordered, template rehydrated), export, import (updates store). Debounced write-through to IndexedDB. | BUG-32, BUG-38 | L |
| `store/modules/queries.js` | `features/templates-admin/templatesStore.ts` + `useTemplates.ts` (TanStack Query for fetch/cache/reload), `lib/storage/queryOptions.ts` | `getQueries(reload)` becomes a query with `refetch`; failed fetch not cached forever. Selectors: `queryTemplates` (grid pivots), `viewTemplates` (New menu), `getTemplate`, `getQueryOption`. `updateQueryOption` kept (hide flag) for parity but no UI. | – | M |
| `store/modules/columnViews.js` | `features/grid/columnViewsStore.ts` + `useColumnViews.ts`, `lib/storage/columnViews.ts` | Global named AG Grid column states, add/update/remove/loadAll. | – | S |

### a4. Event bus events

| Event | New mechanism | Notes | Cx |
|---|---|---|---|
| `show:snackbar` | `useNotify().show({message, color, icon, timeout, link, linkText})` from `components/SnackbarHost.tsx` | Context provider with queue. | S |
| `new:display-component` | Tab store `create` action returns the uuid; `SideTree` derives expansion from state (expand ancestors of the newest/active tab) | No emitter/listener. | S |
| `update:kusto-results` | Tab store `updateState({isVisited:false, rowCount, ...})` dispatched by `runKustoQuery.ts` | Tree reads state; "[new]" derived from `isVisited`. | S |
| `show:detail-side-panel` / `update:detail-side-panel` | `DetailPanelContext` (`open(row)`, `setRow(row)`) provided by `TabHost`, consumed by `ResultsGrid` | Follows focused cell while open. | S |
| `create:tag-event-dialog` | `TagDialogContext.open({events, onSuccess})` provided by `TabHost` | `onSuccess` applies **returned** updated rows to the grid. Fixes stale-rows bug. BUG-25. | S |
| `create:suppression-dialog` | – dropped | Dead. | – |

## (b) Backend

Legacy paths relative to `backend/Tim.Backend/`; new paths relative to `api/src/tim_api/`.

### b1. Controllers

| Legacy | New module | Notes | Bugs fixed | Cx |
|---|---|---|---|---|
| `Controllers/External/KustoExternalController.cs` (schema, query, get run) | `kusto/router.py` (`POST /api/kusto/schema`), `query_runs/router.py` (`POST /api/kusto/query`, `GET /api/kusto/query/{id}`) | Same paths and JSON field names. Cluster URL validated on both endpoints against an allow-list/https rule. Owner check on GET runs. Query errors keep `status:"error"` (Q-008: contract in `api-contract.md`). Guid path params → 422/400 on malformed. | SEC-01, SEC-02, SEC-04 | M |
| `Controllers/External/QueryTemplatesExternalController.cs` | `templates/router.py` (list/get/create/replace/patch/delete) | 201/204 semantics documented (Q-008); DELETE missing → 404; `includeDeleted` default false; PUT does not create; PATCH re-validated; server sets `createdBy/updatedBy/updated` from token. JSON Patch via `jsonpatch`. | BUG-03, BUG-04, BUG-05, BUG-06 | M |
| `Controllers/External/TaggedEventExternalController.cs` | `tagged_events/router.py` (`savedEvents`, `tags`, `comments`) | 204; empty array → 400; `createdBy`/`dateTimeUtc` set server-side from token/clock. | SEC-03 | M |
| `Controllers/External/AuthenticateExternalController.cs` | – dropped | Q-011 assumed drop. | SEC-07 | – |
| `Controllers/Internal/HealthChecksController.cs` | `main.py` (`/api/healthChecks/liveness`, `/readiness`) or `health.py` | Liveness always 204; readiness checks storage connectivity (documented deviation). Legacy paths kept for probes. | – | S |

### b2. Providers

| Legacy | New module | Notes | Bugs fixed | Cx |
|---|---|---|---|---|
| `Providers/Query/DelayedQueryRunner.cs` | `query_runs/runner.py` | asyncio task started on POST; race vs 1 s; explicit query timeout; `timedOut` status set; on startup mark stale `created` runs as `error`; sanitised error (no stack trace, log server-side). | SEC-04, BUG-02 | M |
| `Providers/Query/IKustoQueryClient.cs` | `kusto/client.py` (`KustoQueryClient` Protocol) | Interface for mocking. | – | S |
| `Providers/Kusto/KustoQueryClient.cs` | `kusto/query_client.py` | `azure-kusto-data` with user token; V2 frames, concatenate all `PrimaryResult` tables, `Stats` row → metrics; parity value serialisation (datetime ISO, timespan `hh:mm:ss`, dynamic nested, null, guid str); parameters `StartTime`/`EndTime`; optional row/size cap. | – | L |
| `Providers/Kusto/UnexpectedFrameException.cs` | `kusto/errors.py` | | – | S |
| `Providers/Kusto/KustoAdminClient.cs` | `kusto/admin.py` | Used by the table-creation CLI only. | – | S |
| `Providers/Kusto/KustoTableFactory.cs` + `Models/TaggedEvents/Tables/*` | `tagged_events/tables.py` (table + mapping definitions), `tagged_events/cli.py` (`python -m tim_api.tagged_events.cli create-tables`) | Q-015 default: separate command, not startup. | – | M |
| `Providers/Kusto/KustoIngestClient.cs` | `tagged_events/ingest.py` (`TagIngestClient` Protocol + `azure-kusto-ingest` impl) | Direct ingest of NDJSON with JSON mapping under app identity. | – | M |
| `Providers/Helpers/AuthHelper.cs` | `auth/obo.py` (OBO token exchange), `auth/deps.py` (`get_current_user`, `get_raw_token`) | msal `ConfidentialClientApplication` created once and cached; scope configurable/derived from cluster (Q-013). | BUG-09 | M |
| (JWT bearer in `Startup/ServiceExtensions.cs:147-164`) | `auth/jwt.py` (JWKS cache, `aud`, issuer set, username claim fallback) | Q-014. | – | M |
| `Providers/Database/IDatabaseRepository.cs`, `IDatabaseClient.cs` | `storage/base.py` (`TemplateRepository`, `QueryRunRepository` Protocols) | Only the operations used. | – | S |
| `Providers/Database/{Couchbase,Mongo,Redis}{DbClient,Repository}.cs` | `storage/postgres.py` (PostgreSQL, ADR-0004: SQLAlchemy async + asyncpg, Alembic migrations) + `storage/memory.py` (fast unit tests/dev; contract tests also run against real Postgres) | Single store; the 3-way switch is dropped. Consistent retention: runs expire by `expires_at` and a cleanup task. `resultData` kept as compressed JSON. | BUG-01, BUG-07, BUG-08 | L |
| `Providers/Helpers/ZipExtensions.cs` | `storage/compression.py` (gzip helpers) | Only if the store needs compressed results. | – | S |
| `Providers/Helpers/RedisKeyGenerator.cs` | – dropped | Dead. | – | – |

### b3. Models

| Legacy | New module | Notes | Cx |
|---|---|---|---|
| `Models/Templates/QueryTemplate.cs`, `QueryParam.cs`, `QueryField.cs` | `templates/models.py` (`QueryTemplate`, `QueryParam`, `QueryField`) | Pydantic v2; same JSON names (camelCase aliases); validation rules ported from `IValidatableObject`. | M |
| `Models/KustoQuery/KustoQuery.cs` | `query_runs/models.py` (`KustoQueryRequest`) | No `requestedBy` field accepted (ignored/removed); start ≤ end; cluster validated. | S |
| `Models/KustoQuery/KustoClusterDatabase.cs` | `kusto/models.py` (`SchemaRequest`) | https URL validation. | S |
| `Models/KustoQuery/KustoQueryRun.cs`, `KustoQueryResults.cs`, `KustoQueryStats.cs` | `query_runs/models.py` (`QueryRun`, `QueryRunStatus`, `QueryResults`, `QueryStats`) | Status enum `created|completed|error|timedOut` values unchanged. | S |
| `Models/TaggedEvents/{SavedEvent,EventTag,EventComment,IKustoEvent}.cs` | `tagged_events/models.py` | Same JSON names; server-set audit fields excluded from the request models. | S |
| `Models/IJsonEntity.cs` | `storage/base.py` (id field convention) | | S |
| `Models/User/AuthenticateRequest.cs`, `AuthenticateResponse.cs` | – dropped | SEC-07. | – |

### b4. Startup and configuration

| Legacy | New module | Notes | Bugs fixed | Cx |
|---|---|---|---|---|
| `Program.cs`, `Startup/Startup.cs` | `main.py` (`create_app()`, lifespan: storage init; readiness), uvicorn entrypoint | Global exception handler returns sanitised 500. Serilog → `logging`/structlog JSON. Prometheus `/metrics` via `prometheus-fastapi-instrumentator` (registered once). OpenAPI at `/api/docs`. | SEC-04 | M |
| `Startup/ServiceExtensions.cs`, `ServiceCollectionExtensions.cs` | `main.py` (router wiring), `auth/` (JWT, OBO), `storage/factory.py` | DI via FastAPI `Depends`. | BUG-09 | S |
| `Startup/Config/AuthConfiguration.cs` | `config.py` (`AuthSettings`) | `AUTH_TENANT_ID`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET` (optional); `SIGNING_KEY/AUTH_USERNAME/AUTH_PASSWORD` dropped. | SEC-07 | S |
| `Startup/Config/KustoConfiguration.cs` | `config.py` (`KustoSettings`) | `KUSTO_CLUSTER_URI`, `KUSTO_DATABASE_NAME` (default `Research`), OBO scope setting; `KUSTO_INGEST_URL` dropped (unused). | – | S |
| `Startup/Config/{Database,Couchbase,Mongo,Redis}Configuration.cs` | `config.py` (`StorageSettings`) | PostgreSQL settings only (DSN, pool). | – | S |
| CORS (`Startup.cs`) | `main.py` (`CORSMiddleware`) | Origin list from `CORS_ALLOWED_ORIGINS`; none needed if same-origin proxy. | SEC-05 | S |
| `appsettings*.json`, `secrets.example.json` | `api/.env.example` + docs table in `api/README.md` | Env only; no secrets in repo. | – | S |
| `Filters/Swagger/*` | – dropped (FastAPI generates OpenAPI) | Dead. | – | – |
| `Startup/Logging/RetryExtensions.cs`, `IEnvironmentInfo.cs` | – dropped | Dead (Polly unused). | – | – |
| `libman.json`, `stylecop.json`, `.editorconfig`, `Directory.Packages.props`, `*.csproj`, `*.sln` | `api/pyproject.toml` (ruff, mypy, pytest config; uv lock) | Tooling equivalents. | – | S |
| `Dockerfile`, `compose.yaml`, `helm/` | `api/Dockerfile`, root `compose.yaml` (dev, incl. PostgreSQL), helm later (Q-016) | See P1/P5 tasks. | BUG-10 | M |
| `Tim.Backend.Tests/` (empty scaffolding) | `api/tests/` (pytest) | Real tests per endpoint. | – | – |
| Frontend infra: `frontend/Dockerfile`, `.docker/*`, nginx | `web/Dockerfile`, `web/nginx.conf.template`, `web/docker-entrypoint.sh` generating `config.js` | Entrypoint validates required env, generates `config.js` (JSON-escaped values). Single build; optional AG Grid licence key at runtime (ADR-0006). | BUG-10, BUG-43 | M |

## (c) Dropped items

| Item | Reason | Ref |
|---|---|---|
| `SuppressionDialog.vue`, `create:suppression-dialog` event, `createSuppression` API stub | Never mounted; API returns `'TODO'` | Q-010 |
| `DetailCellRenderer.vue` | Registered, unused | – |
| `retrieveRecentTags` (`helpers/tags.js`) | Stub returning `[]` | – |
| `queryRetrieveById` | Unused | – |
| `getKustoToken` (Kusto scope token in `auth.js`) | Kusto goes through backend OBO | – |
| `validateData` (`kustoQueries.js`) | Unused | – |
| `queries` store `addQuery` / `updateQuery` / `removeQuery` | Unused | – |
| `onClickNewQuery` / `onClickNewView` (4 copies) | Unused | – |
| QueryEditor `onHideQuery` / `isQueryHidden` | No UI; hide flag kept only in query options for menus | – |
| `.ag-grade-*` CSS, `vue.config.js` | Dead | – |
| Deps `monaco-yaml`, `vue-class-component`, `vue-property-decorator`, `ms`; stale `tests/unit/components/TemplateQueryResult.spec.js` | Unused (its 11 param-widget cases are re-created in Vitest, see P4 template tab task) | – |
| Event bus (`helpers/eventBus.js`) | Replaced by context/callbacks | BUG-37 |
| `/api/user/authenticate`, `Models/User/*`, `SIGNING_KEY`/`AUTH_USERNAME`/`AUTH_PASSWORD` | Issued tokens nothing accepts | SEC-07, Q-011 |
| `SwaggerRequestHeader*`, `SwaggerConfiguration` | Dead (custom header unused) | – |
| `RedisKeyGenerator`, `IEnvironmentInfo`, `TryGetHeaderValueWithDefault` | Dead | – |
| `DeleteItemAsync` on repositories | Unused | – |
| Polly policies (`RetryExtensions.cs`), `AddHttpClient` | Registered but unused | – |
| `KUSTO_INGEST_URL` | Unused | – |
| `QueryRunStatus.TimedOut` (legacy) | Never set. **Re-introduced** functionally as a real timeout status | BUG-02 |
| Couchbase/Mongo/Redis switch, `IDatabaseClient` per-store clients | Single store: PostgreSQL (ADR-0004) | ADR-0004 |
| Unused NuGet refs (Autofac, FluentValidation, ServiceBus, Identity.Web, ADAL, …) | n/a in Python | – |
| Empty `Tim.Backend.Tests` project | Replaced by pytest suite | – |
| Legacy Helm charts (`helm/`, `frontend/helm`, `backend/helm`) | Broken as shipped; redo later | BUG-10, Q-016 |
| Vuex strict-mode config, `nodeEnv` runtime key | No React equivalent | BUG-33 |
