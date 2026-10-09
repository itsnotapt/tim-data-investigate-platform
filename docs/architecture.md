# Architecture

TIM is a Kusto investigation platform. Analysts run KQL against Azure Data Explorer (Kusto) clusters, pivot from result rows into other queries through shared query templates, and tag or comment on events. An investigation is a tree of tabs: each pivot creates a child tab.

| Part | Location | Stack |
|---|---|---|
| Web | `web/` | React SPA served by nginx |
| API | `api/` | Python 3.12, FastAPI |
| Persistence | PostgreSQL | templates and query runs ([ADR-0004](adr/0004-postgresql-persistence.md)) |

Layout rationale: [ADR-0001](adr/0001-react-python-web-api.md). Domain vocabulary: [GLOSSARY.md](../GLOSSARY.md). Configuration variables: [configuration.md](configuration.md). HTTP reference: [api.md](api.md).

## System overview

```
 Browser (SPA, hash routes)
 +------------------------------+   MSAL popup    +------------------------+
 | React, MUI, AG Grid, Monaco  |---------------->| Entra ID               |
 | Handlebars template engine   |  token for      | (one app registration  |
 | IndexedDB "tim"              |  api://<client> |  for SPA and API)      |
 +--------------+---------------+                 +-----------^------------+
                | /api/*  (same origin)                       | OBO exchange
                v                                             |
 +------------------------------+     +-----------------------+------------+
 | web container (nginx)        |---->| api container (FastAPI)            |
 | static files, /config.js,    |     |  templates, query runs, tag ingest |
 | security headers, /api proxy |     +---+-------------+-----------+------+
 +------------------------------+         |             |           |
                                          v             |           |
                              +--------------------+    |           |
                              | PostgreSQL         |    |           |
                              | query_templates    |    |           |
                              | query_runs         |    |           |
                              +--------------------+    |           |
                      user token (OBO)  +---------------+           | app identity
                                        v                           v
                         +-------------------------+   +---------------------------+
                         | Kusto clusters the user |   | Tag cluster / database    |
                         | queries                 |   | SavedEvent, EventTag,     |
                         +-------------------------+   | EventComment              |
                                                       +-------------^-------------+
                                      read back inside the user's own query
                                      by the {{> getTagEvents}} partial (runs as the user)
```

Key points:

- Investigation state (tabs, cached result rows, column views) lives only in the browser. The API never receives it.
- Templates are rendered to KQL in the browser. The API receives the final KQL text.
- Queries run on the API: it exchanges the caller's token for a Kusto token (OBO), executes the query and stores the result as a query run that the SPA polls.
- Tag data is written through the API (app identity) and read back with KQL, inside the user's own queries.

## Web architecture

### Stack

React 19, TypeScript (strict), Vite, react-router (hash routes), zustand stores, MUI 9, AG Grid 36 Enterprise ([ADR-0006](adr/0006-ag-grid-enterprise.md)), Monaco with `@kusto/monaco-kusto`, Handlebars (KQL templates), js-yaml (template editor), `idb` (IndexedDB), `@azure/msal-browser` / `@azure/msal-react`.

### Source layout

| Path | Contents |
|---|---|
| `web/src/app/` | Entry (`main.tsx`), router, app shell, auth gate, bootstrap, theme |
| `web/src/components/` | Shared UI: code editor, cluster select, time range picker, dialogs, snackbar |
| `web/src/features/` | One folder per feature: `tabs`, `tree`, `kusto-query`, `template-query`, `templates`, `templates-admin`, `new-query`, `pivots`, `grid`, `column-views`, `tagging`, `share`, `export-import` |
| `web/src/lib/api/` | Typed API client, problem handling, query-run polling; `schema.d.ts` is generated |
| `web/src/lib/auth/` | MSAL client, auth provider, redirect bridge |
| `web/src/lib/config/` | Runtime config loader |
| `web/src/lib/kql-templates/` | Template engine, escaping, param building, `getTagEvents` partial |
| `web/src/lib/storage/` | IndexedDB database and DAOs |
| `web/src/lib/monaco/`, `time-range/` | Editor setup, time range model |
| `web/src/lib/isEmpty.ts` | `isEmpty`: true for `''`, `undefined`, `null`, empty arrays and empty plain objects |
| `web/src/lib/uuid.ts` | `generateUuid` (v4 UUID via `crypto.randomUUID`) |
| `web/src/test/` | Unit-test helpers: MSW server and handlers, bootstrap stub, tabs store utilities |
| `web/e2e/` | Playwright e2e tests: `flows/` specs, `mocks/` (api and editor mocks), fixtures, screenshot helper |

Features import `lib/*` and `components/*`. Eight features (`new-query`, `tree`, `templates`, `tagging`, `tabs`, `pivots`, `grid`, `column-views`) have a public `index.ts`, and most imports between features go through it. About twenty imports reach into another feature's modules directly, for example `tabs/tabStore`, `tabs/types`, `tabs/tabRegistry`, `kusto-query/runPipeline`, `template-query/runTemplateQuery`, `share/shareLink` and `grid/rowUpdates`. Code outside `features/grid` imports `features/grid/rowUpdates` directly, and code loaded at startup imports `lib/kql-templates/params` directly, because those `index.ts` files pull in AG Grid and Handlebars (see Bundle). `app/lazyPages.ts` imports the page components of `templates-admin`, `tabs`, `share` and `export-import` directly.

### Routes

Hash routes; unknown hashes redirect to `#/`. Pages are lazy-loaded.

| Route | Page |
|---|---|
| `#/` | Welcome |
| `#/queries` | Query Manager (template administration) |
| `#/view/:uuid` | A tab (`uuid` is the tab's component uuid) |
| `#/share/:uuid?p=<base64url params>&execute=0\|1` | Opens a template with params from the link; `execute=1` runs it |
| `#/exportimport` | Export and import of the investigation as JSON; template tabs are exported without the template's `name`, `isDeleted`, `isManaged`, `createdBy`, `updatedBy` and `updated` |

### Bundle

The startup bundle (`index.html`'s script and module preloads) holds React, MUI, MSAL, react-router, zod and the app shell. Everything else loads on demand:
- Pages are lazy (`web/src/app/lazyPages.ts`).
- AG Grid loads with the first results grid. `features/grid/ResultsGrid.tsx` registers the modules listed in `features/grid/agGridSetup.ts` and applies the licence key; `vite.config.ts` puts AG Grid in its own `ag-grid` chunk. A grid feature whose module is not registered logs AG Grid console error #200, and the e2e fixture fails on AG Grid console errors.
- Monaco, `@kusto/monaco-kusto` and their workers load when the first editor mounts (`web/src/lib/monaco/loader.ts`).
- Handlebars and js-yaml load with the pages that use them.

### State and tab model

- `tabStore` (zustand) holds `tabs` by uuid and an ordered uuid list (parents precede children). `children` is derived by selectors, never stored. Changes are written to IndexedDB through a debounced, serialised queue.
- Removing a tab removes its whole subtree and the row results of every removed tab.
- Visited tabs stay mounted up to a cap of 100 (least recently visited are evicted).
- `templatesStore` caches the template list from the API plus local query options. `columnViewsStore` holds column views.
- Each tab stores a snapshot of its template, so later template edits do not change existing tabs.

### Data flow: run, poll, pivot, tag

1. Run. A tab calls `runQuery` (`lib/api`): `POST /api/kusto/query` with cluster, database and query. Kusto tabs also send `startTime`/`endTime` from their time range. Template tabs render cluster, database and query with the template engine first and send no time range; the template's KQL does its own time filtering ([ADR-0015](adr/0015-kql-templating.md)). One run per tab; starting a new run aborts the previous one, and removing the tab aborts it.
2. Poll. A `200` response is final. On `202` the client polls `GET /api/kusto/query/{id}`, starting at 500 ms and doubling every three polls up to 30 s, and gives up after 11 minutes. `completed` returns rows and stats; `error` and `timedOut` become errors on the tab.
3. Store. Rows go to IndexedDB `row_results` (keyed by tab uuid); the tab state records row count and execution stats; the grid reloads rows from IndexedDB.
4. Pivot. A context-menu pivot builds params from the clicked or selected rows (`fields`), creates a child template tab with a template snapshot and runs it when the data is complete.
5. Tag. The tagging dialog posts to `/api/taggedevents/savedEvents`, `/tags` and `/comments` in batches of at most 1000 items. The next run of a query using `{{> getTagEvents}}` returns the updated `TagEvent` column.

### IndexedDB

Database `tim` (version 1):

| Store | Key | Value |
|---|---|---|
| `display_components` | `componentUuid` | Tab: name (`KustoQueryResult` or `TemplateQueryResult`), title, `parentUuid`, `rowDataTrigger`, `displayComponentIndex`, state, params |
| `row_results` | tab uuid (out-of-line) | Array of raw result rows |
| `column_views` | `uuid` | `{uuid, name, columnState}` (AG Grid column state) |
| `query_options` | template uuid (out-of-line) | `{hide?, ...}` |

### Template engine

`lib/kql-templates` creates an isolated Handlebars environment with HTML escaping off (the output is KQL). Literal helpers do the escaping: `{{array xs}}` (verbatim string list), `{{str x}}` (one verbatim `@'...'` literal), `{{kql x}}` (one escaped `'...'` literal). A plain `{{x}}` is substituted unchanged. The partial `{{> getTagEvents}}` is built from the configured tag cluster and database (see [Kusto tables](#kusto-tables)).

### Templates in the SPA

`templatesStore` holds the shared templates (`QueryTemplate`, fields in [api.md](api.md#querytemplate)) and the browser-only query options.

- `queryType` places a template: the New menu lists `view` templates in its Views submenu and `query` templates in its Queries submenu, following each template's `path`; `query` templates, which require `fields`, are also the pivots in the grid's context menu.
- `params` entries are filled in a form. `type` is a string by default, `array` (choices in `values`) or boolean; an entry may set `default`, `optional`, `multiple` and `hint`.
- `fields` entries are filled from grid rows when pivoting: `type: multiple` takes the `from` column across the selected rows, `type: match` takes the columns whose name matches `regex`, and any other type copies the clicked row's value.
- `isManaged: true` makes a template read-only in the Query Manager.
- Query options are per template in IndexedDB `query_options`; `hide` leaves the template out of the menus.

### Runtime configuration

`index.html` loads `/config.js`, which sets `window.appConfig`. The web container renders it at start from environment variables (`docker-entrypoint.sh`); `web/public/config.js` is the development version. Values are validated at load; an invalid or missing key shows a configuration error page.

| Key | Meaning |
|---|---|
| `auth.clientId`, `auth.authority` | Entra app registration and authority (`https://login.microsoftonline.com/<tenant>`) |
| `redirectUri` | MSAL redirect page (`/blank.html`) |
| `apiEndpoint` | API origin; empty means same origin |
| `agGridLicenseKey` | AG Grid Enterprise key; empty runs in trial mode |
| `tagCluster`, `tagDatabase` | Tag tables location (database default `Research`) |
| `defaultClusters` | Cluster and database groups offered in the UI |
| `wikiUri`, `issueUri` | Help links |

`/config.js` and `index.html` are served uncached; hashed assets under `/assets/` are cached for a year.

### Authentication

MSAL popup flow with a `localStorage` token cache. The SPA requests the scope `api://<clientId>/user_impersonation` (one app registration serves SPA and API). `/blank.html` is the redirect page; MSAL silent flows load it in a same-origin hidden iframe. Tokens are acquired silently for every API call, with `ssoSilent` or a popup as fallback; a `401` triggers one retry with a fresh token. See [ADR-0005](adr/0005-auth-entra-popup-obo.md). A development stub (`VITE_AUTH_STUB=true`) exists and throws in a production build.

## API architecture

### Stack

Python 3.12, FastAPI on uvicorn, pydantic and pydantic-settings, PyJWT (token validation), `msal` (OBO), `azure-kusto-data` (queries), `azure-kusto-ingest` and `azure-identity` (tag ingestion), SQLAlchemy 2 with asyncpg and Alembic (PostgreSQL), `jsonpatch`.

### Module layout (`api/src/tim_api`)

| Module | Responsibility |
|---|---|
| `main.py` | App factory, lifespan, health routes, middleware order |
| `config.py` | Settings from `TIM_*` environment variables |
| `errors.py` | Problem-details body and exception handlers |
| `deps.py` | FastAPI dependencies returning the storage and its template and query-run stores |
| `models_common.py` | Shared Pydantic building blocks: camelCase `ApiModel`, UTC datetimes, non-blank strings |
| `observability.py` | Trace ids, logging, body-size limit, request logging, CORS |
| `auth/` | Token validation (`jwt.py`), caller resolution (`dependencies.py`), OBO (`obo.py`) |
| `kusto/` | Cluster validation, query client, `POST /api/kusto/schema` |
| `query_runs/` | Query-run routes, models and the run lifecycle (`runner.py`) |
| `templates/` | Template routes and models |
| `tagged_events/` | Tag routes, ingestion client, table schema, `create-tables` CLI |
| `storage/` | Storage interfaces, PostgreSQL and in-memory implementations, retention loop |
| `openapi_meta.py`, `openapi_export.py` | OpenAPI post-processing and spec export |

Database migrations are in `api/migrations` (Alembic).

### Request flow and middleware

Outermost first: `LazyCORSMiddleware` (origins from `TIM_CORS_ALLOWED_ORIGINS`; no CORS headers when empty), `RequestLoggingMiddleware` (assigns the trace id, adds `x-trace-id`, `x-content-type-options: nosniff` and `cache-control: no-store` to every response, logs one line per request), `BodySizeLimitMiddleware` (413 above `TIM_MAX_REQUEST_BYTES`, checked on `Content-Length` and on streamed bytes). Then the route, whose dependencies resolve the caller (`get_current_principal`), settings, storage and clients.

The trace id is a valid W3C `traceparent`, else a sane `x-request-id`, else generated. Logs contain method, path (no query string), status, duration and trace id; headers and bodies are never logged.

### Authentication and OBO

- Bearer tokens are validated against the tenant JWKS (RS256 only, cached for one hour, rate-limited refetch on an unknown `kid`). Checked: signature, `aud` (`api://<clientId>` or the bare client id), `iss` (v1 or v2 issuer of the configured tenant), `tid`, and required `exp`, `nbf`, `iat` with 60 s leeway.
- The caller is a `Principal`: `oid`, `tid`, and a name taken from `unique_name`, then `upn`, then `preferred_username`. The name is the owner and audit identity (`requestedBy`, `createdBy`, `updatedBy`).
- Query and schema calls exchange the caller's token for a Kusto token with `msal.ConfidentialClientApplication.acquire_token_on_behalf_of`, scope `TIM_KUSTO_OBO_SCOPE` (default `{cluster}/.default`). One MSAL app (and token cache) per process; credential is `TIM_AUTH_CLIENT_SECRET` or a federated token file (`AZURE_FEDERATED_TOKEN_FILE`); startup fails with neither (when auth is enabled).
- OBO failures: `invalid_grant` or `interaction_required` gives `403 consent-required` (the SPA prompts again); an Entra or network failure gives `502`; OBO not available (auth disabled, or no token) gives `503`.
- `TIM_AUTH_DISABLED=true` runs every request as a fixed development user and disables OBO. Settings validation fails at startup when it is combined with `TIM_ENVIRONMENT=production` (the default environment).

### Kusto client and cluster validation

`validate_cluster_url` runs before any token exchange and returns the normalised `https://<host>`. The rules are listed in [api.md](api.md#cluster-validation). The allow-list is `TIM_ALLOWED_KUSTO_HOSTS`, a list of host patterns (exact, `*.domain`, `**.domain`; default `**.kusto.windows.net`). A rejected cluster gives `400 cluster-not-allowed`.

`AzureKustoQueryClient` runs the synchronous `azure-kusto-data` client in a worker thread with the user's token. Result values are serialised (datetime, timespan, decimal, dynamic, guid), and every `PrimaryResult` table is concatenated. `StartTime` and `EndTime` are passed as query parameters, so KQL must `declare query_parameters(StartTime:datetime, EndTime:datetime)` to use them. Kusto errors become sanitised messages (stack-trace lines removed, capped at 2000 characters).

### Query-run lifecycle

1. `POST /api/kusto/query` validates the cluster, exchanges the token (auth errors are returned synchronously, before a run exists), and `RunManager` stores a run (`KustoQueryRun`, table `query_runs`) as `created` with `expiresAt = now + TIM_RUN_RETENTION_SECONDS`.
2. A tracked asyncio task executes the query. At most `TIM_MAX_CONCURRENT_RUNS` run at once per process; the rest stay `created`.
3. The request waits up to about 1 second for the task. If it finished, the response is `200` with the terminal run; otherwise `202` with the `created` run.
4. The task always writes a final state and refreshes `expiresAt`: `completed` (rows and `executionMetrics`), `error` (`mainError`; Kusto error, limit exceeded, shutdown, or a generic message for unexpected failures) or `timedOut` (after `TIM_QUERY_TIMEOUT_SECONDS`).
5. `GET /api/kusto/query/{id}` returns `202` while `created` and `200` otherwise. A run that is unknown, expired or owned by another user is `404`.

Limits: `TIM_MAX_RESULT_ROWS` (100000), `TIM_MAX_RESULT_BYTES` (64 MiB), `TIM_QUERY_TIMEOUT_SECONDS` (600), `TIM_RUN_RETENTION_SECONDS` (86400), `TIM_MAX_CONCURRENT_RUNS` (16). A result over a limit fails the run; it is not truncated. NUL characters in results and errors are replaced with U+FFFD before storing.

Housekeeping:

- At startup, runs still `created` for longer than the query timeout are set to `error` (`Run interrupted by server restart`).
- At shutdown, running tasks are cancelled and their runs are marked `error`.
- A background loop deletes runs past `expiresAt` every `TIM_RUN_RETENTION_SWEEP_SECONDS` (300). Expired runs already read as `404` before they are deleted.

### Templates

Stored in PostgreSQL (`query_templates`), shared by all users. The model is `QueryTemplate` in `templates/models.py`: Handlebars KQL (`query`), `summary`, `cluster` and `database` (both may be templated), `params`, `fields`, column overrides (`columns`) and a menu path (`path`). `GET` returns the list (optionally `since` an `updated` timestamp and `includeDeleted`), `POST` creates (`201`, `Location` header), `PUT` replaces the editable fields, `PATCH` applies an RFC 6902 JSON Patch (`add`, `replace`, `remove`, `test`) and re-validates the result, `DELETE` is a soft delete (`isDeleted: true`, idempotent, `204`). `PATCH {"op":"replace","path":"/isDeleted","value":false}` restores a template. `uuid`, `createdBy`, `updatedBy` and `updated` cannot be patched; `updatedBy` and `updated` are set by the server on every write.

### Tagged events

The three `POST /api/taggedevents/*` routes validate a batch (1 to 1000 items), add `createdBy` (from the token) and `dateTimeUtc` (server clock) to every row, and ingest NDJSON through `ManagedStreamingIngestClient` (`azure-kusto-ingest`) using the table's JSON mapping. Ingestion uses the app identity (`DefaultAzureCredential`, configured with the standard `AZURE_*` variables), not the user. The ingest endpoint is `TIM_TAG_INGEST_URL` or `https://ingest-<tag cluster host>`. Failure gives `502`. `TIM_TAG_INGEST_FAKE=true` (development only) swaps in an in-memory recorder.

### Persistence

`storage/` defines `TemplateStore`, `QueryRunStore` and a `Storage` bundle (health, close). `TIM_DATABASE_URL` selects PostgreSQL (`postgresql+asyncpg://`) or, in development only, an in-memory store (`memory://`; refused in production). Alembic migrations create the schema (`alembic upgrade head`).

| Table | Key | Notes |
|---|---|---|
| `query_templates` | `uuid` | Editable fields, `path`/`params`/`fields`/`columns` as JSONB, `is_deleted`, `updated`, `created_by`, `updated_by`; index on `(updated, uuid)` |
| `query_runs` | `query_run_id` | `requested_by` (owner), `status`, `execute_date_time_utc`, `expires_at`, `kusto_query`, `result_data`, `execution_metrics` (JSONB), `main_error`; indexes on owner, expiry, and `created` runs |

### Errors and logging

Every non-2xx response is `application/problem+json` with `type` (`urn:tim:problem:<slug>`), `title`, `status`, `detail`, `traceId` and, for validation, `errors`. Details are fixed, safe strings: no stack traces, SQL, tokens or upstream bodies. Unhandled exceptions are logged with the trace id and returned as a generic `500`. Logging is stdlib logging to stderr at `TIM_LOG_LEVEL`. The API exposes no metrics endpoint. See [api.md](api.md#errors).

## Security model

- Identity comes from the validated token only. `requestedBy`, `createdBy`, `updatedBy`, `updated` and `dateTimeUtc` sent by a client are ignored (the SPA also strips them).
- Query runs are owner-scoped: another user's run id is indistinguishable from an unknown one (`404`).
- Cluster URLs are validated against an allow-list before any token is acquired or sent, so the API cannot be used to forward user tokens to arbitrary hosts.
- Kusto access runs as the user (OBO); only tag ingestion and table creation use the app identity.
- The development auth bypass (`TIM_AUTH_DISABLED`) and the in-memory store fail startup in production. The SPA's auth stub throws in a production build.
- Request bodies are capped: `TIM_MAX_REQUEST_BYTES` on the API (default 16 MiB, `413`), `client_max_body_size 25m` on nginx. Tagged-event batches are limited to 1000 items and each `eventAsJson` to 1,000,000 bytes serialised; queries to 100,000 characters.
- API responses carry `x-content-type-options: nosniff` and `cache-control: no-store`.
- The web container (nginx, port 8080) sends on every response: `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, microphone, geolocation off) and, behind an https proxy, `Strict-Transport-Security`. The CSP allows only same-origin scripts (plus `unsafe-eval`, needed by Handlebars and the Kusto language service), same-origin and `login.microsoftonline.com` for `connect-src`, a cross-origin `API_BASEPATH` origin when set, `frame-ancestors 'self'` and `object-src 'none'`. `server_tokens` is off.
- nginx proxies `/api/` to `BACKEND_URI` unchanged (the `/api` prefix is kept) with a 620 s read timeout. The entrypoint validates every value substituted into `config.js` and the nginx config and escapes `config.js` content.
- Logs never contain tokens, headers, bodies or query strings.

## Kusto tables

Tag data lives in three tables in the tag database of the tag cluster: `TIM_TAG_CLUSTER_URI` and `TIM_TAG_DATABASE` (default `Research`) on the API, `TAG_CLUSTER` and `TAG_DATABASE` on the web container ([configuration.md](configuration.md)). They are append-only; the latest row per key wins when read.

| Table | Columns |
|---|---|
| `SavedEvent` | EventId:string, EventTime:datetime, DateTimeUtc:datetime, CreatedBy:string, EventAsJson:dynamic |
| `EventTag` | EventId:string, DateTimeUtc:datetime, CreatedBy:string, Tag:string, IsDeleted:bool |
| `EventComment` | EventId:string, DateTimeUtc:datetime, CreatedBy:string, Comment:string, Determination:string, IsDeleted:bool |

`EventComment.Determination` is `malicious`, `suspicious` or `benign`; a comment with `removed` and `IsDeleted` clears it. The grid sets a row class per value (`web/src/features/grid/rowClasses.ts`).

The schema is defined in `api/src/tim_api/tagged_events/kusto_schema.py`. Each table has a JSON ingestion mapping (`<Table>Mapping`, column `X` maps from `$.x`) and streaming ingestion enabled.

Create or update the tables, mappings and policies (idempotent, uses the app identity via `DefaultAzureCredential`) from `api/`:

```
uv run python -m tim_api.tagged_events.cli create-tables [--dry-run] [--cluster-uri URI] [--database NAME]
```

`--cluster-uri` and `--database` default to `TIM_TAG_CLUSTER_URI` and `TIM_TAG_DATABASE`; `--dry-run` prints the commands without running them. Any failing command prints an error and exits non-zero.

The SPA reads the data back with the `getTagEvents` partial (`web/src/lib/kql-templates/tagEvents.ts`). A template includes `{{> getTagEvents}}` and calls `getTagEvents(T)` on a table with an `EventId` column. The partial joins, for each `EventId`, the latest `SavedEvent` (`IsSaved`), the non-deleted `EventTag` tags (`Tags`) and the latest non-deleted `EventComment` (`Determination`, `Comment`, plus `Comments`), and packs them into a `TagEvent` column. The query runs as the user, so users need read access to the tag database.

---
