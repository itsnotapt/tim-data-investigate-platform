# TIM web (React)

React + TypeScript + Vite rewrite of the legacy Vue frontend (removed in P5-12; see git history). See [ADR-0003](../docs/decisions/0003-repo-layout.md) and [target-architecture.md](../docs/rewrite/target-architecture.md) (section 3).

Requires **Node 24** (`engines.node >= 24`) and npm.

```bash
npm install       # install dependencies (commit package-lock.json)
npm run dev       # dev server at http://localhost:5173
npm run build     # type-check (tsc) + production build into dist/
npm run preview   # serve the production build locally
npm run lint          # ESLint (flat config, type-aware typescript-eslint)
npm run format        # Prettier write
npm run format:check  # Prettier check (CI)
npm run typecheck     # tsc --noEmit
npm test              # Vitest (jsdom + Testing Library), single run
npm run test:watch    # Vitest watch mode
npm run e2e           # Playwright e2e (headless Chromium, mocked api)
npm run e2e:headed    # same, with a visible browser
```

Tooling: TypeScript is pinned to 6.0.x because typescript-eslint (8.71) does not yet support TS 7 (peer `<6.1.0`); revisit when it does. Tests live next to code as `*.test.tsx`; setup in `src/test-setup.ts`, config in `vite.config.ts`.

Local stack (PostgreSQL, api, `docker compose`): see [local-dev.md](../docs/rewrite/local-dev.md). `npm run dev` proxies `/api` to `http://localhost:8080`.

Stack: React 19, React Router (hash router), MUI + Emotion. TypeScript is `strict` with `noUncheckedIndexedAccess`.

## E2E tests

`e2e/*.spec.ts` (Playwright, headless Chromium; config in `playwright.config.ts`, own `e2e/tsconfig.json`, excluded from Vitest). `npm run e2e` starts `vite` on port 5180 with `VITE_AUTH_STUB=true` (dev stub auth: fixed signed-in account, token `dev-stub-token`; refused in production builds, so the harness uses the dev server, not `vite preview`). `/config.js` comes from `public/config.js`. No Python api is needed: `e2e/fixtures.ts` exports a `test` that intercepts every `/api/**` call (`e2e/mocks/api.ts`, data in `e2e/mocks/data.ts`, mirroring `tools/legacy-screenshots/mocks.mjs`). Query runs go POST 202 then poll 202 then 200. Each test gets a fresh browser context (empty IndexedDB). Override per file with `test.use({ apiOptions: { rows, templates, pendingPolls, handlers } })`; inspect requests via the `api` fixture (`api.callsTo('POST', '/api/kusto/query')`). `shot(page, 'NN-name')` (`e2e/shot.ts`) writes to `docs/rewrite/screenshots/` only when `E2E_SHOTS=1`. Reports go to `test-results/` and `playwright-report/` (gitignored). First run on a machine: `npx playwright install chromium`.

## Layout

`src/app` (shell, routes + lazy pages, router, theme), `src/features/*`, `src/lib/*`, `src/components`. Rules: `features/*` import `lib/*` and `components/*`, never each other's internals.

## Routes (hash, same as legacy)

`#/`, `#/queries`, `#/view/:uuid`, `#/share/:uuid`, `#/exportimport`. All are placeholders for now.

## Browser storage

`src/lib/storage` owns the IndexedDB database `tim` (v1; stores `display_components`, `row_results`, `column_views`, `query_options`). Use the DAOs (`displayComponentsDao`, `rowResultsDao`, `columnViewsDao`, `queryOptionsDao`); `rowResultsDao.get` returns `[]` when missing (BUG-27). It never opens the legacy `localforage` DB (Q-004). Tests reset the singleton with `resetTimDb()`.

## Time ranges

`src/lib/time-range` is pure logic (no UI yet). `TimeRange` is JSON data: `absolute` (ISO start/end) or `relative` (start/end "ago" offsets, end `null` = now). `resolveTimeRange(range, now?)` gives UTC `{start, end}` and must be called at execution time. `TIME_RANGE_PRESETS` / `DEFAULT_TIME_RANGE` (Last 15 minutes) mirror legacy; labels keep the legacy wording, including "Last 1 hours". `parseCustomPeriod` rejects NaN, empty, zero and negative amounts and start >= end (BUG-39); `parseCustomDateRange` takes UTC `YYYY-MM-DD` + `HH:MM[Z]`.

## Runtime config

`index.html` loads `/config.js` (plain script) before the app; it sets `window.appConfig`. `public/config.js` holds placeholder dev values; in production the container renders it from env vars. `src/lib/config/runtimeConfig.ts` merges `window.appConfig` over `VITE_*` env fallbacks per key (see `.env.example`), validates with zod and exposes `getConfig()`. Empty strings and unsubstituted `$VAR` placeholders count as missing. If validation fails, `main.tsx` shows an error screen listing every missing or invalid key.

| Key (`window.appConfig`)          | Fallback env                                 | Notes                                                       |
| --------------------------------- | -------------------------------------------- | ----------------------------------------------------------- |
| `auth.clientId`, `auth.authority` | `VITE_AUTH_CLIENT_ID`, `VITE_AUTH_AUTHORITY` | required; authority is a full URL                           |
| `redirectUri`                     | `VITE_AUTH_REDIRECT`                         | required                                                    |
| `apiEndpoint`                     | `VITE_API_ENDPOINT`                          | optional, default `''` (same origin), trailing `/` stripped |
| `agGridLicenseKey`                | `VITE_AGGRID_LICENSE_KEY`                    | optional; empty = AG Grid trial (ADR-0006)                  |
| `wikiUri`, `issueUri`             | `VITE_HELP_WIKI_URI`, `VITE_HELP_ISSUE_URI`  | default GitHub URLs                                         |
| `tagCluster`, `tagDatabase`       | `VITE_TAG_CLUSTER`, `VITE_TAG_DATABASE`      | cluster required; database defaults to `Research`           |
| `defaultClusters`                 | `VITE_DEFAULT_CLUSTERS` (JSON)               | default: help.kusto.windows.net sample                      |

## Auth

`src/lib/auth/` is the single auth module (ADR-0005). `createAuthClient()` returns either the dev stub or the MSAL client; all code uses the `AuthClient` interface (`getAccount`, `acquireToken`, `login`, `logout`).

- **MSAL client** (`createMsalAuthClient`): `PublicClientApplication` from runtime config (`auth.clientId`, `auth.authority`, `redirectUri`), cache in `localStorage`. On first use it runs `initialize()` and `handleRedirectPromise()` and restores the cached account, so there is no prompt on every load (BUG-23). `acquireToken(scopes)` tries `acquireTokenSilent` for the active account, or `ssoSilent` when there is none, and opens a popup only on `InteractionRequiredAuthError` or when SSO fails. Only one interactive request is in flight at a time and concurrent callers share it (BUG-23). Failures reject with `AuthClientError` (`code`: `interaction_in_progress`, `popup_blocked`, `cancelled`, `unknown`) and leave nothing stuck, so sign-in can be retried (BUG-22). `logout` uses `logoutPopup`. API scope: `api://<clientId>/user_impersonation` (`apiScopes()`).
- **Popup redirect page**: `@azure/msal-browser` v5 popups return to `redirectUri`, which must serve `blank.html` (built from `web/blank.html` and `src/lib/auth/redirectBridge.ts`) so the response reaches the main window. Register `https://<host>/blank.html` in Entra.
- **React**: `<AuthProvider client={getAuthClient()}>` (wraps `MsalProvider` for MSAL clients) and `useAuth()` returning `{ account, status: 'loading' | 'signedOut' | 'signedIn' | 'error', error, login, logout, getToken }`. Mounted in `App` (`authClient` prop overrides the client in tests; `main.tsx` passes `getAuthClient()`).
- **Dev stub**: set `VITE_AUTH_STUB=true` (e.g. in `.env.local`, or in the environment for Playwright) for a fixed account (`dev.user@example.com`) and fake token, no Entra sign-in. `createAuthClient()` throws if the stub is requested in a production build. Pair it with the API's `TIM_AUTH_DISABLED=true` (see `api/README.md`).

## Docker image

Production deployment (compose stack, env vars, `/api` routing): see [deploy/README.md](../deploy/README.md).

```bash
docker build -t tim-web web/
docker run --rm -p 8080:8080 \
  -e BACKEND_URI=http://api:8080 -e REDIRECT_URI=https://tim.example.com/blank.html \
  -e AUTH_CLIENT_ID=<app-id> -e AUTH_TENANT_ID=<tenant> \
  -e TAG_CLUSTER=https://<cluster>.kusto.windows.net -e AGGRID_LICENSE=<key> tim-web
```

Multi-stage: `node:24-alpine` builds, `nginxinc/nginx-unprivileged:stable-alpine` serves on port 8080 as uid 101. `docker/docker-entrypoint.sh` validates the env (exit 1 listing every missing variable), writes `/usr/share/nginx/html/config.js` (values JSON-escaped with `jq`), renders the nginx conf from `docker/nginx.conf.template` and execs nginx. nginx proxies `/api/` to `BACKEND_URI` keeping the `/api` path (do not strip it in an ingress), resolves the backend at request time, sends gzip and security headers (CSP, `X-Frame-Options: SAMEORIGIN`, nosniff, Referrer-Policy, HSTS when `X-Forwarded-Proto: https`; the CSP allows `'unsafe-eval'` for Handlebars and the Kusto worker, and a cross-origin `API_BASEPATH` origin is added to `connect-src` automatically), and serves `config.js` and `index.html` with `no-cache`. `GET /healthz` returns 200.

| Env var                            | Required | Maps to / notes                                                                  |
| ---------------------------------- | -------- | -------------------------------------------------------------------------------- |
| `BACKEND_URI`                      | yes      | nginx upstream, `http(s)://host[:port]`, no path (trailing `/` stripped)         |
| `REDIRECT_URI`                     | yes      | `redirectUri`; must be registered in Entra                                       |
| `AUTH_CLIENT_ID`, `AUTH_TENANT_ID` | yes      | `auth.clientId`; `auth.authority` = `https://login.microsoftonline.com/<tenant>` |
| `TAG_CLUSTER`                      | yes      | `tagCluster` (also the default cluster)                                          |
| `AGGRID_LICENSE`                   | no       | `agGridLicenseKey`; empty = trial (ADR-0006)                                     |
| `TIM_ENVIRONMENT`                  | no       | `production` (default) or `development`; does not affect `AGGRID_LICENSE`        |
| `TAG_DATABASE`                     | no       | default `Research`                                                               |
| `API_BASEPATH`                     | no       | `apiEndpoint`, default empty (same origin; paths already start `/api`)           |
| `HELP_WIKI_URI`, `HELP_ISSUE_URI`  | no       | omitted when empty (app defaults apply)                                          |
| `DEFAULT_CLUSTERS`                 | no       | JSON array; default is one group from `TAG_CLUSTER`/`TAG_DATABASE`               |
| `NGINX_RESOLVER`                   | no       | DNS server for backend lookups; default first nameserver in `/etc/resolv.conf`   |

The entrypoint also honours `TIM_HTML_DIR`, `TIM_NGINX_TEMPLATE`, `TIM_NGINX_CONF` and `TIM_ENTRYPOINT_DRY_RUN=1` (render files and exit) for testing without Docker.

Docs: [RULES.md](../docs/RULES.md), [docs/README.md](../docs/README.md), [work-breakdown.md](../docs/rewrite/work-breakdown.md).

### Shared components and helpers (P3-06, P3-10)

- `lib/uuid` (`generateUuid`, `crypto.randomUUID`), `lib/isEmpty` (legacy `isEmptyValue` plus empty array/object, BUG-41).
- `app/AppShell` (white dense toolbar: menu > Query Manager, TIM link, Help > Wiki Page / Report a bug from config in a new tab, Settings > Export / Import, Account > Sign in / Sign out with the legacy logout snackbar) wraps the routes in `app/AuthGate` (signed out: "You must sign-in first."; loading: progress; error: message + Retry, BUG-22). The placeholder side drawer was removed; the query tree arrives with P4.
- `components/SnackbarHost` + `useNotify()`: FIFO, one at a time, default 5000 ms, 200 ms pause between messages, optional link button, Dismiss. Mounted in `App`.
- `components/DraggableDialog`: MUI Dialog dragged by title via pointer events, clamped to the viewport, re-clamped on window resize; no polling (BUG-37), no extra dependency.

## API types

`src/lib/api/openapi.json` is exported by the API (`cd api && uv run python -m tim_api.openapi_export`). `npm run gen:api` turns it into `src/lib/api/schema.d.ts` (openapi-typescript; committed, excluded from lint and prettier). Regenerate both after any API change.

## API client (P3-02, P3-03)

`src/lib/api` (`index.ts` re-exports everything). `createApiClient({baseUrl, getToken})` is the only fetch path; `getApiClient()` wires `config.apiEndpoint` (empty = same origin, paths already start `/api`) and a silent `acquireToken` per request. Non-2xx and transport failures throw `ApiError` (`status`, `type`, `title`, `detail`, `traceId` from body or `x-trace-id`, `errors`; status 0 with `urn:tim:client:timeout|network` for client-side failures). One 401 triggers one token re-acquisition and retry. Default timeout 30 s; `signal` aborts (rejects with the abort reason). Endpoint modules (`templates`, `kustoSchema`, `queryRuns`, `taggedEvents`) take `{client?, signal?, timeoutMs?}` and strip `requestedBy`/`createdBy`/`updatedBy`/`updated` from bodies (SEC-03, BUG-40).

`runQuery(request, {signal, onPoll})` POSTs, then polls on 202 (500 ms, doubling every 3 polls, cap 30 s, give up at 11 min). Throws `QueryRunError` (run `error`), `QueryTimeoutError` (`source` `server` for `timedOut`, `client` when polling gave up) or the abort reason; resolves `{rows, stats}` via `handleResult`. `formatCluster` only prepends `https://` and strips trailing slashes, never appending `.kusto.windows.net` (BUG-29); the ad-hoc form re-exports it as `normalizeClusterUrl`.

Tests use the shared MSW server: call `setupMswServer()` from `src/test/msw/server.ts`, add `server.use(...)` handlers (`src/test/msw/handlers.ts`: `apiUrl`, `problemResponse`, `makeRun`, `queryRunHandlers`) and build clients with `baseUrl: TEST_API`.

## KQL templates (P4-17)

`lib/kql-templates` ports the legacy `QueryTemplate` behaviour as pure functions: `getDefaultParams`, `buildParams(template, row, selectedRows)`, `isDataComplete`, and `buildSummary/buildCluster/buildQuery` (or `createTemplateEngine({tagCluster, tagDatabase})` for an explicit engine; the default one reads runtime config lazily). Rendering uses an isolated `Handlebars.create()` environment with `noEscape` (KQL, not HTML).

Escaping rules (SEC-06, Q-024):

- `{{array xs}}` renders `@'a','b'`; inside a verbatim literal only `'` needs escaping, so quotes are doubled (`O'Neil` becomes `@'O''Neil'`). Backslashes and `"` are literal. Output for ordinary values equals legacy.
- `{{str x}}` is a single `@'x'` literal (quotes doubled); `{{kql x}}` is a regular `'x'` literal (backslash, quotes, newlines escaped).
- Raw `{{x}}` is substituted unchanged (existing templates keep rendering the same); authors should wrap user-controlled values in a helper. Values are never evaluated as template source, and Handlebars' prototype-access protection stays on.
- `{{> getTagEvents}}` renders the legacy KQL text (fixture `__fixtures__/getTagEvents.legacy.kql`, generated from the legacy source); the configured tag cluster/database have quotes doubled.

Behaviour notes: falsy defaults (`false`, `0`) are kept by both `getDefaultParams` and `buildParams` (BUG-34); a missing default is `''`. `match` needs exactly one matching column to be complete (legacy); an invalid `regex` matches nothing instead of throwing.

## Tab store (`src/features/tabs`)

`useTabsStore` (Zustand; `createTabsStore({persistence, debounceMs})` for tests, `store.reset()` to empty it) holds normalised tabs `{[uuid]: Tab}` plus `order`. `Tab` is a union on `componentName` (`KustoQueryResult` | `TemplateQueryResult`), same shape as the legacy DisplayComponent. `children` is derived via `selectors.ts` (`selectRoots`, `selectChildrenOf`, `selectAncestors`, `selectSubtreeUuids`).

- `load()` reads IndexedDB sorted by `displayComponentIndex`, renumbers, re-saves, and turns a missing parent into a root.
- Writes (create/update/convert/trigger/visited) are debounced per tab (300 ms) and serialised with deletes; `flush()` forces them.
- `removeTab(uuid)` removes the whole subtree and their `row_results` (BUG-32).
- Errors are reduced to `{message, code?}` on write and on load (BUG-38).
- `triggerRowData(uuid)` sets a strictly increasing `rowDataTrigger`; grids subscribe to it. `lastCreated` replaces the legacy `new:display-component` event.

## Code editor (Monaco)

`src/components/CodeEditor` wraps `@monaco-editor/react` around the locally bundled `monaco-editor` (no CDN). `src/lib/monaco` lazily loads Monaco, the yaml/json languages and, for `language="kusto"`, `@kusto/monaco-kusto`; workers come from Vite `?worker` imports (`environment.ts`, `kusto.worker.ts`; `worker.format` is `es` in `vite.config.ts`). Languages: `kusto`, `yaml`, `json`, `plaintext`. Suggestions are enabled (Q-017). `useCodeEditor()` returns `onMount`, `getEditor` and `getKustoWorker()` (for `setSchemaFromShowSchema`, P4-10). Models and editors are disposed on unmount. The production build emits `editor.worker`, `json.worker` and `kusto.worker` chunks (the Kusto worker is about 8 MB) once a component imports `CodeEditor`. `package.json` `overrides` pins `dompurify` (bundled by monaco-editor 0.55) to `^3.4.15` to clear the S-W06 advisories, because `@kusto/monaco-kusto` 15.0.1 peers on `monaco-editor@^0.55`; remove it once a newer pair exists.

`features/kusto-query/QueryHelperDialog` is the "Query Help" dialog; its sample KQL lives in `queryHelperSamples.ts` (BUG-41 fixed: `getTagEvents` casing, no stray `}`).

## Bootstrap and TabHost (P3-08, P4-04)

`useBootstrap(steps?)` (`src/app/useBootstrap.ts`, used by `AuthGate`) runs sign-in, then templates (`useTemplatesStore.load`), column views (`src/app/columnViewsState.ts`, minimal; P4-16 extends it) and tabs (`useTabsStore.load`). It returns `status` (`signedOut | loading | loaded | error`), `error`, `login` and `retry`; `retry` starts a fresh sign-in after a sign-in failure (BUG-22) and re-runs the load steps after a data failure. `steps` is injectable for tests; tests that render the shell call `stubBootstrap()` from `src/test/stubBootstrap.ts`.

`useTemplatesStore` (`src/features/templates`): non-deleted API templates, per-template `queryOptions`, `load()` (once) / `reload()` / `upsert` / `remove` / `setQueryOption`.

`TabHost` (`/view/:uuid`, `src/features/tabs/TabHost.tsx`) renders the active tab through `tabRegistry` (`tabType -> component`, props `{uuid}`; call `registerTabComponent` to replace the placeholders). Visited tabs stay mounted (LRU 100, `display:none`); key is `uuid:componentName` so a convert remounts; unknown uuids redirect to `/` only once tabs have loaded (BUG-20).

## Query tree and New menu (P4-02, P4-03, P4-05)

- `features/tree`: `<SideTree templates queryOptions onReloadTemplates store? />` is the permanent left drawer (56 px, 700 px while hovered). It reads the tab store, takes the active node from the route (`useMatch('/view/:uuid')`, so a hard load highlights it, BUG-21), shows `[draft]`/`[new]` prefixes and spinner / error / row-count badge ("9+") / faded-folder icons, and on click marks the tab visited and navigates to `/view/:uuid`. Header: New menu, "Reload templates" (calls `onReloadTemplates`, rejections ignored so the callback must notify), "Remove selected". `useTreeSelection(activeUuid)` holds the checked set: check cascades to descendants, uncheck clears descendants and ancestors (`toggleChecked`, pure); Remove selected calls `removeTab` (which cascades) and navigates to `/` (replace) if the active tab is gone (W11).
- `features/new-query`: `<NewQueryMenu templates queryOptions? ariaLabel? store?>label</NewQueryMenu>`: "New query" creates a root `KustoQueryResult` draft titled "New query" with `DEFAULT_QUERY_EXAMPLE` (`features/kusto-query/defaultQuery.ts`); Views / Queries submenus (`TemplateSubMenu`, folders keyed by the full path via `buildTemplateMenuTree`, BUG-35) create a root `TemplateQueryResult` (title = template summary, `getDefaultParams`, `state.editQuery: true`, not auto-run). Search is case-insensitive over menu + summary and expands the groups; `queryOptions[uuid].hide` excludes a template. Both navigate to the new tab.
- Wiring: render `<SideTree templates={templates} queryOptions={queryOptions} onReloadTemplates={...} />` inside the Router (AppShell), and `<NewQueryMenu templates queryOptions>` for the Welcome "Get Started" and tab toolbars ("New").

## Results grid (`src/features/grid`, P4-13 to P4-15)

AG Grid Enterprise only (ADR-0006, no Community path), v33+ Theming API (`themeBalham`) and module registration (`AllEnterpriseModule`).

- `initAgGrid(config)` registers modules and applies `agGridLicenseKey` when present (no key: trial watermark). Call it once at startup in `src/app/main.tsx`, e.g. `initAgGrid(getConfig())`. `ResultsGrid` also registers the modules on import, so tests and the grid work without it.
- `ResultsGrid` takes `rows`, `templateColumns`, `columnId`, `stats`; `TabResultsGrid` takes a tab `uuid` (rows from IndexedDB, reloaded on `rowDataTrigger`; no stored rows gives an empty grid, BUG-27).
- Columns are the union of all row keys (BUG-36); template `columns` override per column name and `default` applies to the rest. Row id is `_id` (`columnId`/`EventId`, else `row-index-N`).
- Extension points: `getContextMenuItems(params)` returns extra items shown above copy / copy with headers / export (pivots, tagging, details); `onGridReady` exposes the grid api (column state, P4-16); `toolbarExtra` sits beside the quick filter.
- Side bar (columns, filters), multi filters, row grouping with a `dcount` aggregation, and a status bar (execution time, CPU, memory MB, total / filtered / selected).
- Column views (P4-16, `src/features/column-views`): `ColumnViewBar` (beside the quick filter; autocomplete with a "Create column view" item, Apply / Rename / Delete / Save icon buttons and dialogs; delete text fixed, BUG-41) over `useColumnViewsStore` (zustand, persisted through `columnViewsDao`, state updated after the write succeeds). Apply = `applyColumnState({state, applyOrder: true})`; Save overwrites the view with the live state; creating captures the live state. `app/columnViewsState.ts` re-exports the store for bootstrap. The selected view is per grid instance (not persisted, as legacy). Per-tab column state: pass `stateKey` (`TabResultsGrid` uses the tab uuid); it is saved on AG Grid `stateUpdated`, when the tab is hidden (container size 0 via `ResizeObserver`) and on unmount, and restored when shown again and when the grid is re-created (`tabColumnState`, in memory only).
- Detail panel (P4-25): `DetailPanel` is a persistent right drawer (900px, absolutely positioned in the grid container, so hidden tabs hide it) with a "Result Details" accordion, YAML for object values (js-yaml 5 has no `replacer`; control characters are stripped before dumping), empty values and the client `_id` hidden, and a visible close button (BUG-41). A "Show details" context-menu item (added after the caller's `getContextMenuItems` items, disabled on group rows) opens it; while open it follows the focused cell's row. `ResultsGrid` props `columnViews` and `detailPanel` (both default true) turn these off.

## Ad-hoc query tab, time range and cluster pickers (P4-06, P4-07, P4-08)

- `features/kusto-query/KustoQueryTab` is registered for `KustoQueryResult` in `tabRegistry`. Like legacy it opens in edit mode (also after a reload); edits live in a local draft. Toolbar: New menu, `TimeRangePicker`, Run Query, Clone (root "Copy of <title>", navigates to it), Edit Query / Save Changes & Run / Save Changes / Cancel. Save needs cluster and database (required errors shown on `ClusterSelect`). Query Help opens `QueryHelperDialog`; the Kusto `CodeEditor` has a per-tab model path. `onRun` defaults to `useRunKustoQuery()` (P4-11, below); `TabResultsGrid` renders once the tab has a `rowDataTrigger`.
- `components/TimeRangePicker` (+ `CustomDateRangeDialog`, `CustomPeriodDialog` in `TimeRangePickerDialogs.tsx`, both `DraggableDialog`s, forms reset on open) wraps `lib/time-range`. The range is stored in tab `state.timeRange` (Q-108); default Last 15 minutes.
- `components/ClusterSelect`: two freeSolo autocompletes from `defaultClusters` (clusters grouped by group name; database options are the databases of the group listing the typed cluster). `clusterSelection.ts` has `validateClusterSelection` and `databasesFor`; `clusterUrl.ts` has `normalizeClusterUrl` (prepends `https://` only, BUG-29), applied on blur/selection.
- Wiring: `AppShell` renders `SideTree` (inside `AuthGate`, so after bootstrap) with main content offset by `SIDE_TREE_COLLAPSED_WIDTH`; a failed "Reload templates" shows a snackbar. Welcome's "Get Started" is a `NewQueryMenu`.

## Kusto schema and ad-hoc run (`src/features/kusto-query`, P4-10, P4-11)

- `useKustoSchema(cluster, database, editor)`: when the editor instance exists and cluster and database are set (initial mount included, BUG-28), fetches `getKustoSchema` (cached per formatted cluster + database in `kustoSchema.ts`, in-flight shared, failures not cached), then `setSchemaFromShowSchema(schema, formattedCluster, database)` on the worker from `getKustoWorkerFor`. Effect cleanup marks the run stale, so late responses are ignored. Errors go to the snackbar. `normalizeSchema` accepts the parsed document, `ClusterSchema`/`DatabaseSchema`/`schema`/`data` wrappers (object, JSON string or legacy row list), Q-018/Q-028. The tab passes the draft cluster/database while editing and the `CodeEditor` `onMount` editor; suggestions stay on (Q-017).
- `runKustoQuery(uuid, timeRange?, {store?, signal?})` (never rejects): executing + unvisited + no error, `runQuery` with the tab's saved params and `startTime`/`endTime` (ISO, from `resolveTimeRange`, as legacy `KustoQueryResult.vue:297`), then rows to `rowResultsDao`, `rowCount`, `executionTime`/`cpuUsage`/`memoryUsage` (strings) and `triggerRowData`. Errors: stored via `toStoredError` (BUG-38), rows deleted, row data triggered. The run aborts when the tab leaves the store (subscription, BUG-30) or a newer run starts on the same tab; nothing is written after an abort. `useRunKustoQuery()` adds the "Executing query..." snackbar (needs `SnackbarHost`).
- `src/app/main.tsx` calls `initAgGrid(getConfig())`.

## Template tab form (`src/features/template-query`, P4-18)

`TemplateQueryTab` is registered for `TemplateQueryResult`. Toolbar: New menu, Run Query, Clone, Convert (confirm dialog), Edit and Share Link, or Save & Run / Save / Cancel while editing. Edit mode is the persisted `state.editQuery`; edits live in a local draft. Run / clone / convert / share call the `onRun` / `onClone` / `onConvert` / `onShare` props (defaults in `useTemplateTabActions.ts`). `runTemplateQuery` (`runTemplateQuery.ts`) renders cluster / database / query with kql-templates and runs them through the shared `runTabQuery` pipeline (`kusto-query/runPipeline.ts`, also used by `runKustoQuery`) with NO time range (Q-009); render errors are stored as the tab error. Clone makes a sibling (same parent) titled `Copy of <title>`, in edit mode, not run, and navigates to it. Convert (after the dialog) calls `convertToKusto` with the rendered KQL; `TabHost` keys on uuid and type so the tab remounts as a `KustoQueryTab`. Results render via `TabResultsGrid` (template `columns` overrides) once `rowDataTrigger` is set.

- `ParamField` by type: `array` select (`multiple` adds Select All and shows "first, (+N others)" above 5), `match` select of the `[{column, value}]` found when edit started (stores a one-element list, unlike legacy which stored the bare value string), `multiple` chips combobox (`,` / `;` / Enter add), `boolean` switch, anything else a trimmed text field. `params` and `fields` are merged, fields win; `optional !== true` is required (red asterisk).
- Required rule (`paramRules.ts`): blank means missing, whitespace-only or empty list (legacy `!!value` accepted `[]`); booleans are never required. Errors appear after a failed save, which also shows the snackbar "Unable to save query due to validation errors."
- Summary refresh button uses `buildSummary`; "Preview Query" show/hide renders `buildQuery` of the draft in a read-only Kusto `CodeEditor`.
- Tests mock `CodeEditor` and use an in-memory tab store, as for `KustoQueryTab`.

## Pivots (`src/features/pivots`, P4-20)

`PivotResultsGrid` (used by `KustoQueryTab` and `TemplateQueryTab` instead of `TabResultsGrid`) adds a context-menu group of the non-hidden `query` templates, nested by `path` (`templateMenuTree`, BUG-35; folders then items, each sorted by text). Choosing one calls `createPivotTab`: `buildParams` from the clicked row and the selected rows (clicked row when none selected), a child `TemplateQueryResult` titled by `buildSummary`, `editQuery = !autoExecute || !isDataComplete`, `runTemplateQuery` when it auto-runs, and navigation to the child only when the data is incomplete (legacy `createNewTemplateQueryComponent`, so a complete pivot stays on the parent). Shift is tracked with window `keydown`/`keyup` (as legacy; cleared on blur) and suppresses the run. `ResultsGrid.getContextMenuItems` accepts a list of groups: group 0 is followed by "Show details" (tagging goes there, P4-21), later non-empty groups come after a separator.

## Query Manager (`src/features/templates-admin`, P4-28, P4-29)

`QueryManagerPage` (routed, default export) lists templates fetched with `includeDeleted=true` (legacy columns; timestamps localised; sortable, filterable, paged). Delete is disabled when nothing deletable is selected or any selected template is managed; Restore (only with "Show deleted") is enabled by the number of selected deleted rows (BUG-24) and uses `restoreTemplate` (PATCH). After any change the page reloads its list and `useTemplatesStore.reload()`. `TemplateDialog` creates (POST, new uuid) or edits (PUT); Params/Fields/Column customisation are YAML `CodeEditor`s parsed with `js-yaml` (parse errors, or a non-mapping, show under the editor; empty = not set; Fields required for `query` type). Managed templates are read-only including Fields. Save errors show `ApiError.detail` plus field errors, network failures included (BUG-40). `createdBy` is never sent. Both components take optional `client`/`store` props for tests; tests mock `components/CodeEditor` with `testUtils.fakeCodeEditorModule`.

## Export / Import (P4-27) and toolbar (P4-30)

`features/export-import`: `ExportImportPage` (routed, `#/exportimport`). Scope matches legacy: only this app's tabs (`display_components` in the `tim` DB, legacy-compatible JSON array); row results, column views and query options are not exported. Export flushes pending tab writes, fills the textarea and copies to the clipboard. Import is disabled while the text is empty, not JSON, or fails the zod `exportSchema` (message under the field). Import writes the tabs (same uuid overwrites, `isExecuting` reset, `displayComponentIndex` rebased after existing tabs) and calls `useTabsStore.load()` so they show in the tree without a page refresh (legacy asked for a refresh). AppShell Help (Wiki Page / Report a bug from `wikiUri`/`issueUri`, new tab, `noopener noreferrer`) and Settings > Export / Import were already wired and tested.

## Share (`src/features/share`, P4-26)

`buildShareUrl(templateUuid, inParams)` makes `<origin><path>#/share/<uuid>?p=<base64url of UTF-8 JSON>&execute=0` (BUG-31); `decodeShareParams` also reads legacy `btoa` links (standard base64, Latin-1, `+` turned into a space). The Share Link button (`useShareTemplateQuery`) copies it and shows "Shared link has been saved to the clipboard.". `ShareQueryPage` (`#/share/:uuid`, after bootstrap so templates are loaded) shows "This query was not found." / "Parameters are missing." / "Parameters are invalid.", else `sanitizeShareParams` (declared params only over the defaults, legacy string `match` converted, Q-109) creates a root `TemplateQueryResult` titled with `buildSummary`, and navigates to it. `execute=1` runs it immediately (legacy parity; trusted users, Q-030, Q-110 reverted) unless required data is missing, then it opens in edit mode; `execute=0` always opens in edit mode.

## Tagging (`src/features/tagging`, P4-21, P4-22)

- Quick tag: the grid's first context-menu group is a "Tag Events" submenu (`useTaggingMenu`, composed by `PivotResultsGrid`) with "Quick - Malicious / Suspicious / Benign", before "Show details". Targets are the selected rows, or the clicked row; the submenu and items are disabled unless every target has `EventId` and `EventTime`. `quickTag` (never rejects) calls `saveEvents` for unsaved rows, then `commentEvents` with `{eventId, determination (lower case), isDeleted: false}` (no comment, as legacy), with the legacy snackbars ("Quick saving events...", "Tag events successfully saved.", "Saving events failed: ...", "Saving comments failed: ..."; the text is the API problem `detail`). On success the returned rows (`TagEvent.Determination`, `IsSaved`) go to the grid via `applyRowUpdates` (`features/grid/rowUpdates.ts`: `applyTransaction` by `_id`, then the stored `row_results` of the tab are rewritten; `_id` is never stored) and the selection is cleared. On failure nothing changes. The API returns 204, so "returned rows" are computed locally. The "Tag Events" submenu starts with "Customise tag events" (P4-23, below); it is disabled outside a `TagDialogProvider`.
- Customise dialog (P4-23): `TagDialogProvider` (mounted by `PivotResultsGrid`) owns one `TagDialog` and exposes `TagDialogContext` (`openDialog({rows, api, uuid, columnId})`), which `useTaggingMenu` calls with the selected/clicked rows. `TagDialog` is a `DraggableDialog` "Customise Tag Events" ("N event(s) selected"; determination / comment / tags, each with an action select; chips autocomplete with "Exists in N event(s)" hints, free text added with Enter or on blur except when removing). Save runs `validateTagDialog` (messages under the fields/form, modification preview live), then `buildTagRequests` + `submitTagRequests`, then `applyRowUpdates` (BUG-25) and closes with the snackbar "Tag events successfully customised." (or "...removed."). On any error the dialog stays open, shows "Customisation of tag events failed: <detail>" inline and as a snackbar, and Save stays available (BUG-26; legacy closed and threw). The backdrop click does not close it (legacy persistent). After a partial failure (events saved, comments failed) a retry re-sends the save-events call, as the rows still look unsaved.
- Dialog logic for P4-23 (pure, no React): `tagSets.ts` (`tagsFromRow`, `tagsDiff`, `tagsIntersect`, `existingTagCounts`, `tagOptions`), `tagDialogLogic.ts`: `TagDialogInput` (+ `defaultTagDialogInput`, per-field action lists, `isDeterminationDisabled`...), `validateTagDialog(input, rows)` -> `{ok, fieldErrors, errors}` (field errors "Determination/Comment cannot be empty." first; the cross-field messages are only computed when those pass, as legacy), `modificationPreview(rows, tagAction, tags)` ("Adding X to N event(s)." ...), `buildTagRequests(rows, input)` -> `{savedEvents, comments, tags, updatedRows}` for Override / Append / Remove / Remove-determination, and `submitTagRequests` (events, comments, tags in order; `TagSubmitError.stage`). The dialog should call `applyRowUpdates` with `updatedRows` on success and stay open on error (BUG-25, BUG-26).

### Inline comment edit (P4-24, `tagging/commentEdit.ts`)

- Columns (`features/grid/columns.ts`): `defaultColDef.editable` is false and `buildColumnDefs` forces `editable` on every column (template `editable` overrides are ignored; BUG-42). Only `TagEvent.Comment` is editable, and only for rows where `isCommentEditable` holds: `TagEvent.IsSaved === true`, `EventId` set, `TagEvent.Determination` set.
- The grid keeps `readOnlyEdit`, so an edit arrives as `onCellEditRequest`; the cell value is not changed by AG Grid. `TabResultsGrid` wires `useCommentEdit(uuid, columnId)` by default (a caller's own `onCellEditRequest` wins), so `PivotResultsGrid` needs no change.
- `commentEdit(event, {uuid, notify, call})` (never rejects, returns saved or not): ignores other columns, ineditable rows and unchanged values; "Quick saving comment..."; `commentEvents([{eventId, determination, comment, isDeleted: false}])`; then `applyRowUpdates` (grid + stored rows) and "Comment successfully quick saved." (BUG-42 text). On failure the row is untouched (cells refreshed, so the old value shows) and "Saving comments failed: <detail>" is shown.
