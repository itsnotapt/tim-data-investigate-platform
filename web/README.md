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
npm run e2e           # Playwright e2e (headless Chromium, against a real api)
npm run e2e:headed    # same, with a visible browser
npm run e2e:smoke     # only the flows tagged @smoke (what CI runs on a PR)
npm run gen:api       # regenerate src/lib/api/schema.d.ts from openapi.json
```

Stack: React 19, React Router (hash router), MUI + Emotion, Zustand, AG Grid Enterprise, Monaco.

- TypeScript is `strict`, with `noUncheckedIndexedAccess`.
- TypeScript is pinned to 6.0.x, because typescript-eslint peers on `<6.1.0`.
- Tests live next to the code, as `*.test.tsx`. Their setup is in `src/test-setup.ts`, and their config in `vite.config.ts`.

## E2E tests

Playwright specs run in headless Chromium: `e2e/flows/*.spec.ts`. Flows tagged `@smoke` run on every PR; every flow runs on `main` and on release PRs.

- The config is `playwright.config.ts`.
- `e2e/` has its own `tsconfig.json`, and Vitest excludes it.
- The first run on a machine needs `npx playwright install chromium`.

`npm run e2e` starts two servers:

- A real api on port `E2E_PORT + 1` (default 5181), from `e2e/api_server.py`. It needs uv; see [development.md](../docs/development.md#e2e-tests).
- `vite` on port `E2E_PORT` (default 5180) with `VITE_AUTH_STUB=true`, proxying `/api` to that api. Production builds refuse the stub, so the harness uses the dev server, not `vite preview`.

Neither server is reused; to run several checkouts at once, see [development.md](../docs/development.md#e2e-tests).

`/config.js` comes from `public/config.js`. Every flow imports `e2e/realApi.ts` and uses the dev actions in `e2e/actions/`.

- `page` is signed in as a new analyst per test (`analyst`).
- `signIn(upn)` opens a second analyst's browser context.
- `idPrefix` is a random per-test prefix for `id`s.
- `page.route` is for faults the server can't produce.
- `waitForEditor` is in `e2e/editor.ts`.

Each test gets a fresh browser context, so IndexedDB starts empty.

- `shot(page, 'NN-name')` in `e2e/shot.ts` writes screenshots for a person to review.
  - It writes only when `E2E_SHOTS=1`, into `e2e/.screenshots/` (gitignored).
  - Each light `NN-name.png` gets a dark copy, `NN-name-dark.png`, beside it.
  - There are no `toHaveScreenshot` baselines.
- Reports go to `test-results/` and `playwright-report/` (gitignored).
- `e2e/flows/theme.spec.ts` checks the colour scheme.
  - It picks the scheme from **Settings › Appearance**, or seeds `localStorage['tim-theme-mode']` with `page.addInitScript`.
  - It emulates the OS scheme with `page.emulateMedia`.
  - It reaches the config error page by serving a `/config.js` without `auth`.
  - The colour contrast sweep walks several screens on one page through hash routes.
  - The rest of the suite runs light, because Playwright emulates a light OS.

## Layout

The source has four parts:

- `src/app`: shell, routes and lazy pages, router, theme, bootstrap;
- `src/features/*`;
- `src/lib/*`;
- `src/components`.

`features/*` import `lib/*` and `components/*`, never each other's internals.

## Routes (hash)

`#/`, `#/view/:uuid` (tab), `#/runs/:runId` (a share link to a run).

## Runtime config

`index.html` loads `/config.js`, a plain script, before the app. It sets `window.appConfig`. See [architecture.md](../docs/architecture.md#runtime-configuration).

- `public/config.js`: placeholder dev values. In production the container renders it from env vars.
- `src/lib/config/runtimeConfig.ts`: exposes `getConfig()`.
  - It merges `window.appConfig` over the `VITE_*` env fallbacks, per key (see `.env.example`).
  - It validates with zod.
  - Empty strings and unsubstituted `$VAR` placeholders count as missing.
- `main.tsx`: if validation fails, shows an error screen listing every missing or invalid key.

| Key (`window.appConfig`)          | Fallback env                                 | Notes                                                       |
| --------------------------------- | -------------------------------------------- | ----------------------------------------------------------- |
| `auth.clientId`, `auth.authority` | `VITE_AUTH_CLIENT_ID`, `VITE_AUTH_AUTHORITY` | required; authority is a full URL                           |
| `redirectUri`                     | `VITE_AUTH_REDIRECT`                         | required                                                    |
| `apiEndpoint`                     | `VITE_API_ENDPOINT`                          | optional, default `''` (same origin), trailing `/` stripped |
| `agGridLicenseKey`                | `VITE_AGGRID_LICENSE_KEY`                    | optional; empty = AG Grid trial                             |
| `wikiUri`, `issueUri`             | `VITE_HELP_WIKI_URI`, `VITE_HELP_ISSUE_URI`  | default GitHub URLs                                         |

## Auth

`src/lib/auth/` is the only auth module; see [architecture.md](../docs/architecture.md#authentication). `createAuthClient()` returns a dev stub or the MSAL client. All other code uses the `AuthClient` interface: `getAccount`, `acquireToken`, `login`, `logout`. Only the stub sign-in (`stubSignIn`) has `signInAs`.

- **MSAL client** (`createMsalAuthClient`): wraps `PublicClientApplication`.
  - It is configured from `auth.clientId`, `auth.authority` and `redirectUri`, with its cache in `localStorage`.
  - On first use, it runs `initialize()` and `handleRedirectPromise()`, and restores the cached account.
  - `logout` uses `logoutPopup`.
  - The API scope is `api://<clientId>/user_impersonation` (`apiScopes()`).
- **Token acquisition**: `acquireToken(scopes)` tries `acquireTokenSilent` for the active account, or `ssoSilent` when there is none.
  - It opens a popup only on `InteractionRequiredAuthError`, or when SSO fails.
  - One interactive request runs at a time. Concurrent callers share it.
- **Errors**: failures reject with `AuthClientError`, whose `code` is `interaction_in_progress`, `popup_blocked`, `cancelled`, `not_signed_in` or `unknown`. Nothing stays stuck, so sign-in can be retried.
- **Popup redirect page**: MSAL popups return to `redirectUri`, which must serve `blank.html`, built from `web/blank.html` and `src/lib/auth/redirectBridge.ts`. Register `https://<host>/blank.html` in Entra.
- **React**: `<AuthProvider client={getAuthClient()}>` wraps `MsalProvider` for MSAL clients. `useAuth()` returns `{ account, status, error, login, logout, getToken, signInAs }`. `status` is `'loading'`, `'signedOut'`, `'signedIn'` or `'error'`. `signInAs` is `null` except with `stubSignIn`.
- **Dev stubs**: `createAuthClient()` picks one in either of two cases.
  - `VITE_AUTH_STUB=true` (`createDevStubAuth`), for example in `.env.local`, or in the environment for Playwright. It gives a fake account with no Entra sign-in: `dev.user@example.com`, or the upn in `localStorage['tim.devStubUpn']`.
  - This stub has no `signInAs` and no "Who are you?" screen.
  - Its Sign out shows the "You must sign-in first" gate, and does not clear the stored upn.
  - `stubSignIn: true` in the runtime config (`createStubSignIn`, container variable `STUB_SIGN_IN`). No one is signed in until an analyst is chosen on the "Who are you?" screen.
  - "Who are you?" has buttons for `alice@demo.example` and `bob@demo.example`, and a "Name or email" box.
  - This stub has `signInAs`, which keeps the choice in `localStorage['tim.devStubUpn']`.
  - Its Sign out forgets the stored upn and returns to the screen.
  - Both stubs send the token `dev:<upn>`.
  - `createAuthClient()` throws if `VITE_AUTH_STUB` is set in a production build. The web container renders `stubSignIn` only when `TIM_ENVIRONMENT=development`.
  - Pair it with the API's `TIM_AUTH_DISABLED=true` (see `api/README.md`).

## Docker image

Production deployment and `/api` routing: see [docs/deployment.md](../docs/deployment.md). Environment variables: see [docs/configuration.md](../docs/configuration.md).

```bash
docker build -t tim-web web/
docker run --rm -p 8080:8080 \
  -e BACKEND_URI=http://api:8080 -e REDIRECT_URI=https://tim.example.com/blank.html \
  -e AUTH_CLIENT_ID=<app-id> -e AUTH_TENANT_ID=<tenant> \
  -e AGGRID_LICENSE=<key> tim-web
```

The build is multi-stage:

- `node:24-alpine3.24`, from `mirror.gcr.io`, builds;
- `ghcr.io/nginx/nginx-unprivileged:1.30-alpine` serves on port 8080, as uid 101.

The root filesystem can be read-only. Only `/tmp` must be writable.

- `docker/docker-entrypoint.sh`:
  - validates the env, and exits 1 listing every missing variable;
  - writes `/tmp/tim/config.js`, with the values JSON-escaped by `jq`;
  - renders the nginx conf, and execs nginx.
- `docker/nginx.conf.template`: rendered to `/tmp/tim/nginx.conf`, which the static `/etc/nginx/conf.d/default.conf` includes.
- Proxying: nginx sends `/api/` to `BACKEND_URI` and keeps the `/api` path, so an ingress must not strip it. It resolves the backend at request time.
- Headers: nginx sends gzip, and the security headers: CSP, `X-Frame-Options: SAMEORIGIN`, nosniff, Referrer-Policy, and HSTS when `X-Forwarded-Proto` is `https`.
- Caching: `config.js` and `index.html` are served with `no-cache`.
- CSP: it allows `'unsafe-eval'`, for the Kusto worker. A cross-origin `API_BASEPATH` origin is added to `connect-src` automatically.
- `GET /healthz` returns 200.

| Env var                            | Required                        | Maps to / notes                                                                                                                      |
| ---------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `BACKEND_URI`                      | yes                             | nginx upstream, `http(s)://host[:port]`, no path (trailing `/` stripped)                                                             |
| `STUB_SIGN_IN`                     | no                              | `true` or `false` (default `false`); `stubSignIn`. `true` needs `TIM_ENVIRONMENT=development` and replaces the three variables below |
| `REDIRECT_URI`                     | yes, unless `STUB_SIGN_IN=true` | `redirectUri`; must be registered in Entra                                                                                           |
| `AUTH_CLIENT_ID`, `AUTH_TENANT_ID` | yes, unless `STUB_SIGN_IN=true` | `auth.clientId`; `auth.authority` = `https://login.microsoftonline.com/<tenant>`                                                     |
| `AGGRID_LICENSE`                   | no                              | `agGridLicenseKey`; empty = trial                                                                                                    |
| `TIM_ENVIRONMENT`                  | no                              | `production` (default) or `development`; gates `STUB_SIGN_IN`, not `AGGRID_LICENSE`                                                  |
| `API_BASEPATH`                     | no                              | `apiEndpoint`, default empty (same origin; paths already start `/api`)                                                               |
| `HELP_WIKI_URI`, `HELP_ISSUE_URI`  | no                              | omitted when empty (app defaults apply)                                                                                              |
| `NGINX_RESOLVER`                   | no                              | DNS server for backend lookups; default first nameserver in `/etc/resolv.conf`                                                       |

The entrypoint also honours three variables, for testing without Docker:

- `TIM_RUNTIME_DIR` (default `/tmp/tim`);
- `TIM_NGINX_TEMPLATE`;
- `TIM_ENTRYPOINT_DRY_RUN=1`, which renders the files and exits.

## Browser storage

`src/lib/storage` owns the IndexedDB database `tim`; its stores are in [architecture.md](../docs/architecture.md#indexeddb).

- Use the DAOs: `displayComponentsDao`, `rowResultsDao`, `defaultViewsDao`, `annotationsDao` and `annotationSyncDao`.
- Annotations are kept in `annotationsDao`, never in `rowResultsDao`. The code that applies and polls them is in `src/lib/annotations` ([architecture.md](../docs/architecture.md#annotations-in-the-browser)).
- `rowResultsDao.get` returns `[]` when nothing is stored.
- Tests reset the singleton with `resetTimDb()`.

## API types and client

`src/lib/api/openapi.json` is exported by the API (`cd api && uv run python -m tim_api.openapi_export`).

- `npm run gen:api` turns it into `src/lib/api/schema.d.ts`, with openapi-typescript.
- The generated file is committed, and excluded from lint and prettier.
- Regenerate both after any API change.

`src/lib/api` re-exports everything from `index.ts`.

- `createApiClient({baseUrl, getToken})`: the only fetch path.
  - `getApiClient()` wires `config.apiEndpoint`, and `getApiToken()` for each request's token, a silent `acquireToken` that asks for the api scope under Entra.
  - An empty endpoint means same origin. Paths already start with `/api`.
- Timeouts and aborts: the default timeout is 30 s. A `signal` aborts the call and rejects with the abort reason.
- `ApiError`: thrown for non-2xx responses and transport failures.
  - It carries `status`, `type`, `title`, `detail`, `traceId` (from the body or `x-trace-id`) and `errors`.
  - Client-side failures have status 0, and a `type` of `urn:tim:client:timeout`, `urn:tim:client:network` or `urn:tim:client:invalid-response`.
- 401: one 401 triggers one token re-acquisition and one retry.
- Endpoint modules: `instance`, `connections` and `runs`.

Tests use the shared MSW server.

- Call `setupMswServer()` from `src/test/msw/server.ts`.
- Add `server.use(...)` handlers, with the helpers in `src/test/msw/handlers.ts`: `apiUrl`, `problemResponse` and `makeRun`.
- Build clients with `baseUrl: TEST_API`.

## Shell, notifications, dialogs

- `lib/uuid`: `generateUuid`, which wraps `crypto.randomUUID`.
- `lib/isEmpty`: tells whether a value, array or object is empty.
- `app/AppShell`: a flat, dense toolbar on the paper colour. Its menus are a TIM link, Help (Wiki Page and Report a bug, from config, in a new tab), Settings (Appearance) and Account (Sign in, Sign out).
- `app/AuthGate`: wraps the routes. Signed out shows "You must sign-in first.", loading shows progress, and an error shows its message with Retry.
- `SideTree`: rendered inside `AuthGate`. The main content is offset by `SIDE_TREE_COLLAPSED_WIDTH`.
- `components/SnackbarHost` and `useNotify()`: show one message at a time, first in first out.
  - A message shows for 5000 ms by default, with a 200 ms pause between messages.
  - A message can have a link button. Dismiss hides it.
  - `App` mounts the host.
- `components/DraggableDialog`: a MUI Dialog dragged by its title with pointer events. It stays inside the viewport and is clamped again when the window resizes.

## Theme

Every colour lives in one palette in `src/app/theme.ts`, with a light and a dark colour scheme (`colorSchemes`). Besides MUI's entries it has TIM's own: `editor.{border,background}`, `grid.{header,oddRow}`, `label.*` (row fills) and `labelStripe.*`.

- Variables: MUI emits the palette as `--mui-palette-…` CSS variables. Components read them through palette tokens, for example `sx={{ borderColor: 'editor.border' }}` or `theme.vars.palette.*`. They never use colour literals or `theme.palette.mode`.
- Scheme attribute: MUI writes the active scheme as `data-ag-theme-mode="light|dark"` on `<html>`. AG Grid's theme reads the same attribute.
- `ResultsGrid.tsx`: sets the grid theme's params to those variables.
- `features/labels/labels.css`: colours labelled rows from `label.*` and adds a `labelStripe.*` stripe on the first cell.
- `theme.test.ts`: checks the WCAG AA contrast pairs in both schemes.
- `colourLiterals.test.ts`: fails on a colour literal anywhere in `src` outside `theme.ts` and tests. Hex, `rgb(`, `hsl(` and named colours all count.

Choosing the scheme:

- `app/AppThemeProvider` (`ThemeProvider` and `CssBaseline`) wraps both `App` and `ConfigError` in `main.tsx`. Tests that render either use it as their `wrapper`.
- Users pick **Light**, **Dark** or **System** under **Settings › Appearance** (`AppShell.tsx`). System is the default. It follows the OS `prefers-color-scheme`, including live changes.
- MUI's `useColorScheme()` holds the choice, saves it in `localStorage['tim-theme-mode']` and follows changes made in other tabs.
- `public/theme-init.js` sets `data-ag-theme-mode` and `color-scheme` on `<html>` from the same key. So the page never shows the other scheme first.
  - A plain `<script src>` in the `<head>` of `index.html` loads it before the module bundle, because the CSP allows no inline script.
  - `AppThemeProvider` removes its inline `color-scheme` once MUI's styles take over.
  - `themeInit.test.ts` runs it in jsdom.
- In Vitest, `src/test/matchMedia.ts` stubs `matchMedia`. Switch the OS scheme with `setPrefersColorScheme`. `localStorage` is cleared after each test.

## Bootstrap and TabHost

`useBootstrap(steps?)` in `src/app/useBootstrap.ts` is used by `AuthGate`. It signs in, then runs these steps in order:

1. The instance: `useInstanceStore.load`.
2. The analyst's default views (`loadDefaultViews`).
3. The tabs: `useTabsStore.load`.
4. `resumeActionRuns`, which picks up the runs the tabs were following.

Once loaded, the instance is refetched on window focus (`refreshInstanceOnFocus`).

- It returns `status` (`signedOut`, `loading`, `loaded` or `error`), `error`, `login` and `retry`.
- `retry` starts a fresh sign-in after a sign-in failure, and re-runs the load steps after a data failure.
- `steps` can be injected for tests. Tests that render the shell call `stubBootstrap()` from `src/test/stubBootstrap.ts`.

One more piece lives beside it.

- `TabHost` (`src/features/tabs/TabHost.tsx`): renders the active tab at `/view/:uuid` through `tabRegistry`, which maps each tab kind to a component that takes `{uuid}`.

`TabHost` keeps visited tabs mounted, hidden with `display:none`.

- It keeps up to 100. The least recently visited are dropped.
- An unknown uuid redirects to `/`, but only once the tabs have loaded.

## Tab store (`src/features/tabs`)

`useTabsStore` holds the open tabs; see [architecture.md](../docs/architecture.md#state-and-tab-model). Tests use `createTabsStore({persistence, debounceMs})` and call `store.reset()` to empty it.

- State: normalised tabs `{[uuid]: Tab}` plus `order`. `Tab` is an `ActionResult`.
- `selectors.ts`: `children` is derived, never stored. The selectors are `selectRoots`, `selectChildrenOf`, `selectAncestors` and `selectSubtreeUuids`.
- `load()`: reads IndexedDB sorted by `displayComponentIndex`, renumbers, and saves again. A tab whose parent is missing becomes a root.
- Writes: create, update, trigger and visited changes are debounced per tab (300 ms) and serialised with deletes. `flush()` forces them.
- `removeTab(uuid)`: removes the whole subtree and the `row_results` of every removed tab.
- Errors: reduced to `{message, code?}` on write and on load.
- `triggerRowData(uuid)`: sets a strictly increasing `rowDataTrigger`. Grids subscribe to it.
- `lastCreated`: records the most recently created tab.

## Query tree and New menu

`features/tree` holds the side tree.

- `SideTree`: `<SideTree store? />` is the permanent left drawer.
  - It is 56 px wide, and 700 px while hovered.
  - It reads the tab store, and takes the active node from the route with `useMatch('/view/:uuid')`.
  - Clicking a node marks the tab visited, and navigates to `/view/:uuid`.
- Node labels: `[draft]` and `[new]` prefixes.
- Node icons: a spinner, an error, a ringed 0, a row-count badge ("9+" above nine) or a faded folder. The ringed 0 is an action tab whose run succeeded with no rows (`nodeStatus.ts`).
- Header: the New menu and "Remove selected".
- `useTreeSelection(activeUuid)`: holds the checked set. Checking a node checks its descendants. Unchecking clears its descendants and ancestors (`toggleChecked`, pure).
- Remove selected: calls `removeTab`, which cascades, then navigates to `/` with replace if the active tab is gone.

`features/new-query` holds the New menu: `<NewQueryMenu actions? ariaLabel? store? presetsStore? analyst?>label</NewQueryMenu>`. Choosing an entry creates a root tab and navigates to it.

- Actions and presets submenu: one tree of folders (`buildNewMenuTree`), where each folder shows its item count.
  - An action makes a root `ActionResult` tab (`createFromAction`), nested by its `menuPath`. The title is the action's name and the params are the defaults. It is not run.
  - A preset makes a root `ActionResult` tab (`createFromPreset`), nested by its `menuPath`. The title is the preset's name, and the params keep `presetId`. It is not run.
  - `presetTabParams` (`features/presets`) builds the params: the action's defaults, then the preset's `params`, then its fixed values. Each From row input still unset goes in `state.pivotMissing`; the query parameters become the `parameters` value, with From row ones left needed.
  - A filter shows All (with the actions), Mine, Others' or Hidden presets (`NewMenuFilter`). "Mine" shows the presets whose `owned` is true; the server sets it for the caller.
  - `entryCaption` gives the line under a preset: "Bookmark · owner" when every input is fixed, or "<action> · pivot on <columns> · asks for <params>".
  - `PresetMoreMenu` is a preset's ⋯: Open, Copy as action file (when the action's `actionFile` is true; it copies the YAML of `GET /api/presets/{presetId}/actionFile` to the clipboard), Edit… (owner; the dialog starts from `presetValues`, the preset's params and fixed values, not the action's defaults), Duplicate, Share with everyone or Make private (owner), Delete… with a confirm (owner), Hide or Unhide (others).
  - `usePresetsStore` (`features/presets`) holds the presets, and the menu refetches them each time it opens. Its calls go through `lib/api/presets.ts`.
  - `SavePresetDialog` (`features/presets`) is opened by Save… in the action tab header, and by Edit….
    - On a tab with a `presetId`, Save… refetches the presets first; if that fails it opens `PresetsLoadErrorDialog`, with Retry, instead.
    - Its fields and its preview show an unset value as a placeholder for the param's type, e.g. `<number>`.
    - The preview lists every param of the action. With query parameters it shows the declare statement (`useDeclareStatement`) before the query, and a line per query parameter. A fixed query parameter's value shows as a Kusto literal: `datetime(…)`, `timespan(…)`, `dynamic(…)`, and the others as typed.
    - After saving on an action tab of Run KQL, the tab takes the declared query parameters: fixed values, and From row ones keep the tab's value for them or are left empty.
    - A Query parameters section adds a parameter (its name suggested from names in the query), picks its type, and makes it Fixed with a value or From row with columns.
- Search: case-insensitive. For actions it matches name, folders and key; for presets, name, folders, action, owner and From columns. It expands the groups.
- The Welcome page's "Get Started" button is a `NewQueryMenu`.

## Code editor (Monaco)

`src/components/CodeEditor` wraps `@monaco-editor/react` around the locally bundled `monaco-editor`, with no CDN. Its `language` is `kusto`, `json` or `plaintext`, and suggestions are on. Its `headerLine` prop adds a greyed line above the first line, a view zone that isn't part of the text.

- `src/lib/monaco`: loads Monaco lazily, with the json language, and `@kusto/monaco-kusto` for `language="kusto"`.
  - Workers come from Vite `?worker` imports, in `environment.ts` and `kusto.worker.ts`.
  - `vite.config.ts` sets `worker.format` to `es`.
- `useCodeEditor()`: returns `onMount`, `getEditor` and `getKustoWorker()`, which `setSchemaFromShowSchema` needs. Models and editors are disposed on unmount.
- Build output: the production build emits `editor.worker`, `json.worker` and `kusto.worker` chunks. The Kusto worker is about 8 MB.
- Pins: `package.json` `overrides` pins `dompurify`, which monaco-editor 0.55 bundles, to `^3.4.15`. `@kusto/monaco-kusto` 15.0.1 peers on `monaco-editor@^0.55`.

## Results grid (`src/features/grid`)

AG Grid Enterprise with the v33+ Theming API (`themeBalham`) and explicit module registration.

- `agGridSetup.ts`: `initAgGrid(config)` registers the modules, and applies `agGridLicenseKey` when present.
  - Without a key, the grid runs as a trial, with a watermark.
  - `ResultsGrid` calls `initAgGridFromConfig()` when it is imported, so the grid works in tests without extra setup.
  - `src/app/main.tsx` must not import AG Grid.
- `ResultsGrid`: takes `rows`. `columnDefs` replaces the columns built from the rows, and `stateKey` keeps per-tab column state (see below).
- `useRowResults(uuid, trigger)`: reads a tab's rows from IndexedDB and reloads them when `trigger`, the tab's `rowDataTrigger`, changes. A tab with no stored rows gives `[]`.
- Columns: the union of all row keys.
- Row id: the row's row number, `row`.
- Extension points:
  - `getContextMenuItems(params)` returns extra items above copy, copy with headers and export, such as pivots and labelling.
    It accepts a list of groups: non-empty groups after the first come after a separator;
  - `onGridReady` exposes the grid api;
  - `toolbarExtra` sits beside the quick filter.
- Built-in features: a side bar with columns and filters (an action tab adds Views), multi filters, row grouping with a `dcount` aggregation, and a status bar.
  - The status bar shows execution time, CPU, memory in MB, and total, filtered and selected counts. An action tab adds "View: name" after the execution stats.
  - `ResultsGrid` takes `sideBar`, `statusPanels`, `context` and `onStateUpdated` for that. `onStateUpdated` is not called while the tab is hidden.
- Per-tab column state: pass `stateKey`, the tab uuid. The state is kept in memory only, in `tabColumnState`.

### Column views of action tabs (`src/features/action-column-views`)

[architecture.md](../docs/architecture.md#column-views) describes the behaviour.

- `columnViewState.ts`: `columnViewStateOf` takes the column and filter sections of a `GridState`. `fitColumnView` fits a column view to a result. `isModified` and `sameColumnView` compare states.
- `useActionColumnView(uuid)`: `ActionResultsGrid` calls it. `start` puts the tab's state, the default view or the built-in view on the grid when it is ready. `keep` stores the grid's state in the tab's `gridState`. The controller (`pick`, `revert`, `current`) reaches the panels through the grid's `context.columnViews`.
- `ColumnViewsToolPanel` is the Views panel, with `SaveColumnViewDialog`, `RenameColumnViewDialog` and `ColumnViewMoreMenu`. `ColumnViewStatusPanel` is the status bar panel. `gridParts.ts` has the side bar and status panel definitions.
- `ranking.ts`: `rankColumnViews` orders the list by how many of the tab's columns a column view matches.
- `savedColumnViewsStore.ts`: the column views from `GET /api/columnViews` (client: `src/lib/api/columnViews.ts`). `defaultViewsStore.ts`: the default views, through `defaultViewsDao`.
- `loadDefaultViews(analyst)`: bootstrap's loader. It drops the default views of presets that are gone.

### Row detail (`src/features/annotate`, `src/features/grid/detailText.ts`)

[architecture.md](../docs/architecture.md#grid-annotating) describes the behaviour.

- `RowDetail.tsx`: the right-hand side panel, 900px wide, capped at 100% of the grid's container. It is positioned absolutely in the grid container, so that hidden tabs hide it. It holds the header, and the band with the `id`, label and tags.
- `RowFields.tsx`: the row's fields, with clamping and a copy button on each value.
- `CommentsAndHistory.tsx`: the comment box, the other analysts' current comments and the `id`'s history, in a section that folds.
- `useRowDetail.tsx`: opens and closes the panel and follows the focused row. `ActionResultsGrid` calls it, with the context menu item and the D key.
- `detailText.ts`: lays out the fields: the run's column order, objects in a YAML-like layout, and the text each copy button copies.
- `ResultsGrid` passes `onCellFocused` and `onCellKeyDown` through, for the panel to follow the row.

## Action tab (`src/features/action-tab`, `src/features/instance`)

The tab that runs an action. How it behaves is in [architecture.md](../docs/architecture.md#the-tab-and-new-menu); this is where the code is.

- `ActionTab.tsx`: the tab, registered for `ActionResult`.
  - It has a header with Save…, Clone and Copy link, and a pills bar with Run, or the running spinner with Cancel.
  - Its inner tabs are "Query" (for a `kql` or `sql` param), "Results · N" and "Run · duration".
  - It picks the inner tab, and shows the previous results during a run.
  - It finds its action in `useInstanceStore` by `params.action`. The param values are plain values, in `params.params`.
- `PillsBar.tsx`: one pill per param except `kql`/`sql`, each edited in a popover.
  - `DatetimeEditor.tsx` (MUI X date pickers with dayjs, in UTC) and `TimespanEditor.tsx` (preset chips, or an amount and a unit) edit those kinds.
  - `paramValues.ts` parses and shows values.
  - On an action tab of Run KQL each query parameter has its own pill, named after it and typed by its type (`dynamic` is a list), in place of a "Query parameters" pill. `queryParameters.ts` holds the types, the pill names and the entries of the `parameters` param.
  - A pill shows the server's reason for a refused param.
  - An Edited chip resets the params to the latest run's, and clears the marks.
- `RunPanel.tsx`: the Run tab: status, start, duration, run id, the tab's error, details, columns and params. `runText.ts` words the status and durations.
- `cloneActionTab.ts`: `cloneActionTab` adds the sibling "Copy of <title>" with the same params.
- `actionRuns.ts`:
  - `runActionTab` starts a run, polls it (every second for 10 s, then every 3 s) and loads its rows.
  - A 422's `params.<name>` error goes to the tab's `paramErrors` when the action declares that param. Otherwise it goes into the "Couldn't start: …" message, as `name: reason`.
  - `cancelActionTab` cancels a run, with `cancelRun` from `lib/api/runs.ts`.
  - `resumeActionRuns` picks runs up again after a reload.
  - `openRunTab` opens a root action tab holding a given run, with its `linkedRow`, and follows the run; see Share links.
- `runRows.ts`: the rows loading in this session, page by page, so the grid fills before the rest arrive. They are written to `row_results` once all have loaded.
- `ActionResultsGrid.tsx`: the grid, keyed by `row`. New pages go in by AG Grid transaction. Its context menu has Copy link as the last group before the grid's Copy, Copy with Headers and Export, after the sinks and Copy column settings.
  - Given `linkedRow`, it focuses that row and opens Row detail on it once the row has arrived, then calls `onLinkedRowShown`.
- `StoredActionResultsGrid` (same file) reads `row_results` instead, after a reload.
- `editorSchema.ts`: `useEditorSchema` loads the schema of the Query editor's `schemaFrom` params, with `getEditorSchema` from `lib/api/connections.ts`.
  - It loads once the editor has mounted, and each param has a value that has stayed unchanged for 400 ms.
  - Schemas are cached per connection and scope. A failure is not cached.
  - A late answer is ignored. A failure goes to the snackbar.
  - It hands `{kind, schema, connection, scope}` to its `onSchema` callback. It does not touch the editor.
- `editorSchemaAdapters.ts`: `applyEditorSchema`, one adapter per schema kind, applied by the Query editor in `ActionTab.tsx`. `kql` calls `setSchemaFromShowSchema`, with the connection name as the cluster.
  - `kql` also gives the Kusto language service the tab's query parameters, as global scalar parameters. `setEditorParameters` gives them again when they change.
  - The page's Kusto editors share one language service. The adapters track the editor that holds it, and `setEditorParameters` leaves it alone while another editor holds it.
  - `claimEditorSchema` makes an editor the holder when it gains focus (`onDidFocusEditorText`). It gives the language service that editor's last loaded schema with its tab's query parameters, or the parameters alone before any schema has loaded. It does nothing for the holder or for a `sql` editor, whose schemas are per model.
- `declareStatement.ts`: `useDeclareStatement` asks `POST /api/actions/{key}/declareStatement` once the query parameters' names and types have stayed unchanged for 400 ms. The Query editor shows the result above its first line, and the Save dialog's preview before the query.
- `actionColumns.ts`: the grid's columns. Declared settings become `initial*` settings, and declared `calculated` columns become `calculatedExpression` columns. A `bigint` column gets cell data type `bigint`.
- `roundedColumns.ts` finds the `number` columns with a whole number beyond ±(2^53 − 1). `NumberHeader.tsx` is their header, with the warning icon.
- Tests pass `onRun` to `ActionTab` instead of running.

## Share links (`src/features/share-links`)

A share link opens a run; see the glossary entry for Share link.

- `shareLink(runId, row?)`: makes `<origin><path>#/runs/<runId>`, with `?row=<n>` for a row. `rowParam` reads the `row` value, or `null` unless it is a row number.
- `copyShareLink(runId, row, notify)`: copies the link and says "Copied a link to this result" or "Copied a link to this row". A failed copy says "Couldn't copy the link".
- The action tab's header Copy link button is disabled before the tab has a run. The row context menu's Copy link is its last group of items.
- `ShareLinkPage`: routed at `#/runs/:runId`. It waits until the tabs are loaded. It reads the run with `getRun`, and a succeeded run with rows also its first rows page.
  - A `404` or `410` shows only "This result is no longer available".
  - Otherwise `openRunTab` opens an action tab holding the run, and the URL is replaced with `#/view/<uuid>`.
  - For an action the instance doesn't know, the rows still show and Run is disabled.
