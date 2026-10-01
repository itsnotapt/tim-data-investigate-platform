# Parity report (P5-04)

Side-by-side review of the 42 legacy screens (`docs/current-system/screenshots/`) against the rewrite (`docs/rewrite/screenshots/`, captured by the e2e flows in `web/e2e/flows/`, P5-02/P5-03). Both sets use mocked API data, stubbed auth and a 1440x900 viewport (Q-100).

Each difference is **accepted** (with the reason: ADR, question, bug ID, library styling or mock data) or **fix** (with a follow-up task). Reviewed 2026-09-30.

## Fix list

| ID | Screen(s) | Change | Follow-up |
|---|---|---|---|
| F-A01 | 07–11 | Editor still loading (spinner) when shot is taken; wait for Monaco content and re-capture — fixed: `waitForEditor` (web/e2e/mocks/editor.ts) before shots 07-12 | P5-13 |
| F-A02 | 07, 08, 15, 17 | Time-range toolbar trigger reads as plain text; style it like the other toolbar buttons — fixed: uppercase button like other toolbar buttons | P5-13 |
| F-A03 | 12–14 | KQL syntax colouring / diagnostics missing in the editor; verify monaco-kusto language registration and theme — fixed/verified: language and tokenizer work; shot was early. e2e asserts >1 `.mtk*` classes; squiggle and scrollbar marker now present | P5-13 |
| F-A04 | 13 | Bold StartTime/EndTime lost in the Query help sample — fixed: `<strong>` StartTime/EndTime in sample | P5-13 |
| F-A06 | 15, 17–20 | Quick UI filter and Column view floating labels clipped | P5-14 (fixed P5-14) |
| F-A07 | 15–20 | Side-tree "9+" badge clipped | P5-14 (fixed P5-14) |
| F-B01 | 25 | "Determination action" label truncated in the tag dialog | P5-14 (fixed P5-14) |
| F-B02 | 25 | Tags field not disabled while its action is Ignore (check legacy) | P5-14 (accepted: already disabled (TagDialog isTagsDisabled); screenshot shows greyed placeholder) |
| F-B03 | 27 | Active side-tree item not highlighted | P5-14 (fixed P5-14) |
| F-B04 | 33, 34 | Last Updated shows locale text; legacy shows the UTC ISO value. Match legacy (parity first) | P5-14 (fixed P5-14) |
| F-B05 | 34 | Deleted rows not greyed out in Query Manager | P5-14 (fixed P5-14) |
| F-B06 | 36 | Screenshot taken before the YAML/query editors loaded; re-capture | P5-13 |
| F-B07 | 40 | Export JSON shape differs from legacy; verify export → import round-trip and drop server-only fields | P5-14 (fixed P5-14 (server-only fields stripped, round-trip test; legacy compat accepted per Q-004)) |

Accepted without a fix: F-A05 (`getTagEvents()` vs legacy `GetTagEvents()`, BUG-41); the account name in the account menu (Q-112); prefilled custom time-range dialogs (Q-113).

## Screens 00–20

Legend: accepted = deliberate or library/mock difference; fix = follow-up task proposed.
Common to every screen (not repeated): MUI vs Vuetify look (filled blue GET STARTED button, filled help icon, outlined text fields, content shifted ~1px / toolbar spacing). Accepted as "styling (ADR-0003 MUI replaces Vuetify)".

### 00 share-missing-params
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Same "Parameters are missing." error alert, same shell | accepted | -- |
| 2 | Alert styling (outlined, round icon), tab strip "+" is blue and legacy's clipped second tab glyph gone | accepted | styling (MUI) |

### 01 welcome
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Same heading, subtitle, GET STARTED; block sits higher (y~300 vs ~425) and button is filled blue | accepted | styling/layout (MUI) |

### 02 menu-hamburger
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Single "Query Manager" item, same | accepted | -- |
| 2 | No round hover/focus halo on hamburger; menu slightly smaller | accepted | styling |

### 03 menu-help
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Wiki Page (info) and Report a bug (bug) items, same; tighter row spacing | accepted | styling |
| 2 | Help icon is filled "?" circle instead of bare "?" | accepted | icon glyph (MUI) |

### 04 menu-account
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | New menu lists the signed-in account (dev.user@example.com, disabled) above "Sign out" | accepted | Additive, shows identity; noted in rewrite README. Not in a Q/ADR, so record it in open-questions as a decision (docs only). |

### 05 new-query-menu
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Same "New query" header, "Search queries", Views/Queries collapsed | accepted | -- |
| 2 | Search field outlined; group rows tighter and smaller text; popup anchored at button's left edge | accepted | styling |

### 06 new-query-menu-search
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Legacy popup is cut off at the viewport bottom so Queries > Weather > Storms > "Storm events for state" is not visible; new shows the full result tree | accepted | Legacy layout defect; same data (mock) |
| 2 | Expanded groups no longer highlighted blue | accepted | styling |

### 07 kusto-query-edit
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Query editor shows only a loading spinner; default DeviceProcessEvents query (legacy shows 5 lines) not visible | fix | Screenshot taken before Monaco finished loading. F-A01: wait for editor content in `w02-adhoc-query` flow and re-shoot (web/e2e/flows/w02-*.ts). Default text itself exists (`web/src/features/kusto-query/defaultQuery.ts`). |
| 2 | Validation errors shown only after a failed Save & Run (legacy: immediately) | accepted | Documented in rewrite README (deliberate); the shot forces a failed submit. |
| 3 | Labels carry asterisk ("Cluster *", "Database *") | accepted | MUI required marker, positive |
| 4 | Toolbar "Time range: Last 15 minutes" is plain dark text, not upper-case, and looks like a label rather than a button (legacy: TIME RANGE: LAST 15 MINUTES in same style as other toolbar buttons) | fix | F-A02: give the time-range trigger the same button styling/uppercase as NEW / RUN QUERY so it reads as clickable (web/src/components/TimeRange*.tsx, toolbar). Rewrite README only notes the casing, it does not justify the lost affordance. |
| 5 | Summary is an outlined field; Query label icon is filled | accepted | styling |

### 08 time-range-menu
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Same 9 items and labels ("Last 1 hours" grammar kept for parity) | accepted | parity |
| 2 | Denser menu, no pressed-button state on trigger; editor still spinner | accepted | styling; spinner covered by F-A01 |

### 09 time-range-custom-date
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Modal dialog with backdrop (legacy: popup anchored under toolbar) | accepted | library styling (MUI Dialog) |
| 2 | Fields prefilled with current range (19:36 to 19:51) instead of 00:00/00:00 | accepted | Improvement: legacy default midnight values were unhelpful. Not recorded anywhere; log in open-questions. |
| 3 | Native date inputs (locale mm/dd/yyyy, calendar icon), no leading calendar/clock icons | accepted | library styling |

### 10 time-range-custom-period
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Start period prefilled "15" (legacy empty with placeholder) | accepted | Mirrors current range; same note as 09 #2 |
| 2 | Unit labels "Start time units"/"End time units" (legacy both "Time units") | accepted | Clearer labels; text change is minor |
| 3 | End time period is disabled when unit is "now" (kept; visually an empty outlined field, not obviously disabled) | accepted | Behaviour matches (`disabled={endUnit==='now'}`) |
| 4 | Modal dialog with backdrop | accepted | library styling |

### 11 cluster-selection
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Group label "Example" and option https://help.kusto.windows.net, same | accepted | -- |
| 2 | Popup overlaps the Database error text; MUI Autocomplete; editor still spinner (hidden) | accepted | library styling; spinner = F-A01 |

### 12 kusto-query-edit-filled
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | KQL has no syntax colouring and no diagnostics squiggle/scrollbar marker (legacy: coloured tokens, red squiggle under DeviceProcessEvents, red scrollbar marker) | fix | F-A03: verify monaco-kusto tokenizer and schema load (`web/src/lib/monaco/loader.ts`, `web/src/features/kusto-query/useKustoSchema.ts`); if working, delay the shot until tokens render; if not, fix. Editor is also plain text in 13 (background) and 14. |
| 2 | Database field focused with clear (x) button | accepted | MUI Autocomplete |
| 3 | Cluster/Database values, no validation errors | accepted | parity |

### 13 query-help-dialog
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Same Required Fields table, Time Range and Tagged Events sections; "Close" button is pinned in a footer (legacy: at end of scroll) | accepted | improvement |
| 2 | StartTime / EndTime bold emphasis in the query_parameters code block is lost | fix | F-A04 (low): restore bold markup for StartTime/EndTime in the sample (web/src/features/kusto-query/QueryHelperDialog.tsx, queryHelperSamples.ts). |
| 3 | Tagged-events sample shows cluster("https://help.kusto.windows.net") where legacy showed cluster("") | accepted | Legacy interpolated an empty cluster; new fills the selected cluster (better). |
| 4 | Type cell "Tagging, Queries" (legacy "Tagging,Queries"); table less chrome | accepted | minor text/styling |

### 14 query-help-dialog-scrolled
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Sample ends `invoke getTagEvents()` (legacy `GetTagEvents()`) | fix | F-A05 (low): check case against legacy source / known-issues; Kusto function names are case-sensitive and the sample defines `getTagEvents`, so the new text is internally consistent and likely the correct one. If confirmed, mark accepted (legacy typo) and note in known-issues. (queryHelperSamples.ts) |
| 2 | Examples block lacks the stray trailing "}" that legacy shows after ReportIndex) | accepted | legacy typo not ported |
| 3 | Dialog title stays pinned while body scrolls | accepted | improvement |
| 4 | Editor behind dialog not syntax coloured | fix | covered by F-A03 |

### 15 kusto-query-results
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Columns tool panel lists columns without the blank first (disabled) checkbox row | accepted | legacy artefact; AG Grid 36 |
| 2 | Header now shows filter icon and column menu (three dots) on every column | accepted | AG Grid 36 default (ADR-0006) |
| 3 | Tool panel wider (~250px vs ~200px) so fewer columns visible (EventType hidden behind panel; legacy partly visible) | accepted | AG Grid 36 default; panel is resizable |
| 4 | Quick UI filter is an outlined field whose floating label "Quick UI filter" looks half-clipped at the top edge; Column view label clipped the same way | fixed | F-A06: increase toolbar top padding / remove overflow clipping so floating labels render fully (web/src/features/query-results/ result toolbar component, e.g. QuickFilter/ColumnView). Also affects 17, 18, 19, 20. | ([fixed P5-14])
| 5 | Tab badge "9+" is a tiny superscript without the grey circle, looks clipped by the tab strip (legacy: full grey pill) | fixed | F-A07: give the tab-strip badge room/overflow visible and a background (web/src/features/tabs/ tab strip / SideQueryTree badge). Affects 15-20. | ([fixed P5-14])
| 6 | Footer shows Execution Time, CPU Time, Memory, Total Rows; toast "Executing query..." purple info icon instead of blue; toast sits over footer | accepted | README: footer as legacy; toast styling (MUI) |
| 7 | Time range button looks like plain text | fix | see F-A02 |

### 16 side-tree-expanded
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Add, refresh, delete icons and one "New query" item with "9+" badge, selected highlight; same overlay width | accepted | parity |
| 2 | Badge again tiny/clipped; action icons spaced wider | fix (badge) | F-A07 |

### 17 grid-sidebar-columns
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Collapsed Columns / Filters tabs, same toolbar buttons and footer metrics; toast still visible in new | accepted | README: capture timing, toast is transient |
| 2 | Header filter and menu icons; grid ends with a small gap before the tab strip | accepted | AG Grid 36 |
| 3 | Quick filter / Column view labels clipped; Time range looks like text | fixed (A06), A02 pending | F-A06 done P5-14, F-A02 |

### 18 grid-sidebar-filters
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Panel shows "Search..." and expandable column entries (EventTime ... TagEvent.Determination), same list | accepted | parity; search box now has magnifier icon |
| 2 | Panel pushes the grid (legacy overlays it); no blue-grey row background | accepted | AG Grid 36 / styling |
| 3 | Legacy row separators/headers shaded; new flat | accepted | styling |

### 19 grid-column-menu
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Legacy tabbed menu (General/Filter/Columns icons) replaced by single list with Sort Ascending / Sort Descending, Pin Column, Autosize This/All Columns, Group by State, Choose Columns, Reset Columns | accepted | AG Grid 36 column menu (README note); superset of legacy entries |
| 2 | Menu opened from the header three-dots button | accepted | AG Grid 36 |

### 20 column-view-create
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | "Triage layout / Create column view" option present; legacy also showed a "No data available" row below | accepted | Legacy combobox quirk; empty list correctly omitted |
| 2 | Floating label "Column view" clipped at top | fixed | F-A06 (P5-14) |

## Screens 21–41

Shared note for screens 21-32 and 41: the new grid screens show header filter/menu icons on every column, the Columns tool panel open by default, a bordered "Quick UI filter" with search icon, and an "Executing query..." toast. The first three are AG Grid 36 / MUI styling (ADR library swap; README notes for 15). The toast is screenshot sequencing. Legacy 21-23 had the panel collapsed only because the capture sequence had closed it. Each screen below lists only the extras.

### 21 grid-context-menu
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Same items: Tag Events >, Show details, Weather >, Copy (Ctrl+C), Copy with Headers, Export > | accepted | identical in substance |
| 2 | Column view is empty (no "Triage layout"); toolbar "Time range:" is mixed case; sidebar open; toast visible | accepted | README note (taken before a column view exists); styling; capture sequence |
| 3 | Styling (ADR-0003 MUI, AG Grid 36) | accepted | library styling |

### 22 grid-context-menu-tag
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Submenu: Customise tag events, Quick - Malicious, Quick - Suspicious, Quick - Benign | accepted | identical |
| 2 | Styling | accepted | library styling |

### 23 grid-context-menu-pivot
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Weather > Damage / Storms > "Storm events for state" | accepted | identical structure |
| 2 | Submenus overlap the "Copy" row more (nested flyout sits over the parent) | accepted | AG Grid 36 menu placement |

### 24 detail-side-panel
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Legacy lists a trailing `_id 61032` row; new omits it | accepted | `_id` is the synthetic AG Grid row id (KustoPivot.vue getRowId, `ignoreColumns=['_id']`), so not data. `detailEntries` in web/src/features/grid/DetailPanel.tsx drops it on purpose |
| 2 | Drawer starts below the app bar in legacy, and overlaps the grid toolbar in new (panel top at y=49, close button lower, heading smaller) | accepted | MUI Drawer layout |
| 3 | Fields, values and TagEvent YAML are the same | accepted | – |

### 25 tag-event-dialog
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Same fields and defaults (Override/Override/Ignore), "2 event(s) selected", CLOSE/SAVE | accepted | – |
| 2 | New adds floating labels "Determination action", "Comment action", "Tag action" on the action selects. "Determination ac..." is truncated | fixed | F-B01: widen the action select or shorten the label | ([fixed P5-14])
| 3 | Legacy shows Tags as a disabled, dotted-underline field while action is Ignore. New renders it as a normal enabled-looking field | fixed | F-B02: show Tags as disabled when its action is Ignore, if the legacy rule holds (confirm in legacy TagEventDialog.vue) | ([accepted, Tags already disabled on Ignore (same as legacy)])
| 4 | Legacy selection: two checked rows and State cell highlighted on IOWA. New selects the same two rows, focused cell is on KANSAS | accepted | mock interaction |

### 26 after-pivot
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Rows 3 and 4 selected (IOWA, FLORIDA) in both | accepted | – |
| 2 | Child tab in the left strip shows a spinner (new) versus a blue 9+ badge (legacy) | accepted | README note: capture timing, child still loading |
| 3 | Sidebar open and focused cell differs | accepted | capture sequence |

### 27 side-tree-with-pivot
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Tree has add / refresh / delete toolbar, parent "New query" and child "[new] Storm events in ..." with badge | accepted | – |
| 2 | Child is "KANSAS" (new) vs "TEXAS" (legacy) | accepted | README note, pivot row differs |
| 3 | Parent badge is grey and overlaps the folder icon; the parent's blue colour is lost (legacy: blue text and open-folder icon for the active item) | fixed (low) | F-B03: style the active tree item (blue label, open folder icon) in web/src/features/tree/SideTree.tsx. Legacy highlights the current tab, new highlights only the row background | ([fixed P5-14])
| 4 | Tree's first toolbar is slightly taller | accepted | styling |

### 28 template-query-results
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Toolbar NEW, RUN QUERY, CLONE, CONVERT, EDIT, SHARE LINK | accepted | same set; button text is sentence case in places, styling |
| 2 | Legacy Columns panel shows an empty first entry (hidden `_id` column) | accepted | legacy artefact of the `_id` column, not ported |
| 3 | Parent tab in strip is an outlined folder (new) vs open folder (legacy) | accepted | icon glyph |

### 29 template-query-edit
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Summary, State *, Preview Query "show", SAVE & RUN / SAVE / CANCEL, RUN QUERY / CLONE / CONVERT disabled | accepted | identical |
| 2 | Summary and State fields are outlined boxes instead of underlines | accepted | MUI styling |
| 3 | Legacy Columns panel empty first entry | accepted | as 28 |

### 30 template-convert-dialog
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Same title, same text, CANCEL / CONVERT | accepted | text identical (button case is styling) |

### 31 new-menu-template-tree
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Legacy opens "Queries" > "Weather" expanded (blue highlight); new shows the same expansion without highlight colours | accepted | styling |
| 2 | Storms and Damage children shown as collapsed groups in both | accepted | – |
| 3 | Search box placeholder "Search queries" | accepted | same |

### 32 template-new-draft
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Same summary, required EventType, Preview Query, disabled RUN QUERY/CLONE/CONVERT, SAVE & RUN/SAVE/CANCEL | accepted | – |
| 2 | Tab strip: active new tab has no badge in either | accepted | – |

### 33 query-manager
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | New adds a "Query Manager" page heading | accepted | improvement, no info lost (same for 40 "Export / Import") |
| 2 | Last Updated is now locale, local-time text ("9/27/2026, 1:00:00 AM") instead of raw ISO `...Z` | fixed (low) | F-B04: decide and record (Q-xxx) whether local locale or UTC ISO. Legacy and the UTC-everywhere rule (BUG-39 time-range UTC) suggest showing UTC, or add a tooltip with ISO. File: web/src/features/templates-admin/QueryManagerPage.tsx `formatUpdated` (uses `toLocaleString`). Times also shift by the capture machine's timezone | ([fixed P5-14])
| 3 | Path joined as "Weather, Damage" (legacy "Weather,Damage") | accepted | readability improvement |
| 4 | Filter is an outlined field; Show deleted toggle is left of Filter rather than above | accepted | layout/styling |
| 5 | Row order: legacy sorted "Damage, Recent, Storm"; new identical | accepted | – |

### 34 query-manager-show-deleted
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | RESTORE (0) button present, 4 rows, "1-4 of 4" | accepted | identical |
| 2 | Deleted row "Old deleted query" is not greyed out in the new screenshot. Only the name is given the disabled colour and it renders near-black. Legacy greyed the name | fixed (low) | F-B05: grey the whole deleted row (name via `text.disabled` is not visible). QueryManagerPage.tsx TableRow `sx` when `t.isDeleted` | ([fixed P5-14])
| 3 | Last Updated for deleted row 7/28/2026 3:00 AM vs legacy 2026-07-28T22:00Z (local conversion plus mock timezone) | accepted | see F-B04 |

### 35 create-query-dialog
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | New adds required asterisks (Name, Menu text, Summary text, Cluster, Database) and helper texts under fields; legacy showed neither in this shot | accepted | improvement, parity of validation rules (README) |
| 2 | Radios are horizontal (View, Query) vs stacked vertical | accepted | MUI layout |
| 3 | Path field has no dropdown arrow in new (free-text chips) vs legacy v-combobox with arrow | accepted | MUI Autocomplete freeSolo, same multi-chip entry (CreateQueryDialog.vue v-combobox chips, multiple) |
| 4 | Dialog title is sticky, with CLOSE/CREATE footer always shown | accepted | MUI Dialog; legacy footer only visible after scroll |
| 5 | Placeholder/labels "Menu text", "Summary text", "Column Id" identical | accepted | – |

### 36 create-query-dialog-scrolled
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | New shows Params, Column customisation and Query editors, each with a loading spinner instead of the (empty) editor content | fix (capture only) | F-B06: re-capture after Monaco finishes loading (wait for `.monaco-editor` in the w12-query-manager spec, web/e2e/flows) so the screenshot shows the editors, as legacy did |
| 2 | Editor section labels are the same | accepted | – |

### 37 edit-query-dialog
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Same populated values (Query type, menu text, summary, Path Weather/Storms, cluster, database, Column Id) | accepted | – |
| 2 | Path chips have a delete (x) in new | accepted | MUI Chip onDelete, matches v-combobox chips |
| 3 | Asterisks/helper texts as in 35 | accepted | see 35 |

### 38 edit-query-dialog-scrolled
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Fields (YAML State: type: single), Column customisation `{}`, Query with StormEvents KQL | accepted | identical content |
| 2 | Dialog scroll position different, and the Query editor shows the whole snippet | accepted | capture sequence |

### 39 edit-query-dialog-managed
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Notice "This query is being managed by source control." is an orange Alert with icon (legacy red text) | accepted | MUI Alert styling, same text |
| 2 | All fields read-only; SAVE disabled visible in new | accepted | legacy footer not in shot |
| 3 | Path chips in new show (disabled) delete icons | accepted | styling |

### 40 export-import-exported
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | "Export / Import" heading added; EXPORT and IMPORT buttons outlined with icons swapped (upload/download glyph) | accepted | README note, icon glyph |
| 2 | Snackbar "All settings have been exported and saved to your clipboard." with DISMISS | accepted | same |
| 3 | JSON differs: new contains one tab and embeds extra template metadata (`isDeleted`, `isManaged`, `createdBy`, `updatedBy`, `updated`) inside `queryTemplate`, and a new `editQuery` state key. Legacy holds two tabs and only template fields | fixed | F-B07: confirm the export shape against legacy ExportImport.vue (frontend/src/components) and docs/rewrite/api-contract.md. If legacy round-trip files must import in the new app (W13), the schema must be compatible, and server-side fields (createdBy/updatedBy, emails) should not be exported into shared JSON. Files: web/src/features/export-import/ | ([fixed P5-14; legacy-format import accepted per Q-004])
| 4 | Textarea is narrower (980px) and sits under the heading | accepted | layout |

### 41 share-link-opened
| # | Difference | Verdict | Reason / follow-up |
|---|---|---|---|
| 1 | Same toolbar, results grid and footer | accepted | – |
| 2 | Only one tab in the strip; no leftover export snackbar | accepted | capture sequence (legacy README already notes the leftover snackbar) |

### 41b share-link-confirm
Removed: the confirmation dialog was reverted to legacy behaviour (`execute=1` runs immediately, Q-110 answered per Q-030); no capture.

## Bug-regression checklist (P5-05)

Every BUG-xx / SEC-xx in `docs/current-system/known-issues.md` and how the rewrite covers it. Paths are relative to the repo root; `api/tests/test_regressions.py` is new in P5-05 (ID-titled tests for template bugs whose existing tests did not name the ID). "Web unit" = Vitest under `web/src`.

| ID | Title (short) | Status in rewrite | Coverage |
|---|---|---|---|
| SEC-01 | Cluster URL not validated on `/kusto/query` (OBO token to any URL) | fixed | `api/tests/test_kusto_validation.py::test_rejects`, `::test_error_message_does_not_echo_input`, `::test_strict_host_list`; `api/tests/test_query_runs_api.py::test_bad_cluster_is_400_before_token`; `api/tests/test_kusto_schema_api.py::test_bad_cluster_400_before_token`; `api/tests/test_config.py::test_non_https_cluster_rejected` |
| SEC-02 | No owner check on query runs | fixed | `api/tests/test_query_runs_api.py::test_other_users_run_is_404`; `api/tests/storage_contract.py::RunContract::test_other_owner_is_none` (run via `api/tests/test_storage_contract.py`) |
| SEC-03 | `createdBy`/`requestedBy`/`dateTimeUtc` trusted from client | fixed | `api/tests/test_tagged_events_api.py::test_client_supplied_identity_ignored`; `api/tests/test_models_tagged_events.py::test_client_supplied_server_fields_ignored`; `api/tests/test_models_query_runs.py::test_request_ignores_requested_by`; `api/tests/test_models_templates.py::TestServerOwnedFields::test_create_ignores_audit_fields`; web unit `web/src/lib/api/client.test.ts::never sends identity fields in template bodies (SEC-03, BUG-40)` |
| SEC-04 | .NET stack traces returned in `stackTrace` | fixed | `api/tests/test_query_runs_api.py::test_kusto_error_has_no_stack`, `::test_unexpected_error_is_generic`; `api/tests/test_models_query_runs.py::test_run_stack_trace_not_serialised`; `api/tests/test_errors.py::test_unhandled_error_is_sanitised_and_logged`; `api/tests/test_kusto_query_client.py::test_sanitise_message_strips_stack_and_caps` |
| SEC-05 | CORS allows any origin | fixed | `api/tests/test_errors.py::test_cors_allowed_origin_gets_headers`, `::test_cors_disabled_when_no_origins` |
| SEC-06 | Handlebars `noEscape` / `array` helper KQL injection; share-link param crafting | fixed (escaping; `execute=1` confirmation reverted to legacy per Q-030, Q-110) | Web unit `web/src/lib/kql-templates/kql-templates.test.ts::array helper escapes quotes (SEC-06)`, `::array helper neutralises a classic injection`, `::array helper: backslash-quote cannot break out`; `web/src/features/share/shareLink.test.ts::sanitizes against the template (SEC-06)`; e2e `web/e2e/flows/w08-share.spec.ts::W8 execute=1 link runs immediately and opens results (screen 41, Q-110 reverted)` |
| SEC-07 | `/api/user/authenticate` issues tokens nothing accepts | not ported (removed, Q-011) | `api/tests/test_openapi_contract.py::test_removed_authenticate_route_is_absent`; deviation D1 in `docs/rewrite/api-contract.md` |
| BUG-01 | Inconsistent run retention (TTL) | fixed (single PostgreSQL store + retention sweep) | `api/tests/test_storage_retention.py::test_sweep_removes_only_expired`, `::test_background_loop_deletes_expired`; `api/tests/storage_contract.py::RunContract::test_expired_run_is_none_even_if_not_deleted`, `::test_delete_expired_counts_and_removes` |
| BUG-02 | Runs stuck in `created`; `timedOut` never set; no timeout | fixed | `api/tests/test_query_runs_api.py::test_timeout_sets_timed_out`, `::test_startup_sweep_marks_stale_runs`, `::test_shutdown_cancels_running_tasks_and_marks_error`, `::test_result_limit_error`; `api/tests/storage_contract.py::RunContract::test_stale_created_marked_error`; web unit `web/src/lib/api/queryRuns.test.ts::throws a server-source QueryTimeoutError for status timedOut` |
| BUG-03 | DELETE missing template returns 500 | fixed | `api/tests/test_regressions.py::test_bug_03_delete_missing_template_is_404_not_500` (also `api/tests/test_templates_api.py::test_delete_missing_404`) |
| BUG-04 | POST/PUT return empty 200; auth validation throws 500 | fixed | `api/tests/test_regressions.py::test_bug_04_create_and_replace_return_the_template`, `::test_bug_04_unauthenticated_is_401_not_500`; `api/tests/test_openapi_contract.py::test_create_template_documents_location_header` |
| BUG-05 | `includeDeleted` omitted includes deleted | fixed | `api/tests/test_regressions.py::test_bug_05_deleted_templates_excluded_unless_requested`; `api/tests/storage_contract.py::TemplateContract::test_list_excludes_deleted_unless_requested` |
| BUG-06 | PUT blind upsert; trusts `createdBy`/`isDeleted`; PATCH not re-validated | fixed | `api/tests/test_regressions.py::test_bug_06_put_does_not_upsert_and_ignores_client_audit_fields`; `api/tests/test_templates_api.py::test_patch_invalid_result_400`; `api/tests/test_models_templates.py::test_patch_result_revalidated_like_post` |
| BUG-07 | Redis list uses `KEYS` on every server | not applicable (Redis dropped; PostgreSQL only, ADR-0004) | none needed; `docs/rewrite/component-mapping.md` |
| BUG-08 | Mongo filter on unmapped computed `Id` | not applicable (Mongo dropped, ADR-0004) | none needed; `docs/rewrite/component-mapping.md` |
| BUG-09 | OBO scope hard-coded; new MSAL app per request | fixed | `api/tests/test_auth_obo.py::test_scope_per_cluster_and_user_assertion`, `::test_custom_scope_template`, `::test_app_created_once_and_configured`, `::test_dependency_caches_provider_on_app` |
| BUG-10 | Helm env names mismatch; frontend env missing; ingress strips `/api` | fixed in `deploy/` + `web/docker/` (Helm not ported, Q-016) | Verified 2026-09-30 (P5-08, Docker 29.8.1, fresh compose deploy per `deploy/README.md`): `migrate` exit 0, api healthy, `/api/healthChecks/readiness` via nginx 204 (503 with postgres down), `/api/templates/queries` 401 problem+json (prefix preserved), `/config.js` contains `agGridLicenseKey` (empty when no key, optional since 2026-09-30) and env values. Found/fixed: pinned subnet 172.29.0.0/16 broke container networking on Docker Desktop (Q-114). Real ingress/TLS unverified |
| BUG-20 | Hard refresh of `/view/:uuid` redirects to `/` | fixed | Web unit `web/src/features/tabs/TabHost.test.tsx::renders the tab on a hard load once tabs are loaded (BUG-20)` |
| BUG-21 | Side tree does not highlight active tab on first load | fixed | Web unit `web/src/features/tree/SideTree.test.tsx::highlights the active node on first load (BUG-21)` |
| BUG-22 | First sign-in failure leaves "Authenticating..." stuck | fixed | Web unit `web/src/app/useBootstrap.test.tsx::failed first sign-in then retry proceeds to loaded (BUG-22)`; `web/src/app/AppShell.test.tsx::error: shows the message and Retry succeeds (BUG-22)`; `web/src/lib/auth/AuthProvider.test.tsx::a failed login shows an error and can be retried`; `web/src/lib/auth/msalAuth.test.ts::rejects a failed popup with a typed error and can be retried` |
| BUG-23 | MSAL prompts every load; multiple popups | fixed (ADR-0005) | Web unit `web/src/lib/auth/msalAuth.test.ts::builds MSAL from config, initialises, handles the pending response and restores the account`, `::returns a silent token without any popup`, `::shares one popup between concurrent acquireToken calls`, `::serialises interactive requests for different scopes` |
| BUG-24 | Restore button disabled check uses delete count | fixed | Web unit `web/src/features/templates-admin/QueryManagerPage.test.tsx::enables Restore from the restore count, not the delete count (BUG-24)` |
| BUG-25 | Customise-tag `onSuccess` re-applies old rows | fixed | Web unit `web/src/features/tagging/TagDialog.test.tsx::submits, updates the grid rows and closes (BUG-25)` |
| BUG-26 | TagEventDialog closes on error; `getDetermination(undefined)` throws | fixed | Web unit `web/src/features/tagging/TagDialog.test.tsx::keeps the dialog open and shows the error when a request fails (BUG-26)` |
| BUG-27 | `loadRowData` throws with no stored rows | fixed | Web unit `web/src/lib/storage/storage.test.ts::returns [] when missing (BUG-27)`; `web/src/features/grid/ResultsGrid.test.tsx::renders without throwing when no rows are stored (BUG-27)` |
| BUG-28 | Schema not loaded for initial cluster/db; races; bad JSON parse | fixed (schema is an object, deviation in `api-contract.md`) | Web unit `web/src/features/kusto-query/useKustoSchema.test.tsx::loads the schema for the initial cluster and database`, `::waits for the editor and for a cluster and database`, `::ignores a stale response (BUG-28)`; `api/tests/test_kusto_schema_api.py::test_happy_path_normalises_cluster` |
| BUG-29 | `formatCluster` forces `.kusto.windows.net` | fixed | Web unit `web/src/components/clusterUrl.test.ts::prepends https:// but never forces a kusto domain (BUG-29)`; `web/src/components/ClusterSelect.test.tsx::accepts free text and normalises without forcing .kusto.windows.net (BUG-29)`; API accepts Fabric suffix: `api/tests/test_kusto_validation.py::test_accepts_and_normalises` |
| BUG-30 | Poll timeout returns `null`; no cancellation | fixed | Web unit `web/src/lib/api/queryRuns.test.ts::gives up after 11 minutes with a client-source QueryTimeoutError`, `::aborts while waiting between polls and stops polling (BUG-30)`, `::rejects at once for an already-aborted signal` |
| BUG-31 | Share link `btoa`/`atob` not Unicode-safe | fixed | Web unit `web/src/features/share/shareLink.test.ts::round-trips emoji and non-Latin1 params (BUG-31)`, `::decodes legacy btoa links, including Latin-1 and a + turned into a space` |
| BUG-32 | Removing a tab leaves orphaned descendants | fixed | Web unit `web/src/features/tabs/tabStore.test.ts::cascades to the whole subtree and their row results (BUG-32)`; `web/src/features/tree/useTreeSelection.test.tsx::removing a parent removes all descendants, leaves others`; e2e `web/e2e/flows/w11-manage-tabs.spec.ts::W11 side tree expands on hover (screen 16), cascade-select and remove tabs` |
| BUG-33 | Vuex strict always on; `TAG_*` not `VITE_` prefixed | fixed / partly not applicable (no Vuex; `nodeEnv` dropped) | Web unit `web/src/lib/config/runtimeConfig.test.ts::regression BUG-33: VITE_TAG_* env vars work and nodeEnv is not part of the config` |
| BUG-34 | `getDefaultParams` turns falsy defaults into `''` | fixed | Web unit `web/src/lib/kql-templates/kql-templates.test.ts::keeps falsy defaults (BUG-34)` |
| BUG-35 | `templateQueriesAsObject` keys by segment name (collisions) | fixed | Web unit `web/src/features/new-query/templateMenuTree.test.ts::keeps same segment name under different paths apart (BUG-35)` |
| BUG-36 | Grid columns derived only from `rowData[0]` | fixed | Web unit `web/src/features/grid/grid.test.ts::derives columns from the union of all rows (BUG-36)` |
| BUG-37 | Event bus listeners leak; Monaco never disposed; 100 ms interval | fixed (event bus removed; no polling) | Web unit `web/src/components/CodeEditor.test.tsx::disposes model and editor on unmount`; `web/src/components/DraggableDialog.test.tsx::moves when the title is dragged` (handler based, no interval). Event bus removal is structural (`component-mapping.md`) |
| BUG-38 | Raw error objects stored in Vuex/IndexedDB | fixed | Web unit `web/src/features/tabs/tabStore.test.ts::errors (BUG-38) stores only serialisable {message, code}`, `::sanitises raw errors found in stored data on load` |
| BUG-39 | Invalid custom time period accepted (NaN) | fixed | Web unit `web/src/lib/time-range/timeRange.test.ts::custom period (BUG-39)`; `web/src/components/TimeRangePicker.test.tsx::validates custom periods (BUG-39)` |
| BUG-40 | `err.response.data.error` wrong shape / crashes on network error | fixed | Web unit `web/src/features/templates-admin/TemplateDialog.test.tsx::shows the problem detail from the API (BUG-40)`, `::shows a network error without crashing (BUG-40)`; `web/src/lib/api/client.test.ts::never sends identity fields in template bodies (SEC-03, BUG-40)` |
| BUG-41 | Cosmetic items (QueryHelper brace and `GetTagEvents` case, ColumnView text, close icon, `issueUri` typo, LICENCE, `isEmptyValue`) | fixed; `getTagEvents()` casing accepted without change (F-A05, parity report) | Web unit `web/src/features/kusto-query/QueryHelperDialog.test.tsx::BUG-41: invokes the function with the defined casing and has no stray brace`; `web/src/features/column-views/ColumnViewBar.test.tsx::confirms deletion with corrected text (BUG-41) and clears the selection`; `web/src/lib/config/runtimeConfig.test.ts::regression BUG-41: default issueUri is valid https and the LICENSE env spelling is read`; `web/src/lib/isEmpty.test.ts::isEmpty(%j) = %s` (`[]`, `{}` cases). DetailSidePanel close icon: documented manual check, open Show details from a result row (e2e `web/e2e/flows/w07-inspect-row.spec.ts::W7: Show details opens the Result Details panel`) and confirm the close icon is visible in light and dark themes |
| BUG-42 | Every column editable but only `TagEvent.Comment` persisted | fixed | Web unit `web/src/features/tagging/commentEdit.test.tsx::only TagEvent.Comment can be edited, and only for saved rows with a determination`, `::persists the comment and updates the row and stored rows` |
| BUG-43 | Community Docker build silently loses Enterprise grid features | not ported (single Enterprise build, ADR-0006) | Updated 2026-09-30: licence key made optional (no production, trial must work everywhere; ADR-0006 amendment). Earlier P5-08 fail-fast (container exit 1, compose refusing to render) removed. Re-verified with the prod compose stack (`-p tim-trial`) and `AGGRID_LICENSE` unset: web starts, readiness via nginx 204, `/config.js` has empty `agGridLicenseKey`; entrypoint test asserts it. Single Enterprise build, so BUG-43 still not ported. Licence validity itself (real key, no watermark) unverified; `docs/decisions/0006-ag-grid-enterprise.md` |
