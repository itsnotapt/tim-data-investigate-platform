# AG Grid 36 Server-Side Row Model: what it requires from the API, and what TIM would lose

Research for [#68](https://github.com/itsnotapt/tim-data-investigate-platform/issues/68) (map [#65](https://github.com/itsnotapt/tim-data-investigate-platform/issues/65), generic actions).
Versions checked: `ag-grid-community@36.2.0` and `ag-grid-enterprise@36.2.0` (what `web/package.json` resolves, `^36.2.0`), and the PostgreSQL 18 docs.
Date: 2026-10-10.

## Sources

- [RM] AG Grid docs, Row Models (with the feature comparison table): https://www.ag-grid.com/react-data-grid/row-models/
- [SSRM] AG Grid docs, Server-Side Row Model: https://www.ag-grid.com/react-data-grid/server-side-model/
- [DS] AG Grid docs, SSRM Datasource: https://www.ag-grid.com/react-data-grid/server-side-model-datasource/
- [CFG] AG Grid docs, SSRM Configuration (cache, row IDs): https://www.ag-grid.com/react-data-grid/server-side-model-configuration/
- [SORT] AG Grid docs, SSRM Sorting: https://www.ag-grid.com/react-data-grid/server-side-model-sorting/
- [FILT] AG Grid docs, SSRM Filtering: https://www.ag-grid.com/react-data-grid/server-side-model-filtering/
- [GRP] AG Grid docs, SSRM Row Grouping: https://www.ag-grid.com/react-data-grid/server-side-model-grouping/
- [PIV] AG Grid docs, SSRM Pivoting: https://www.ag-grid.com/react-data-grid/server-side-model-pivoting/
- [SEL] AG Grid docs, SSRM Row Selection: https://www.ag-grid.com/react-data-grid/server-side-model-selection/
- [REF] AG Grid docs, SSRM Refresh: https://www.ag-grid.com/react-data-grid/server-side-model-updating-refresh/
- [TX] AG Grid docs, SSRM Transactions: https://www.ag-grid.com/react-data-grid/server-side-model-updating-transactions/
- [ONE] AG Grid docs, SSRM Single Row Updates: https://www.ag-grid.com/react-data-grid/server-side-model-updating-single-row/
- [COLS] AG Grid docs, SSRM Changing Columns: https://www.ag-grid.com/react-data-grid/server-side-model-changing-columns/
- [QF] AG Grid docs, Quick Filter: https://www.ag-grid.com/react-data-grid/filter-quick/
- [SETV] AG Grid docs, Set Filter List (supplying values): https://www.ag-grid.com/react-data-grid/filter-set-filter-list/
- [STATE] AG Grid docs, Grid State: https://www.ag-grid.com/react-data-grid/grid-state/
- [CT] `ag-grid-community@36.2.0` npm tarball, type definitions under `dist/types/src/` (file named in each citation)
- [CJS] `ag-grid-community@36.2.0` npm tarball, `dist/ag-grid-community.noStyle.js` (line numbers refer to that file)
- [EJS] `ag-grid-enterprise@36.2.0` npm tarball, `dist/ag-grid-enterprise.noStyle.js` (line numbers refer to that file)
- [PGJ] PostgreSQL 18 docs, JSON Types: https://www.postgresql.org/docs/current/datatype-json.html
- [PGT] PostgreSQL 18 docs, TOAST: https://www.postgresql.org/docs/current/storage-toast.html
- [PGL] PostgreSQL 18 docs, LIMIT and OFFSET: https://www.postgresql.org/docs/current/queries-limit.html
- [PGLIM] PostgreSQL 18 docs, Appendix K. PostgreSQL Limits: https://www.postgresql.org/docs/current/limits.html
- [PGTRGM] PostgreSQL 18 docs, pg_trgm: https://www.postgresql.org/docs/current/pgtrgm.html
- [PGSRC] PostgreSQL source, `src/backend/utils/adt/jsonb_util.c` (lines 1790-1800) and `src/include/utils/jsonb.h` (line 140), `master` on GitHub
- [TIM] This repo at `main` (be51146): `web/src/features/grid/*`, `web/src/features/tagging/*`, `web/src/features/pivots/pivotMenu.ts`, `api/src/tim_api/storage/postgres.py`, `docs/architecture.md`, `docs/adr/0012-query-run-limits-and-lifecycle.md`

## Answer in brief

- **Contract.** The SSRM calls one browser-side function, `getRows(params)`, for each block of rows. `params.request` is a JSON-serialisable `IServerSideGetRowsRequest`: `startRow`/`endRow` (default blocks of 100), `sortModel`, `filterModel`, `rowGroupCols` + `groupKeys` (which group level is being expanded), `valueCols` (with `aggFunc` names) and `pivotCols` + `pivotMode` [CT `interfaces/iServerSideDatasource.d.ts`]. The browser answers with `params.success({ rowData, rowCount?, pivotResultFields?, grandTotalData? })` or `params.fail()` [CT `interfaces/iServerSideRowModel.d.ts` 39-62]. All of sorting, filtering, grouping, aggregation and pivoting happen on the server [SORT; FILT; GRP; PIV]. TIM's API would have to turn that request into SQL over dynamic, mostly untyped columns. AG Grid itself calls this "advanced", needing "some difficult server-side coding" [SSRM].
- **What TIM loses or must rebuild.** The quick filter is client-side only (`quickFilterText` is validated as `clientSide` only [CJS 34890-34891]; [QF]; [RM]). CSV and Excel export cover only the loaded rows [RM; CJS 46429-46470]. The total and filtered row-count status panels are client-side only [EJS 101099-101105]. `selectAll: 'filtered'` is invalid, so the header checkbox selects everything, including rows hidden by the filter [SEL; EJS 128391-128394]. `getSelectedNodes()`, which pivots and tagging use today, must not be used with select-all or group selection [SEL; CJS 68203, 68206]. Set filter values must come from an API call [FILT; SETV]. Column definitions can no longer come from the union of keys across all rows. Row classes for determinations, column views, the detail panel, cell selection, the context menu and clipboard copy of loaded rows keep working.
- **Storage.** SSRM, or even plain paged fetching of a large result, needs **one PostgreSQL row per result row**. A single JSONB value per run is a hard dead end at large sizes: one `jsonb` array cannot exceed 268,435,455 bytes (about 256 MiB) [PGSRC], any field is capped at 1 GB [PGLIM], and every read of a TOASTed value decompresses it [PGT]. So the "no cap by default" in #65 cannot hold with today's `query_runs.result_data` blob.
- **Recommendation for TIM.** Store action results as one row per result row now, with a server-assigned ordinal as the row id. Serve them in pages. **Keep the client-side row model** for the grid, loading the run's rows through those pages. Do not adopt SSRM in the first spec. Shape the rows endpoint so it can later accept the `IServerSideGetRowsRequest` fields (`startRow`, `endRow`, `sortModel`, `filterModel`). An SSRM mode for runs above an instance-configured size can then be added later without a storage change. Details are in "Recommendation" below.

## 1. The request/response contract

### Wiring

- Set `rowModelType: 'serverSide'` and register `serverSideDatasource` (grid option or `api.setGridOption`) [DS]. Register `ServerSideRowModelModule` and `ServerSideRowModelApiModule` from `ag-grid-enterprise` [CT; enterprise `serverSideRowModel/serverSideRowModelModule.d.ts`] in place of `ClientSideRowModelModule`/`ClientSideRowModelApiModule` in `agGridSetup.ts`.
- `IServerSideDatasource` has `getRows(params)` and an optional `destroy()` [CT `iServerSideDatasource.d.ts` 61-69]. The datasource is browser code. AG Grid "does not impose any restrictions on the server-side technologies used" [DS]. TIM therefore defines its own HTTP endpoint, and `getRows` calls it.
- `rowData` is not supported with the SSRM (`supportedRowModels: ["clientSide"]`) [CJS 34907-34908].

### `params` passed to `getRows` [CT `iServerSideDatasource.d.ts` 32-60]

| Field | Meaning |
|---|---|
| `request` | `IServerSideGetRowsRequest`, "a simple object that can be converted to JSON" |
| `parentNode` | the group row being expanded (root node at level -1); not serialisable |
| `needsGrandTotal` | hint that the grid has no cached grand total yet |
| `success(LoadSuccessParams)` | return the block |
| `fail()` | tell the grid the load failed |

### `IServerSideGetRowsRequest` [CT `iServerSideDatasource.d.ts` 8-31]

| Field | Type | Notes |
|---|---|---|
| `startRow`, `endRow` | `number \| undefined` | block range; "`startRow: 0` and `endRow: 100` … the grid will expect a result with 100 rows (rows 0 to 99)" [DS]. Block size is `cacheBlockSize`, default 100 [CT `entities/gridOptions.d.ts` 1540-1544] |
| `sortModel` | `SortModelItem[]` = `{ colId, sort: 'asc'\|'desc', type? }[]` | one entry per sorted column, in priority order [SORT; CT `interfaces/iSortModelItem.d.ts`] |
| `filterModel` | `FilterModel \| AdvancedFilterModel \| null` | `FilterModel` is `{ [colId]: any }` [CT `interfaces/iFilter.d.ts` 369-371], see below |
| `rowGroupCols` | `ColumnVO[]` = `{ id, displayName, field?, aggFunc? }[]` | the grouping dimensions [GRP; CT `interfaces/iColumnVO.d.ts`] |
| `groupKeys` | `string[]` | the path of the group being loaded, e.g. `['Argentina', '2012']` [GRP] |
| `valueCols` | `ColumnVO[]` | columns being aggregated, each with its `aggFunc` name |
| `pivotCols`, `pivotMode` | `ColumnVO[]`, `boolean` | pivoting [PIV] |

### Filter models the server must interpret (TIM's multi filter)

TIM's `defaultColDef` uses `agMultiColumnFilter` with text, number, date and set sub-filters [TIM `gridOptions.ts`]. Its model is `{ filterType: 'multi', filterModels: [text|null, number|null, date|null, set|null] }`, in `filterParams` order [CT `interfaces/iMultiFilter.d.ts` 56-63]. The sub-models are:

- Text: `{ filterType: 'text', type: 'equals'|'notEqual'|'contains'|'notContains'|'startsWith'|'endsWith'|'blank'|'notBlank'|'empty', filter, filterTo? }` [CT `filter/provided/text/iTextFilter.d.ts`; `filter/provided/iSimpleFilter.d.ts` 88-95].
- Number: the same, with `lessThan`/`greaterThan`/`inRange` etc.
- Date: `dateFrom`/`dateTo` strings formatted `YYYY-MM-DD hh:mm:ss` [CT `filter/provided/date/iDateFilter.d.ts` 10-17]. Preset ranges such as `last7Days` arrive as a `type` with no dates, and "Your server … must interpret the preset and apply the equivalent date range logic using its own time zone and locale rules" [FILT].
- Two conditions combine as `{ operator: 'AND'|'OR', conditions: [...] }` [CT `iSimpleFilter.d.ts` 100-103].
- Set: `{ filterType: 'set', values: [...] }` [CT `interfaces/iSetFilter.d.ts` 11-14].

TIM's date `comparator` (`dateComparator` in `gridOptions.ts`) runs only in the browser. With the SSRM, the server must parse cell values as dates itself, which needs column types. Per #65, actions declare columns or ISO-8601 dates are detected. That detection would have to run server-side over all rows.

The set filter cannot list values from rows it has not loaded: "When using the Set Filter with the SSRM it is necessary to supply the values" through `filterParams.values`, synchronously or with an async `values(params)` callback that calls `params.success(values)` [FILT; SETV; CT `interfaces/iSetFilter.d.ts` 90-97]. That means a "distinct values of column X in run R" endpoint.

### Response (`LoadSuccessParams`) [CT `interfaces/iServerSideRowModel.d.ts` 39-62]

| Field | Meaning |
|---|---|
| `rowData` | the rows of the block (leaf rows, or group rows at a group level) |
| `rowCount?` | "The last row, if known." With it, the scrollbar is sized to the whole (filtered) set [CFG, "Block Loading Debounce"]. TIM always knows it for a finished run, so it should always send the filtered count. |
| `pivotResultFields?` | in pivot mode, the generated fields (`'2000_gold'`, separator `serverSidePivotResultFieldSeparator`, default `_`) from which the grid builds pivot result columns [PIV] |
| `grandTotalData?` | grand total row data, if `grandTotalRow` is used [GRP] |
| `groupLevelInfo?` | extra info for the load |

### Grouping, aggregation and pivoting on the server

- When grouping, each request is for one level. The rows returned for a level with `groupKeys.length < rowGroupCols.length` are group rows: one per distinct value of the next group column, carrying that column's field plus the aggregated `valueCols`. Leaf rows are returned once `groupKeys` covers every group column [GRP]. Child counts appear only if TIM implements `getChildCount(dataItem)` and the server puts the count in the group row [GRP, "Providing Child Counts"].
- Aggregation is done by the server ("Server-Side Grouping, Pivot and Aggregation" [SSRM]). The request carries only `aggFunc` names, so every function offered in the UI needs a SQL equivalent. That includes `sum`, `min`, `max`, `count`, `avg`, `first` and `last`, plus TIM's custom `dcount` (`web/src/features/grid/aggregation.ts`, which also flattens array values).
- In pivot mode the server must return the pivot result fields. Also, "when you pivot, it is not possible to drill all the way down the leaf levels" [PIV].
- Changing a row-group, pivot, value or sort column re-requests data [COLS]. By default a filter change purges the whole cache [GRP, "Filters"].
- With grouping, group rows need unique ids. `getRowId` receives `parentKeys` and `level` to build them [CFG, "Supplying Unique Group IDs"].

### Cache and load settings

- Blocks are cached. `maxBlocksInCache` defaults to **no limit**, "so every requested block is kept" [CT `gridOptions.d.ts` 1545-1550]. TIM would need to set it, or scrolling a huge run fills the browser anyway.
- `maxConcurrentDatasourceRequests` defaults to 2 [CT `gridOptions.d.ts` 1551-1558]. `blockLoadDebounceMillis` skips blocks while scrolling fast [CFG].
- `getRowId` is required for selection, transactions and refresh. IDs must be "unique Row IDs across the entire data set"; "a database Primary Key is recommended" [CFG, "Providing Row IDs"]. TIM's current fallback (`row-index-<n>` for empty or duplicate `EventId`, computed in the browser over all rows [TIM `columns.ts` `prepareRows`]) cannot work when the browser does not have all rows. The server must assign the id.

## 2. TIM's current grid features under the SSRM

TIM registers the client-side row model and uses the features below [TIM `agGridSetup.ts`, `gridOptions.ts`, `ResultsGrid.tsx`].

| Feature (where in TIM) | Under the SSRM | Source |
|---|---|---|
| **Quick filter** (`quickFilterText`, `cacheQuickFilter`, `getQuickFilterText` in `ResultsGrid.tsx`/`gridOptions.ts`) | **Not supported.** "The Quick Filter is only supported with the Client-Side Row Model. For the other row models you would need to implement your own server-side filtering". TIM would send its own `quick` text alongside the AG Grid request and call `refreshServerSide({ purge: true })` when it changes. The server would do a case-insensitive substring search over every value, including JSON of object values as `scalarText` does today, e.g. `ILIKE` over a precomputed per-row search text with a `pg_trgm` GIN index (pg_trgm indexes support `LIKE`/`ILIKE`, but "a pattern with no extractable trigrams will degenerate to a full-index scan", e.g. 1-2 characters) | [QF "Server-Side Data"]; [RM table]; [CJS 34890-34891]; [PGTRGM] |
| **Column filters** (multi: text/number/date/set) | Work, but executed by the server from `filterModel` (section 1). Set filter values need an endpoint. The date comparator moves to SQL. | [FILT]; [SETV] |
| **Sorting** | Server-side from `sortModel`. `serverSideEnableClientSideSort` sorts in the browser only once a group's rows are all loaded. | [SORT] |
| **Row grouping** (`enableRowGroup`, `groupDisplayType: 'groupRows'`, group checkbox) | Server-side grouping and aggregation per level (section 1). `groupDisplayType` has no row-model restriction in 36.2.0's option validation. | [GRP]; [CJS 33580-35110 validation table] |
| **Pivot mode + aggregation** (`PivotModule`, `AggregationModule`, `dcount`) | Server-side, including `pivotResultFields` and every `aggFunc`. | [PIV]; [SSRM] |
| **Row selection, multiRow, `selectAll: 'filtered'`, `groupSelects: 'filteredDescendants'`, header checkbox** | `'filtered'`/`'currentPage'` select-all is invalid ("The grid will behave as though `rowSelection.selectAll = 'all'`"), with warning 195 "selecting just filtered only works when `rowModelType='clientSide'`". Selection survives filtering ("If a selected row doesn't match the applied filter, it will still be selected when the filter is removed"). So **"select all" changes meaning**: from the filtered rows to every row of the run. | [SEL]; [EJS 128391-128394]; [CJS 68199] |
| **Selected rows for pivots and tagging** (`getSelectedNodes()` in `features/pivots/pivotMenu.ts`, `features/tagging/useTaggingMenu.ts`) | **Must change.** `getSelectedNodes()`/`getSelectedRows()` "cannot be used while using `rowSelection.groupSelects` is `'descendants'` or `'filteredDescendants'`, or when any select all functionality is required". In 36.2.0 the group-selects strategy warns on every call (warning 202), and the default strategy warns after select-all (warning 199). Use `api.getServerSideSelectionState()` instead: `{ selectAll: boolean, toggledNodes: string[] }`, or a nested `{ nodeId, selectAllChildren, toggledNodes }` tree with group selection. The server must then turn that state, plus the current `filterModel`, into the actual rows. | [SEL "API Reference"]; [CT `interfaces/selectionState.d.ts`]; [EJS 127764-127772, 128091-128092]; [CJS 68203, 68206] |
| **Selected-count status panel** (`agSelectedRowCountComponent`) | Supported. | [EJS 101102] |
| **Total and filtered row-count panels** (`agTotalRowCountComponent`, `agFilteredRowCountComponent`) | **Client-side only** (warnings 222/225). Replace them with a custom panel fed from the run's row count and the `rowCount` of the last response. | [EJS 101099-101105]; [CJS 68226-68229] |
| **CSV/Excel export** (context menu `export`) | Exports **only rows the grid has loaded** ("data on screen"). The serializer walks the cached nodes (`forEachNode` / `forEachNodeAfterFilterAndSort`). A full export needs a server-side CSV/XLSX endpoint that takes the same filter and sort model. | [RM table]; [CJS 46429-46470] |
| **Clipboard / cell selection** | Supported (row-model comparison: ✓ for SSRM); limited to loaded rows. | [RM table] |
| **Row classes for determinations** (`rowClassRules` in `rowClasses.ts`, reading `TagEvent.Determination`) | Unchanged: rules run per row as rows are rendered. The server must attach the tag/determination to each row it returns in `getRows`, which matches #65 ("attached to rows when a result is read"). | [RM table "Cell Renderers / Value Getter" ✓]; [TIM `rowClasses.ts`] |
| **Updating tagged rows** (`applyTransaction({ update })` in `rowUpdates.ts`, `commentEdit.ts`, `TagDialogContext.ts`) | `applyTransaction` is the client-side API. With SSRM use `applyServerSideTransaction({ update })` (requires row ids), `rowNode.updateData()` on loaded nodes, or `refreshServerSide()` to reload loaded blocks, which keeps selection. The IndexedDB write-back in `rowUpdates.ts` goes away: the server is the source. | [TX]; [ONE]; [REF] |
| **Column views / tab column state** (`getColumnState`/`applyColumnState` in `column-views`, `useTabColumnState.ts`) | Row-model independent. Applying a view with row groups, pivots, aggregations or sorts triggers new server requests. | [COLS]; [STATE] |
| **Column definitions** (`buildColumnDefs` takes the union of keys over all rows, `columns.ts`) | **Must change.** The browser no longer has all rows, so the server must return the full column list (declared and discovered) with the run. | [TIM `columns.ts`]; follows from [SSRM] |
| **Detail panel** (`getDisplayedRowAtIndex`, `node.data`) | Works for loaded rows. | [TIM `ResultsGrid.tsx`] |
| **Auto row height** (`RowAutoHeightModule`) | Supported (`autoHeight` allowed for client and server side). | [CJS 33593] |
| **IndexedDB `row_results` cache** | No longer the source of the grid's rows. A tab's rows then live only as long as the run, which is 24 h retention per ADR-0012 and #65. Today a tab keeps its rows in IndexedDB indefinitely. | [TIM `docs/architecture.md` "IndexedDB"; `docs/adr/0012`] |

## 3. Storage: one JSONB value per run vs one row per result row

Today a run's rows are one JSONB column, `query_runs.result_data`, a list of row objects [TIM `api/src/tim_api/storage/postgres.py` 83-103]. It is capped at 100,000 rows / 64 MiB by ADR-0012.

### One JSONB value per run (today)

- **Hard size ceiling.** PostgreSQL rejects a `jsonb` array whose element data exceeds `JENTRY_OFFLENMASK` = `0x0FFFFFFF` = 268,435,455 bytes: "total size of jsonb array elements exceeds the maximum of %d bytes" [PGSRC]. Any single field is limited to 1 GB [PGLIM]. With #65's "no cap by default", a large enough run fails at insert.
- **Every read is whole-value.** Values over about 2 kB are TOASTed (compressed or moved out of line) [PGT], and a compressed datum "must be decompressed before use" [PGT]. Serving rows 5,000-5,099 with `jsonb_array_elements`/`->` still reads and decompresses the whole result. Every SSRM block request, set-values request and export would do that, possibly concurrently, and then sort or filter in memory.
- **Updates lock and rewrite the whole value.** "any update acquires a row-level lock on the whole row. Consider limiting JSON documents to a manageable size" [PGJ].
- No index can help a sort or filter on a column inside the array.

Verdict: acceptable only while the browser downloads the whole result in one response, as today. Not viable for SSRM or for uncapped results.

### One row per result row (needed)

A shape that supports paging, sort and filter:

```
action_run_rows(
  run_id   uuid    references action_runs on delete cascade,
  ordinal  integer,        -- 0-based position in the action's output; the grid row id
  row_id   text,           -- the action-defined `id` (for tags), not necessarily unique
  data     jsonb,          -- the row's values, keyed by column name
  search   text,           -- optional: lower-cased text of all values, for the quick filter
  primary key (run_id, ordinal)
)
```

- **Default order and paging.** With no sort or filter, a block is `WHERE run_id = $1 AND ordinal >= $start AND ordinal < $end`, which is an index range scan regardless of offset. That is also what a client-side-row-model download in pages needs.
- **Sorted or filtered pages.** The SSRM asks by offset (`startRow`), so sorted or filtered blocks become `ORDER BY <expr>, ordinal LIMIT n OFFSET m`. The `ordinal` tiebreak is required: "it is important to use an ORDER BY clause that constrains the result rows into a unique order. Otherwise you will get an unpredictable subset" [PGL]. "The rows skipped by an OFFSET clause still have to be computed inside the server; therefore a large OFFSET might be inefficient" [PGL]. Each block of a sorted, filtered run therefore re-filters and re-sorts the run's rows. For big runs, cache the ordered ordinal list per (run, sort model, filter model) for the life of the view, e.g. a temporary table or an array, so later blocks become ordinal lookups.
- **Typed comparison.** `ORDER BY data->'col'` uses jsonb ordering: numbers compare numerically and strings lexically, but mixed types order "Object > Array > Boolean > Number > String > null" [PGJ]. Date columns stored as ISO-8601 strings sort correctly as strings but must be cast for range filters (`(data->>'col')::timestamptz`). The server therefore needs each column's type, from the action's declared columns or ISO-8601 detection (#65).
- **Indexes.** Per-column expression indexes are impractical because columns are dynamic per action. Rows are scoped by `run_id`, so the scan size is one run's rows. A GIN index on `data` (`jsonb_ops` or `jsonb_path_ops`) helps only containment (`@>`)-style equality filters [PGJ]. A `pg_trgm` GIN index on `search` makes the quick filter's `ILIKE '%x%'` indexable [PGTRGM].
- **Run-level metadata** lives on the run: total row count, the column list and types (for column defs and filters), and run details.
- **Retention.** Deleting a run cascades to its rows. The existing retention sweep stays one `DELETE`, but now on many rows (consider partitioning by time or batching the delete if runs are large).

## Recommendation for TIM

1. **Store results one row per result row** (as sketched above) in the actions spec, with a server-assigned `ordinal` as the grid row id. The action `id` is kept for tags but is not the grid id: it can repeat, and today's browser-side de-duplication cannot run over rows the browser does not have. This is needed whichever row model the grid uses, because a single JSONB value per run cannot hold an uncapped result (256 MiB `jsonb` limit) [PGSRC].
2. **Keep the client-side row model for the first actions spec.** Load a finished run through a paged rows endpoint (`GET …/runs/{id}/rows?start=&end=` by ordinal) and feed the grid as pages arrive. AG Grid's own guidance is "If you are not sure, use default Client-Side. The grid can handle massive amounts of data (100k+ rows) … your browser will run out of memory before the grid gets into problems" [RM]. Every TIM grid feature (quick filter, multi/set/date filters, grouping with group checkboxes, pivot mode with `dcount`, filtered select-all, full export, row counts, `getSelectedNodes` for pivots and tagging) keeps working unchanged. The practical ceiling is the analyst's browser memory, not the API.
3. **Leave SSRM as a later, separate step for very large runs.** Make the rows endpoint's query shape a subset of `IServerSideGetRowsRequest` (`startRow`, `endRow`, `sortModel`, `filterModel`) so it can grow into an SSRM datasource without a storage change. If SSRM is adopted, the spec must also cover:
   - a server-side quick filter;
   - a set-filter values endpoint;
   - SQL for every filter type and `aggFunc` (including `dcount`), plus group-level and pivot responses;
   - pivots and tagging resolving `getServerSideSelectionState()` (+ `filterModel`) on the server instead of sending row values;
   - select-all meaning "all rows of the run";
   - a server-side CSV/XLSX export;
   - custom total and filtered row-count panels;
   - `maxBlocksInCache`;
   - a clear tab state when the run has expired (no IndexedDB copy).
   A possible trigger is an instance setting such as "row count above which a tab uses the server-side row model". Two row models means two code paths in `ResultsGrid`, which is a strong reason to defer.

## Implications for other #65 tickets

- **Result envelope / API contract:** the envelope should carry the total row count and the full column list (with types) separately from the rows, and rows should be fetched by page. The grid row id should be the server ordinal, not `id`.
- **Limits:** "no cap by default" is not reachable with a single JSONB blob per run. One row per result row removes the PostgreSQL ceiling; the remaining ceiling is browser memory under the client-side row model.
- **Pivot context:** with the client-side row model, the browser can keep sending clicked and selected row values as context. If SSRM is ever used, the context must become `{ runId, selection state, filterModel }`, resolved by the server.
- **Retention vs IndexedDB:** once rows come from the server, whether tabs keep a local copy beyond the 24 h retention needs deciding, since today `row_results` keeps rows indefinitely.
