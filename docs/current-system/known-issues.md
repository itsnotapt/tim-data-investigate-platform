# Known legacy issues

> **Archive.** This document describes the legacy system (Vue 2 + .NET 6), which was removed from the repo in P5-12. Paths and `file:line` citations refer to commit `8a2ff2e` (`git show 8a2ff2e:<path>`). Kept for reference; not maintained.

Bugs, security issues, and dead code found in the legacy app. **Do not reproduce these in the rewrite** (RULES §4). Reference them by ID (`BUG-xx`, `SEC-xx`) in tasks and PRs.

## Security
| ID | Issue | Where |
|---|---|---|
| SEC-01 | `/api/kusto/query` skips cluster https/URL validation → backend sends user OBO token to any client-supplied URL | `backend/Tim.Backend/Models/KustoQuery/KustoQuery.cs:46` |
| SEC-02 | Query runs have no owner check; any user can GET any `queryRunId` | `KustoExternalController.cs:99-109` |
| SEC-03 | `createdBy` / `requestedBy` / `dateTimeUtc` trusted from client; ingestion runs as app identity | `TaggedEventExternalController.cs`, `apiClient.js` |
| SEC-04 | .NET stack traces returned in `stackTrace` | `DelayedQueryRunner.cs` |
| SEC-05 | CORS allows any origin | `Startup.cs` |
| SEC-06 | Handlebars `noEscape` + `array` helper without quote escaping → KQL injection; share links let others craft params (run as the victim when `execute=1`) | `helpers/kustoQueries.js:40-41`, `views/ShareQuery.vue` |
| SEC-07 | Legacy `/api/user/authenticate` issues tokens nothing accepts; app requires its secrets to boot | `AuthenticateExternalController.cs`, `AuthConfiguration.cs` |

## Backend bugs
| ID | Issue |
|---|---|
| BUG-01 | Inconsistent run retention: Couchbase TTL cleared on completion; Redis ignores TTL; Mongo relies on index |
| BUG-02 | Runs stuck in `created` forever on restart/oversize result; `timedOut` never set; no query timeout |
| BUG-03 | DELETE missing template → 500 (null ref) |
| BUG-04 | POST/PUT templates return 200 empty (declared 204); auth validation throws → 500 |
| BUG-05 | `includeDeleted` omitted ⇒ deleted templates included |
| BUG-06 | PUT is blind upsert (creates; trusts `createdBy`/`isDeleted`); PATCH not re-validated |
| BUG-07 | Redis list uses `KEYS` on every server (duplicates with replicas) |
| BUG-08 | Mongo filter on unmapped computed `Id` — unverified |
| BUG-09 | OBO scope hard-coded to `https://help.kusto.windows.net/.default`; new MSAL app per request (no cache) |
| BUG-10 | Helm env var names don't match code (`backend/helm`); frontend helm passes no env (entrypoint fails); ingress strips `/api` |

## Frontend bugs
| ID | Issue | Where |
|---|---|---|
| BUG-20 | Hard refresh of `/view/:uuid` likely redirects to `/` (OpenTriage checks before tree loads IndexedDB) | `views/OpenTriage.vue:61-68`, `SideQueryTree.vue:168` |
| BUG-21 | Side tree doesn't highlight active tab on first load | `SideQueryTree.vue:148-154` |
| BUG-22 | First sign-in failure → later sign-in stuck on "Authenticating…" | `App.vue:192-233` |
| BUG-23 | MSAL prompts every load (`handleRedirectPromise`/initial `handleResponse` never called); token lock can open multiple popups | `helpers/auth.js` |
| BUG-24 | Restore button disabled check uses delete count | `views/QueryEditor.vue:49` |
| BUG-25 | Customise-tag `onSuccess` re-applies old rows → grid not updated | `grids/KustoPivot.vue:426-429` |
| BUG-26 | TagEventDialog closes on error; `getDetermination(undefined).toLowerCase()` throws | `TagEventDialog.vue:598` |
| BUG-27 | `loadRowData` throws when no stored rows (after every query error) | `KustoPivot.vue:363-365` |
| BUG-28 | Schema not loaded for initial cluster/db; races editor init; `JSON.parse(undefined)`; cluster not formatted | `KustoMonacoEditor.vue` |
| BUG-29 | `formatCluster` forces `.kusto.windows.net` (breaks other clouds/Fabric) | `helpers/queries.js:3-12` |
| BUG-30 | Poll timeout returns `null` → TypeError; `queryRunId === null` check never fires; no cancellation | `helpers/queries.js` |
| BUG-31 | Share link `btoa`/`atob` not Unicode-safe | `TemplateQueryResult.vue`, `ShareQuery.vue` |
| BUG-32 | Removing a tab doesn't remove descendants → orphans reappear as roots | `store/modules/displayComponent.js` |
| BUG-33 | Vuex strict always on (`nodeEnv` string); `TAG_CLUSTER`/`TAG_DATABASE` not `VITE_` prefixed | `store/index.js`, `runtimeConfig.js:14-15` |
| BUG-34 | `getDefaultParams` turns falsy defaults into `''` (≠ `buildParams`) | `kustoQueries.js` |
| BUG-35 | `templateQueriesAsObject` keys by segment name (submenu collisions) | `helpers/displayComponent.js:125-143` |
| BUG-36 | Grid columns derived only from `rowData[0]` | `KustoPivot.vue:557-594` |
| BUG-37 | Event bus listeners never removed; Monaco never disposed; 100 ms interval forever | various |
| BUG-38 | Raw error objects stored in Vuex/IndexedDB | `displayComponent.js` |
| BUG-39 | Invalid custom time period accepted (NaN) | `TimeSelection.vue:327-333` |
| BUG-40 | `err.response.data.error` wrong shape / crashes on network error | `CreateQueryDialog.vue:318` |
| BUG-41 | Cosmetic: QueryHelper stray `}` + `GetTagEvents` case; ColumnView "Are you should you"; DetailSidePanel invisible close icon; `issueUri` `'ttps://'` typo; `.env.example` LICENCE vs LICENSE; `isEmptyValue` `=== []` | various |
| BUG-42 | Every column editable but only `TagEvent.Comment` persisted | `KustoPivot.vue` |
| BUG-43 | Community Docker build silently loses context menu/sidebar (Enterprise features) | `frontend/Dockerfile` |

## Dead code (don't port)
Backend: `SwaggerRequestHeader*`, `RedisKeyGenerator`, `IEnvironmentInfo`, `TryGetHeaderValueWithDefault`, `DeleteItemAsync`, Polly policies, `AddHttpClient`, `KUSTO_INGEST_URL`, `QueryRunStatus.TimedOut`, many NuGet refs, empty test project.
Frontend: `SuppressionDialog`, `DetailCellRenderer`, `createSuppression`, `retrieveRecentTags`, `queryRetrieveById`, `getKustoToken`, `validateData`, `queries` add/update/removeQuery, `onClickNewQuery/onClickNewView` (×4), QueryEditor `onHideQuery/isQueryHidden`, `.ag-grade-*` CSS, `vue.config.js`, deps `monaco-yaml`, `vue-class-component`, `vue-property-decorator`, `ms`, stale unit test.
