# Architecture

TIM is a Kusto investigation platform. Analysts run KQL against Azure Data Explorer (Kusto) clusters, pivot from result rows into other queries through shared query templates, and tag or comment on events. An investigation is a tree of tabs: each pivot creates a child tab.

| Part | Location | Stack |
|---|---|---|
| Web | `web/` | React SPA served by nginx |
| API | `api/` | Python 3.12, FastAPI |
| Persistence | PostgreSQL | templates, runs and query runs ([ADR-0004](adr/0004-postgresql-persistence.md)) |

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
 | static files, /config.js,    |     |  templates, runs, query runs,      |
 | security headers, /api proxy |     |  tag ingest                        |
 +------------------------------+     +---+-------------+-----------+------+
                                          |             |           |
                                          v             |           |
                              +--------------------+    |           |
                              | PostgreSQL         |    |           |
                              | query_templates    |    |           |
                              | runs, run_rows     |    |           |
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
| `web/src/features/` | One folder per feature: `tabs`, `tree`, `kusto-query`, `template-query`, `action-tab`, `instance`, `templates`, `templates-admin`, `new-query`, `pivots`, `grid`, `column-views`, `tagging`, `share`, `export-import` |
| `web/src/lib/api/` | Typed API client, problem handling, query-run polling, `GET /api/instance` and runs; `schema.d.ts` is generated |
| `web/src/lib/auth/` | MSAL client, auth provider, redirect bridge |
| `web/src/lib/config/` | Runtime config loader |
| `web/src/lib/kql-templates/` | Template engine, escaping, param building, `getTagEvents` partial |
| `web/src/lib/storage/` | IndexedDB database and DAOs |
| `web/src/lib/monaco/`, `time-range/` | Editor setup, time range model |
| `web/src/lib/isEmpty.ts` | `isEmpty`: true for `''`, `undefined`, `null`, empty arrays and empty plain objects |
| `web/src/lib/uuid.ts` | `generateUuid` (v4 UUID via `crypto.randomUUID`) |
| `web/src/test/` | Unit-test helpers: MSW server and handlers, bootstrap stub, tabs store utilities |
| `web/e2e/` | Playwright e2e tests: `flows/` specs, `realApi.ts` (fixtures for flows against a real api), `api_server.py` (that api), `actions/` (its dev action files), `mocks/` and `fixtures.ts` (the mocked flows), screenshot helper |

Features import `lib/*` and `components/*`. Eight features (`new-query`, `tree`, `templates`, `tagging`, `tabs`, `pivots`, `grid`, `column-views`) have a public `index.ts`, and most imports between features go through it. About twenty imports reach into another feature's modules directly, for example `tabs/tabStore`, `tabs/types`, `tabs/tabRegistry`, `kusto-query/runPipeline`, `template-query/runTemplateQuery`, `share/shareLink` and `grid/rowUpdates`. Code outside `features/grid` imports `features/grid/rowUpdates` directly, and code loaded at startup imports `lib/kql-templates/params` directly, because those `index.ts` files pull in AG Grid and Handlebars (see Bundle). `app/lazyPages.ts` imports the page components of `templates-admin`, `tabs`, `share` and `export-import` directly.

### Routes

Hash routes; unknown hashes redirect to `#/`. Pages are lazy-loaded.

| Route | Page |
|---|---|
| `#/` | Welcome |
| `#/queries` | Query Manager (template administration) |
| `#/view/:uuid` | A tab of any kind: Kusto, template or action (`uuid` is the tab's component uuid) |
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
- A tab is one of three kinds, named by `componentName`: `KustoQueryResult`, `TemplateQueryResult` and `ActionResult`. An action tab's params are `{action, params}`: the action's key and the param values as plain values, as the browser sends them. They are never resolved again, so the tab keeps working when the instance's catalogue changes. Its state holds, besides the common fields, `run` (the envelope of the latest run; cleared when a run starts, so `null` until its envelope arrives, and kept if the server refuses only params), `cancelling` (a cancel was asked for and the run has not ended), `paramErrors` (why each param was refused, by name), `runParams` (the plain params the latest run started with), `resultsRunId` (the run whose rows are stored), `resultColumns` (that run's columns) and `resultsStartedAt` (when that run started).
- `instanceStore` holds the instance from `GET /api/instance` (actions, connections, labels, limits). Bootstrap loads it before the templates, and a refetch on every window focus replaces it only when its `version` differs, so a rolling update shows up without a reload. A failed refetch keeps the instance already loaded.

### Data flow: run, poll, pivot, tag

1. Run. A tab calls `runQuery` (`lib/api`): `POST /api/kusto/query` with cluster, database and query. Kusto tabs also send `startTime`/`endTime` from their time range. Template tabs render cluster, database and query with the template engine first and send no time range; the template's KQL does its own time filtering ([ADR-0015](adr/0015-kql-templating.md)). One run per tab; starting a new run aborts the previous one, and removing the tab aborts it.
2. Poll. A `200` response is final. On `202` the client polls `GET /api/kusto/query/{id}`, starting at 500 ms and doubling every three polls up to 30 s, and gives up after 11 minutes. `completed` returns rows and stats; `error` and `timedOut` become errors on the tab.
3. Store. Rows go to IndexedDB `row_results` (keyed by tab uuid); the tab state records row count and execution stats; the grid reloads rows from IndexedDB.
4. Pivot. A context-menu pivot builds params from the clicked or selected rows (`fields`), creates a child template tab with a template snapshot and runs it when the data is complete.
5. Tag. The tagging dialog posts to `/api/taggedevents/savedEvents`, `/tags` and `/comments` in batches of at most 1000 items. The next run of a query using `{{> getTagEvents}}` returns the updated `TagEvent` column.

An action tab runs differently:

1. Run. `runActionTab` sends `POST /api/runs` with the tab's `{action, params}`. A `422` puts each `params.<name>` error in the tab's `paramErrors` for every param the action declares, including the Query editor's `kql` or `sql` param, whose border and caption show it; one for a param the action does not declare joins the tab's error "Couldn't start: …" as `name: reason`, reasons separated by `; `, as does any other start error. When the server refuses only params, the tab keeps its latest `run`; on any other start error `run` stays cleared. The run's envelope goes to the tab's `run` and the tab is saved at once, so a reload finds the run id.
2. Poll. While the run is `running`, `GET /api/runs/{runId}` every second for the first 10 s, then every 3 s. A run that ends in `error`, `timedOut` or `cancelled` becomes the tab's error.
3. Cancel. `cancelActionTab` sends `POST /api/runs/{runId}/cancel` and sets `cancelling`; polling then sees the run end. If the answer is already an ended run, the tab ends at once. A failed cancel shows "Couldn't cancel: …" and clears `cancelling`.
4. Store. For a succeeded run the rows are loaded page by page from `GET /api/runs/{runId}/rows`. Each page is added to the open grid as it arrives, so the analyst can scroll the first rows while the rest load; the tab shows "Results · 20000 of 85000" until they all have. Once every page has loaded, the rows are written to IndexedDB `row_results` as `{row, id, data}` rows, in one write, with the tab's `resultsRunId`, `resultColumns` and row count. A failed or abandoned load shows none of its rows. A tab whose rows are stored needs no API call, so it still shows them after the run has expired on the server.
5. Resume. After a reload, bootstrap calls `resumeActionRuns` once the tabs are loaded: it follows again a run still `running` by its `runId`, and loads the rows of a succeeded run that is not yet stored. A tab marked executing with no run id to follow stops executing.
6. Run gone. A `404` on the run shows "The run is no longer available; run again". A `410` on the rows (results gone) shows "Results are no longer available; run again".

One run is followed per tab: starting another run stops following the previous one.

### IndexedDB

Database `tim` (version 1):

| Store | Key | Value |
|---|---|---|
| `display_components` | `componentUuid` | Tab: name (`KustoQueryResult`, `TemplateQueryResult` or `ActionResult`), title, `parentUuid`, `rowDataTrigger`, `displayComponentIndex`, state, params |
| `row_results` | tab uuid (out-of-line) | Array of raw result rows; for an action tab, `{row, id, data}` rows of its run |
| `column_views` | `uuid` | `{uuid, name, columnState}` (AG Grid column state) |
| `query_options` | template uuid (out-of-line) | `{hide?, ...}` |

### The tab and New menu

The New menu offers an **Actions** group beside Views and Queries. Its folders are each action's `menuPath`; the search matches the action's name, its folders and its key. Choosing an action creates a root action tab, titled with the action's name, whose params are the params' defaults, and takes focus. It does not run.

The action tab has:

- A header: the action's menu path · the action, and the tab's title, with a **Clone** button. Clone adds a sibling tab titled "Copy of <title>" with the same params, not run, and takes focus.
- A pills bar with one pill per param that is not edited in an editor (`kql` and `sql` params are left out). A `connection` param whose type has exactly one connection is filled in when the tab opens from the New menu, and its pill is greyed out. A pill shows the param's title and value, and opens a popover that edits it by kind: a switch for `boolean`; chips for a many-valued param, where pasted text is split on newlines, tabs, commas and semicolons; a pick list for a param with `choices` and for a `connection` param (the instance's connections of the param's `connectionType`); text for `string` and `number`; for `datetime`, a field, calendar and clock in UTC (Kusto's timezone), where pasting an ISO datetime from a result row sets it; for `timespan`, preset chips for common lookbacks (15 minutes to 30 days) and an amount with a unit, stored as an ISO 8601 duration; JSON text for `json`. A many-valued `datetime` or `timespan` param uses chips like any other. **Run** sits at the right of the bar. While the run is going it is replaced by a spinner with the elapsed time (from the run's `startedAt`) and **Cancel**; Cancel is disabled until the run has an id, and the tab says "Cancelling…" until the run ends. A failed cancel shows "Couldn't cancel: …". When the params differ from those the latest run started with (`runParams`), an **Edited** chip shows; clicking it resets them and clears the pill marks. A param the server refused is marked on its pill (error colour, the reason as its description) until the pill is edited. An action that is not in the catalogue shows a warning and cannot be run.
- The inner tab **Query**, for an action with a `kql` or `sql` param: a full-height editor, where Ctrl/Cmd+Enter runs. The `database` param's suggestions are the chosen connection's `databases`. Above the editor a status line shows the latest run: "Succeeded · N rows · duration" with **Show results**, or its error with **Details**, which opens the Run tab ("Couldn't start: …" for an error from the `POST`). A `422` on the query param marks the editor's border and caption.
- The inner tab **Results · N**, with the row count; while rows are loading it shows how many have arrived out of the total ("Results · 20000 of 85000"), and the grid already shows them.
- The inner tab **Run · duration**, the details of the latest run: its status (with an icon; "Succeeded, no rows" for an empty success), start, duration and run id; the tab's error; the run's details in the order the action reported them, where a `warning` key gets a warning icon; the columns (name, type, declared or inferred); and the params the run used.

Results shows by default, and Run when the tab has an error: a run that ended in `error`, `timedOut` or `cancelled`, a start error, or results that are gone. The analyst's choice of inner tab holds until the run changes: a run starts, gets its id or ends. The error is shown only on the Run tab. A tab with a Query tab never switches inner tab by itself: the status line above the editor reports the run, and its buttons switch tabs.

While a run is going the previous results stay, dimmed and marked `aria-busy`, under "Showing the run from <start> UTC". After a failed run the last good results stay under a note: "The last run failed.", "timed out.", "was cancelled." or "could not start.", or "The last run’s results could not be loaded." for a run that succeeded or was running but whose rows or run could not be loaded, then "Showing the run from <start> UTC".

The results grid is AG Grid with its client-side row model, keyed by each row's row number (`row`). The columns are those of the run, with the action's declared `columns` as `initial*` settings, so a restored column state wins over them, and its declared `calculated` columns as AG Grid calculated columns ([actions.md](actions.md#columns)). Analysts can add their own calculated columns from the column menu. A succeeded run with no rows shows "The run succeeded with no rows." instead of a grid. CSV and Excel export are AG Grid's own.

The tree shows an action tab's status like any tab's: a spinner while running, a red alert on error, a row-count badge, and for a succeeded run with no rows a ringed 0 ("Succeeded, no rows").

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

Python 3.12, FastAPI on uvicorn, `tim-actions` (the provider interface, a uv workspace member in `api/tim-actions`), pydantic and pydantic-settings, PyJWT (token validation), `msal` (OBO), `azure-kusto-data` (queries, in the `tim-actions` `kusto` extra), `azure-kusto-ingest` and `azure-identity` (tag ingestion), SQLAlchemy 2 with asyncpg and Alembic (PostgreSQL), `jsonpatch`.

### Module layout (`api/src/tim_api`)

| Module | Responsibility |
|---|---|
| `main.py` | App factory, lifespan (provider loading included), health routes, middleware order |
| `config.py` | Settings from `TIM_*` environment variables |
| `errors.py` | Problem-details body and exception handlers |
| `deps.py` | FastAPI dependencies returning the storage and its template, run and query-run stores |
| `models_common.py` | Shared Pydantic building blocks: camelCase `ApiModel`, UTC datetimes, non-blank strings |
| `observability.py` | Trace ids, logging, body-size limit, request logging, CORS |
| `actions/` | Provider discovery, action-file loading and startup validation (`registry.py`), the instance description (`instance.py`, `models.py`) and `GET /api/instance` (`router.py`) |
| `cli.py` | The `tim-api` command: `schema actions`, `schema connections` and `check` |
| `auth/` | Token validation (`jwt.py`), caller resolution (`dependencies.py`), OBO (`obo.py`) |
| `kusto/` | The Kusto tab's path: cluster validation, query client, `POST /api/kusto/schema` |
| `runs/` | `/api/runs` routes (`router.py`), models, the run lifecycle (`runner.py`), rows, columns and caps (`results.py`), and the connections a run reaches (`connections.py`: the instance's `Connections`, and one run's hooks) |
| `query_runs/` | Kusto query-run routes, models and their lifecycle (`runner.py`) |
| `templates/` | Template routes and models |
| `tagged_events/` | Tag routes, ingestion client, table schema, `create-tables` CLI |
| `storage/` | Storage interfaces, PostgreSQL and in-memory implementations, retention loop |
| `openapi_meta.py`, `openapi_export.py` | OpenAPI post-processing and spec export |

Database migrations are in `api/migrations` (Alembic).

`tim-actions` (`api/tim-actions/src/tim_actions`) is a separate distribution that providers depend on instead of `tim-api` ([ADR-0021](adr/0021-tim-actions-and-derived-images.md)):

| Module | Responsibility |
|---|---|
| `action.py` | `Action`, the base of query action types, with its menu path and pivot columns |
| `params.py` | `Param` and `validate_params`: declaration checks, then validation and conversion of values |
| `columns.py` | `Column` |
| `connections.py` | `Connection`, the base of a connection type's entries in the connections file |
| `connections_file.py` | The connections file: the loader (`load_connections_file`) and the JSON Schema (`connections_file_schema`) |
| `hooks.py` | `Hook`, the base of a connection type's access, with its `Connection` model and `editor`, and `EditorSchema` |
| `run.py` | `RunContext`, the protocol `run` is given, `Analyst` and `RunError` |
| `rows.py` | `RowId`, how a row's `id` is taken from it, and `IdColumns` |
| `provider.py` | `Provider` and the `tim.actions` entry-point group |
| `files.py` | Action files: `ActionDocument`, `Sidecar`, the loader (`load_action_files`) and the JSON Schema (`action_files_schema`) |
| `kusto.py` | The `kusto` connection type (`KustoConnection`, `KustoHook`) and the built-in Run KQL action; needs the `kusto` extra |
| `builtin.py` | TIM's built-in provider |

### Request flow and middleware

Outermost first: `LazyCORSMiddleware` (origins from `TIM_CORS_ALLOWED_ORIGINS`; no CORS headers when empty), `RequestLoggingMiddleware` (assigns the trace id, adds `x-trace-id`, `x-content-type-options: nosniff` and `cache-control: no-store` to every response, logs one line per request), `BodySizeLimitMiddleware` (413 above `TIM_MAX_REQUEST_BYTES`, checked on `Content-Length` and on streamed bytes). Then the route, whose dependencies resolve the caller (`get_current_principal`), settings, storage and clients.

The trace id is a valid W3C `traceparent`, else a sane `x-request-id`, else generated. Logs contain method, path (no query string), status, duration and trace id; headers and bodies are never logged.

### Actions and providers

An **action type** is a Python subclass of `tim_actions.Action` that implements `run`; an **action** is a configured instance of one, with a `key`, `name`, `menu`, `description`, `params`, `pivot`, `columns` and `id` ([ADR-0017](adr/0017-actions-from-providers.md)). Actions come from **providers**: a package exposes a callable that returns `Provider(actions, action_types, hooks)` in the `tim.actions` entry-point group. TIM's built-in provider (`tim_actions.builtin`, in the `tim-actions` distribution) registers the same way. With the `kusto` extra installed it adds the `kusto` connection type and the action **Run KQL** (`tim.run_kql`); without it the provider is empty.

Loading happens once, in the lifespan, before storage is opened. `discover_providers` calls every entry point; `create_app(providers=...)` skips discovery and takes the given providers instead. `build_registry` then indexes actions by key, file-capable action types by `type_name` and hooks by connection type. Any of these stops startup, with every problem listed and each naming its entry point and distribution (`InstanceConfigError`, which prints `Invalid instance:` and the problems):

- an entry point that fails to load, raises, or doesn't return a `Provider`;
- an invalid action. `Action`, `Param` and `Column` are pydantic models that check themselves when they are built, and the registry validates each action again from its fields;
- a key outside lowercase letters, digits, `_`, `-` and `.`, or a `tim.` key from any distribution but `tim-actions`;
- a duplicate action key, `type_name` or connection type;
- a file-capable action type without a `File` model.

The **connections file** and the action files then add problems of their own, below.

**Action files** ([actions.md](actions.md#action-files)) come next, once every provider's action types are indexed, so a file can name an action type from any provider. `build_registry` loads, in this order, each provider's package-data directory (`Provider(action_files=...)`) and then `TIM_ACTIONS_DIR`. Each directory is read non-recursively, `*.yaml` and `*.yml` in file name order, skipping dot-entries (so a ConfigMap's `..data` is skipped). `tim_actions.files.load_action_files` parses each file with PyYAML, keeping timestamps as strings, and takes each YAML document as one action:

1. `type` picks the action type by `type_name`.
2. Each `<field>_file` of a field marked `Sidecar` is replaced by that file's text, read next to the action file.
3. The type's `File` model validates the document, and `Action.from_file` builds the action, which validates it again as an `Action`.

Each document is validated on its own, so a file reports all of its problems at once. A problem names the file and the line of the field, from the YAML nodes, as `<file>:<line>: <field>: <message>`. A field given twice in a mapping is a problem too. Action files add these to the problems that stop startup:

- a file that isn't YAML or UTF-8, or a document that isn't a mapping;
- an unknown `type`, an unknown field, or a value its `File` model or the action rejects;
- a missing sidecar, a sidecar given as a path rather than a file name in the action file's directory, or both `<field>` and `<field>_file`;
- a key already taken by another file or a Python action, or a `tim.` key outside the built-in distribution's package data.

The **connections file** (`TIM_CONNECTIONS_FILE`, [actions.md](actions.md#connections-file)) is read after the providers, so each entry names a connection type from any provider. It is a YAML list; `load_connections_file` validates each entry with the `Connection` model of the hook for its `type`, and a problem is reported as `<file>:<line>: <field>: <message>`. These stop startup:

- a file that isn't YAML or UTF-8, isn't a single document, or isn't a list of mappings;
- a missing or unknown `type`, an unknown field, or a value the type's model rejects (`name` is lowercase letters, digits and `-`; `obo` needs a `scope`, which a connection type may default);
- a duplicate connection name;
- an action's fixed connection (`Action.connections()`, which maps each name to the connection type it must have) that isn't in the file or is of another type.

An action with a `connection` param is left out of the catalogue, with an info log line such as `Action tim.run_kql left out: no kusto connection for its connection param`, when the instance has no connection of the param's `connection_type`. Without a connections file there are no connections, so Run KQL is left out.

`tim-api check` (`cli.py`) runs `build_registry` the same way without the rest of the lifespan, so it needs no settings, database or credentials ([operations.md](operations.md#tim-api-check)). `tim-api schema actions` prints `action_files_schema`: one `File` model per installed type, with `type` fixed to its `type_name` and each sidecar field accepting `<field>_file` instead. `tim-api schema connections` prints `connections_file_schema`: a list whose entries are one `Connection` model per installed connection type, told apart by `type`.

The registry serves the catalogue and the connections in `GET /api/instance` ([api.md](api.md#instance)), built once at startup. Its `version` is a hash of the provider distributions (name and version), the name (relative to its directory) and content of every action file, sidecar and connections file read, and the rest of the body, so it changes whenever the catalogue, an installed provider or a file does. Actions run through `/api/runs` ([Runs and rows](#runs-and-rows)).

Params are declared as data: `Param(name, kind, title, required, default, many, choices, connection_type, schema_from, from_columns, help)`. `kind` is `string`, `number`, `boolean`, `datetime`, `timespan`, `json`, `kql`, `sql` or `connection`. `tim_actions.validate_params` validates and converts the values in a request: a `datetime` is an ISO 8601 string (UTC when it has no offset), a `timespan` an ISO 8601 duration or `HH:MM:SS`, a `many` param a list, and a `connection` param the name of a connection of its `connection_type`. A missing or blank value takes the default; errors are keyed `params.<name>`. The catalogue's `pivot.columns` comes from `Action.pivot_columns()`: each required param's `from_columns` is one group, and a row needs one column from each. Every action sets `pivot`, which has no default: `row` or `rows` offers it on one or several selected rows, and `none` keeps it out of the context menu.

### Authentication and OBO

- Bearer tokens are validated against the tenant JWKS (RS256 only, cached for one hour, rate-limited refetch on an unknown `kid`). Checked: signature, `aud` (`api://<clientId>` or the bare client id), `iss` (v1 or v2 issuer of the configured tenant), `tid`, and required `exp`, `nbf`, `iat` with 60 s leeway.
- The caller is a `Principal`: `oid`, `tid`, and a name taken from `unique_name`, then `upn`, then `preferred_username`. The name is the owner and audit identity (`requestedBy`, `createdBy`, `updatedBy`).
- Runs exchange the caller's token for each `obo` connection's scope with `msal.ConfidentialClientApplication.acquire_token_on_behalf_of`, through `OboTokenProvider.token_for(principal, scope)` (blocking, so callers use a worker thread). The Kusto tab's query and schema calls use `get_token(principal, cluster_url)`, with scope `TIM_KUSTO_OBO_SCOPE` (default `{cluster}/.default`). One MSAL app (and token cache) per process; credential is `TIM_AUTH_CLIENT_SECRET` or a federated token file (`AZURE_FEDERATED_TOKEN_FILE`). Startup fails with neither when auth is enabled and a connection uses `obo` (`OboConfigError`); otherwise OBO answers `503` when it is used.
- A hook never sees the caller's token: it is given a `token_for(scope)` callable. Before `POST /api/runs` creates a run, TIM validates the params, works out the run's connections (the action's fixed ones and its `connection` params' values) and gets each `obo` connection's token, so consent, MFA and missing-token errors answer the `POST` ([ADR-0009](adr/0009-obo-token-exchange.md)). The hook's own calls are then served from the token cache.
- OBO failures: `invalid_grant` or `interaction_required` gives `403 consent-required` (the SPA prompts again); an Entra or network failure gives `502`; OBO not available (auth disabled, or no token) gives `503`.
- `TIM_AUTH_DISABLED=true` runs every request as the analyst its stub token (`dev:<upn>`) names, or a fixed development user without one, and disables OBO. Settings validation fails at startup when it is combined with `TIM_ENVIRONMENT=production` (the default environment).

### Connections and hooks

A **connection** is one fixed endpoint of a connection type, listed in the connections file ([ADR-0018](adr/0018-fixed-connections.md)). A **hook** (`tim_actions.Hook`) is the access to one connection of a connection type, built per run as the analyst. A hook class sets `connection_type`, its `Connection` model (the type's entries in the file, extending `tim_actions.Connection` with `name`, `title`, `type`, `auth`, `scope` and its own fields) and `editor` (`kql` for Kusto). It is built with its connection and a `token_for(scope)` callable.

`Connections` (`runs/connections.py`) holds the instance's connections and hooks. For a run it opens the connections the run uses, gets each `obo` connection's token on a worker thread, and gives the run a `RunConnections`, whose `hook(name)` builds a new hook. An action reaches a connection only through `ctx.hook(name)`, which refuses a connection the run didn't declare: one in the action's `connections()` or named by one of its `connection` params.

The `kusto` connection type (`tim_actions/kusto.py`, extra `kusto`) has the fields `cluster`, `databases` (optional) and `scope` (optional), and the auth `obo`:

- `cluster` gets the URL shape checks and normalisation to `https://<host>` ([api.md](api.md#cluster-validation)) when the file is read. There is no allow-list: the operator names each cluster.
- `scope` defaults to `{cluster}/.default`.
- `databases` are suggestions the browser offers for the `database` param; they don't restrict it.

`KustoHook` runs the synchronous `azure-kusto-data` client on a worker thread with a token from `token_for`. It passes the time left until the run's deadline as the Kusto server timeout and sets the client request id `TIM.RunKql;<uuid>`; `cancel()` sends `.cancel query` for the queries in flight and refuses new ones. Result values are serialised (datetime, timespan, decimal, dynamic, guid), every `PrimaryResult` table is concatenated, and columns are declared from Kusto's types. The query's execution metrics are reported as run details: `executionTime`, `cpuTime`, `memoryPeakPerNode`, `extentsScanned` and `extentsTotal`. Kusto errors become sanitised messages (stack-trace lines removed, capped at 2000 characters).

**Run KQL** (`tim.run_kql`) is the built-in action on a Kusto connection. Its params are `connection` (a Kusto connection), `database`, `kql` (a `kql` param scoped by the `connection` and `database` params) and an optional `idColumn`, the column that gives each row its `id`; without it rows have no `id`. It sets `pivot: none`.

The Kusto tab runs free-text KQL through `validate_cluster_url`, which runs before any token exchange and returns the normalised `https://<host>`, with the rules in [api.md](api.md#cluster-validation). The allow-list is `TIM_ALLOWED_KUSTO_HOSTS`, a list of host patterns (exact, `*.domain`, `**.domain`; default `**.kusto.windows.net`). A rejected cluster gives `400 cluster-not-allowed`.

`AzureKustoQueryClient` runs the synchronous `azure-kusto-data` client in a worker thread with the user's token. Result values are serialised (datetime, timespan, decimal, dynamic, guid), and every `PrimaryResult` table is concatenated. `StartTime` and `EndTime` are passed as query parameters, so KQL must `declare query_parameters(StartTime:datetime, EndTime:datetime)` to use them. Kusto errors become sanitised messages (stack-trace lines removed, capped at 2000 characters).

### Runs and rows

Two paths run work on the server: runs of an action through `/api/runs` (`runs/`), and Kusto query runs through `/api/kusto/query` (`query_runs/`). Both follow [ADR-0012](adr/0012-query-run-limits-and-lifecycle.md) and share one concurrency semaphore of `TIM_MAX_CONCURRENT_RUNS` per process.

A run:

1. `POST /api/runs` looks up the action and validates the params with `tim_actions.validate_params` (`422` before a run exists). `Runner.start` stores the run (table `runs`) as `running` with `expiresAt = now + TIM_RUN_RETENTION_SECONDS`, and starts a tracked asyncio task.
2. The task waits for a concurrency slot, still `running`, and then runs the action's synchronous `run(params, ctx)` in its own daemon thread. `ctx` gives `analyst`, `deadline` (when the timeout ends), `hook(connection)`, `detail(key, value)` and `declare_columns(columns)`. `hook` refuses a connection the action doesn't declare, either in `connections()` or as a `connection` param's value, and gives one hook per connection per run.
3. The thread passes each yielded row to `ResultBuilder` (`results.py`), which counts rows and bytes (compact JSON per row, summed), takes the row's `id` with `Action.row_id(params)`, replaces NUL with U+FFFD and builds the columns. Rows are written to `run_rows` in batches of 1,000 rows or 8 MiB.
4. The request waits up to about 1 second for the task: `200` with the ended run, else `202` with the `running` run.
5. The task ends the run, refreshes `expiresAt` and writes its final state:
   - `succeeded`, with `columns` and `rowCount`;
   - `error`, with the message of the action's `RunError`, `Result exceeds limit of N rows` or `N bytes`, or `The run failed unexpectedly` for any other exception, which is logged with the trace id;
   - `timedOut` after `TIM_RUN_TIMEOUT_SECONDS`, counted from taking the slot (`Run exceeded the time limit of N seconds`);
   - `cancelled`.

   Only a succeeded run keeps its rows; the store deletes those of any other outcome when it writes the final state.
6. On a timeout or cancel, the thread stops writing rows and `Hook.cancel()` is called on each of the run's hooks from another thread. The run ends once every `Hook.cancel()` has returned or the thread has exited, or after 10 seconds. A thread that never returns is left behind as a daemon.

Cancel (`POST /api/runs/{runId}/cancel`) sets `cancel_requested` on the run. The process executing it acts at once when it took the request; every process also polls, each second, for cancel requests to the runs it executes, so any replica can take the request. A run cancelled while it waits for a slot never takes one.

`details` holds `duration` (seconds, from taking the slot) and, when succeeded, `rowCount` first, then the action's own `ctx.detail` values in the order they were reported. Problems with `id`, such as an id column missing from the results or an `id` over 512 characters, never fail the run: they are added to a `warning` detail.

`columns` lists the declared columns first, the action's and then those the run declared, and then the rest in first-seen order. A column's type is inferred from its values: `boolean`, `number`, `datetime` for ISO 8601 strings, other strings as `string`, objects and arrays as `json`, and `string` when the values disagree or are all `null`.

`id` comes from `Action.row_id(params)`, a `RowId`: by default `IdColumns` over the action's `id` column or list of alternatives, taking the first that isn't `null` or `""`. It is stored as text: a string as it is (not trimmed), anything else as its compact JSON, so the number `1` and the string `"1"` match. `GET /api/runs/{runId}/rows` reads a page of `run_rows` by row number; when a succeeded run with rows has none stored, it answers `410`.

Kusto query runs:

1. `POST /api/kusto/query` validates the cluster, exchanges the token (auth errors are returned synchronously, before a run exists), and `RunManager` stores a run (`KustoQueryRun`, table `query_runs`) as `created` with `expiresAt = now + TIM_RUN_RETENTION_SECONDS`.
2. A tracked asyncio task executes the query, `created` while it waits for a slot.
3. The request waits up to about 1 second for the task. If it finished, the response is `200` with the terminal run; otherwise `202` with the `created` run.
4. The task always writes a final state and refreshes `expiresAt`: `completed` (rows and `executionMetrics`), `error` (`mainError`; Kusto error, limit exceeded, shutdown, or a generic message for unexpected failures) or `timedOut` (after `TIM_RUN_TIMEOUT_SECONDS`).
5. `GET /api/kusto/query/{id}` returns `202` while `created` and `200` otherwise.

A Kusto query run's rows are one `jsonb` value, so its caps are 100,000 rows and 64 MiB, or `TIM_MAX_RESULT_ROWS` and `TIM_MAX_RESULT_BYTES` when lower. Runs use the settings as they are: `TIM_MAX_RESULT_ROWS` (1,000,000) and `TIM_MAX_RESULT_BYTES` (512 MiB). A result over a cap fails the run; it is not truncated. NUL characters in results and errors are replaced with U+FFFD before storing.

A run or query run that is unknown, expired or owned by another user is `404`.

Housekeeping, for both:

- At startup, runs still `running` (query runs still `created`) for longer than `TIM_RUN_TIMEOUT_SECONDS` are set to `error` (`Run interrupted by server restart`).
- At shutdown, runs in flight are stopped and marked `error` the same way.
- A background loop deletes runs past `expiresAt` every `TIM_RUN_RETENTION_SWEEP_SECONDS` (300), ten runs at a time so each delete of their rows stays short, then the expired query runs. Expired runs already read as `404` before they are deleted.

### Templates

Stored in PostgreSQL (`query_templates`), shared by all users. The model is `QueryTemplate` in `templates/models.py`: Handlebars KQL (`query`), `summary`, `cluster` and `database` (both may be templated), `params`, `fields`, column overrides (`columns`) and a menu path (`path`). `GET` returns the list (optionally `since` an `updated` timestamp and `includeDeleted`), `POST` creates (`201`, `Location` header), `PUT` replaces the editable fields, `PATCH` applies an RFC 6902 JSON Patch (`add`, `replace`, `remove`, `test`) and re-validates the result, `DELETE` is a soft delete (`isDeleted: true`, idempotent, `204`). `PATCH {"op":"replace","path":"/isDeleted","value":false}` restores a template. `uuid`, `createdBy`, `updatedBy` and `updated` cannot be patched; `updatedBy` and `updated` are set by the server on every write.

### Tagged events

The three `POST /api/taggedevents/*` routes validate a batch (1 to 1000 items), add `createdBy` (from the token) and `dateTimeUtc` (server clock) to every row, and ingest NDJSON through `ManagedStreamingIngestClient` (`azure-kusto-ingest`) using the table's JSON mapping. Ingestion uses the app identity (`DefaultAzureCredential`, configured with the standard `AZURE_*` variables), not the user. The ingest endpoint is `TIM_TAG_INGEST_URL` or `https://ingest-<tag cluster host>`. Failure gives `502`. `TIM_TAG_INGEST_FAKE=true` (development only) swaps in an in-memory recorder.

### Persistence

`storage/` defines `TemplateStore`, `RunStore`, `QueryRunStore` and a `Storage` bundle (health, close). `TIM_DATABASE_URL` selects PostgreSQL (`postgresql+asyncpg://`) or, in development only, an in-memory store (`memory://`; refused in production). Alembic migrations create the schema (`alembic upgrade head`).

| Table | Key | Notes |
|---|---|---|
| `query_templates` | `uuid` | Editable fields, `path`/`params`/`fields`/`columns` as JSONB, `is_deleted`, `updated`, `created_by`, `updated_by`; index on `(updated, uuid)` |
| `runs` | `run_id` | `owner`, `status`, `action` and `params` (JSONB), `details` (JSON, which keeps the order of its keys), `columns` (JSONB), `row_count`, `error`, `started_at`, `finished_at`, `expires_at`, `cancel_requested`; indexes on expiry and `running` runs |
| `run_rows` | `(run_id, ordinal)` | `UNLOGGED`. `ordinal` (the row number), `id` (text), `data` (JSONB); `run_id` references `runs` `ON DELETE CASCADE`. Kept only for succeeded runs |
| `query_runs` | `query_run_id` | `requested_by` (owner), `status`, `execute_date_time_utc`, `expires_at`, `kusto_query`, `result_data`, `execution_metrics` (JSONB), `main_error`; indexes on owner, expiry, and `created` runs |

`run_rows` is `UNLOGGED`, so it is not written to the WAL: PostgreSQL empties it after a crash and a replica doesn't have it, while `runs` survives. Rows of a run that succeeded then read as `410` ([operations.md](operations.md#rows-lost-after-a-crash)).

### Errors and logging

Every non-2xx response is `application/problem+json` with `type` (`urn:tim:problem:<slug>`), `title`, `status`, `detail`, `traceId` and, for validation, `errors`. Details are fixed, safe strings: no stack traces, SQL, tokens or upstream bodies. Unhandled exceptions are logged with the trace id and returned as a generic `500`. Logging is stdlib logging to stderr at `TIM_LOG_LEVEL`. The API exposes no metrics endpoint. See [api.md](api.md#errors).

## Security model

- Identity comes from the validated token only. `requestedBy`, `createdBy`, `updatedBy`, `updated` and `dateTimeUtc` sent by a client are ignored (the SPA also strips them).
- Runs and query runs are owner-scoped: another user's run id is indistinguishable from an unknown one (`404`).
- A run reaches only the connections in the connections file, whose endpoints the operator chose; analysts never name an endpoint, so the API cannot be used to forward user tokens to arbitrary hosts. Hooks get a `token_for(scope)` callable and never see the analyst's token. `GET /api/instance` shows a connection's name, title, type, editor and databases, never its cluster, auth or scope.
- The Kusto tab's cluster URLs are validated against an allow-list before any token is acquired or sent, for the same reason.
- Connections run as the user (OBO); only tag ingestion and table creation use the app identity.
- The development auth bypass (`TIM_AUTH_DISABLED`), the development actions (`TIM_DEV_ACTIONS`) and the in-memory store fail startup in production. The SPA's auth stub throws in a production build.
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
