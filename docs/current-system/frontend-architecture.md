# Frontend architecture (legacy Vue 2)

> **Archive.** This document describes the legacy system (Vue 2 + .NET 6), which was removed from the repo in P5-12. Paths and `file:line` citations refer to commit `8a2ff2e` (`git show 8a2ff2e:<path>`). Kept for reference; not maintained.

> Source: `frontend/src/`. Stack: Vue 2.7, Vuetify 2.6 (MDI icons), Vuex 3, vue-router 3 (**hash mode**), ag-grid 29 via `ag-grid-vue` (**Enterprise features used**), Monaco 0.35 + `@kusto/monaco-kusto` (loaded at runtime from `public/monaco-editor`), axios, `@azure/msal-browser` v2, localforage (IndexedDB), Handlebars, js-yaml. Build: Vite 3 + `vite-plugin-vue2`.
> Versions at HEAD `a51eea0`: frontend 1.5.6, backend 3.0.4, core 3.0.7.

See [frontend-components.md](frontend-components.md) for per-component detail, [workflows.md](workflows.md) for end-to-end flows.

## Bootstrap
1. `index.html` loads `/config.js` synchronously → `window.appConfig` (generated in Docker from env).
2. `main.js` mounts Vue with vuetify/router/store. `/* LICENSE … */` comments are uncommented by the enterprise Docker build (`sed`) to import `ag-grid-enterprise` + set licence key.
3. `App.vue` `mounted` → `runSetup()`: `auth.login()` (MSAL popup) → `queries/loadQueries` → `columnViews/loadAllColumnViews` → `loaded=true` → renders `<router-view>` + `<SideQueryTree>`.
4. `SideQueryTree.mounted` → `displayComponent/loadAllDisplayComponents` (IndexedDB).

## Routes (`router/index.js`, hash mode, lazy-loaded, no catch-all)
| Path | View | Notes |
|---|---|---|
| `/` | Welcome | "Get Started" = NewQueryButton |
| `/queries/` | QueryEditor ("Query Manager") | template CRUD |
| `/view/:uuid` | OpenTriage | hosts one display component |
| `/share/:uuid?p=<base64 JSON>&execute=0\|1` | ShareQuery | uuid = **template** uuid |
| `/exportimport/` | ExportImport | |

## Core concept: display components (investigation "tabs")
A display component = one query tab, persisted in IndexedDB, forming a **tree** (pivot ⇒ child).
```js
{ componentUuid, componentName: 'KustoQueryResult' | 'TemplateQueryResult',
  parentUuid: uuid|null, title, params, state,
  rowDataTrigger: null | Date.now(),   // bump ⇒ grid reloads rows from IndexedDB
  displayComponentIndex: int,          // ordering; parents before children
  children: [] }                       // memory only
```
- `KustoQueryResult` params `{query, cluster, database}`; state `{isVisited, error, rowCount, isExecuting, executionTime, cpuUsage, memoryUsage}`.
- `TemplateQueryResult` params `{inParams: {name: value}, queryTemplate: <full template snapshot>}`; state adds `editQuery` (persisted). Template is **snapshotted** — later server edits don't propagate.
- Row results stored separately in IndexedDB `row_results[uuid]`.

## Vuex store (`store/`, 3 namespaced modules; strict mode is **always on** — bug)
### `displayComponent`
- State `{displayComponents: {[uuid]: Node}, rootDisplayComponents: Node[], displayComponentIndex}`.
- Actions: `createDisplayComponent` (new uuid, emits `new:display-component`, saves), `updateComponentState/Params/Title` (shallow merge + save), `convertDisplayComponent`, `triggerComponentRowData`, `saveDisplayComponent` (strips children), `removeDisplayComponent`/`removeAllDisplayComponents` (also deletes row_results; **doesn't remove descendants** → orphans reappear as roots), `loadAllDisplayComponents` (sort by index, rehydrate `QueryTemplate`), `exportDisplayComponents` (raw array, no rows), `importDisplayComponents` (writes IndexedDB only; needs refresh).
- Getters: `isComponent`, `getComponentParams/Title/RowDataTrigger/ParentUuid/Name/State`, `getRootDisplayComponents`, `getParentDisplayComponent`.
### `queries`
- State `{templates: QueryTemplate[], queryOptions: {[uuid]: {hide?}}, queryPromise}`.
- `getQueries(reload)` memoises `queryRetrieve()` (rejected promise stays cached). `loadQueries` drops `isDeleted`, wraps in `QueryTemplate`, loads `query_options`.
- Getters: `getQueryTemplates` (queryType `query` → grid context-menu pivots), `getViewTemplates` (`view`, sorted by menu → New menu), `getTemplate`, `getQueryOption`.
- `updateQueryOption` persists `{hide}` — honoured in menus but **no UI sets it**.
### `columnViews`
- `{columnViews: {[uuid]: {uuid, name, columnState}}}` — AG Grid column state, **global** (not per template). Add/update/remove/loadAll.

## Browser persistence (localforage, IndexedDB DB name `localforage`)
| store | key | value |
|---|---|---|
| `display_components` | component uuid | node without children |
| `row_results` | component uuid | row array |
| `column_views` | view uuid | `{uuid,name,columnState}` |
| `query_options` | template uuid | `{hide}` |
MSAL token cache in `localStorage`. No versioning/migrations.

## Event bus (`helpers/eventBus.js`, bare Vue instance; listeners never `$off` → leaks)
| Event | Payload | Emitter → Listener |
|---|---|---|
| `show:snackbar` | `{message, color?='accent', icon?='mdi-information', timeout?=5000, link?, linkText?}` | many → DefaultSnackbar (FIFO queue) |
| `new:display-component` | `{uuid}` | store → SideQueryTree (expand parent) |
| `update:kusto-results` | `{uuid}` | runNewQuery → SideQueryTree (mark visited) |
| `show:detail-side-panel` / `update:detail-side-panel` | row data | KustoPivot → OpenTriage |
| `create:tag-event-dialog` | `{events, onSuccess}` | KustoPivot → TagEventDialog |
| `create:suppression-dialog` | – | nobody → SuppressionDialog (dead) |

## Auth (`helpers/auth.js`)
- MSAL `PublicClientApplication`, authority `https://login.microsoftonline.com/<tenant>`, cache localStorage.
- Login: `loginPopup({scopes:['<clientId>/.default'], prompt:'select_account'})`. **Popup only**; `handleRedirectPromise` never called ⇒ prompts every load.
- API token: `api://<clientId>/user_impersonation` (same app reg for SPA + API). `getKustoToken` (help.kusto scope) is **dead** — all Kusto goes via backend OBO.
- `getToken`: silent → popup fallback; "singleton" promise lock is buggy (waiters can open multiple popups).
- Logout: `logoutRedirect` with `onRedirectNavigate: () => false` (clears cache, no navigation).
- Unauthenticated: calls go out as `Bearer null` → 401; no global handling. If first sign-in fails, later sign-in never re-runs `runSetup` → stuck on "Authenticating…".

## API client (`helpers/apiClient.js`)
All calls `Authorization: Bearer <api token>`, base `${apiEndpoint}api/...` (apiEndpoint must end with `/` or be empty). No interceptors/retries/timeouts. Full endpoint table in [backend-api.md](backend-api.md). Client supplies `requestedBy` / `createdBy` / `dateTimeUtc`. `createSuppression` returns `'TODO'`; `queryRetrieveById` unused.

## Query execution & polling (`helpers/queries.js`, `helpers/displayComponent.js`)
- `formatCluster`: appends `.kusto.windows.net` if missing, prepends `https://` (breaks non-public-cloud clusters). Schema load passes the **unformatted** cluster.
- `runKustoQueryPoll`: POST → 200 ⇒ result; 202 ⇒ poll `GET /api/kusto/query/{id}`: start 500 ms, doubles every 3 polls, cap 30 s, max 11 min, then returns `null` (→ TypeError downstream). 400 ⇒ throws `response.data.detail`.
- `handleResult`: `completed` → `{queryInfo: executionMetrics, data: resultData}`; `error` → throws `mainError`; else "Unexpected status".
- `runNewQuery`: set executing → poll → store `executionTime = execution_time`, `cpuUsage = resource_usage.cpu['total cpu']`, `memoryUsage = resource_usage.memory.peak_per_node`, `rowCount`; save rows to IndexedDB; emit `update:kusto-results`; `triggerComponentRowData`. On error stores raw error in state, deletes rows.
- **Time range only for ad-hoc queries** (`startTime/endTime` body fields → Kusto query parameters). Template queries get none.

## Query templates (`helpers/kustoQueries.js` — `QueryTemplate` class)
Template shape: see [data-models.md](data-models.md#querytemplate).
- `getDefaultParams()` → `{k: default || ''}` (falsy defaults become `''` — inconsistent).
- `buildParams(row, selectedRows)` (pivot): start from defaults; for each field: `multiple` → `selectedRows.map(r => r[from])` non-empty; `match` → `[{column, value}]` for row columns matching `regex`; else `row[fieldName] ?? ''`.
- `isDataComplete(params)`: multiple ⇒ length>0; match ⇒ exactly 1; else non-empty. Decides auto-run vs edit mode for pivots.
- `buildSummary/buildCluster/buildQuery`: `Handlebars.compile(str, {noEscape:true})(params)` → **KQL injection surface**.
- Global Handlebars partial `{{> getTagEvents}}`: KQL `let getTagEvents=(T:(EventId:string)){…}` left-joining `SavedEvent`/`EventTag`/`EventComment` from `cluster(tagCluster).database(tagDatabase)` with latest-wins `arg_max`, producing a `TagEvent` dynamic column `{IsSaved, Tags[], Determination, Comment, Comments[]}`.
- Helper `{{array X}}` → `@'a',@'b'` (no quote escaping).
- `validateData` unused.

## Grid (`components/grids/KustoPivot.vue`) — summary
No type inference. Columns: checkbox col → template `columns` overrides (except `default`) → every key of `rowData[0]` with `columns.default` → hidden `TagEvent.Tags/Comment/Determination`. Default col: `agMultiColumnFilter` (text/number/date/set), editable (popup large-text), row-groupable. Custom agg `dcount`. Row id `_id` = `row[columnId||'EventId']` (fallback `row-index-N`). Row colour by `TagEvent.Determination` (malicious `#fbbbb9`, suspicious `#ffecae`, benign `#d4f3cd`). Status bar: execution stats + total/filtered/selected. Side bar: columns + filters. Enterprise-only: context menu, set/multi filter, side bar, status bar, row grouping, range selection, aggregation, export. Details in components doc.

## Monaco / Kusto language
- `package.json` `prepublish` copies `monaco-editor` and `@kusto/monaco-kusto/release/min` into `public/monaco-editor` (gitignored).
- `loadMonacoKusto.js` (from Grafana PR 33528): injects `bridge.min.js`, then `kusto.javascript.client.min.js`, `newtonsoft.json.min.js`, `Kusto.Language.Bridge.min.js`, then AMD `require(['vs/language/kusto/monaco.contribution'])`.
- Schema: `POST /api/kusto/schema` → `JSON.parse(data[0].ClusterSchema)` → `worker.setSchemaFromShowSchema(schema, cluster, database)`. Watchers not immediate (no schema on initial load), no caching/error handling.

## Runtime config (`helpers/runtimeConfig.js`)
`window.appConfig` shallow-overrides `import.meta.env`:
| Key | Env | Default |
|---|---|---|
| `auth.clientId` / `auth.authority` | `VITE_AUTH_CLIENT_ID`, `VITE_AUTH_TENANT_ID` | – |
| `redirectUri` | `VITE_AUTH_REDIRECT` | – |
| `apiEndpoint` | `VITE_API_ENDPOINT` | – |
| `agGridLicenseKey` | `VITE_AGGRID_LICENSE_KEY` (`.env.example` misspells LICENCE) | – |
| `wikiUri` / `issueUri` | `VITE_HELP_WIKI_URI` / `VITE_HELP_ISSUE_URI` | GitHub URLs |
| `nodeEnv` | `NODE_ENV` (never exposed by Vite → always `'production'`) | |
| `tagCluster` / `tagDatabase` | `TAG_CLUSTER` / `TAG_DATABASE` (not `VITE_`-prefixed → undefined in dev) | – / `Research` |
| `defaultClusters` | – | `[{name:'Example', clusters:['https://help.kusto.windows.net'], databases:['Samples']}]` |

## Tests
One stale spec `tests/unit/components/TemplateQueryResult.spec.js` (11 cases for param widgets); can't run (jest preset not installed, no test script, component props changed). CI runs lint only.
