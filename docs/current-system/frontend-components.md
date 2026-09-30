# Frontend component inventory (legacy Vue 2)

> Paths relative to `frontend/src/`. Screenshots in [screenshots/](screenshots/README.md). Complexity = React rewrite estimate (S/M/L).

## Component tree
```
App.vue
├─ v-toolbar (Hamburger→Query Manager | TIM | Help | Settings | Account)
├─ <router-view>
│   ├─ Welcome ─ NewQueryButton ─ TemplateQuerySubMenu (recursive)
│   ├─ QueryEditor ─ CreateQueryDialog ─ MonacoEditor ×4
│   ├─ ExportImport
│   ├─ ShareQuery (no UI except error; creates component, redirects)
│   └─ OpenTriage
│       ├─ <keep-alive max=100> <component :is=componentName>
│       │    ├─ KustoQueryResult ─ NewQueryButton, TimeSelection, ClusterSelection,
│       │    │                     KustoMonacoEditor, KustoPivot, QueryHelperDialog
│       │    └─ TemplateQueryResult ─ NewQueryButton, KustoPivot
│       │         KustoPivot ─ ColumnView, AgGridVue, ExecutionStatusPanelComponent
│       ├─ DetailSidePanel
│       └─ TagEventDialog
├─ SideQueryTree ─ NewQueryButton, VTreeviewIndependantParent
└─ DefaultSnackbar
Dead: SuppressionDialog.vue, DetailCellRenderer.vue
```

## Summary table
| Component | Purpose | Cx | Screens |
|---|---|---|---|
| App.vue | shell, auth gate, toolbar, draggable dialogs | M | 01–04 |
| Welcome | landing | S | 01 |
| QueryEditor | template CRUD list | M | 33–34 |
| CreateQueryDialog | create/edit template (YAML editors) | M | 35–39 |
| OpenTriage | host for one tab (keep-alive) | M | – |
| ShareQuery | deep-link receiver | S | 00, 41 |
| ExportImport | backup/restore tabs JSON | S | 40 |
| SideQueryTree (+VTreeviewIndependantParent) | tab tree navigator | L | 16, 27 |
| NewQueryButton + TemplateQuerySubMenu | new query / template menu with search | M | 05, 06, 31 |
| KustoQueryResult | ad-hoc KQL tab | M | 07, 12, 15 |
| TemplateQueryResult | template tab: param form, preview, share, convert | L | 28–30, 32 |
| KustoPivot | results grid, context menu, tagging, pivots | L | 15–26 |
| ColumnView | saved column layouts | S–M | 20 |
| TagEventDialog | bulk determination/comment/tags | L | 25 |
| TimeSelection | time range picker | M | 08–10 |
| ClusterSelection | cluster/db comboboxes | S | 11 |
| KustoMonacoEditor | Kusto editor + schema | M | 07 |
| MonacoEditor | generic editor | S | 35 |
| QueryHelperDialog | query help | S | 13–14 |
| DetailSidePanel | row details drawer | S | 24 |
| ExecutionStatusPanelComponent | grid status panel | S | 15 |
| DefaultSnackbar | notification queue | S | 40 |

---

## App.vue (M)
Toolbar `dense`, elevation 0, 1px bottom border `rgba(0,0,0,.1)`: hamburger (`v-app-bar-nav-icon`, a **menu** with "Query Manager" → `/queries`, not a drawer) · "TIM" link → `/` · spacer · Help `mdi-help` (Wiki Page `mdi-information`, Report a bug `mdi-bug`, new tab) · Settings `mdi-cog-outline` (Export / Import) · Account `mdi-account` (Sign in / Sign out).
Body: not signed in → info alert "You must sign-in first."; loading → "Authenticating and loading queries..."; error alert; `<v-main>` router-view + SideQueryTree.
Errors: `interaction_in_progress` → "Authentication is in an abnormal state. Consider clearing the session and cookies to resolve this."; no user → "You must login to access TIM. Check that your browser allows pop-up windows for this site."
Logout snackbar "You have successfully logged out.". Global draggable dialogs: mousedown on `.v-card__title` in active dialog → fixed-position drag, clamped; 100 ms interval keeps it in bounds (used by TagEventDialog, TimeSelection cards). Imports ag-grid **balham** theme.

## Welcome (S)
Centred: `text-h4` "Welcome to TIM", subtitle "The triage and investigation experience.", `NewQueryButton` "Get Started".

## QueryEditor — "Query Manager" (M)
Buttons: **Create** (primary, `mdi-plus-circle`), **Delete (n)** (`mdi-delete`; disabled if none selected or any managed), **Restore (n)** (`mdi-auto-fix`, only with Show deleted; bug: disabled check uses delete count). `v-data-table` show-select, key uuid, sort name; headers Name (link → edit; grey if deleted), Type, Menu text, Last Updated (raw ISO), Path, Cluster. Top: "Show deleted" switch, "Filter" search. Uses raw `getQueries(true)` (includes deleted). Delete/restore via `Promise.all` then reload.

## CreateQueryDialog (M)
`v-dialog persistent max-width=800`, title "Create Query"/"Edit Query". Managed ⇒ form disabled + red "This query is being managed by source control." Fields (filled): Name*, "Select type of query" radio View/Query, Menu text* (hint "e.g. Show all children processes"), Summary text* (hint "Supports {{variable}} e.g. Timeline for {{MachineId}}"), Path (chips combobox; hint "The submenu path for this menu item e.g. Machine, Windows"), Cluster* (hint "Domain name for cluster. Supports {{variable}} e.g. {{Cluster}}"), Database*, Column Id (hint "Used as a unique identifier for each row e.g. EventId"). Monaco editors 200px dotted border: Params (yaml), Fields (yaml, only when type=query; not read-only for managed — bug), Column customisation (yaml), Query (plaintext). Save: require query, `yaml.load` each (errors under editor), validate, snackbar "Saving query...", PUT or (new uuid) POST, reload, "Successfully saved query.". Error reads `err.response.data.error` (wrong shape; crashes on network error).

## OpenTriage (M)
Prop `uuid`. `<keep-alive :max=100><component :is=componentName :key="name-uuid">`; DetailSidePanel; TagEventDialog. Redirects to `/` if uuid unknown — **likely bug on hard refresh** (runs before SideQueryTree loads IndexedDB). React needs per-tab grid caching (keep-alive equivalent) and remount when converted Template→Kusto.

## ShareQuery (S)
`/share/:templateUuid?p=&execute=`. Errors: "This query was not found.", "Parameters are missing.". Merges defaults + `JSON.parse(atob(p))`, title = buildSummary, creates root TemplateQueryResult, runs if `execute=1`, navigates.

## ExportImport (S)
Outlined textarea "Settings (JSON)" 10 rows; **Export** (`mdi-export`) → JSON of display components → textarea + clipboard, snackbar "All settings have been exported and saved to your clipboard."; **Import** (`mdi-import`, disabled if invalid JSON) → IndexedDB only, "All settings have been imported. Refresh the browser for changes." Column views/options/rows not included.

## SideQueryTree (L)
`v-navigation-drawer absolute permanent expand-on-hover width=700 mini-variant` (~56px collapsed, expands on hover). Header: `+` NewQueryButton, `mdi-refresh` "Reload templates", `mdi-delete` "Remove selected" (disabled if none). Treeview key componentUuid, text title, `selection-type=leaf`, open-all, activatable, dense, selectable.
Status icon: spinner (executing) → red `mdi-alert` (error) → badge with rowCount ("9+" if >9; grey visited / warning 0 rows / info) over `mdi-folder`/`mdi-folder-open` (primary when active) → 50% folder. Label prefixes: "[draft] " (never run), "[new] " (results not yet visited, medium weight).
Click → `isVisited:true`, push `/view/:uuid`. Remove → `removeAllDisplayComponents`, route `/` if active removed. Active highlight not set on first load (watcher not immediate). Global CSS leak: dense list `min-height: 50px`.
**VTreeviewIndependantParent** overrides selection: checking a node checks all descendants; unchecking unchecks descendants **and all ancestors**; checking all children does not check parent ⇒ removing a parent always removes children.

## NewQueryButton (M) + TemplateQuerySubMenu (S–M)
Props `text, small, icon, tile`; default slot = label. Menu (`close-on-content-click=false`): "New query" → `createNewQueryComponent('New query')` (default KQL, navigates); divider; "Search queries" field (`mdi-magnify`); SubMenu "Views" (view templates) and "Queries" (query templates), hidden if empty, auto-expanded while searching. Search: case-insensitive substring over `JSON.stringify([menu, summary])`, nested by `path` (`templateQueriesAsObject` keys by segment name only — collision bug). Hidden (`queryOption.hide`) excluded.
SubMenu: recursive `v-list-group`; leaf click → `createNewTemplateQueryComponent(summary, tpl, defaults, null, autoExecute=false, makeActive=true)` (opens in edit mode), emits `close-menu`.

## KustoQueryResult (M)
Toolbar: NewQueryButton "New" · TimeSelection · **Run Query** (`mdi-play`) · **Clone** (`mdi-content-copy`) · view: **Edit Query** (`mdi-pencil`) / edit: **Save Changes & Run** (primary), **Save Changes**, **Cancel**. Edit form: "Summary" field, ClusterSelection, "Query" label + help icon (`mdi-help-circle-outline` → QueryHelperDialog), KustoMonacoEditor 400px, dotted border, `resize: vertical`, options `{tabSize:2, minimap off, lineNumbers, suggest off, automaticLayout}`. Results: error alert with `<pre>`, KustoPivot when `rowDataTrigger`.
`editQuery` local, **defaults true** (every mount → edit mode). `timeRange` local, not persisted. Run: snackbar "Executing query...", `runNewQuery(uuid, query, cluster, database, {startTime, endTime})`. Clone → new root "Copy of <title>". Pivot from grid → child TemplateQueryResult, always auto-execute.
Default query (`defaultNewQuery()`):
```kql
declare query_parameters(StartTime:datetime, EndTime:datetime);
DeviceProcessEvents
| where Timestamp between (StartTime .. EndTime)
| take 1
| extend EventTime=Timestamp, Cluster=current_cluster_endpoint(), EventId=strcat(DeviceId, ReportIndex)
```

## TemplateQueryResult (L)
Toolbar: New · **Run Query** · **Clone** · **Convert** (dialog "Convert to custom query?" — "This will convert the templated query into a custom query by making all parameters constant. This will allow you to modify the KQL directly. Note that this is permanent and cannot be undone." Cancel/Convert) · view: **Edit**, **Share Link** (`mdi-share`) / edit: **Save & Run**, **Save** (`mdi-content-save`), **Cancel**.
Edit form: "Summary" with `mdi-refresh` prepend (regenerate via buildSummary); `cols=4` field per key of `{...params, ...fields}`; label = key + red " *" unless `optional`; `persistent-hint` = hint; required rule "Required.". Widget by type:
- `array` → v-select over `values` (optional `multiple`, "Select All" toggle, "(+N others)" after 5)
- `match` → v-select of cached `[{column,value}]`, text "column: value"
- `multiple` → combobox chips, delimiters `,` `;`
- `boolean` → switch
- default → text field (trim)
"Preview Query" heading with show/hide link → read-only textarea (20 rows) of `buildQuery(editParams)`.
`editQuery` persisted in store. **Shift held** while choosing a pivot → child created without auto-execute. Run → `runTemplateQuery` (no time range). Clone → sibling, same parent, not auto-run. Convert → becomes KustoQueryResult with rendered KQL. Share → clipboard `…/#/share/<tplUuid>?p=<btoa(JSON)>&execute=0`, snackbar "Shared link has been saved to the clipboard." Save validation fail → "Unable to save query due to validation errors."

## KustoPivot (L)
Row 1: "Quick UI filter" (`setQuickFilter`) + ColumnView. Row 2: `ag-grid-vue.ag-theme-balham`, height `calc(100vh - 200px)`.
Grid options: rangeSelection, `groupDisplayType='groupRows'` with checkbox, groupSelectsChildren, maintainColumnOrder, `readOnlyEdit`, rowBuffer 20, rowSelection multiple, `sideBar=['columns','filters']`, `suppressFieldDotNotation=false`, suppressRowClickSelection, `getRowId=_id`, context `{componentParent}`.
Checkbox col: pinned left, width 42, header checkbox (filtered only). defaultColDef + columns + row classes + status bar: see architecture doc.
Keep-alive: saves/restores column state on deactivate/activate.
**Context menu** (targets = selected rows, or clicked row if none):
- **Tag Events ▸** "Customise tag events" (→ TagEventDialog), "Quick - Malicious/Suspicious/Benign" (saveEvents for unsaved → createComments `{determination: lowercase}` → mutate rows; snackbars "Quick saving events...", "Tag events successfully saved.", "Saving events failed: …", "Saving comments failed: …"). Disabled unless every row has `EventId` and `EventTime`.
- "Show details" → DetailSidePanel.
- separator · all non-hidden **query** templates nested by `path` (sorted) → `buildParams` → `create:query-template` (never disabled).
- separator · Copy, Copy with Headers, Export.
Cell edit: only `TagEvent.Comment` persisted (row saved + has determination) → createComments; "Quick saving comment...", "Comment successfully quick saved."; other edits silently discarded. Cell focus → `update:detail-side-panel`.
Bugs: `loadRowData` throws when no rows stored (after any query error); customise-dialog `onSuccess` re-applies old rows (grid not updated).

## ColumnView (S–M)
Autocomplete "Column view"; prepend item shows typed text or "Type to add new column view..." / subtitle "Create column view" → `add-column-view(name)`. Icon buttons (disabled w/o selection): Apply `mdi-clipboard-check-outline`, Rename `mdi-pencil` (dialog "Rename column view"), Delete `mdi-delete` (dialog "Delete column view", text typo "Are you should you wish to delete…"), Save `mdi-content-save`.

## TagEventDialog (L)
Opened via `create:tag-event-dialog`. `v-dialog max-width=800 persistent hide-overlay`, draggable title "Customise Tag Events", subtitle "N event(s) selected". Rows (field + action select):
1. Determination (Malicious/Suspicious/Benign) — actions Ignore/**Override**/Remove
2. Comment — Ignore/**Override**/Append
3. Tags (chips autocomplete; custom tag "Type to add new tag..."; subtitles "Exists in N event(s)"/"Recent tag") — **Ignore**/Append/Remove/Override
Modifications preview ("Adding X to N event(s).", "Removing X from N event(s).").
Validation: "At least one action should be selected.", "Determination is missing from N event(s) and cannot be ignored.", "Tags cannot be empty.", "Comment and tag actions must be ignored when removing determination.", "Determination cannot be empty.", "Comment cannot be empty."
Save: Remove determination → createComments `{comment:'removed', determination:'removed', isDeleted:true}` and `TagEvent=null`. Else: (Override) saveEvents for unsaved → createComments (Append joins with space; lowercase determination) → createTags (append / isDeleted / diff) → onSuccess → "Tag events successfully customised." / "Customisation of tag events failed: …". Closes even on error. Recent tags stub returns `[]`.

## TimeSelection (M)
Activator "Time range: <text>" ("Last 15 minutes", "YYYY-MM-DDTHH:MMZ - …", "Invalid time"). Menu list: Custom Date Range, Custom Time Period, Last 15 minutes / 30 minutes / 1 hours / 24 hours / 7 days / 30 days / 90 days. Custom date: start/end date (date picker, max today) + time (`HH:MM`, optional Z; "Please input time (HH:MM)"), **UTC**. Custom period: start number + minutes/hours/days; end number + now/minutes/hours/days. Validation "Start time must be prior to end time" (NaN slips through). Emits default Last 15 minutes on mount. `TimeAgoRange` evaluated at run time.

## ClusterSelection (S)
Comboboxes "Cluster" (items from `defaultClusters`, grouped by `name` headers; "Cluster is required") and "Database" (databases of the selected cluster's group; "Database is required"). Free text allowed.

## KustoMonacoEditor (M) / MonacoEditor (S)
v-model via `change`. Kusto: loader → loadMonacoKusto → `editor.create({language:'kusto'})`; schema on cluster/db change. No dispose. Generic: same with `language` prop.

## QueryHelperDialog (S)
"Query Help": Required Fields table (EventId — Tagging "Unique identifier for this event."; EventTime — Tagging, Queries; Cluster — Queries); Time Range Parameters (`declare query_parameters(StartTime:datetime, EndTime:datetime)`); Tagged Events (getTagEvents KQL with tagCluster/tagDatabase; uses `invoke GetTagEvents()` — case mismatch); Examples (default query; stray `}`; "More examples...").

## DetailSidePanel (S)
Right `v-navigation-drawer temporary stateless hide-overlay width=900`; close `mdi-close` (dark icon — likely invisible); expansion panel "Result Details" with `<dl>` grid (250px/auto): key → value, objects as YAML; empty hidden. Follows focused cell.

## ExecutionStatusPanelComponent (S)
"Execution Time: X", "CPU Time: X", "Memory: N MB" (bytes/1024²).

## DefaultSnackbar (S)
Bottom snackbar, icon + message, optional link button (`mdi-open-in-new`), "Dismiss" (`mdi-close`). FIFO; next after timeout+200 ms.

## Dead: SuppressionDialog, DetailCellRenderer
Suppression: intended "Create Suppression" dialog (Justification, Tags, field conditions eq/ieq/contains/…); never mounted; API stub. DetailCellRenderer registered but unused. Recommend drop (Q-010).
