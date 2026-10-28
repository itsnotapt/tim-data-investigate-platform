# Architecture

TIM is an investigation platform. Analysts:

- run actions against an instance's connections (Kusto, Snowflake);
- pivot from result rows into other actions;
- annotate rows by `id`.

An investigation is a tree of tabs. Each pivot creates a child tab.

| Part | Location | Stack |
|---|---|---|
| Web | `web/` | React SPA served by nginx |
| API | `api/` | Python 3.12, FastAPI |
| Persistence | PostgreSQL | presets, column views, runs and annotations ([ADR-0004](adr/0004-postgresql-persistence.md)) |

Related docs:

- Layout rationale: [ADR-0001](adr/0001-react-python-web-api.md).
- Domain vocabulary: [GLOSSARY.md](../GLOSSARY.md).
- Configuration variables: [configuration.md](configuration.md).
- HTTP reference: [api.md](api.md).

## System overview

```
 Browser (SPA, hash routes)
 +------------------------------+   MSAL popup    +------------------------+
 | React, MUI, AG Grid, Monaco  |---------------->| Entra ID               |
 |                              |  token for      | (one app registration  |
 | IndexedDB "tim"              |  api://<client> |  for SPA and API)      |
 +--------------+---------------+                 +-----------^------------+
                | /api/*  (same origin)                       | OBO exchange
                v                                             |
 +------------------------------+     +-----------------------+------------+
 | web container (nginx)        |---->| api container (FastAPI)            |
 | static files, /config.js,    |     |  presets, runs,                    |
 | security headers, /api proxy |     |  annotations                       |
 +------------------------------+     +---+-------------+------------------+
                                          |             |
                                          v             |
                              +--------------------+    | user token (OBO)
                              | PostgreSQL         |    |
                              | presets,           |    v
                              | preset_hidden      | +-------------------------+
                              | runs, run_rows     | | Kusto clusters the user |
                              +--------------------+ | queries                 |
                                                     +-------------------------+
```

Key points:

- Investigation state (tabs, cached result rows, the column views applied per analyst) lives only in the browser. The API never receives it. Column views are saved to the API, so analysts can share them ([Column views](#column-views)).
- Actions run on the API. It exchanges the caller's token for each connection's token (OBO), runs the action's hook and stores the result as a run. The SPA polls the run and loads its rows.
- Labels, tags and comments are stored in PostgreSQL by `id`, and reach every open browser through a change feed ([Annotations and the change feed](#annotations-and-the-change-feed)).

## Web architecture

### Stack

- React 19, TypeScript (strict) and Vite.
- react-router (hash routes) and zustand stores.
- MUI 9 and AG Grid 36 Enterprise ([ADR-0006](adr/0006-ag-grid-enterprise.md)).
- Monaco with `@kusto/monaco-kusto`, and its `sql` language.
- `idb` for IndexedDB.
- `@azure/msal-browser` and `@azure/msal-react`.

### Source layout

| Path | Contents |
|---|---|
| `web/src/app/` | Entry (`main.tsx`), router, app shell, auth gate, bootstrap, theme |
| `web/src/components/` | Shared UI: code editor, dialogs, snackbar |
| `web/src/features/` | One folder per feature: `tabs`, `tree`, `action-tab`, `instance`, `new-query`, `presets`, `action-pivots`, `sinks`, `grid`, `labels`, `annotate`, `action-column-views`, `share-links` |
| `web/src/lib/api/` | Typed API client, problem handling, run polling, `GET /api/instance` and runs; `schema.d.ts` is generated |
| `web/src/lib/annotations/` | The annotation store and the change-feed poller |
| `web/src/lib/auth/` | MSAL client, auth provider, redirect bridge |
| `web/src/lib/config/` | Runtime config loader |
| `web/src/lib/storage/` | IndexedDB database and DAOs |
| `web/src/lib/monaco/` | Editor setup |
| `web/src/lib/isEmpty.ts` | `isEmpty`: true for `''`, `undefined`, `null`, empty arrays and empty plain objects |
| `web/src/lib/uuid.ts` | `generateUuid` (v4 UUID via `crypto.randomUUID`) |
| `web/src/test/` | Unit-test helpers: MSW server and handlers, bootstrap stub, tabs store utilities |
| `web/e2e/` | Playwright e2e tests: `flows/` specs, `realApi.ts` (fixtures for flows against a real api), `api_server.py` (that api), `actions/` (its dev action files), `editor.ts` (`waitForEditor`), screenshot helper |

Features import `lib/*` and `components/*`. Between features:

- **Public `index.ts`:** every feature has one. Most imports between features go through it.
- **Direct imports:** about twenty imports reach into another feature's modules. Examples are `tabs/tabStore`, `tabs/types`, `tabs/tabRegistry` and `grid/rowUpdates`.
- **Startup code:** code outside `features/grid` imports `features/grid/rowUpdates` directly. The `index.ts` of `features/grid` pulls in AG Grid (see [Bundle](#bundle)).
- **Lazy pages:** `app/lazyPages.ts` imports the page components of `tabs` and `share-links` directly.

### Routes

Routes are hash routes. Unknown hashes redirect to `#/`. Pages are lazy-loaded.

| Route | Page |
|---|---|
| `#/` | Welcome |
| `#/view/:uuid` | A tab of either kind: Kusto or action (`uuid` is the tab's component uuid) |
| `#/runs/:runId?row=<n>` | A share link to a run, and optionally to one of its rows (`n` is the row's ordinal). It opens an action tab holding the run and replaces the URL with `#/view/<uuid>` ([Share links](#share-links)) |

### Bundle

The startup bundle (`index.html`'s script and module preloads) holds React, MUI, MSAL, react-router, zod and the app shell. Everything else loads on demand:

- **Pages** are lazy (`web/src/app/lazyPages.ts`).
- **AG Grid** loads with the first results grid.
  - `features/grid/ResultsGrid.tsx` registers the modules listed in `features/grid/agGridSetup.ts` and applies the licence key.
  - `vite.config.ts` puts AG Grid in its own `ag-grid` chunk.
  - A grid feature whose module is not registered logs AG Grid console error #200. The e2e fixture fails on AG Grid console errors.
- **Monaco**, `@kusto/monaco-kusto` and their workers load when the first editor mounts (`web/src/lib/monaco/loader.ts`).

### State and tab model

- **`tabStore`** (zustand) holds `tabs` by uuid, and an ordered uuid list where parents precede children.
  - `children` is derived by selectors, never stored.
  - Changes are written to IndexedDB through a debounced, serialised queue.
  - Removing a tab removes its whole subtree, and the row results of every removed tab.
  - Visited tabs stay mounted up to a cap of 100. The least recently visited are evicted.
  - On load, a stored tab of an unknown kind is dropped, with its rows.
- **`presetsStore`** holds the analyst's own presets and the shared ones, from `GET /api/presets`. The New menu refetches it each time it opens.
- **`savedColumnViewsStore`** holds the analyst's own column views and the shared ones, from `GET /api/columnViews`. The Views panel refetches it each time it opens.
- **`appliedViewsStore`** holds the analyst's applied column views, from IndexedDB `applied_views` ([Column views](#column-views)). Bootstrap loads it right after `instanceStore`.
- **`instanceStore`** holds the instance from `GET /api/instance`: actions, connections, labels and limits.
  - Bootstrap loads it first.
  - A refetch on every window focus replaces it only when its `version` differs. So a rolling update shows up without a reload.
  - A failed refetch keeps the instance already loaded.

A tab has the kind `ActionResult`, named by `componentName`.

An action tab's params are `{action, params, presetId?}`: the action's key, the param values as plain values, as the browser sends them, and the preset the tab was opened from or saved as. They are never resolved again, so the tab keeps working when the instance's catalogue changes.

Besides the common fields, an action tab's state holds:

| Field | Holds |
|---|---|
| `run` | The envelope of the latest run. Cleared when a run starts, so `null` until its envelope arrives. Kept if the server refuses only params |
| `cancelling` | A cancel was asked for and the run has not ended |
| `paramErrors` | Why each param was refused, by name |
| `runParams` | The plain params the latest run started with |
| `resultsRunId` | The run whose rows are stored |
| `resultColumns` | That run's columns |
| `resultsStartedAt` | When that run started |
| `gridState` | The column and filter sections of the tab's grid, as the analyst last left them |
| `columnView` | `{viewId, name, baseline}`: the column view the tab started from or last picked (`viewId` is `null` for the action default), and the grid state just after it was put on |

### Data flow: run, poll, pivot

1. **Run.** `runActionTab` sends `POST /api/runs` with the tab's `{action, params}`.
   - A `422` puts each `params.<name>` error in the tab's `paramErrors`, for every param the action declares. That includes the Query editor's `kql` or `sql` param, whose border and caption show it.
   - An error for a param the action does not declare joins the tab's error "Couldn't start: …" as `name: reason`. Reasons are separated by `; `. Any other start error joins it the same way.
   - When the server refuses only params, the tab keeps its latest `run`. On any other start error, `run` stays cleared.
   - The run's envelope goes to the tab's `run`, and the tab is saved at once. So a reload finds the run id.
2. **Poll.** While the run is `running`, the tab polls `GET /api/runs/{runId}`: every second for the first 10 s, then every 3 s. A run that ends in `error`, `timedOut` or `cancelled` becomes the tab's error.
3. **Cancel.** `cancelActionTab` sends `POST /api/runs/{runId}/cancel` and sets `cancelling`. Polling then sees the run end.
   - If the answer is already an ended run, the tab ends at once.
   - A failed cancel shows "Couldn't cancel: …" and clears `cancelling`.
4. **Store.** For a succeeded run, the rows are loaded page by page from `GET /api/runs/{runId}/rows`.
   - Each page is added to the open grid as it arrives, so the analyst can scroll the first rows while the rest load.
   - Until they all have, the tab shows "Results · 20000 of 85000".
   - The page's `annotations` go to the annotation store before its rows reach the grid ([Annotations in the browser](#annotations-in-the-browser)).
   - Once every page has loaded, the rows are written to IndexedDB `row_results` as `{row, id, data}` rows, in one write. The tab's `resultsRunId`, `resultColumns` and row count are written with them.
   - A failed or abandoned load shows none of its rows.
   - A tab whose rows are stored needs no API call. So it still shows them after the run has expired on the server.
5. **Resume.** After a reload, bootstrap calls `resumeActionRuns` once the tabs are loaded.
   - It follows again a run still `running`, by its `runId`.
   - It loads the rows of a succeeded run that is not yet stored.
   - A tab marked executing with no run id to follow stops executing.
6. **Run gone.**
   - A `404` on the run shows "The run is no longer available; run again".
   - A `410` on the rows (results gone) shows "Results are no longer available; run again".

From the rows, an analyst pivots:

- **Pivot.** A context-menu pivot builds params from the clicked or selected rows.
  - **Action pivot.** The params come from `POST /api/actions/{key}/resolve` ([Action pivots](#action-pivots)). It creates a child action tab in the background, under the current tab.
  - **Preset pivot.** The browser resolves the params from the preset's From row inputs, with `presetPivot` (`features/presets/presetPivot.ts`), into the child tab's `{action, params}`. There is no `/resolve` call ([Preset pivots](#presets-and-column-views)). The child tab is the same as an action pivot's, titled with the preset's name and holding its `presetId`. It runs at once, or waits with the toast "Opened <preset>: needs <params>". The toast has a **Go to** button.

### Share links

A share link is `<origin><path>#/runs/<runId>`, or `…#/runs/<runId>?row=<n>` for one row. The code is in `web/src/features/share-links/`.

- **Copy link.** The action tab's header button copies the link to its run: "Copied a link to this result". It is disabled until the tab has a run. The last group of the row context menu, after the sinks and Copy column settings, copies the link to the row: "Copied a link to this row".
- **Open.** `ShareLinkPage` reads the run with `GET /api/runs/{runId}`. For a succeeded run with rows it also reads the first page of rows.
  - A `404` (unknown or expired run) or a `410` (results gone) shows only "This result is no longer available".
  - Otherwise `openRunTab` opens an ordinary action tab holding the run, with the run's params on its pills, and the URL becomes `#/view/<uuid>`. A run still going is followed, and the tab fills in when it ends.
  - The linked row is kept in the tab as `linkedRow`. Once that row arrives, the grid focuses it and opens Row detail on it, and `linkedRow` is cleared. It is also cleared when the run ends without success, when the stored rows don't have that row, and when a new run of the tab starts.
- **Run.** Run starts a new run as the recipient, with the tab's params. For an action the instance does not know, the rows still show and Run is disabled.

One run is followed per tab. Starting another run stops following the previous one.

### IndexedDB

Database `tim` (version 5):

| Store | Key | Value |
|---|---|---|
| `display_components` | `componentUuid` | Tab: name (`ActionResult`), title, `parentUuid`, `rowDataTrigger`, `displayComponentIndex`, state, params |
| `row_results` | tab uuid (out-of-line) | Array of raw result rows; for an action tab, `{row, id, data}` rows of its run |
| `applied_views` | `[analyst, scope]` (index on `analyst`) | `{analyst, scope, viewId, name}`: the column view an analyst applied. `scope` is `preset:<presetId>` or `action:<key>` |
| `annotations` | `id` | An `id`'s [Annotations](api.md#annotations): `{id, label, tags, comments, version}`. An `id` whose annotations were all removed stays, with `label: null`, as a tombstone that keeps its `version` |
| `annotation_sync` | `cursor` (out-of-line) | The change feed version read up to; `0` before the first read |

Annotations are never stored in `row_results`.

### The tab and New menu

The New menu opens from the **New** button. It lists, in order:

- A search box.
- An **All / Mine / Others' / Hidden** filter for presets.
- **Actions and presets**, one tree of folders.

**Actions and presets** share one namespace of folders.

- A folder is an action's `menuPath` or a preset's `menuPath`. Each folder shows how many items are below it.
- Within a folder, subfolders come first, then actions, then presets.
- The filter decides what shows:
  - **All** shows the actions and every preset that is not hidden.
  - **Mine** and **Others'** show only presets that are not hidden, by the preset's `owned`, which the server sets for the caller. The web never compares names.
  - **Hidden** shows only the presets the analyst hid.
- The search matches an action's name, folders and key. It matches a preset's name, folders, action, owner and From columns. While searching, the groups are open.
- A caption under each preset says what it is:
  - a preset with every input fixed is a bookmark: "Bookmark · <owner>";
  - otherwise "<action> · pivot on <columns> · asks for <params>", where the second part lists the From columns, and the third the From row inputs with no columns.
- Each preset has a **⋯** menu:
  - **Open**, and **Duplicate**, for everyone. Duplicate creates a private "Copy of <name>".
  - For the owner: **Edit…** (the Save dialog on the preset, starting from the preset's own params and fixed values, not the action's defaults), **Share with everyone** or **Make private**, and **Delete…**, which asks to confirm.
  - For anyone else: **Hide** or **Unhide**, for that analyst only.
- A preset whose action is not in the catalogue cannot be opened or edited.
- **Copy as action file**, when the action's `actionFile` is true: copies the preset's YAML ([api.md](api.md#get-apipresetspresetidactionfile)) to the clipboard.
- The presets are refetched each time the menu opens, so presets others shared since show up.

Choosing an action creates a root action tab and gives it focus. The tab is titled with the action's name, and its params are the params' defaults. It does not run.

Opening a preset creates a root action tab in the same way, titled with the preset's name. Its params are:

- the action's defaults, and the only connection for each `connection` param;
- then the preset's `params`;
- then the preset's fixed values.

A From row query parameter is left unset too. A From row input that is still unset waits to be filled in, as after an [action pivot](#action-pivots): the tab sets `pivotMissing` and does not run. The tab keeps `presetId` in its params.

The action tab has a header, a pills bar and inner tabs.

**Header:** the action's menu path · the action, and the tab's title, with **Save…**, **Clone** and **Copy link** buttons. [Save…](#presets-and-column-views) saves the tab as a preset. [Copy link](#share-links) copies a link to the tab's run. Clone adds a sibling tab titled "Copy of <title>" with the same params. The copy is not run, and it takes focus. It starts with the [applied column view](#column-views), not the original's columns.

**Pills bar:** one pill per param that is not edited in an editor, so `kql` and `sql` params are left out.

- A `connection` param whose type has exactly one connection is filled in when the tab opens from the New menu. Its pill is greyed out.
- A pill shows the param's title and value. It opens a popover that edits the param by kind:

  | Param | Popover |
  |---|---|
  | `boolean` | A switch |
  | Many-valued | Chips. Pasted text is split on newlines, tabs, commas and semicolons |
  | With `choices` | A pick list |
  | `connection` | A pick list of the instance's connections of the param's `connectionType` |
  | `string`, `number` | Text. A `number` typed beyond ±(2^53 − 1) is kept as its digits, not rounded |
  | `datetime` | A field, calendar and clock in UTC (Kusto's timezone). Pasting an ISO datetime from a result row sets it |
  | `timespan` | Preset chips for common lookbacks (15 minutes to 30 days), and an amount with a unit. Stored as an ISO 8601 duration |
  | `json` | JSON text |

  A many-valued `datetime` or `timespan` param uses chips like any other.

- **Run** sits at the right of the bar. While the run is going, it is replaced by a spinner with the elapsed time (from the run's `startedAt`) and **Cancel**.
  - Cancel is disabled until the run has an id.
  - The tab says "Cancelling…" until the run ends.
  - A failed cancel shows "Couldn't cancel: …".
- When the params differ from those the latest run started with (`runParams`), an **Edited** chip shows. Clicking it resets them and clears the pill marks.
- A param the server refused is marked on its pill until the pill is edited. The pill takes the error colour, with the reason as its description.
- An action that is not in the catalogue shows a warning and cannot be run.

**Inner tabs:**

- **Query**, for an action with a `kql` or `sql` param.
  - A full-height editor, where Ctrl/Cmd+Enter runs.
  - The `database` param's suggestions are the chosen connection's `databases`.
  - Above the editor, a status line shows the latest run: "Succeeded · N rows · duration" with **Show results**, or its error with **Details**. Details opens the Run tab. An error from the `POST` shows as "Couldn't start: …".
  - A `422` on the query param marks the editor's border and caption.
- **Results · N**, with the row count. While rows are loading, it shows how many have arrived out of the total ("Results · 20000 of 85000"). The grid already shows them.
- **Run · duration**, the details of the latest run:
  - its status, with an icon ("Succeeded, no rows" for an empty success);
  - start, duration and run id;
  - the tab's error;
  - the run's details, in the order the action reported them, where a `warning` key gets a warning icon;
  - the columns: name, type, declared or inferred;
  - the params the run used.

Which inner tab shows:

- Results shows by default.
- Run shows when the tab has an error: a run that ended in `error`, `timedOut` or `cancelled`, a start error, or results that are gone. The error is shown only on the Run tab.
- The analyst's choice of inner tab holds until the run changes: a run starts, gets its id or ends.
- A tab with a Query tab never switches inner tab by itself. The status line above the editor reports the run, and its buttons switch tabs.

Previous results:

- While a run is going, the previous results stay, dimmed and marked `aria-busy`, under "Showing the run from <start> UTC".
- After a failed run, the last good results stay under a note, then "Showing the run from <start> UTC". The note is:
  - "The last run failed.", "timed out.", "was cancelled." or "could not start.";
  - or "The last run’s results could not be loaded.", for a run that succeeded or was running but whose rows or run could not be loaded.

The results grid is AG Grid with its client-side row model, keyed by each row's row number (`row`).

- The columns are those of the run.
- The action's declared `columns` become `initial*` settings, so a restored column state wins over them.
- Its declared `calculated` columns become AG Grid calculated columns ([actions.md](actions.md#columns)).
- Analysts can add their own calculated columns from the column menu.
- A `bigint` column shows `BigInt` values, with the text, bigint and set filters in its multi filter. A `number` column with a whole number beyond ±(2^53 − 1) has a warning icon in its header ([actions.md](actions.md#columns)).
- A succeeded run with no rows shows "The run succeeded with no rows." instead of a grid.
- CSV and Excel export are AG Grid's own.

The tree shows an action tab's status like any tab's:

- a spinner while running;
- a red alert on error;
- a row-count badge;
- a ringed 0 for a succeeded run with no rows ("Succeeded, no rows");
- a "Needs input" icon for a tab waiting on the params a pivot left missing (`pivotMissing`).

#### Action pivots

The results grid's right-click menu has **Pivot ▸**. Its targets are the selected rows. Right-clicking a row outside the selection selects just that row.

- **Menu.**
  - A disabled "Recent" heading and the analyst's last three pivots come first, named by their full menu path. They are kept in localStorage under `tim-recent-pivots`: an action by its key, a preset as `preset:<presetId>`. A separator follows, then the actions and presets in one tree of folders, actions first in each folder, as in the New menu.
  - It lists the actions whose `pivot` is not `null` and whose every pivot column group has a column in every target row.
  - It lists the presets that [pivot from the rows](#presets-and-column-views). Hidden presets, and presets of an action not in the catalogue, are left out.
  - The item is omitted when nothing applies.
  - An action with `rows: "row"` is disabled, with the tooltip "Takes one row", when several rows are targeted. Presets have no such limit.
  - The whole item is disabled over `limits.maxPivotRows` rows, for actions and presets alike, with the tooltip "At most 100 rows; 2,500 selected".
  - `useActionPivotMenu` loads the presets store when it has not loaded yet.
- **Resolve.** Choosing a preset resolves in the browser instead ([Preset pivots](#presets-and-column-views)). Choosing an action sends `POST /api/actions/{key}/resolve` ([api.md](api.md#post-apiactionskeyresolve)). The rows hold the target rows' values, trimmed to the action's pivot columns and its params' `fromColumns`. The right-clicked cell is sent when its column is one of them.
- **Child tab.** It is an action tab under the current tab, created in the background, so focus stays on the parent. Its params are:
  - the action's defaults;
  - the only connection, for each `connection` param;
  - the resolved params.
- **Run.**
  - When nothing is missing, the tab runs at once and a toast says "Running <action>".
  - Otherwise the tab waits, with `pivotMissing` set (cleared when a run starts), and the toast says "Opened <action>: needs <params>".
  - Both toasts have a **Go to** button that focuses the child tab.
  - A refused resolve shows the toast "Couldn't pivot into <action>: <reason>" and creates no tab.
- **Waiting tab.**
  - Each needed pill is dashed, warning-coloured and labelled "<Title>: needed".
  - A warning note says "Fill in <params> to run this pivot", with the reasons.
  - The first needed pill's popover opens when the tab is first shown.
  - The analyst presses Run once the params are filled.

### Presets and column views

A preset is an action with some params fixed and the rest filled in by the analyst or from rows ([GLOSSARY.md](../GLOSSARY.md)). Its stored shape is in [api.md](api.md#preset).

- A preset holds params only. It has no test values and no results.
- It is private to its owner, or shared with everyone.
- Others read a shared preset but do not change it. They open it, duplicate it, or hide it for themselves.
- Open tabs keep their snapshot. A tab opened from a preset holds plain params like any other tab.
- Last write wins.

**Inputs.** An input is one param of the preset's action that declares `from_columns` (`source: "param"`), or a query parameter (`source: "queryParameter"`).

- A **fixed input** has a `value`, which is saved with the preset.
- A **From row input** has `fromColumns`: it takes the value from the first of these columns that the rows have. With no columns, the tab asks the analyst for it.
- A preset with every input fixed is a bookmark.
- A **query parameter** input has a name and a `type`, and is fixed or From row like a param. It is allowed only on an action with a `json` param named `parameters`, which Run KQL and Run SQL have. The query parameters are an ordered list, and the preset's `parameters` value is built from these inputs in that order.
- Values are validated when a run starts, not when the preset is saved.

**Preset pivots.** A preset can pivot when it has From row inputs and each has columns. The grid's [Pivot ▸ menu](#action-pivots) offers it when every target row has one of each input's columns.

- Each input takes the first non-empty column of its `fromColumns` in each row: the first match wins.
- A many-valued param, or a `dynamic` query parameter, takes the distinct values of the rows.
- Any other input takes the value the rows agree on. When they differ, the menu item is disabled with the tooltip "The N selected rows have different {Title} values". A query parameter's title is its name.
- A query parameter's value goes in its `parameters` entry.
- A required param left unset is missing, as when the server resolves a pivot, and so is a query parameter left without a value, by its pill's name (`parameters.<name>`). The child tab sets `pivotMissing` and waits.
- The other params come from the action's defaults and the preset's fixed values, as when [opening a preset](#the-tab-and-new-menu).

**Save….** The action tab header opens the Save dialog (`SavePresetDialog`).

- Name, menu folder (folders separated by `/`) and **Share with everyone**.
- For each param that rows can fill, a fixed input (**Fixed**) or a From row input (**From row**). From row offers the param's columns to read.
- A **Query parameters** section, on an action that takes them. Add a parameter: its name is suggested from the names in the query. Pick its type, then **Fixed** with a value, or **From row** with columns.
  - Each row shows its number, `:N` for SQL and N for KQL, and has **Move up** and **Move down** buttons. For KQL the order sets the order of the `declare` statement. For SQL it sets the position each is bound to.
  - SQL offers no `timespan` type.
- A preview of what the action receives, one line for every param of the action.
  - A From row input shows as `<column of the clicked row>`.
  - For query parameters on KQL it shows the `declare query_parameters` line before the query, and a line per query parameter.
  - A fixed query parameter's value shows as a Kusto literal: `datetime(…)`, `timespan(…)`, `dynamic(…)`, and the others as typed.
  - On SQL each query parameter's line starts with its `:N`, and a fixed value shows as its text, with no Kusto literal.
  - A value that is unset, in its field and in the preview, shows as a placeholder for the param's type, e.g. `<number>`.
- A preset of your own offers **Update "<name>"** or **Save as new**. Anyone else's offers **Save**, which makes your own private copy.
- After saving, the tab takes the preset's name and `presetId`. On an action tab of Run KQL or Run SQL it also takes the declared query parameters: fixed values, and From row ones keep the tab's value for them or are left empty.
- On a tab with a `presetId`, Save… first refetches the presets to find that preset. When they can't be loaded, it says so and offers **Retry**, not a Save that would make a copy.

**Storage.** The API stores presets in `presets`, and each analyst's hidden marks in `preset_hidden` ([Persistence](#persistence)).

- `GET /api/presets` returns the caller's presets and the shared ones, oldest first, each with `owned` and `hidden` for the caller.
- The server assigns `presetId`, `owner` (from the token) and the timestamps.
- It checks that `action` is in the catalogue, that each param input is a param of it with `from_columns`, and that query parameter inputs are on an action that takes them, with unique names that are identifiers (a letter or `_`, then letters, digits and `_`).
- `404` for an unknown preset or someone else's private one. `403` for a change by someone who does not own it.

### Column views

A column view is a named, saved set of the results grid's columns and filters ([GLOSSARY.md](../GLOSSARY.md)). Action tabs use it. Its stored shape is in [api.md](api.md#columnview); the decision is [ADR-0022](adr/0022-column-views-store-grid-state.md).

- It is private to its owner, or shared with everyone.
- Others read a shared column view but do not change it. They apply it, hide it for themselves, or save their own copy.
- Names are not unique. Last write wins.

**What's stored.** `state` is a partial AG Grid `GridState` (`features/action-column-views/columnViewState.ts`).

- It holds the sections `columnOrder`, `columnSizing`, `columnVisibility`, `columnPinning`, `columnHeaderName` (without AG Grid's own `ag-Grid-*` columns), `userColumns`, `sort`, `rowGroup`, `aggregation`, `pivot` and `filter`, with `partialColumnState: true`.
- Every section is filled, and empty when the grid has nothing set. So applying a column view clears what it doesn't have.
- `state.version` is what AG Grid reported when it was saved. Nothing rewrites a stored column view.
- The server checks only that `state` is a JSON object. The browser decides its keys.
- `savedFrom` is the action, and the preset when there is one, of the tab it was saved from. It is fixed at creation.

**Fitting.** A column view is fitted to the result's columns before it is applied (`fitColumnView`).

- Column ids the result doesn't have are dropped from every section.
- Columns the column view doesn't know are appended to the order, with the result's action default hidden, pinned and width.
- The column view's calculated columns are kept. The tab's own are not.

**Three layers.** A tab's grid is built from these, each over the one before:

1. **Action default.** The action's declared `columns:` as AG Grid `initial*` settings, or the columns inferred from the rows.
2. **The applied column view,** or the tab's own state when it has one.
3. **The tab's own changes.** The tab keeps the grid's column and filter sections in its `gridState`, in IndexedDB, as they change.

When the grid is ready, it resets to the action default (`resetColumnState()`). It then applies the first of these that exists: the tab's `gridState`, the column view applied for the tab's preset or action, or the action default. The state goes on with `setState()`, leaving alone the sections the column view doesn't have.

**Views panel.** The grid's side bar of an action tab has a Views panel beside Columns and Filters (and the [Action file panel](#action-file-panel)).

- **Header:** "name (applied) • modified". "Modified" shows when the tab's grid differs from the baseline it started with.
- **Save…** opens the Save column view dialog: Name and **Share with everyone**. When you own the tab's column view, it offers **Update "name"** or **Save as new**; otherwise **Save**.
- **Apply** makes the tab's column view the applied one. It is disabled while the tab is modified, when it is already applied, or when the column view is gone. For the action default, it clears the applied column view.
- **Revert** puts the tab's column view back as it was picked.
- **New tabs start with "name"** shows the applied column view, with × to go back to the action default.
- **Hidden** switch: includes the column views the analyst hid.
- **List:** Action default; the column views saved from this preset (on a tab without a preset, from this action); then **Other views**, ranked "N of M columns match" and left out when none match. TIM's `tim:` columns and AG Grid's own don't count.
- **⋯** per column view: Hide or Unhide, and for the owner Delete….
- Picking a column view puts it on the tab, and replaces the tab's filters.
- The column views are refetched each time the panel opens.

The status bar has a panel "View: name (applied) • modified".

**Applied column views.** An analyst applies a column view for a preset or an action, and new tabs opened from it start with it.

- It is kept per analyst and per browser, in IndexedDB `applied_views`. It does not follow the analyst to another browser.
- Open tabs don't change.
- A preset never falls back to its action's applied column view.
- A tab with no `gridState` of its own, such as a clone, starts with the applied column view.
- When the applied column view is gone, the tab starts with the action default and warns: "Column view "name" is gone, so the tab starts with the action default." The entry is then removed.
- Bootstrap loads the applied column views for the signed-in analyst, and drops the entries of presets that are gone.

**Storage.** The API stores column views in `column_views`, and each analyst's hidden marks in `column_view_hidden` ([Persistence](#persistence)). The rules mirror presets.

- `GET /api/columnViews` returns the caller's column views and the shared ones, oldest first, each with `owned` and `hidden` for the caller.
- The server assigns `viewId`, `owner` (from the token) and the timestamps.
- `404` for an unknown column view or someone else's private one. `403` for a change by someone who does not own it.

### Action file panel

The Action file panel exports an action tab's column layout as the `columns:` block of an action file ([actions.md](actions.md#columns)), so a layout the analyst built can become the action default.

- **Where.** The Action file panel is in the action tab's side bar, beside Columns, Filters and Views. It shows the live `columns:` block, kept up to date as the columns change, with **Copy**.
- **Copy column settings (action file).** The same block is in the right-click menu, in its own group after the sinks and above Copy link, and in the column menu after AG Grid's items.
- **Generated in the browser** from the tab's grid state (`web/src/features/action-column-views/actionFileColumns.ts`).
  - Each column is in grid order, which is AG Grid's column order, so a pinned column keeps its place.
  - An entry has `name`, `type`, `title` (when the header isn't the name), `hidden`, `width` (when not the default: 200, or TIM's own for its columns), `pinned`, `sort`, `group` and `calculated`.
  - It includes the calculated columns the analyst made. Their type is the dialog's type, else `string`.
  - TIM's own `tim:` columns are in it only when they differ from TIM's settings or sit before a result column.
  - Filters are left out.
- **Limits.**
  - `columns:` has no sort or group index, so several sorts or groups follow the order of the block.
  - TIM's own columns left out after the last result column keep TIM's order, even when the analyst reordered them.

### Sinks in the browser

`web/src/features/sinks/` runs sinks on selected rows without opening a tab.

- **Input.** The full selected rows (every column) come from the tab's IndexedDB copy, with the run's columns as `{name, type}`. So a sink runs on rows of an expired run too.
- **Polling.** The run is polled in the background: every second for ten polls, then every 3 s.
- **Result.** It ends in a toast: "<Sink name>: N rows", or the error with **Retry**, which resends the snapshot kept in memory.
  - There is no Retry for a `413` ("Too much to send; select fewer rows"), a `422`, or a run the browser lost track of.
- **After a reload.** Pending runs are kept in localStorage `tim-pending-sink-runs`. Their result shows once, without Retry.
- **Last sink.** localStorage `tim-last-sink` holds the last sink run.
- **Where it is offered.**
  - The Annotate dialog's "After tagging, run…" picker, for **Annotate…** only: **None** or one sink, preselecting the last used. The button reads "Save and run <name>". The `PATCH` goes first and the sink starts only after it succeeds; a failed sink rolls nothing back.
  - The grid's context menu, under the sink's menu path after **Pivot**.
  - Both are disabled over `maxAnnotationIds` rows, with the reason ("At most 10,000 rows; 23,412 selected").
  - Sinks are not in the New menu or in **Pivot**. With no sinks installed, the picker and menu items are hidden.

### Annotations in the browser

`web/src/lib/annotations/` keeps the annotations of every `id` the browser has seen, apart from any tab's rows ([ADR-0020](adr/0020-annotations-in-postgres.md)).

- **The store.** `apply` writes each `Annotations` newer than the stored one to IndexedDB `annotations`, so the newest `version` wins. It then tells the listeners of every tab of the browser, over a `BroadcastChannel` named `tim-annotations`.
- **Where annotations come from.** Each applied change has a source:
  - `rows`: the `annotations` of a page of a run's rows;
  - `own`: the answer to the analyst's own `PATCH`;
  - `feed`: the change feed.
- **The poller.** One poller runs per browser: the tab that holds the Web Lock `tim-annotations-poller`. The other tabs queue for the lock, and take over when the holder closes.
  - It reads the feed from the cursor in `annotation_sync` when it starts, every `annotationPollSeconds` (30 by default), when its window gets focus, and when asked.
  - It is asked soon after the analyst's own change. A tab that doesn't hold the lock asks the holder through the channel.
  - It reads page after page while the answer has `hasMore`, and saves the cursor after each page.
  - A failed read is tried again at the next poll.
  - Without Web Locks every tab polls.
- **Starting.** Bootstrap (`web/src/app/useBootstrap.ts`) starts the poller once the instance is loaded, with the instance's `limits.annotationPollSeconds`.
- **A new browser** starts at cursor `0` and reads the whole feed.

### Grid annotating

An action tab's grid labels, tags and comments on rows by `id` ([ADR-0006](adr/0006-ag-grid-enterprise.md): the context menu is the only UI for it). The code is in `web/src/features/labels/`, `web/src/features/annotate/` and `features/action-tab/ActionResultsGrid.tsx`.

- **How a row shows its label.**
  - The row's fill, a stripe on its left edge and a symbol in the selection column.
  - The label's `colour` and `symbol` pick them from the theme's palette (`label` and `labelStripe` in `web/src/app/theme.ts`, light and dark).
  - A stored key that the labels file no longer lists shows grey, as its bare key, with no symbol.
  - Every row with the same `id` shows it, in any tab.
- **The Label column.** Column `tim:label` holds the label's name. It is hidden until the analyst shows it, and it has a set filter and can be grouped.
- **Comment column.** Column `tim:comments` has the header **Comment**, is shown, is about 280px wide and has a text filter on the shown text.
  - **Cell.** It shows the analyst's own comment. Without one it shows the latest other comment, dimmed and italic, as "author: text", with the author's UPN before the `@`. A line break shows as ⏎.
  - **+N.** A chip counts the other current comments the cell doesn't show.
  - **Tooltip.** It lists every current comment, the analyst's first, with author and time. A row without an `id` says it can't have comments.
  - **Editor.** Double-click, Enter or F2 opens a popup editor under the cell. It holds the analyst's comment, with the others' read-only. Enter or clicking away saves, Shift+Enter is a new line, Esc cancels, and a blank text clears the comment. Typing a letter doesn't start an edit, so T, C, D and the label digits keep working.
  - **Save.** It sends a `PATCH /api/annotations` for the row's `id`, so every row of that `id` updates. A failed save keeps the old value and shows the toast "Couldn't save the comment: …".
  - **TIM's own column.** A declared `type` on it is ignored, the Action file panel writes it as `type: string`, and a saved column view's number filter on it is dropped when the view loads.
- **Hidden columns.** The analyst can show two more. A declared `tim:` column in the action's `columns:` sets up any of TIM's four columns, including whether it starts hidden ([Actions](actions.md#columns)).
  - **Tags** (`tim:tags`) holds the row's tags. Its set filter lists each tag once, plus "(no tags)", and it can be grouped.
  - **Comment text** (`tim:commentText`) holds the text of the row's current comments, and has a text filter.
- **Label ▸.** The right-click menu has a **Label** submenu for the selected rows, or for the clicked row when none is selected.
  - It lists the instance's labels in file order, each with a colour swatch and its key 1 to 9.
  - A label is checked when every target row with an `id` has it.
  - **Clear label** (0) comes last.
- **Annotate… and Comment….** The menu has both after **Label ▸**, for the same target rows.
  - **Annotate…** (T) opens the Annotate dialog. It saves the label, the tags and the analyst's comment as one change.
  - **Comment…** (C) opens the same dialog with the comment only.
  - On one row, the comment box starts with the analyst's comment, and emptying it clears the comment. On several rows it starts empty and, when the analyst has a comment on some of those ids, says "Replaces your comment on N of these ids". An empty box leaves comments alone.
  - They are disabled, with the reason as a tooltip, in the same cases as **Label ▸** (see Targets).
- **Row detail.** The menu has **Row detail** (D) after **Annotate…** and **Comment…**, in the same group. It acts on the clicked or focused row only.
  - It is never disabled, also on a row without an `id`.
  - It opens Row detail on that row. D closes it.
- **Menu order.** In an action tab the menu lists:
  - **Label ▸**, **Annotate…**, **Comment…** and **Row detail**;
  - the action's extra items, such as pivots;
  - the sinks, **Copy column settings** and **Copy link**;
  - copy and export.
- **Row detail layout.** The side panel (`RowDetail.tsx`, opened by `useRowDetail.tsx`) is 900px wide, capped at 100% of the grid's container. Its header reads "Row detail · row N · D closes · ↑↓ move rows", with a close button. From the top it shows:
  - a header band with:
    - the `id` and a copy button;
    - its current label with a swatch;
    - who set the label and when;
    - its tags;
  - for a row without an `id`, the reason in place of the band: "No id: set Id column and run again to annotate" or "No id: this action gives its rows no id";
  - the row's fields;
  - the **Comments and history** section.
- **The fields.** They follow the run's column order: the declared columns first, then the order the query returned them, hidden columns included (`web/src/features/grid/detailText.ts`).
  - The grid's column moves are ignored. Keys not among the columns come last.
  - Empty values are left out.
  - Objects show in a YAML-like layout.
  - A value of more than 180 characters or more than 3 lines is clamped, with **Show all (N characters)**.
  - Each value and the `id` has a copy button. Objects copy as JSON. A toast reports "Copied <name>".
- **Comments and history.** This section holds a comment box, then the other analysts' current comments, then the `id`'s history, newest first: label changes as "old → new", and every version of the comments.
  - The box starts with the analyst's current comment. **Save** replaces it, and saving it empty clears it.
  - In the history, an earlier version of an author's comment reads "· edited", and an empty one "· cleared their comment".
  - The section folds, and the fold holds for every row while the page is open.
  - A comment draft is kept per `id` while the analyst moves between rows, and dropped when the panel closes.
- **Following the row.** Row detail follows the focused row (`onCellFocused` and `onCellKeyDown` on `ResultsGrid`), and keyboard focus stays in the grid. It takes the `id`'s annotations from the browser annotation store, so a change from the feed, such as a teammate's comment after a poll, updates it. The history comes from `GET /api/annotations/history`.
- **The Annotate dialog.**
  - **Label.** Keep, each label or Clear, with a "Now: …" line for the targets' current label.
  - **Tags.** A tag held by only some of the targets is dashed, with "n/total". Clicking it adds it to all. A removed tag is struck through, and clicking it undoes the removal.
  - **Suggestions.** From `GET /api/tags/suggestions`, in the groups "Your recent tags" and "Most used".
  - **Comment.** A text field. It replaces the analyst's comment on every target.
  - **Save.** Sends one `PATCH /api/annotations`. A failed save keeps the dialog open and shows the error.
- **Right-click.** Opening the context menu of any results grid on a row that isn't selected selects just that row first (`makeGetContextMenuItems` in `web/src/features/grid/gridOptions.ts`).
- **Keys.** 1 to 9 set the label at that place in the list, and 0 clears it. T opens Annotate… and C opens Comment…. They act on the selected rows, or the focused row when none is selected. D opens or closes Row detail on the focused row. They do nothing while a cell is edited, or with Ctrl, Cmd or Alt held.
- **Targets.** The target is the distinct `id`s of the rows. Rows without an `id` are skipped. The items are disabled, with the reason as a tooltip, and a key shows it in a toast, when:
  - there are more than `maxAnnotationIds` ids: "At most 10,000 ids; 23,412 selected";
  - no target row has an `id`, and the action has an `idColumn` param (Run KQL): "No id: set Id column and run again to annotate";
  - no target row has an `id`, and the action has no such param: "No id: this action gives its rows no id".
- **Feedback.** One `PATCH /api/annotations` sets the label of every target, and a toast reports it. The Annotate dialog's own save reports "Annotated N ids", "Commented on N ids" or "Nothing to change".
  - "Labelled 3 ids Malicious", or "Cleared the label of 3 ids". Ids that already had the label are left out of the count.
  - "Already Malicious" or "No labels to clear" when nothing changed.
  - A failure shows "Couldn't label: …".
- **Flash.** A change that arrives from the feed, such as a teammate's, flashes the rows it changes.
- **Row updates.** The grid keeps a map from each `id` to its rows. A changed `id` updates all of them with one AG Grid transaction.

### Runtime configuration

`index.html` loads `/config.js`, which sets `window.appConfig`.

- The web container renders it at start from environment variables (`docker-entrypoint.sh`).
- `web/public/config.js` is the development version.
- Values are validated at load. An invalid or missing key shows a configuration error page.

| Key | Meaning |
|---|---|
| `auth.clientId`, `auth.authority` | Entra app registration and authority (`https://login.microsoftonline.com/<tenant>`) |
| `redirectUri` | MSAL redirect page (`/blank.html`) |
| `apiEndpoint` | API origin; empty means same origin |
| `agGridLicenseKey` | AG Grid Enterprise key; empty runs in trial mode |
| `wikiUri`, `issueUri` | Help links |

`/config.js` and `index.html` are served uncached. Hashed assets under `/assets/` are cached for a year.

### Authentication

The SPA uses the MSAL popup flow with a `localStorage` token cache ([ADR-0005](adr/0005-auth-entra-popup-obo.md)).

- It requests the scope `api://<clientId>/user_impersonation`. One app registration serves SPA and API.
- `/blank.html` is the redirect page. MSAL silent flows load it in a same-origin hidden iframe.
- Tokens are acquired silently for every API call, with `ssoSilent` or a popup as fallback.
- A `401` triggers one retry with a fresh token.
- A development stub (`VITE_AUTH_STUB=true`) exists. It throws in a production build.

## API architecture

### Stack

- Python 3.12, FastAPI on uvicorn.
- `tim-actions`, the provider interface, a uv workspace member in `api/tim-actions`.
- pydantic and pydantic-settings.
- PyJWT, for token validation.
- `msal`, for OBO.
- `azure-kusto-data`, for queries, in the `tim-actions` `kusto` extra.
- `snowflake-connector-python`, for SQL, in the `tim-actions` `snowflake` extra.
- SQLAlchemy 2 with asyncpg, and Alembic, for PostgreSQL.

### Module layout (`api/src/tim_api`)

| Module | Responsibility |
|---|---|
| `main.py` | App factory, lifespan (provider loading included), health routes, middleware order |
| `config.py` | Settings from `TIM_*` environment variables |
| `errors.py` | Problem-details body and exception handlers |
| `deps.py` | FastAPI dependencies returning the storage and its preset, column-view, run and annotation stores |
| `models_common.py` | Shared Pydantic building blocks: camelCase `ApiModel`, UTC datetimes, non-blank strings |
| `observability.py` | Trace ids, logging, body-size limit, request logging, CORS |
| `actions/` | Provider discovery, action-file loading and startup validation (`registry.py`), the instance description (`instance.py`, `models.py`), and the endpoints `GET /api/instance` and `POST /api/actions/{key}/resolve` (`router.py`) |
| `cli.py` | The `tim-api` command: `schema actions`, `schema connections`, `schema labels` and `check` |
| `annotations/` | `/api/annotations` and `/api/tags/suggestions` routes (`router.py`) and the `Annotations` models |
| `auth/` | Token validation (`jwt.py`), caller resolution (`dependencies.py`), OBO (`obo.py`) |
| `connections/` | `POST /api/connections/{name}/schema` (`router.py`) and its models |
| `runs/` | `/api/runs` routes (`router.py`), models, the run lifecycle (`runner.py`), rows, columns and caps (`results.py`), and the connections a run reaches (`connections.py`: the instance's `Connections`, and one run's hooks) |
| `presets/` | `/api/presets` routes (`router.py`) and models |
| `column_views/` | `/api/columnViews` routes (`router.py`) and models |
| `storage/` | Storage interfaces, PostgreSQL and in-memory implementations, retention loop |
| `openapi_meta.py`, `openapi_export.py` | OpenAPI post-processing and spec export |

Database migrations are in `api/migrations` (Alembic).

`tim-actions` (`api/tim-actions/src/tim_actions`) is a separate distribution that providers depend on instead of `tim-api` ([ADR-0021](adr/0021-tim-actions-and-derived-images.md)):

| Module | Responsibility |
|---|---|
| `action.py` | `Action`, the base of query action types, with its menu path, pivot columns and `resolve()` |
| `pivots.py` | `PivotContext`, `PivotCell`, `Resolved`, `resolve_pivot` and the default `resolve()` |
| `params.py` | `Param` and `validate_params`: declaration checks, then validation and conversion of values |
| `columns.py` | `Column` |
| `connections.py` | `Connection`, the base of a connection type's entries in the connections file |
| `connections_file.py` | The connections file: the loader (`load_connections_file`) and the JSON Schema (`connections_file_schema`) |
| `labels_file.py` | The labels file: `Label`, the default labels, the loader (`load_labels_file`) and the JSON Schema (`labels_file_schema`) |
| `hooks.py` | `Hook`, the base of a connection type's access, with its `Connection` model and `editor`, and `EditorSchema` |
| `run.py` | `RunContext`, the protocol `run` is given, `Analyst` and `RunError` |
| `rows.py` | `RowId`, how a row's `id` is taken from it, and `IdColumns` |
| `provider.py` | `Provider` and the `tim.actions` entry-point group |
| `files.py` | Action files: `ActionDocument`, `Sidecar`, the loader (`load_action_files`), `add_file_actions`, which adds the loaded actions and reports duplicate keys and the reserved `tim.` prefix, and the JSON Schema (`action_files_schema`) |
| `query_parameters.py` | What Run KQL and Run SQL share: `TakesQueryParameters`, the base of an action with a `parameters` param, `checked_parameters`, which checks it, and `preset_file_params`, which makes a preset's query parameters the params of its action file |
| `kusto.py` | The `kusto` connection type (`KustoConnection`, `KustoHook`) and the built-in Run KQL action and `kql_query` action type; needs the `kusto` extra |
| `snowflake.py` | The `snowflake` connection type (`SnowflakeConnection`, `SnowflakeHook`), the built-in Run SQL action and the `snowflake_query` action type, and how values are bound (`bind_value`, `bind_values`); needs the `snowflake` extra |
| `builtin.py` | TIM's built-in provider |
| `testing/` | `tim_actions.testing`: `run_action`, `run_sink`, `resolve_pivot`, `load_actions` and `Connections`, and `plugin.py`, the `pytest11` plugin with the `tim_analyst`, `tim_connections`, `tim_kusto` and `tim_snowflake` fixtures ([actions.md](actions.md#testing)) |

### Request flow and middleware

Middleware, outermost first:

1. **`LazyCORSMiddleware`**: origins from `TIM_CORS_ALLOWED_ORIGINS`. It adds no CORS headers when that is empty.
2. **`RequestLoggingMiddleware`**: assigns the trace id and logs one line per request. It adds `x-trace-id`, `x-content-type-options: nosniff` and `cache-control: no-store` to every response.
3. **`BodySizeLimitMiddleware`**: answers `413` above `TIM_MAX_REQUEST_BYTES`, checked on `Content-Length` and on streamed bytes.

Then the route runs. Its dependencies resolve the caller (`get_current_principal`), settings, storage and clients.

- The trace id is a valid W3C `traceparent`, else a sane `x-request-id`, else generated.
- Logs contain method, path (no query string), status, duration and trace id.
- Headers and bodies are never logged.

### Actions and providers

Actions come from providers ([ADR-0017](adr/0017-actions-from-providers.md)):

- An **action type** is a Python subclass of `tim_actions.Action` (a query action, which yields rows) or `tim_actions.Sink` ([Sinks](#sinks)) that implements `run`.
- An **action** is a configured instance of one, with a `key`, `name`, `menu` and `description`. A query action also has `params`, `pivot`, `columns` and `id`.
- A **provider** is a callable that a package exposes in the `tim.actions` entry-point group. It returns `Provider(actions, action_types, hooks)`.

TIM's built-in provider (`tim_actions.builtin`, in the `tim-actions` distribution) registers the same way.

- Each connection type is included when its extra is installed.
  - The `kusto` extra adds the `kusto` connection type, the `kql_query` action type and the action **Run KQL** (`tim.run_kql`).
  - The `snowflake` extra adds the `snowflake` connection type, the `snowflake_query` action type and the action **Run SQL** (`tim.run_sql`).
- With neither extra, the provider is empty.

Loading happens once, in the lifespan, before storage is opened:

1. `discover_providers` calls every entry point. `create_app(providers=...)` skips discovery and takes the given providers instead.
2. `build_registry` indexes actions by key, file-capable action types by `type_name`, and hooks by connection type.

Any of these problems stops startup. Every problem is listed, and each names its entry point and distribution. The error is `InstanceConfigError`, which prints `Invalid instance:` and the problems.

- An entry point that fails to load, raises, or doesn't return a `Provider`.
- An invalid action. `Action`, `Param` and `Column` are pydantic models that check themselves when they are built. The registry validates each action again from its fields.
- A key outside lowercase letters, digits, `_`, `-` and `.`, or a `tim.` key from any distribution but `tim-actions`.
- A duplicate action key, `type_name` or connection type.
- A file-capable action type without a `File` model.

The **connections file** and the action files then add problems of their own, below.

**Action files** ([actions.md](actions.md#action-files)) come next, once every provider's action types are indexed. So a file can name an action type from any provider.

- `build_registry` loads each provider's package-data directory (`Provider(action_files=...)`), then `TIM_ACTIONS_DIR`, in that order.
- Each directory is read non-recursively: `*.yaml` and `*.yml`, in file name order.
- Dot-entries are skipped, so a ConfigMap's `..data` is skipped.
- `tim_actions.files.load_action_files` parses each file with PyYAML, keeping timestamps as strings. It takes each YAML document as one action:
  1. `type` picks the action type by `type_name`.
  2. Each `<field>_file` of a field marked `Sidecar` is replaced by that file's text, read next to the action file.
  3. The type's `File` model validates the document, and `Action.from_file` builds the action, which validates it again as an `Action`.

Each document is validated on its own, so a file reports all of its problems at once.

- A problem names the file and the line of the field, from the YAML nodes: `<file>:<line>: <field>: <message>`.
- A field given twice in a mapping is a problem too.

Action files add these to the problems that stop startup:

- a file that isn't YAML or UTF-8, or a document that isn't a mapping;
- an unknown `type`, an unknown field, or a value its `File` model or the action rejects;
- a missing sidecar, a sidecar given as a path rather than a file name in the action file's directory, or both `<field>` and `<field>_file`;
- a key already taken by another file or a Python action, or a `tim.` key outside the built-in distribution's package data.

The **connections file** (`TIM_CONNECTIONS_FILE`, [actions.md](actions.md#connections-file)) is read after the providers, so each entry can name a connection type from any provider.

- It is a YAML list.
- `load_connections_file` validates each entry with the `Connection` model of the hook for its `type`.
- A problem is reported as `<file>:<line>: <field>: <message>`.

These stop startup:

- a file that isn't YAML or UTF-8, isn't a single document, or isn't a list of mappings;
- a missing or unknown `type`, an unknown field, or a value the type's model rejects. `name` is lowercase letters, digits and `-`. `obo` needs a `scope`, which a connection type may default;
- a duplicate connection name;
- an action's fixed connection that isn't in the file or is of another type. `Action.connections()` maps each name to the connection type it must have.

An action with a `connection` param is left out of the catalogue when the instance has no connection of the param's `connection_type`.

- An info log line says so, such as `Action tim.run_kql left out: no kusto connection for its connection param`.
- Without a connections file there are no connections, so Run KQL is left out.

The `tim-api` command (`cli.py`):

- **`tim-api check`** runs `build_registry` the same way, without the rest of the lifespan. So it needs no settings, database or credentials ([operations.md](operations.md#tim-api-check)).
- **`tim-api schema actions`** prints `action_files_schema`: one `File` model per installed type. `type` is fixed to its `type_name`, and each sidecar field accepts `<field>_file` instead.
- **`tim-api schema connections`** prints `connections_file_schema`: a list whose entries are one `Connection` model per installed connection type, told apart by `type`.

The registry serves the catalogue and the connections in `GET /api/instance` ([api.md](api.md#instance)), built once at startup.

- Its `version` is a hash of:
  - the provider distributions (name and version);
  - the name (relative to its directory) and content of every action file, sidecar and connections file read;
  - the rest of the body.
- So `version` changes whenever the catalogue, an installed provider or a file does.
- Actions run through `/api/runs` ([Runs and rows](#runs-and-rows)).
- A pivot into an action is resolved through `POST /api/actions/{key}/resolve`. At most `TIM_MAX_PIVOT_ROWS` rows (default 100) are accepted.

Params are declared as data: `Param(name, kind, title, required, default, many, choices, connection_type, schema_from, from_columns, help)`.

- **`kind`** is `string`, `number`, `boolean`, `datetime`, `timespan`, `json`, `kql`, `sql` or `connection`.
- **`tim_actions.validate_params`** validates and converts the values in a request:
  - a `datetime` is an ISO 8601 string, UTC when it has no offset;
  - a `timespan` is an ISO 8601 duration or `HH:MM:SS`;
  - a `number` is a JSON number, or a whole number as a string of digits, which becomes an integer;
  - a `many` param is a list;
  - a `connection` param is the name of a connection of its `connection_type`;
  - a missing or blank value takes the default;
  - errors are keyed `params.<name>`.
- **`pivot.columns`** in the catalogue comes from `Action.pivot_columns()`. Each required param's `from_columns` is one group, and a row needs one column from each.
- **`Action.resolve(context)`** gives the params of a pivot from a `PivotContext` (`rows`, `cell`) as a `Resolved` (`params`, `missing`). `missing` maps each unfilled param's name to its reason, or `None`.
  - The default takes, for each param with `from_columns`, the first non-empty of those columns in each row.
  - A `many` param takes the distinct values in first-seen order.
  - A single-valued param takes the value the rows agree on. When they disagree it is missing, with the reason "The N selected rows have different <Title> values".
  - A required param with no value and no default is missing, with no reason.
- **`resolve_pivot(action, rows, cell)`** trims the rows, and the cell, to the union of `pivot_columns()` and every param's `from_columns`, then calls `action.resolve()`. An overridden `resolve()` sees only those columns.
- **`pivot`** is set by every action and has no default. `row` or `rows` offers the action on one or several selected rows. `none` keeps it out of the context menu.

### Authentication and OBO

- **Token validation.** Bearer tokens are validated against the tenant JWKS: RS256 only, cached for one hour, with a rate-limited refetch on an unknown `kid`. The checks:
  - signature;
  - `aud`: `api://<clientId>` or the bare client id;
  - `iss`: the v1 or v2 issuer of the configured tenant;
  - `tid`;
  - required `exp`, `nbf` and `iat`, with 60 s leeway.
- **The caller** is a `Principal`: `oid`, `tid`, and a name taken from `unique_name`, then `upn`, then `preferred_username`. The name is the owner and audit identity (`requestedBy`, `createdBy`, `updatedBy`).
- **OBO exchange.** Runs exchange the caller's token for each `obo` connection's scope with `msal.ConfidentialClientApplication.acquire_token_on_behalf_of`.
  - Runs call it through `OboTokenProvider.token_for(principal, scope)`. It blocks, so callers use a worker thread.
  - There is one MSAL app, and one token cache, per process.
  - The credential is `TIM_AUTH_CLIENT_SECRET` or a federated token file (`AZURE_FEDERATED_TOKEN_FILE`).
  - With neither, startup fails when auth is enabled and a connection uses `obo` (`OboConfigError`). Otherwise OBO answers `503` when it is used.
- **Hooks never see the caller's token.** A hook is given a `token_for(scope)` callable.
  - Before `POST /api/runs` creates a run, TIM validates the params and works out the run's connections: the action's fixed ones and its `connection` params' values.
  - It then gets each `obo` connection's token, so consent, MFA and missing-token errors answer the `POST` ([ADR-0009](adr/0009-obo-token-exchange.md)).
  - The hook's own calls are then served from the token cache.
- **OBO failures:**
  - `invalid_grant` or `interaction_required` gives `403 consent-required`, and the SPA prompts again;
  - an Entra or network failure gives `502`;
  - OBO not available (auth disabled, or no token) gives `503`.
- **`TIM_AUTH_DISABLED=true`** runs every request as the analyst its stub token (`dev:<upn>`) names, or a fixed development user without one. It disables OBO. Settings validation fails at startup when it is combined with `TIM_ENVIRONMENT=production`, the default environment.

### Connections and hooks

Connections are fixed by the operator ([ADR-0018](adr/0018-fixed-connections.md)):

- A **connection** is one fixed endpoint of a connection type, listed in the connections file.
- A **hook** (`tim_actions.Hook`) is the access to one connection of a connection type. It is built per run, as the analyst, with its connection and a `token_for(scope)` callable.

A hook class sets:

- `connection_type`;
- its `Connection` model, for the type's entries in the file. It extends `tim_actions.Connection` (`name`, `title`, `type`, `auth`, `scope`) with its own fields;
- `editor`: `kql` for Kusto, `sql` for Snowflake.

`Connections` (`runs/connections.py`) holds the instance's connections and hooks. For a run, it:

1. opens the connections the run uses;
2. gets each `obo` connection's token, on a worker thread;
3. gives the run a `RunConnections`, whose `hook(name)` builds a new hook.

An action reaches a connection only through `ctx.hook(name)`. It refuses a connection the run didn't declare: one in the action's `connections()`, or one named by its `connection` params.

The `kusto` connection type (`tim_actions/kusto.py`, extra `kusto`) has the fields `cluster`, `databases` (optional) and `scope` (optional), and the auth `obo`:

- `cluster` gets the URL shape checks and normalisation to `https://<host>` ([configuration.md](configuration.md#connections)) when the file is read.
- `scope` defaults to `{cluster}/.default`.
- `databases` are suggestions the browser offers for the `database` param. They don't restrict it.

`KustoHook` runs the synchronous `azure-kusto-data` client on a worker thread, with a token from `token_for`.

- It passes the time left until the run's deadline as the Kusto server timeout.
- It sets the client request id `TIM.RunKql;<uuid>`.
- `cancel()` sends `.cancel query` for the queries in flight, and refuses new ones.
- Result values are serialised (datetime, timespan, decimal, dynamic, guid), and every `PrimaryResult` table is concatenated.
- Columns are declared from Kusto's types.
- The query's execution metrics are reported as run details: `executionTime`, `cpuTime`, `memoryPeakPerNode`, `extentsScanned` and `extentsTotal`.
- Kusto errors become sanitised messages: stack-trace lines removed, capped at 2000 characters.
- `KustoHook.query(database, kql, *, deadline, parameters=None)` sends `parameters` as query parameters in `ClientRequestProperties`. `parameters` maps each name to its Kusto literal text.

The `snowflake` connection type (`tim_actions/snowflake.py`, extra `snowflake`) has the fields `account`, `warehouse`, `role` (optional) and `scope`, and the auth `obo` and `workload_identity`:

- `account` is an account identifier such as `myorg-myaccount`, not a URL or host name. The file's loader rejects anything else.
- `obo` has no default `scope`, so the file must give one.
  - `SnowflakeHook` logs in as the analyst with `authenticator="oauth"` and the token from `token_for(scope)`. Snowflake accepts it through an External OAuth security integration ([deployment.md](deployment.md#snowflake-app-registration-and-external-oauth)).
- `workload_identity` logs in as TIM, with the authenticator `WORKLOAD_IDENTITY` and the provider `AZURE`. It uses TIM's managed or workload identity, with no OBO exchange. A `scope` on it is refused when the file loads ("scope is only for auth obo").
  - Every analyst gets TIM's access, which is the operator's choice ([ADR-0018](adr/0018-fixed-connections.md)).
  - An instance whose connections are all `workload_identity` needs no OBO credential.

`SnowflakeHook` runs the synchronous `snowflake-connector-python` client on a worker thread, with one login per query and no pooling across analysts.

- `SnowflakeHook.query(sql, *, deadline, params=())` sends the SQL unchanged, with `params` bound server-side by position (`paramstyle` numeric): `:1` is the first. The connector's default `pyformat` binds on the client, so it isn't used.
- It logs in with the session parameter `TIMEZONE=UTC`, so a bound datetime, which is UTC without its offset, is read in UTC. It also sets the time left until the run's deadline as the session's `STATEMENT_TIMEOUT_IN_SECONDS`.
- It runs the query asynchronously, so `cancel()` aborts it on Snowflake by its query id, and refuses new ones.
- Columns are declared from Snowflake's types: numbers, booleans and datetimes keep their kind, `VARIANT`, `OBJECT`, `ARRAY` and the geography, geometry, vector and map types are `json`, and the rest are `string`.
- Result values are serialised (datetime as UTC ISO 8601, decimal, binary as hex).
- Snowflake errors become the run's error with Snowflake's own message, without the connector's code and ids, capped at 2000 characters. A login failure is a run error too.

A hook can also give the editor schema of its connection: `Hook.editor_schema(scope)`.

- It returns an `EditorSchema` of a `kind` and a `schema`, or `None`.
- `scope` holds the values of the editor param's `schemaFrom` params, without its `connection` param.
- `KustoHook` runs `.show schema as json` in the scope's `database`, and returns kind `kql`. Without a `database`, it returns `None`.
- `SnowflakeHook` returns kind `sql`: `{databases: [{name, schemas: [{name, tables: [{name, columns: [{name, type}]}]}]}]}`.
  - It reads `SHOW TERSE DATABASES`, then each database's `INFORMATION_SCHEMA.COLUMNS`. It leaves out a database the login can't read.
  - It takes no scope values.
- A Kusto or Snowflake error, or an unrecognised Kusto result, is a `RunError`.

`POST /api/connections/{name}/schema` ([api.md](api.md#post-apiconnectionsnameschema)) serves it:

1. It gets the connection's `obo` token, as `POST /api/runs` does.
2. It calls the hook on a worker thread.
3. It answers `204` for `None`, and `502` with a `RunError`'s message.

In the browser, an editor param with `schemaFrom` loads its schema once its connection and scope params have values that have stayed unchanged for 400 ms.

- Schemas are cached per connection and scope.
- `useEditorSchema` in `web/src/features/action-tab/editorSchema.ts` loads, caches and settles the schema. It hands `{kind, schema, connection, scope}` to a callback, and does not touch the editor.
- The browser has one completion adapter per kind, in `web/src/features/action-tab/editorSchemaAdapters.ts`. The Query editor in `ActionTab.tsx` applies it from that callback.
- The `kql` adapter gives Monaco's Kusto worker the schema, with the connection name where Monaco wants a cluster.
- The `sql` adapter (`web/src/features/action-tab/sqlSchema.ts`) registers a completion provider for Monaco's `sql` language. The Query editor uses that language for `sql` params.
  - It offers the databases, and the columns of the tables the query names in `FROM` and `JOIN` as `db.schema.table`, the path perhaps shortened, with an optional alias.
  - After `DB.` it offers that database's schemas. After a table's alias or name, it offers its columns.
  - `DB.SCHEMA.` gives tables, and `DB.SCHEMA.TABLE.` gives columns.
  - A name is quoted unless it is what an unquoted name resolves to.

**Run KQL** (`tim.run_kql`) is the built-in action on a Kusto connection. It sets `pivot: none`. Its params:

- `connection`: a Kusto connection;
- `database`;
- `kql`: a `kql` param scoped by the `connection` and `database` params;
- `idColumn`, optional: the column that gives each row its `id`. Without it, rows have no `id`;
- `parameters`, optional, `json`: the query parameters, an ordered list of `[{name, type, value}]` ([actions.md](actions.md#query-parameters-of-run-kql)). TIM puts `declare query_parameters(...);` before the KQL and sends the values as Kusto query parameters. `check_params`, from `TakesQueryParameters`, checks the entries and answers `params.parameters.<name>` or `params.parameters`.

A preset of Run KQL has an action file: `preset_file` returns a `kql_query` document ([api.md](api.md#get-apipresetspresetidactionfile)). It returns `None` for a preset that lacks a connection, database or query. The document pivots on `rows` when the preset has From row query parameters and every one of them has columns, else `none`.

**Run SQL** (`tim.run_sql`) is the built-in action on a Snowflake connection. It sets `pivot: none`. Its params:

- `connection`: a Snowflake connection;
- `sql`: a `sql` param scoped by the `connection` param;
- `idColumn`, optional: the column that gives each row its `id`. Without it, rows have no `id`;
- `parameters`, optional, `json`: the query parameters, an ordered list of `[{name, type, value}]` with the types of Run KQL but `timespan` ([actions.md](actions.md#query-parameters-of-run-sql)). `check_params` checks them as for Run KQL.

The run sends `sql` unchanged through `SnowflakeHook.query`, with the parameters bound by position, `:1` the first. A login or query failure is a run error. An `obo` error answers `POST /api/runs`, because TIM gets each `obo` token before the run exists.

A preset of Run SQL has an action file: `preset_file` returns a `snowflake_query` document whose params are the query parameters in order. It returns `None` for a preset that lacks a connection or SQL, or has a `timespan` query parameter.

**`snowflake_query`** (`SnowflakeQuery`, with `SnowflakeQueryFile` as its file model) is a file-capable action type with the fields `connection` and `sql`.

- In files, `sql` can be a `sql_file` sidecar.
- Its params are bound by position, `:1` the first param in the file.
- A param's kind is one of `string`, `number`, `boolean`, `datetime` or `json`. Other kinds stop startup.
- `many` params and `json` are bound as JSON text.
- A `datetime` is bound as a UTC datetime.
- A missing optional value is bound as `NULL`.
- A position with no param is Snowflake's error "Bind variable :N not set" when the run executes.

**`kql_query`** (`KqlQuery`, with `KqlQueryFile` as its file model) is a file-capable action type with the fields `connection`, `database` and `kql`. In files, `kql` can be a `kql_file` sidecar.

- `connections()` returns its `connection` as a `kusto` connection, so the fixed-connection check applies.
- Its params must be of kind `string`, `number`, `boolean`, `datetime`, `timespan` or `json`. The action rejects the others when it is built.
- `run` sends the KQL text unchanged. The params go through `tim_actions.kusto.query_parameters`, which formats each value with `kusto_literal` ([actions.md](actions.md#how-kusto-binds-params), [ADR-0019](adr/0019-params-are-bound.md)).
- A param with no value is left out, so the KQL's `declare query_parameters` default applies.

### Runs and rows

Runs of an action go through `/api/runs` (`runs/`). They follow [ADR-0012](adr/0012-query-run-limits-and-lifecycle.md), with one concurrency semaphore of `TIM_MAX_CONCURRENT_RUNS` per process.

A run:

1. **Start.** `POST /api/runs` looks up the action and validates the params with the action's `check_params`. A `422` comes before a run exists. `Runner.start` stores the run (table `runs`) as `running`, with `expiresAt = now + TIM_RUN_RETENTION_SECONDS`, and starts a tracked asyncio task.
2. **Execute.** The task waits for a concurrency slot, still `running`. Then it runs the action's synchronous `run(params, ctx)` in its own daemon thread.
   - `ctx` gives `analyst`, `deadline` (when the timeout ends), `hook(connection)`, `detail(key, value)` and `declare_columns(columns)`.
   - `hook` refuses a connection the action doesn't declare, either in `connections()` or as a `connection` param's value. It gives one hook per connection per run.
3. **Rows.** The thread passes each yielded row to `ResultBuilder` (`results.py`), which:
   - counts rows and bytes (compact JSON per row, summed);
   - takes the row's `id` with `Action.row_id(params)`;
   - replaces NUL with U+FFFD;
   - builds the columns.

   Rows are written to `run_rows` in batches of 1,000 rows or 8 MiB.

4. **Answer.** The request waits up to about 1 second for the task. It answers `200` with the ended run, else `202` with the `running` run.
5. **End.** The task ends the run, refreshes `expiresAt` and writes its final state:
   - `succeeded`, with `columns` and `rowCount`;
   - `error`, with the message of the action's `RunError`, `Result exceeds limit of N rows` or `N bytes`, or `The run failed unexpectedly` for any other exception, which is logged with the trace id;
   - `timedOut` after `TIM_RUN_TIMEOUT_SECONDS`, counted from taking the slot (`Run exceeded the time limit of N seconds`);
   - `cancelled`.

   Only a succeeded run keeps its rows. The store deletes those of any other outcome when it writes the final state.

6. **Timeout or cancel.** The thread stops writing rows, and `Hook.cancel()` is called on each of the run's hooks from another thread.
   - The run ends once every `Hook.cancel()` has returned or the thread has exited, or after 10 seconds.
   - A thread that never returns is left behind as a daemon.

Cancel (`POST /api/runs/{runId}/cancel`) sets `cancel_requested` on the run.

- The process executing the run acts at once when it took the request.
- Every process also polls each second for cancel requests to the runs it executes, so any replica can take the request. The poll is the heartbeat (see Housekeeping).
- A run cancelled while it waits for a slot never takes one.

`details` holds, in this order:

1. `duration`: seconds, from taking the slot;
2. `rowCount`, when the run succeeded;
3. the action's own `ctx.detail` values, in the order they were reported.

Problems with `id` never fail the run, such as an id column missing from the results or an `id` over 512 characters. They are added to a `warning` detail.

`columns` lists the declared columns first, the action's and then those the run declared. The rest follow in first-seen order. A column's type is inferred from its values:

- `boolean` and `number` as themselves;
- ISO 8601 strings as `datetime`, other strings as `string`;
- objects and arrays as `json`;
- `string` when the values disagree or are all `null`.

`id` comes from `Action.row_id(params)`, a `RowId`.

- By default it is `IdColumns` over the action's `id` column or list of alternatives, taking the first that isn't `null` or `""`.
- It is stored as text: a string as it is (not trimmed), anything else as its compact JSON. So the number `1` and the string `"1"` match.

`GET /api/runs/{runId}/rows` reads a page of `run_rows` by row number. When a succeeded run with rows has none stored, it answers `410`.

Result caps:

- `TIM_MAX_RESULT_ROWS` (1,000,000) and `TIM_MAX_RESULT_BYTES` (512 MiB) apply as they are set.
- A result over a cap fails the run. It is not truncated.
- NUL characters in results and errors are replaced with U+FFFD before storing.

A run that is unknown or expired is `404`, and so is cancelling someone else's run.

Housekeeping:

- **Heartbeat:** each run has a `heartbeat_at`, set to `started_at` when the run is created.
  - Every cancel poll (each second) refreshes it for every run in the process's active set, including runs that wait for a slot.
  - The refresh is one `UPDATE … RETURNING` of the runs still `running`. It also reads their `cancel_requested`.
  - A run the heartbeat no longer finds `running` has ended elsewhere, for example through another process's sweep. The process cancels it locally: `Hook.cancel()` is called and the slot is freed. Its outcome isn't stored.
- **Sweep:** runs still `running` whose heartbeat is older than 15 seconds have lost their process.
  - They are set to `error` (`Run interrupted by server restart`), and their rows are deleted.
  - Every process sweeps at startup and then every 30 seconds.
  - PostgreSQL picks the runs with `SELECT … FOR UPDATE SKIP LOCKED`, so replicas sweeping at once take different runs.
  - A failed sweep is logged and retried at the next interval.
- At shutdown, runs in flight are stopped and marked `error` the same way.
- A background loop deletes runs past `expiresAt` every `TIM_RUN_RETENTION_SWEEP_SECONDS` (300).
  - It deletes ten runs at a time, so each delete of their rows stays short.
  - Expired runs already read as `404` before they are deleted.

### Sinks

A **sink** is an action that takes rows and writes them somewhere, such as a ticket queue ([GLOSSARY.md](../GLOSSARY.md)).

- A sink type subclasses `tim_actions.Sink`, a sibling of `Action` on `ActionBase`. It implements `run(columns, rows, ctx)`, which writes the rows and returns nothing.
- A file-capable sink type's `File` model is a `SinkDocument`: `type`, `key`, `name`, `menu` and `description`, with the type's own fields.
- A sink has no params, `pivot`, `columns` or `id`.
- TIM ships no sinks. `dev_sink` (development only) discards the rows after its `delay`, or fails with its `error`.
- In the catalogue a sink has `kind: "sink"`, `params: []` and `pivot: {rows: "rows", columns: []}`.

`POST /api/runs` takes the rows to write as `input`: `{columns: [{name, type}], rows: [{...}]}`.

- A query action with `input` gives `422` (`input`: "Only a sink takes input"). A sink without it gives `422` ("A sink needs the rows to write").
- At most `maxAnnotationIds` rows are accepted (`input.rows`), and column names must be unique (`input.columns`).
- The size of the input is limited by `TIM_MAX_REQUEST_BYTES`.
- A sink's params must be empty.

The run follows the lifecycle above, with these differences:

- The worker thread calls `Sink.run(columns, rows, ctx)` and no rows are stored.
- The succeeded run has no `columns` or `rowCount`, and its `params` are `{}`.
- `details` holds `duration`, then `inputRowCount`, then the sink's own `ctx.detail` values.
- Timeout and cancel work as for any run, through the sink's hooks.
- `POST /api/actions/{key}/resolve` gives `404` for a sink, and a preset of a sink gives `422` (`action`: "A sink has no presets").

### Presets

Presets are stored in PostgreSQL (`presets`, `preset_hidden`) behind `PresetStore`. The models are in `presets/models.py`.

The routes, under `/api/presets`:

- **`GET`** returns the caller's own presets and the shared ones, oldest first. Each has `owned` and `hidden`: whether the caller owns it and whether they hid it.
- **`POST`** creates a preset: `201`, with the preset. The server assigns `presetId`, `owner` (from the token) and the timestamps.
- **`PUT /{presetId}`** replaces the whole preset. Only the owner can. `owner` and `createdAt` are kept.
- **`DELETE /{presetId}`** deletes it for good, with every hidden mark on it. Only the owner can.
- **`PUT` and `DELETE /{presetId}/hidden`** hide and unhide it for the caller only.
- **`GET /{presetId}/actionFile`** returns the preset as an action file in YAML (`presets/action_file.py`). It asks the action's `preset_file`. It answers `409` `no-action-file` when:
  - the action has no `preset_file`;
  - a Run KQL preset lacks a connection, database or query;
  - a Run SQL preset lacks a connection or SQL;
  - a Run SQL preset has a `timespan` query parameter.

Rules:

- `404` for an unknown preset, or someone else's private one.
- `403` for a `PUT` or `DELETE` by anyone but the owner.
- `422` for an `action` that is not in the catalogue (`errors.action`), an input that is not a param of the action with `from_columns` (`errors["inputs.<i>.name"]`), a query parameter on an action that takes none (`errors["inputs.<i>.source"]`), or a query parameter name that is not an identifier or is used twice.
- Param values are not checked here. They are validated when a run starts.
- Inputs are told apart by `source` and the boolean `fixed`, not by an OpenAPI discriminator.

### Annotations and the change feed

An `id`'s annotations are its label, tags and comments ([ADR-0020](adr/0020-annotations-in-postgres.md)).

The wire shape is the same everywhere: `Annotations = {id, label: {key, by, at} | null, tags, comments, version}`. `version` is the version of the change that last touched the `id`.

**Labels.** The instance's labels come from the labels file, `TIM_LABELS_FILE` ([actions.md](actions.md#labels-file)), read with the action files at startup. Without the file there are three: Malicious, Suspicious and Benign.

- A label's `key` is what annotations store, so changing a label's name or colour changes how rows look, not what is stored.
- `GET /api/instance` lists the labels.

**A change** (`PATCH /api/annotations`) checks the body, then writes in one transaction:

1. It answers `422` for a label key the instance doesn't have, for more than `TIM_MAX_ANNOTATION_IDS` distinct ids, for a body that changes nothing, and for an invalid tag or a blank comment ([api.md](api.md#patch-apiannotations)). Tags and the comment are trimmed.
2. It takes the next version first: `UPDATE annotation_clock SET version = version + 1 RETURNING version`. The lock on that row queues concurrent writers, so the versions are gapless and in commit order.
3. It finds the ids that change: those whose label differs from the one asked for, those that gain or lose a tag, and, for a comment, those where the caller's current comment differs from the one asked for (a `null` comment differs only where the caller has one). `setTags` gains and loses the difference from the current tags.
4. For those it upserts `id_state` with the version.
5. For a changed label it sets the label, who set it (from the token) and when in `id_state`, and adds a row to `label_changes`.
6. It inserts the added tags into `tags` and deletes the removed ones. It inserts a new version of the caller's comment into `comments`, with the author from the token. A clear inserts a row with empty text.
7. It answers with the changed ids' annotations and the version.

A change that changes nothing rolls back. It takes no version, writes no history and answers `changes: []` with the current version.

**State and history.**

- `id_state` has one row per `id` that was ever labelled. Clearing a label keeps the row, with `label: null`, so the removal reaches other browsers through the feed.
- `label_changes` keeps every label change: the label, who changed it, when, and the version.
- `tags` keeps the current tags of each `id`. A removed tag is deleted, with no history.
- `comments` keeps every version of every comment as a row. An author's current comment on an `id` is their newest row, unless its text is empty. Versions are never removed.

**The change feed** (`GET /api/annotations/changes?since=V`) gives the `id`s whose `id_state.version` is above `V`, as they now are, in version order.

- A page ends after a whole version, so it holds at least 1,000 `id`s unless the feed ends there, and more when its last change touches more.
- `next` is the version of the page's last change, and the `since` for the next request. `hasMore` says whether more follow.
- Because versions are gapless and in commit order, a reader that has read up to `V` never misses a lower version that commits later.

**History.** `GET /api/annotations/history?id=` reads `label_changes` and every version in `comments` for the `id` and merges them, newest first. A clear is a `comment` entry with empty text.

- Within one version, the label change comes before the comment.
- Tags are not in it, and it has no paging.
- An `id` that was never changed gives `entries: []`.
- The memory store keeps a history list per `id`.

**Tag suggestions.** `GET /api/tags/suggestions?prefix=` reads `tags`, matching the prefix ignoring case.

- `recent` is the tags the caller added, the most recently added first.
- `mostUsed` is the other tags, on the most `id`s first. A tag the caller added is only in `recent`.
- Each list has at most 10 tags.

**Rows.** `GET /api/runs/{runId}/rows` adds the annotations of its page's `id`s (`annotations`, by `id`) and `annotationVersion`, the version read before them, so the annotations are never older than it.

### Persistence

`storage/` defines `PresetStore`, `ColumnViewStore`, `RunStore`, `AnnotationStore` and a `Storage` bundle (health, close).

- `TIM_DATABASE_URL` selects PostgreSQL (`postgresql+asyncpg://`).
- In development only, `memory://` selects an in-memory store. Production refuses it.
- Alembic migrations create the schema (`alembic upgrade head`).

| Table | Key | Notes |
|---|---|---|
| `presets` | `preset_id` | `owner`, `name`, `visibility` (`private` or `shared`), `action`, `menu_path`, `params` and `inputs` (JSONB), `created_at`, `updated_at`; index on `(created_at, preset_id)` |
| `preset_hidden` | `(preset_id, analyst)` | The presets an analyst hid; `preset_id` references `presets` `ON DELETE CASCADE` |
| `column_views` | `view_id` | `owner`, `name`, `visibility` (`private` or `shared`), `saved_from_action`, `saved_from_preset_id` (null without a preset), `state` (JSONB), `created_at`, `updated_at`; index on `(created_at, view_id)` |
| `column_view_hidden` | `(view_id, analyst)` | The column views an analyst hid; `view_id` references `column_views` `ON DELETE CASCADE` |
| `runs` | `run_id` | `owner`, `status`, `action` and `params` (JSONB), `details` (JSON, which keeps the order of its keys), `columns` (JSONB), `row_count`, `error`, `started_at`, `finished_at`, `expires_at`, `cancel_requested`, `heartbeat_at`; indexes on expiry and `running` runs, none on `heartbeat_at` so its updates can be HOT |
| `run_rows` | `(run_id, ordinal)` | `UNLOGGED`. `ordinal` (the row number), `id` (text), `data` (JSON, which keeps the order of its keys); `run_id` references `runs` `ON DELETE CASCADE`. Kept only for succeeded runs |
| `annotation_clock` | `one` | A single row, checked to be the only one: `version`, the feed's counter |
| `id_state` | `id` | `label`, `labelled_by`, `labelled_at` and `version`; index on `version`. Kept when its label is cleared |
| `label_changes` | `(id, version)` | `label` (null for a clear), `changed_by`, `changed_at` |
| `tags` | `(id, tag)` | `added_by`, `added_at` |
| `comments` | none | `id`, `author`, `created_at`, `text` (empty for a clear), `version`; index on `(id, version)` |

`run_rows` is `UNLOGGED`, so it is not written to the WAL.

- PostgreSQL empties it after a crash, and a replica doesn't have it. `runs` survives.
- Rows of a run that succeeded then read as `410` ([operations.md](operations.md#rows-lost-after-a-crash)).

### Errors and logging

Every non-2xx response is `application/problem+json` ([api.md](api.md#errors)). It has `type` (`urn:tim:problem:<slug>`), `title`, `status`, `detail`, `traceId` and, for validation, `errors`.

- Details are fixed, safe strings: no stack traces, SQL, tokens or upstream bodies.
- Unhandled exceptions are logged with the trace id and returned as a generic `500`.
- Logging is stdlib logging to stderr, at `TIM_LOG_LEVEL`.
- The API exposes no metrics endpoint.

## Security model

- **Identity** comes from the validated token only. The API ignores `requestedBy`, `createdBy`, `updatedBy`, `updated` and `dateTimeUtc` sent by a client. The SPA also strips them.
- **A run is readable by any signed-in analyst who holds its id.** Only the owner can cancel a run; for anyone else, cancel answers the same `404` as for an unknown run.
- **Annotations are instance-wide.** Every signed-in analyst reads and changes the labels, tags and comments of every `id`. The author of a change comes from the token.
- **A run reaches only the connections in the connections file**, whose endpoints the operator chose.
  - Analysts never name an endpoint, so the API cannot be used to forward user tokens to arbitrary hosts.
  - Hooks get a `token_for(scope)` callable and never see the analyst's token.
  - `GET /api/instance` shows a connection's name, title, type, editor and databases. It never shows its cluster, auth or scope.
- **Connections run as the user** (OBO).
- **Development modes fail startup in production:** the auth bypass (`TIM_AUTH_DISABLED`), the development actions (`TIM_DEV_ACTIONS`) and the in-memory store. The SPA's auth stub throws in a production build.
- **Request bodies are capped:**
  - `TIM_MAX_REQUEST_BYTES` on the API (default 64 MiB, `413`);
  - `client_max_body_size 64m` on nginx;
  - queries to 100,000 characters.
- **API responses** carry `x-content-type-options: nosniff` and `cache-control: no-store`.
- **The web container** (nginx, port 8080) sends these on every response, and has `server_tokens` off:
  - `Content-Security-Policy`;
  - `X-Content-Type-Options: nosniff`;
  - `X-Frame-Options: SAMEORIGIN`;
  - `Referrer-Policy: strict-origin-when-cross-origin`;
  - `Permissions-Policy`, with camera, microphone and geolocation off;
  - `Strict-Transport-Security`, behind an https proxy.
- **The CSP** allows:
  - only same-origin scripts, plus `unsafe-eval`, which the Kusto Monaco worker needs;
  - same-origin and `login.microsoftonline.com` for `connect-src`;
  - a cross-origin `API_BASEPATH` origin, when set;
  - `frame-ancestors 'self'` and `object-src 'none'`.
- **nginx proxies `/api/`** to `BACKEND_URI` unchanged, keeping the `/api` prefix, with a 620 s read timeout.
- **The entrypoint** validates every value substituted into `config.js` and the nginx config. It escapes `config.js` content.
- **Logs** never contain tokens, headers, bodies or query strings.
