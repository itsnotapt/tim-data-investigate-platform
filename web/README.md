# TIM web

React + TypeScript + Vite frontend for TIM.

Requires **Node 24** (`engines.node >= 24`) and npm.

```bash
npm install       # install dependencies
npm run dev       # dev server at http://localhost:5173 (proxies /api to http://localhost:8080)
npm run build     # type-check (tsc) + production build into dist/
npm run preview   # serve the production build locally
npm run lint          # ESLint (flat config, type-aware typescript-eslint)
npm run format        # Prettier write
npm run format:check  # Prettier check (CI)
npm run typecheck     # tsc --noEmit
npm test              # Vitest (jsdom + Testing Library), single run
npm run test:watch    # Vitest watch mode
npm run e2e           # Playwright e2e (headless Chromium, real api and mocked flows)
npm run e2e:headed    # same, with a visible browser
npm run gen:api       # regenerate src/lib/api/schema.d.ts from openapi.json
```

Stack: React 19, React Router (hash router), MUI + Emotion, Zustand, AG Grid Enterprise, Monaco. TypeScript is `strict` with `noUncheckedIndexedAccess` and is pinned to 6.0.x (typescript-eslint peers `<6.1.0`). Tests live next to code as `*.test.tsx`; setup in `src/test-setup.ts`, config in `vite.config.ts`.

## E2E tests

Playwright specs run in headless Chromium: `e2e/smoke.spec.ts` and `e2e/flows/*.spec.ts`. Config is `playwright.config.ts`, `e2e/` has its own `tsconfig.json`, and Vitest excludes it. The first run on a machine needs `npx playwright install chromium`.

`npm run e2e` starts two servers:

- A real api on port 5181, from `e2e/api_server.py`. It needs uv; see [development.md](../docs/development.md#e2e-tests).
- `vite` on port 5180 with `VITE_AUTH_STUB=true`, proxying `/api` to that api. Production builds refuse the stub, so the harness uses the dev server, not `vite preview`.

`/config.js` comes from `public/config.js`. There are two kinds of flow.

- Real-api flows import `e2e/realApi.ts` and use the dev actions in `e2e/actions/`. `page` is signed in as a new analyst per test (`analyst`), `signIn(upn)` opens a second analyst's browser context, and `idPrefix` is a random per-test prefix for `id`s.
- Mocked flows import `e2e/fixtures.ts`, which intercepts every `/api/**` call (`e2e/mocks/api.ts`, data in `e2e/mocks/data.ts`) and signs in as the stub's default account (token `dev:dev.user@example.com`). Query runs go POST 202, poll 202, then 200. Override per file with `test.use({ apiOptions: { rows, templates, pendingPolls, handlers } })`. Inspect requests with the `api` fixture, for example `api.callsTo('POST', '/api/kusto/query')`.

Each test gets a fresh browser context, so IndexedDB starts empty.

- `shot(page, 'NN-name')` in `e2e/shot.ts` writes screenshots only when `E2E_SHOTS=1`, into `e2e/.screenshots/` (gitignored). Each light `NN-name.png` gets a dark copy `NN-name-dark.png` beside it, for a person to review. There are no `toHaveScreenshot` baselines.
- Reports go to `test-results/` and `playwright-report/` (gitignored).
- `e2e/flows/theme.spec.ts` checks the colour scheme. It picks from **Settings › Appearance** or seeds `localStorage['tim-theme-mode']` with `page.addInitScript`, and it emulates the OS scheme with `page.emulateMedia`. It reaches the config error page by serving a `/config.js` without `auth`. The colour contrast sweep walks several screens on one page through hash routes, and its Export / Import step comes last so the snackbar fading out never overlaps an axe run. The rest of the suite runs light, because Playwright emulates a light OS.

## Layout

`src/app` (shell, routes and lazy pages, router, theme, bootstrap), `src/features/*`, `src/lib/*`, `src/components`. `features/*` import `lib/*` and `components/*`, never each other's internals.

## Routes (hash)

`#/`, `#/queries` (Query Manager), `#/view/:uuid` (tab), `#/share/:uuid`, `#/exportimport`.

## Runtime config

`index.html` loads `/config.js`, a plain script, before the app. It sets `window.appConfig`. See [architecture.md](../docs/architecture.md#runtime-configuration).

- `public/config.js`: placeholder dev values. In production the container renders it from env vars.
- `src/lib/config/runtimeConfig.ts`: merges `window.appConfig` over the `VITE_*` env fallbacks per key (see `.env.example`), validates with zod and exposes `getConfig()`. Empty strings and unsubstituted `$VAR` placeholders count as missing.
- `main.tsx`: if validation fails, shows an error screen listing every missing or invalid key.

| Key (`window.appConfig`)          | Fallback env                                 | Notes                                                       |
| --------------------------------- | -------------------------------------------- | ----------------------------------------------------------- |
| `auth.clientId`, `auth.authority` | `VITE_AUTH_CLIENT_ID`, `VITE_AUTH_AUTHORITY` | required; authority is a full URL                           |
| `redirectUri`                     | `VITE_AUTH_REDIRECT`                         | required                                                    |
| `apiEndpoint`                     | `VITE_API_ENDPOINT`                          | optional, default `''` (same origin), trailing `/` stripped |
| `agGridLicenseKey`                | `VITE_AGGRID_LICENSE_KEY`                    | optional; empty = AG Grid trial                             |
| `wikiUri`, `issueUri`             | `VITE_HELP_WIKI_URI`, `VITE_HELP_ISSUE_URI`  | default GitHub URLs                                         |
| `tagCluster`, `tagDatabase`       | `VITE_TAG_CLUSTER`, `VITE_TAG_DATABASE`      | cluster required; database defaults to `Research`           |
| `defaultClusters`                 | `VITE_DEFAULT_CLUSTERS` (JSON)               | default: help.kusto.windows.net sample                      |

## Auth

`src/lib/auth/` is the only auth module; see [architecture.md](../docs/architecture.md#authentication). `createAuthClient()` returns the dev stub or the MSAL client. All other code uses the `AuthClient` interface: `getAccount`, `acquireToken`, `login`, `logout`.

- **MSAL client** (`createMsalAuthClient`): wraps `PublicClientApplication`, configured from `auth.clientId`, `auth.authority` and `redirectUri`, with its cache in `localStorage`. On first use it runs `initialize()` and `handleRedirectPromise()` and restores the cached account. `logout` uses `logoutPopup`. The API scope is `api://<clientId>/user_impersonation` (`apiScopes()`).
- **Token acquisition**: `acquireToken(scopes)` tries `acquireTokenSilent` for the active account, or `ssoSilent` when there is none. It opens a popup only on `InteractionRequiredAuthError` or when SSO fails. One interactive request runs at a time, and concurrent callers share it.
- **Errors**: failures reject with `AuthClientError`, whose `code` is `interaction_in_progress`, `popup_blocked`, `cancelled`, `not_signed_in` or `unknown`. Nothing stays stuck, so sign-in can be retried.
- **Popup redirect page**: MSAL popups return to `redirectUri`, which must serve `blank.html`, built from `web/blank.html` and `src/lib/auth/redirectBridge.ts`. Register `https://<host>/blank.html` in Entra.
- **React**: `<AuthProvider client={getAuthClient()}>` wraps `MsalProvider` for MSAL clients. `useAuth()` returns `{ account, status, error, login, logout, getToken }`, where `status` is `'loading'`, `'signedOut'`, `'signedIn'` or `'error'`.
- **Dev stub**: set `VITE_AUTH_STUB=true`, for example in `.env.local`, or in the environment for Playwright. It gives a fake account with no Entra sign-in: `dev.user@example.com`, or the upn in `localStorage['tim.devStubUpn']`. Its token is `dev:<upn>`. `createAuthClient()` throws if the stub is requested in a production build. Pair it with the API's `TIM_AUTH_DISABLED=true` (see `api/README.md`).

## Docker image

Production deployment and `/api` routing: see [docs/deployment.md](../docs/deployment.md). Environment variables: see [docs/configuration.md](../docs/configuration.md).

```bash
docker build -t tim-web web/
docker run --rm -p 8080:8080 \
  -e BACKEND_URI=http://api:8080 -e REDIRECT_URI=https://tim.example.com/blank.html \
  -e AUTH_CLIENT_ID=<app-id> -e AUTH_TENANT_ID=<tenant> \
  -e TAG_CLUSTER=https://<cluster>.kusto.windows.net -e AGGRID_LICENSE=<key> tim-web
```

The build is multi-stage. `node:24-alpine3.24` from `mirror.gcr.io` builds, and `ghcr.io/nginx/nginx-unprivileged:1.30-alpine` serves on port 8080 as uid 101. The root filesystem can be read-only; only `/tmp` must be writable.

- `docker/docker-entrypoint.sh`: validates the env and exits 1 listing every missing variable. It writes `/tmp/tim/config.js` with the values JSON-escaped by `jq`, renders the nginx conf, and execs nginx.
- `docker/nginx.conf.template`: rendered to `/tmp/tim/nginx.conf`, which the static `/etc/nginx/conf.d/default.conf` includes.
- Proxying: nginx sends `/api/` to `BACKEND_URI` and keeps the `/api` path, so an ingress must not strip it. It resolves the backend at request time.
- Headers: nginx sends gzip and the security headers: CSP, `X-Frame-Options: SAMEORIGIN`, nosniff, Referrer-Policy, and HSTS when `X-Forwarded-Proto` is `https`. `config.js` and `index.html` are served with `no-cache`.
- CSP: it allows `'unsafe-eval'` for Handlebars and the Kusto worker. A cross-origin `API_BASEPATH` origin is added to `connect-src` automatically.
- `GET /healthz` returns 200.

| Env var                            | Required | Maps to / notes                                                                  |
| ---------------------------------- | -------- | -------------------------------------------------------------------------------- |
| `BACKEND_URI`                      | yes      | nginx upstream, `http(s)://host[:port]`, no path (trailing `/` stripped)         |
| `REDIRECT_URI`                     | yes      | `redirectUri`; must be registered in Entra                                       |
| `AUTH_CLIENT_ID`, `AUTH_TENANT_ID` | yes      | `auth.clientId`; `auth.authority` = `https://login.microsoftonline.com/<tenant>` |
| `TAG_CLUSTER`                      | yes      | `tagCluster` (also the default cluster)                                          |
| `AGGRID_LICENSE`                   | no       | `agGridLicenseKey`; empty = trial                                                |
| `TIM_ENVIRONMENT`                  | no       | `production` (default) or `development`; does not affect `AGGRID_LICENSE`        |
| `TAG_DATABASE`                     | no       | default `Research`                                                               |
| `API_BASEPATH`                     | no       | `apiEndpoint`, default empty (same origin; paths already start `/api`)           |
| `HELP_WIKI_URI`, `HELP_ISSUE_URI`  | no       | omitted when empty (app defaults apply)                                          |
| `DEFAULT_CLUSTERS`                 | no       | JSON array; default is one group from `TAG_CLUSTER`/`TAG_DATABASE`               |
| `NGINX_RESOLVER`                   | no       | DNS server for backend lookups; default first nameserver in `/etc/resolv.conf`   |

The entrypoint also honours `TIM_RUNTIME_DIR` (default `/tmp/tim`), `TIM_NGINX_TEMPLATE` and `TIM_ENTRYPOINT_DRY_RUN=1` (render files and exit) for testing without Docker.

The entrypoint also honours three variables for testing without Docker: `TIM_RUNTIME_DIR` (default `/tmp/tim`), `TIM_NGINX_TEMPLATE`, and `TIM_ENTRYPOINT_DRY_RUN=1`, which renders the files and exits.

## Browser storage

`src/lib/storage` owns the IndexedDB database `tim`; its stores are in [architecture.md](../docs/architecture.md#indexeddb).

- Use the DAOs: `displayComponentsDao`, `rowResultsDao`, `columnViewsDao` and `queryOptionsDao`.
- `rowResultsDao.get` returns `[]` when nothing is stored.
- Tests reset the singleton with `resetTimDb()`.

## Time ranges

`src/lib/time-range` is pure logic.

- `TimeRange` is JSON data. An `absolute` range has an ISO start and end. A `relative` range has start and end "ago" offsets, and an end of `null` means now.
- `resolveTimeRange(range, now?)` gives UTC `{start, end}`. Call it at execution time.
- `TIME_RANGE_PRESETS` defines the presets and `DEFAULT_TIME_RANGE` is Last 15 minutes. Labels keep the wording "Last 1 hours".
- `parseCustomPeriod` rejects NaN, empty, zero and negative amounts. It also rejects a start at or after the end.
- `parseCustomDateRange` takes a UTC `YYYY-MM-DD` date and an `HH:MM[Z]` time.

## API types and client

`src/lib/api/openapi.json` is exported by the API (`cd api && uv run python -m tim_api.openapi_export`). `npm run gen:api` turns it into `src/lib/api/schema.d.ts` with openapi-typescript. The file is committed and excluded from lint and prettier. Regenerate both after any API change.

`src/lib/api` re-exports everything from `index.ts`.

- `createApiClient({baseUrl, getToken})`: the only fetch path. `getApiClient()` wires `config.apiEndpoint` and a silent `acquireToken` per request. An empty endpoint means same origin, and paths already start with `/api`.
- Timeouts and aborts: the default timeout is 30 s. A `signal` aborts the call and rejects with the abort reason.
- `ApiError`: thrown for non-2xx responses and transport failures. It carries `status`, `type`, `title`, `detail`, `traceId` (from the body or `x-trace-id`) and `errors`. Client-side failures have status 0 and a `type` of `urn:tim:client:timeout`, `urn:tim:client:network` or `urn:tim:client:invalid-response`.
- 401: one 401 triggers one token re-acquisition and one retry.
- Endpoint modules: `templates`, `kustoSchema`, `queryRuns`, `taggedEvents`, `instance` and `runs`. The `templates`, `kustoSchema`, `queryRuns` and `taggedEvents` functions take `{client?, signal?, timeoutMs?}` and strip server-owned fields (`requestedBy`, `createdBy`, `updatedBy`, `updated`, `dateTimeUtc`) from bodies.
- `runQuery(request, {signal, onPoll})`: POSTs, then polls on 202 as described in [architecture.md](../docs/architecture.md#data-flow-run-poll-pivot-tag). It resolves `{rows, stats}` and throws `QueryRunError` (the run's `error`), `QueryTimeoutError` or the abort reason. `QueryTimeoutError.source` is `server` for `timedOut` and `client` when polling gave up.
- `formatCluster`: prepends `https://` and strips trailing slashes. It never appends `.kusto.windows.net`. The ad-hoc form re-exports it as `normalizeClusterUrl`.

Tests use the shared MSW server.

- Call `setupMswServer()` from `src/test/msw/server.ts`.
- Add `server.use(...)` handlers, with the helpers in `src/test/msw/handlers.ts`: `apiUrl`, `problemResponse`, `makeRun` and `queryRunHandlers`.
- Build clients with `baseUrl: TEST_API`.

## Shell, notifications, dialogs

- `lib/uuid`: `generateUuid`, which wraps `crypto.randomUUID`.
- `lib/isEmpty`: tells whether a value, array or object is empty.
- `app/AppShell`: a flat, dense toolbar on the paper colour. Its menus are Query Manager, a TIM link, Help (Wiki Page and Report a bug, from config, in a new tab), Settings (Appearance, Export / Import) and Account (Sign in, Sign out).
- `app/AuthGate`: wraps the routes. Signed out shows "You must sign-in first.", loading shows progress, and an error shows its message with Retry.
- `SideTree`: rendered inside `AuthGate`. The main content is offset by `SIDE_TREE_COLLAPSED_WIDTH`. A failed "Reload templates" shows a snackbar.
- `components/SnackbarHost` and `useNotify()`: show one message at a time, first in first out. The default is 5000 ms, with a 200 ms pause between messages. A message can have a link button, and Dismiss hides it. `App` mounts the host.
- `components/DraggableDialog`: a MUI Dialog dragged by its title with pointer events. It stays inside the viewport and is clamped again when the window resizes.

## Theme

Every colour lives in one palette in `src/app/theme.ts`, with a light and a dark colour scheme (`colorSchemes`). Besides MUI's entries it has TIM's own: `editor.{border,background}`, `grid.{header,oddRow}`, `determination.*` (row fills) and `stripe.*`.

- Variables: MUI emits the palette as `--mui-palette-…` CSS variables. Components read them through palette tokens, for example `sx={{ borderColor: 'editor.border' }}` or `theme.vars.palette.*`. They never use colour literals or `theme.palette.mode`.
- Scheme attribute: MUI writes the active scheme as `data-ag-theme-mode="light|dark"` on `<html>`. AG Grid's theme reads the same attribute.
- `ResultsGrid.tsx`: sets the grid theme's params to those variables.
- `grid.css`: colours determination rows by setting AG Grid's row background variables from `determination.*`. It adds a 5px `stripe.*` inset shadow on the first cell.
- `DeterminationSymbol.tsx`: draws each tagged row's determination symbol, 16px tall, in the checkbox column. The context menu of a checkbox cell or of the checkbox column header has **Show determination symbols**. It is off by default, and `determinationSymbols.ts` saves the choice in `localStorage['tim-determination-symbols']`.
- `theme.test.ts`: checks the WCAG AA contrast pairs in both schemes.
- `colourLiterals.test.ts`: fails on a colour literal anywhere in `src` outside `theme.ts` and tests. Hex, `rgb(`, `hsl(` and named colours all count.

Choosing the scheme:

- `app/AppThemeProvider` (`ThemeProvider` and `CssBaseline`) wraps both `App` and `ConfigError` in `main.tsx`. Tests that render either use it as their `wrapper`.
- Users pick **Light**, **Dark** or **System** under **Settings › Appearance** (`AppShell.tsx`). System is the default. It follows the OS `prefers-color-scheme`, including live changes.
- MUI's `useColorScheme()` holds the choice, saves it in `localStorage['tim-theme-mode']` and follows changes made in other tabs.
- `public/theme-init.js` sets `data-ag-theme-mode` and `color-scheme` on `<html>` from the same key, so the page never shows the other scheme first. A plain `<script src>` in the `<head>` of `index.html` loads it before the module bundle, because the CSP allows no inline script. `AppThemeProvider` removes its inline `color-scheme` once MUI's styles take over. `themeInit.test.ts` runs it in jsdom.
- In Vitest, `src/test/matchMedia.ts` stubs `matchMedia`. Switch the OS scheme with `setPrefersColorScheme`. `localStorage` is cleared after each test.

## Bootstrap and TabHost

`useBootstrap(steps?)` in `src/app/useBootstrap.ts` is used by `AuthGate`. It signs in, then runs these steps in order:

1. The instance: `useInstanceStore.load`.
2. The templates: `useTemplatesStore.load`.
3. The column views: `src/app/columnViewsState.ts`.
4. The tabs: `useTabsStore.load`.
5. `resumeActionRuns`, which picks up the runs the tabs were following.

Once loaded, the instance is refetched on window focus (`refreshInstanceOnFocus`).

- It returns `status` (`signedOut`, `loading`, `loaded` or `error`), `error`, `login` and `retry`.
- `retry` starts a fresh sign-in after a sign-in failure, and re-runs the load steps after a data failure.
- `steps` can be injected for tests. Tests that render the shell call `stubBootstrap()` from `src/test/stubBootstrap.ts`.

Two more pieces live beside it.

- `useTemplatesStore` (`src/features/templates`): holds the non-deleted templates from the API and the per-template `queryOptions`. Its actions are `load()` (runs once), `reload()`, `upsert`, `remove` and `setQueryOption`.
- `TabHost` (`src/features/tabs/TabHost.tsx`): renders the active tab at `/view/:uuid` through `tabRegistry`, which maps each tab kind to a component that takes `{uuid}`.

`TabHost` keeps visited tabs mounted, up to 100 (least recently visited are dropped), hidden with `display:none`. The key is `uuid:componentName`, so a convert remounts the tab. An unknown uuid redirects to `/`, but only once the tabs have loaded.

## Tab store (`src/features/tabs`)

`useTabsStore` holds the open tabs; see [architecture.md](../docs/architecture.md#state-and-tab-model). Tests use `createTabsStore({persistence, debounceMs})` and call `store.reset()` to empty it.

- State: normalised tabs `{[uuid]: Tab}` plus `order`. `Tab` is a union on `componentName`: `KustoQueryResult`, `TemplateQueryResult` or `ActionResult`.
- `selectors.ts`: `children` is derived, never stored. The selectors are `selectRoots`, `selectChildrenOf`, `selectAncestors` and `selectSubtreeUuids`.
- `load()`: reads IndexedDB sorted by `displayComponentIndex`, renumbers, and saves again. A tab whose parent is missing becomes a root.
- Writes: create, update, convert, trigger and visited changes are debounced per tab (300 ms) and serialised with deletes. `flush()` forces them.
- `removeTab(uuid)`: removes the whole subtree and the `row_results` of every removed tab.
- Errors: reduced to `{message, code?}` on write and on load.
- `triggerRowData(uuid)`: sets a strictly increasing `rowDataTrigger`. Grids subscribe to it.
- `lastCreated`: records the most recently created tab.

## Query tree and New menu

`features/tree` holds the side tree.

- `SideTree`: `<SideTree templates queryOptions onReloadTemplates store? />` is the permanent left drawer, 56 px wide and 700 px while hovered. It reads the tab store and takes the active node from the route with `useMatch('/view/:uuid')`. Clicking a node marks the tab visited and navigates to `/view/:uuid`.
- Node labels: `[draft]` and `[new]` prefixes. The icon is a spinner, an error, a ringed 0, a row-count badge ("9+" above nine) or a faded folder. The ringed 0 is an action tab whose run succeeded with no rows (`nodeStatus.ts`).
- Header: the New menu, "Reload templates" and "Remove selected". "Reload templates" calls `onReloadTemplates` and ignores its rejections, so the callback must notify.
- `useTreeSelection(activeUuid)`: holds the checked set. Checking a node checks its descendants. Unchecking clears its descendants and ancestors (`toggleChecked`, pure).
- Remove selected: calls `removeTab`, which cascades, then navigates to `/` with replace if the active tab is gone.

`features/new-query` holds the New menu: `<NewQueryMenu templates queryOptions? ariaLabel? store?>label</NewQueryMenu>`. Choosing an entry creates a root tab and navigates to it.

- "New query": a `KustoQueryResult` draft titled "New query", with `DEFAULT_QUERY_EXAMPLE` from `features/kusto-query/defaultQuery.ts`.
- Actions submenu: a root `ActionResult` tab, nested by each action's `menuPath` (`buildActionMenuTree`). The title is the action's name and the params are the defaults. It is not run.
- Views and Queries submenus: a root `TemplateQueryResult`. Folders are keyed by the full path (`buildTemplateMenuTree`; `SubMenu` renders them, and both builders are in `menuTree.ts`). The title is the template's summary, the params come from `getDefaultParams`, and `state.editQuery` is `true`. It is not run.
- Search: case-insensitive over menu and summary. For actions it matches name, folders and key. It expands the groups.
- Hidden templates: `queryOptions[uuid].hide` leaves a template out.
- The Welcome page's "Get Started" button is a `NewQueryMenu`.

## Code editor (Monaco)

`src/components/CodeEditor` wraps `@monaco-editor/react` around the locally bundled `monaco-editor`, with no CDN. Its `language` is `kusto`, `yaml`, `json` or `plaintext`, and suggestions are on.

- `src/lib/monaco`: loads Monaco lazily, with the yaml and json languages, and `@kusto/monaco-kusto` for `language="kusto"`. Workers come from Vite `?worker` imports in `environment.ts` and `kusto.worker.ts`. `vite.config.ts` sets `worker.format` to `es`.
- `useCodeEditor()`: returns `onMount`, `getEditor` and `getKustoWorker()`, which `setSchemaFromShowSchema` needs. Models and editors are disposed on unmount.
- Build output: the production build emits `editor.worker`, `json.worker` and `kusto.worker` chunks. The Kusto worker is about 8 MB.
- Pins: `package.json` `overrides` pins `dompurify`, which monaco-editor 0.55 bundles, to `^3.4.15`. `@kusto/monaco-kusto` 15.0.1 peers on `monaco-editor@^0.55`.

`features/kusto-query/QueryHelperDialog` is the "Query Help" dialog. Its sample KQL is in `queryHelperSamples.ts`.

## Results grid (`src/features/grid`)

AG Grid Enterprise with the v33+ Theming API (`themeBalham`) and explicit module registration.

- `agGridSetup.ts`: `initAgGrid(config)` registers the modules and applies `agGridLicenseKey` when present. Without a key the grid runs as a trial with a watermark. `ResultsGrid` calls `initAgGridFromConfig()` when it is imported, so the grid works in tests without extra setup. `src/app/main.tsx` must not import AG Grid.
- `ResultsGrid`: takes `rows`, `templateColumns`, `columnId` and `stats`. `columnDefs` replaces the columns built from the rows, and `stateKey` keeps per-tab column state (see below).
- `TabResultsGrid`: takes a tab `uuid`. It reads rows from IndexedDB and reloads them on `rowDataTrigger`. A tab with no stored rows gives an empty grid.
- Columns: the union of all row keys. A template's `columns` override per column name, and `default` applies to the rest.
- Row id: `_id`, taken from the `columnId` column (default `EventId`), else `row-index-N`.
- Extension points: `getContextMenuItems(params)` returns extra items above copy, copy with headers and export, such as pivots, tagging and details. `onGridReady` exposes the grid api. `toolbarExtra` sits beside the quick filter.
- Built-in features: a side bar with columns and filters, multi filters, row grouping with a `dcount` aggregation, and a status bar. The status bar shows execution time, CPU, memory in MB, and total, filtered and selected counts.

### Column views (`src/features/column-views`)

- `ColumnViewBar`: sits beside the quick filter. It has an autocomplete with a "Create column view" item, and Apply, Rename, Delete and Save icon buttons with dialogs.
- Apply calls `applyColumnState({state, applyOrder: true})`. Save overwrites the view with the live state, and creating a view captures it.
- `useColumnViewsStore`: a zustand store persisted through `columnViewsDao`. Its state updates after the write succeeds. `app/columnViewsState.ts` re-exports it for bootstrap.
- The selected view belongs to one grid instance and is not persisted.
- Per-tab column state: pass `stateKey`. `TabResultsGrid` uses the tab uuid. The state is kept in memory only, in `tabColumnState`.
- It is saved on AG Grid `stateUpdated`, when the tab is hidden, and on unmount. A `ResizeObserver` detects hiding: the container size drops to 0.
- It is restored when the tab is shown again and when the grid is re-created.

### Detail panel

- `DetailPanel`: a persistent right drawer, 900px wide, positioned absolutely in the grid container so that hidden tabs hide it. It has a "Result Details" accordion and a visible close button.
- Content: object values show as YAML, with control characters stripped before dumping. Empty values and the client `_id` are hidden.
- Opening: a "Show details" context-menu item opens it. It comes after the caller's `getContextMenuItems` items and is disabled on group rows. While open, the panel follows the focused cell's row.
- `ResultsGrid` props `columnViews` and `detailPanel` both default to true. Set one to false to turn that feature off.

## Ad-hoc query tab, time range and cluster pickers

`features/kusto-query/KustoQueryTab` is registered for `KustoQueryResult` in `tabRegistry`.

- Modes: it opens in edit mode, also after a reload. Edits live in a local draft.
- Toolbar: the New menu, `TimeRangePicker`, Run Query, Clone, and Edit Query, Save Changes & Run, Save Changes and Cancel. Clone makes a root tab titled "Copy of <title>" and navigates to it.
- Save: needs a cluster and database. After a failed submit, `ClusterSelect` shows the required errors.
- Editor: Query Help opens `QueryHelperDialog`. The Kusto `CodeEditor` has a per-tab model path.
- Running: `onRun` defaults to `useRunKustoQuery()`. The results render in `PivotResultsGrid` once the tab has a `rowDataTrigger`.

Shared pickers in `src/components`:

- `TimeRangePicker`: wraps `lib/time-range`. `CustomDateRangeDialog` and `CustomPeriodDialog` are in `TimeRangePickerDialogs.tsx`. Both are `DraggableDialog`s and reset their forms on open. The range is stored in the tab's `state.timeRange`, and the default is Last 15 minutes.
- `ClusterSelect`: two freeSolo autocompletes fed by `defaultClusters`. Clusters are grouped by group name. The database options are the databases of the group that lists the typed cluster.
- `clusterSelection.ts`: `validateClusterSelection` and `databasesFor`.
- `clusterUrl.ts`: `normalizeClusterUrl`, which is `formatCluster` from `lib/api`. `ClusterSelect` applies it on blur and on selection.

## Kusto schema and ad-hoc run (`src/features/kusto-query`)

- `useKustoSchema(cluster, database, editor)`: runs when the editor instance exists and both cluster and database are set, including on first mount. It fetches `getKustoSchema`, then calls `setSchemaFromShowSchema(schema, formattedCluster, database)` on the worker from `getKustoWorkerFor`. Effect cleanup marks the run stale, so late responses are ignored. Errors go to the snackbar.
- `kustoSchema.ts`: caches schemas per formatted cluster and database. A call in flight is shared, and failures are not cached. `normalizeSchema` accepts the parsed document, or a `ClusterSchema`, `DatabaseSchema`, `schema` or `data` wrapper, as an object, a JSON string or a row list.
- The tab passes the draft cluster and database while editing, and the editor from the `CodeEditor` `onMount`.
- `runKustoQuery(uuid, timeRange?, {store?, signal?})`: runs the tab's saved query through `runTabQuery` in `runPipeline.ts`, with the given time range or the tab's own. It never rejects.
- `runPipeline.ts`: sets the tab executing and unvisited and clears its error. It calls `runQuery` with `startTime` and `endTime` (ISO strings from `resolveTimeRange`) when there is a time range. It then writes the rows to `rowResultsDao`, sets `rowCount` and `executionTime`, and sets `cpuUsage` and `memoryUsage` as strings, then calls `triggerRowData`.
- Failure: the error is stored through `toStoredError`, the rows are deleted, and row data is triggered.
- Abort: the run aborts when the tab leaves the store or a newer run starts on the same tab. Nothing is written after an abort.
- `useRunKustoQuery()`: adds the "Executing query..." snackbar. It needs a `SnackbarHost`.

## KQL templates (`lib/kql-templates`)

Pure functions: `getDefaultParams`, `buildParams(template, row, selectedRows)`, `isDataComplete`, `buildSummary`, `buildCluster` and `buildQuery`. `createTemplateEngine({tagCluster, tagDatabase})` makes an explicit engine. The default engine reads runtime config lazily. See [architecture.md](../docs/architecture.md#template-engine).

Rendering uses an isolated `Handlebars.create()` environment with `noEscape`, because the output is KQL, not HTML.

Escaping rules:

- `{{array xs}}` renders `@'a','b'`. Inside a verbatim literal only `'` needs escaping, so quotes are doubled: `O'Neil` becomes `@'O''Neil'`. Backslashes and `"` are literal.
- `{{str x}}` is a single `@'x'` literal with quotes doubled.
- `{{kql x}}` is a regular `'x'` literal, with backslash, quotes and newlines escaped.
- A raw `{{x}}` is substituted unchanged, so template authors should wrap user-controlled values in a helper.
- Values are never evaluated as template source, and Handlebars' prototype-access protection stays on.
- `{{> getTagEvents}}` renders the tag-events KQL from `getTagEvents.kql`. The configured tag cluster and database have their quotes doubled.

Edge cases:

- Falsy defaults (`false`, `0`) are kept by both `getDefaultParams` and `buildParams`. A missing default is `''`.
- A `match` param needs exactly one matching column to be complete.
- An invalid `regex` matches nothing instead of throwing.

## Template tab form (`src/features/template-query`)

`TemplateQueryTab` is registered for `TemplateQueryResult`. Edit mode is the persisted `state.editQuery`, and edits live in a local draft.

- Toolbar: the New menu, Run Query, Clone, Convert (with a confirm dialog), Edit and Share Link. While editing it shows Save & Run, Save and Cancel.
- Actions: run, clone, convert and share call the `onRun`, `onClone`, `onConvert` and `onShare` props. Their defaults are in `useTemplateTabActions.ts`.
- `runTemplateQuery.ts`: `runTemplateQuery` renders cluster, database and query with kql-templates. It runs them through `runTabQuery` in `kusto-query/runPipeline.ts`, the pipeline `runKustoQuery` also uses, with no time range. A render error is stored as the tab's error.
- Clone: makes a sibling with the same parent, titled `Copy of <title>`, in edit mode and not run. It navigates to the copy.
- Convert: after the dialog, calls `convertToKusto` with the rendered KQL. `TabHost` keys on uuid and kind, so the tab remounts as a `KustoQueryTab`.
- Results: `PivotResultsGrid` renders them once `rowDataTrigger` is set, with the template's `columns` overrides.

Form pieces:

- `ParamField.tsx`: picks the control by param type.
  - `array`: a select. With `multiple` it adds Select All and shows "first, (+N others)" above 5 selections.
  - `match`: a select of the `[{column, value}]` entries found when editing started. It stores a one-element list.
  - `multiple`: a chips combobox. `,`, `;` and Enter add a chip.
  - `boolean`: a switch.
  - Anything else: a trimmed text field.
- Fields: `params` and `fields` are merged, and fields win. A field is required unless `optional === true`, and shows a red asterisk.
- `paramRules.ts`: a value is missing when it is blank, whitespace-only or an empty list. Booleans are never required.
- Validation: errors appear after a failed save. That also shows the snackbar "Unable to save query due to validation errors."
- Summary: the refresh button uses `buildSummary`. "Preview Query" shows or hides `buildQuery` of the draft in a read-only Kusto `CodeEditor`.
- Tests: mock `CodeEditor` and use an in-memory tab store, as for `KustoQueryTab`.

## Action tab (`src/features/action-tab`, `src/features/instance`)

The tab that runs an action. How it behaves is in [architecture.md](../docs/architecture.md#the-tab-and-new-menu); this is where the code is.

- `ActionTab.tsx`: the tab, registered for `ActionResult`. Header with Clone, pills bar with Run (or the running spinner with Cancel), and the inner tabs "Results · N" and "Run · duration". It picks the inner tab and shows the previous results during a run. It finds its action in `useInstanceStore` by `params.action`; the param values are plain values in `params.params`.
- `PillsBar.tsx`: one pill per param except `kql`/`sql`, each edited in a popover. `DatetimeEditor.tsx` (MUI X date pickers with dayjs, in UTC) and `TimespanEditor.tsx` (preset chips, or an amount and a unit) edit those kinds; `paramValues.ts` parses and shows values. A pill shows the server's reason for a refused param, and an Edited chip that resets the params to the latest run's and clears the marks.
- `RunPanel.tsx`: the Run tab: status, start, duration, run id, the tab's error, details, columns and params. `runText.ts` words the status and durations.
- `cloneActionTab.ts`: `cloneActionTab` adds the sibling "Copy of <title>" with the same params.
- `actionRuns.ts`: `runActionTab` starts a run (a 422's `params.<name>` error goes to the tab's `paramErrors` when that param has a pill, else into the "Couldn't start: …" message as `name: reason`), polls it (every second for 10 s, then every 3 s) and loads its rows; `cancelActionTab` cancels it with `cancelRun` from `lib/api/runs.ts`; `resumeActionRuns` picks runs up again after a reload.
- `runRows.ts`: the rows loading in this session, page by page, so the grid fills before the rest arrive. They are written to `row_results` once all have loaded.
- `ActionResultsGrid.tsx`: the grid, keyed by `row`. New pages go in by AG Grid transaction. `StoredActionResultsGrid` reads `row_results` instead, after a reload.
- `editorSchema.ts`: `useEditorSchema` loads the schema of the Query editor's `schemaFrom` params once the editor has mounted and each has a value that has stayed unchanged for 400 ms, with `getEditorSchema` from `lib/api/connections.ts`. Schemas are cached per connection and scope (a failure is not cached), a late answer is ignored, and a failure goes to the snackbar. One adapter per schema kind gives the editor the schema; `kql` calls `setSchemaFromShowSchema` with the connection name as the cluster.
- `actionColumns.ts`: the grid's columns. Declared settings become `initial*` settings, and declared `calculated` columns become `calculatedExpression` columns.
- Tests pass `onRun` to `ActionTab` instead of running.

## Pivots (`src/features/pivots`)

A pivot opens a template tab from a grid row; see [architecture.md](../docs/architecture.md#data-flow-run-poll-pivot-tag).

- `PivotResultsGrid`: used by `KustoQueryTab` and `TemplateQueryTab` instead of `TabResultsGrid`. It adds a context-menu group of the non-hidden `query` templates, nested by `path`. `menuTree` puts folders first, then items, each sorted by text.
- `createPivotTab`: runs when a template is chosen. It calls `buildParams` with the clicked row and the selected rows, or the clicked row when none is selected.
- The new tab is a child `TemplateQueryResult` titled by `buildSummary`. `editQuery` is `!autoExecute || !isDataComplete`. When it auto-runs, `runTemplateQuery` starts.
- Navigation: the app navigates to the child only when its data is incomplete. A complete pivot stays on the parent.
- Shift: `usePivotMenu` tracks it with window `keydown` and `keyup` listeners, cleared on blur. Holding it suppresses the run.
- Menu groups: `ResultsGrid.getContextMenuItems` accepts a list of groups. Group 0 is followed by "Show details", and tagging goes there. Later non-empty groups come after a separator.

## Query Manager (`src/features/templates-admin`)

- `QueryManagerPage`: the routed page, a default export. It lists templates fetched with `includeDeleted=true`, with localised timestamps, sortable, filterable and paged. After any change it reloads its list and calls `useTemplatesStore.reload()`.
- Delete: disabled when nothing deletable is selected or any selected template is managed.
- Restore: shown only with "Show deleted". Its enabled state follows the number of selected deleted rows. It uses `restoreTemplate`, a PATCH.
- `TemplateDialog`: creates a template (POST, with a new uuid) or edits one (PUT). `createdBy` is never sent.
- YAML fields: Params, Fields and Column customisation are YAML `CodeEditor`s, parsed with `js-yaml`. An empty editor means not set. A parse error, or a document that is not a mapping, shows under the editor. Fields are required for the `query` type.
- Managed templates: read-only, including Fields.
- Save errors: show `ApiError.detail` plus field errors, network failures included.
- Tests: both components take optional `client` and `store` props. Tests mock `components/CodeEditor` with `testUtils.fakeCodeEditorModule`.

## Export / Import (`src/features/export-import`)

`ExportImportPage`, routed at `#/exportimport`, exports and imports only this app's tabs: `display_components` in the `tim` DB, as a JSON array. Row results, column views and query options are not included.

- Export: flushes pending tab writes, fills the textarea and copies the text to the clipboard.
- Import: disabled while the text is empty, is not JSON, or fails the zod `exportSchema`. The message shows under the field.
- Import writes the tabs. A tab with the same uuid is overwritten, `isExecuting` is reset, and `displayComponentIndex` is rebased after the existing tabs. It then calls `useTabsStore.load()`, so the tabs show in the tree at once.

## Share (`src/features/share`)

A share link opens a template tab with given params; see the glossary entry for Share link.

- `buildShareUrl(templateUuid, inParams)`: makes `<origin><path>#/share/<uuid>?p=<base64url of UTF-8 JSON>&execute=0`. `decodeShareParams` reads the same format.
- Share Link button: `useShareTemplateQuery` copies the URL and shows "Shared link has been saved to the clipboard.".
- `ShareQueryPage`: routed at `#/share/:uuid`, after bootstrap so the templates are loaded. It shows "This query was not found.", "Parameters are missing." or "Parameters are invalid." when the link is bad.
- Otherwise `sanitizeShareParams` keeps declared params only, over the defaults, and converts a string `match`. The page creates a root `TemplateQueryResult` titled with `buildSummary` and navigates to it.
- `execute=1`: runs the tab at once, unless required data is missing. Then it opens in edit mode.
- `execute=0`: always opens in edit mode.

## Tagging (`src/features/tagging`)

Tagging saves events and attaches determinations, comments and tags to them; see [architecture.md](../docs/architecture.md#data-flow-run-poll-pivot-tag).

### Quick tag

- Menu: the grid's first context-menu group is a "Tag Events" submenu, built by `useTaggingMenu` and composed by `PivotResultsGrid`. It has "Quick - Malicious", "Quick - Suspicious" and "Quick - Benign", before "Show details".
- Targets: the selected rows, or the clicked row. The submenu and its items are disabled unless every target has `EventId` and `EventTime`.
- `quickTag`: never rejects. It calls `saveEvents` for unsaved rows, then `commentEvents` with `{eventId, determination (lower case), isDeleted: false}` and no comment.
- Snackbars: "Quick saving events...", "Tag events successfully saved.", "Saving events failed: ..." and "Saving comments failed: ...". The text after the colon is the API problem `detail`.
- On success: the API returns 204, so the updated rows (`TagEvent.Determination`, `IsSaved`) are computed locally. `applyRowUpdates` in `features/grid/rowUpdates.ts` applies them with `applyTransaction` by `_id`, then rewrites the tab's stored `row_results`. `_id` is never stored. The selection is cleared.
- On failure: nothing changes.
- The submenu starts with "Customise tag events". It is disabled outside a `TagDialogProvider`.

### Customise dialog

- `TagDialogProvider`: mounted by `PivotResultsGrid`. It owns one `TagDialog` and exposes `TagDialogContext`, whose `openDialog({rows, api, uuid, columnId})` `useTaggingMenu` calls with the selected or clicked rows.
- `TagDialog`: a `DraggableDialog` titled "Customise Tag Events", with "N event(s) selected". It has determination, comment and tags, each with an action select. The tags field is a chips autocomplete with "Exists in N event(s)" hints. Free text is added with Enter or on blur, except when removing. A backdrop click does not close it.
- Save: runs `validateTagDialog`, which shows messages under the fields or form, with a live modification preview. It then runs `buildTagRequests`, `submitTagRequests` and `applyRowUpdates`, and closes with the snackbar "Tag events successfully customised." or "...removed.".
- Errors: the dialog stays open and shows "Customisation of tag events failed: <detail>" inline and as a snackbar. Save stays available.
- Retry: after a partial failure, where events were saved but comments failed, a retry sends the save-events call again, because the rows still look unsaved.

### Dialog logic

This is pure code with no React.

- `tagSets.ts`: `tagsFromRow`, `tagsDiff`, `tagsIntersect`, `existingTagCounts` and `tagOptions`.
- `tagDialogLogic.ts`: `TagDialogInput` with `defaultTagDialogInput`, the per-field action lists and `isDeterminationDisabled`.
- `validateTagDialog(input, rows)`: returns `{ok, fieldErrors, errors}`. The field errors "Determination/Comment cannot be empty." come first. The cross-field messages are computed only when those pass.
- `modificationPreview(rows, tagAction, tags)`: returns text such as "Adding X to N event(s).".
- `buildTagRequests(rows, input)`: returns `{savedEvents, comments, tags, updatedRows}` for the Override, Append and Remove actions.
- `submitTagRequests`: sends events, comments and tags in that order. A failure is a `TagSubmitError` whose `stage` says which step failed.

### Inline comment edit (`tagging/commentEdit.ts`)

- Columns: in `features/grid/columns.ts`, `defaultColDef.editable` is false and `buildColumnDefs` forces `editable` on every column, so template `editable` overrides are ignored. Only `TagEvent.Comment` is editable, and only on rows where `isCommentEditable` holds: `TagEvent.IsSaved === true`, `EventId` set and `TagEvent.Determination` set.
- Grid option: the grid keeps `readOnlyEdit`, so an edit arrives as `onCellEditRequest` and AG Grid does not change the cell value.
- Wiring: `TabResultsGrid` wires `useCommentEdit(uuid, columnId)` by default, and a caller's own `onCellEditRequest` wins. `PivotResultsGrid` needs no change.
- `commentEdit(event, {uuid, notify, call})`: never rejects and returns whether it saved. It ignores other columns, ineditable rows and unchanged values.
- Saving: shows "Quick saving comment...", calls `commentEvents([{eventId, determination, comment, isDeleted: false}])`, then runs `applyRowUpdates` and shows "Comment successfully quick saved.".
- On failure: the row is untouched and the cells are refreshed, so the old value shows. "Saving comments failed: <detail>" is shown.
