# Rewrite UI screenshots

Screenshots of the new React app (1440x900), numbered and named like the legacy screens in [current-system/screenshots](../../current-system/screenshots/README.md). They are produced by the Playwright flows in `web/e2e/flows/` against mocked `/api/**` data (same fake data as the legacy captures):

```
cd web && E2E_SHOTS=1 npx playwright test e2e/flows
```

Without `E2E_SHOTS=1` the same specs run and assert, but write nothing. Workflows are defined in [workflows.md](../../current-system/workflows.md).

## W1-W7

| # | File | Flow spec | Legacy equivalent | Notes |
|---|---|---|---|---|
| 01 | 01-welcome.png | w01-bootstrap | 01-welcome | MUI look; the stub account signs in automatically. |
| 04 | 04-menu-account.png | w01-bootstrap | 04-menu-account | New menu also lists the account name (disabled) above "Sign out". |
| 05 | 05-new-query-menu.png | w02-adhoc-query | 05-new-query-menu | "New query" is a menu item above the search box; Views/Queries groups follow. |
| 06 | 06-new-query-menu-search.png | w05-template-direct | 06-new-query-menu-search | Search "storm" expands the groups and lists "Recent storms" and "Storm events for state". |
| 07 | 07-kusto-query-edit.png | w02-adhoc-query | 07-kusto-query-edit | Required-field errors show only after a failed Save & Run (legacy shows them at once), so the shot is taken after one failed submit. Toolbar label reads "Time range: Last 15 minutes" (not upper-case). |
| 08 | 08-time-range-menu.png | w02-adhoc-query | 08-time-range-menu | |
| 09 | 09-time-range-custom-date.png | w02-adhoc-query | 09-time-range-custom-date | |
| 10 | 10-time-range-custom-period.png | w02-adhoc-query | 10-time-range-custom-period | |
| 11 | 11-cluster-selection.png | w02-adhoc-query | 11-cluster-selection | MUI Autocomplete popup. |
| 12 | 12-kusto-query-edit-filled.png | w02-adhoc-query | 12-kusto-query-edit-filled | |
| 15 | 15-kusto-query-results.png | w02-adhoc-query | 15-kusto-query-results | AG Grid 36: the Columns tool panel is open by default; footer shows Execution Time, CPU Time, Memory, Total Rows. |
| 17 | 17-grid-sidebar-columns.png | w03-explore-results | 17-grid-sidebar-columns | Sidebar collapsed to the Columns / Filters tabs. |
| 18 | 18-grid-sidebar-filters.png | w03-explore-results | 18-grid-sidebar-filters | Filters tool panel (searchable column list). |
| 19 | 19-grid-column-menu.png | w03-explore-results | 19-grid-column-menu | AG Grid 36 column menu. |
| 20 | 20-column-view-create.png | w03-explore-results | 20-column-view-create | Autocomplete offers "Create column view" for a new name. |
| 21 | 21-grid-context-menu.png | w04-pivot | 21-grid-context-menu | Taken before any column view exists (no "Triage layout"). |
| 22 | 22-grid-context-menu-tag.png | w06-tag-events | 22-grid-context-menu-tag | |
| 23 | 23-grid-context-menu-pivot.png | w04-pivot | 23-grid-context-menu-pivot | Nested submenus: Weather > Storms > "Storm events for state" (captured with the mouse kept on the menu). |
| 24 | 24-detail-side-panel.png | w07-inspect-row | 24-detail-side-panel | Drawer opened over the grid; TagEvent shown as YAML. |
| 25 | 25-tag-event-dialog.png | w06-tag-events | 25-tag-event-dialog | Determination/Comment default to Override, Tags to Ignore. |
| 26 | 26-after-pivot.png | w04-pivot | 26-after-pivot | Pivot from the KANSAS row; rows 3 and 4 selected; child tab spinner in the tree. |
| 27 | 27-side-tree-with-pivot.png | w04-pivot | 27-side-tree-with-pivot | Child is "[new] Storm events in KANSAS" (pivot row differs from legacy). |
| 28 | 28-template-query-results.png | w05-template-direct | 28-template-query-results | Opened from the tree child of a pivot. |
| 29 | 29-template-query-edit.png | w05-template-direct | 29-template-query-edit | |
| 31 | 31-new-menu-template-tree.png | w05-template-direct | 31-new-menu-template-tree | NEW > Queries > Weather (Storms, Damage). |
| 32 | 32-template-new-draft.png | w05-template-direct | 32-template-new-draft | |

Not captured in this section: none skipped.

<!-- W8–W14 below -->

| # | Screenshot | Flow spec | Legacy equivalent | Notes |
|---|---|---|---|---|
| 00 | 00-share-missing-params.png | w08-share | 00-share-missing-params | Same "Parameters are missing." error alert. |
| 02 | 02-menu-hamburger.png | w12-query-manager | 02-menu-hamburger | |
| 03 | 03-menu-help.png | w14-help | 03-menu-help | Wiki Page and Report a bug (links open in a new tab). |
| 13 | 13-query-help-dialog.png | w14-help | 13-query-help-dialog | Opened from a new query's edit form. |
| 14 | 14-query-help-dialog-scrolled.png | w14-help | 14-query-help-dialog-scrolled | |
| 16 | 16-side-tree-expanded.png | w11-manage-tabs | 16-side-tree-expanded | Taken with the pointer left on the tree (`shotHovering` in `e2e/mocks/flows-b.ts`), since `shot()` parks the mouse and collapses it. |
| 30 | 30-template-convert-dialog.png | w09-convert | 30-template-convert-dialog | Tab opened via an execute=1 share link. |
| 33 | 33-query-manager.png | w12-query-manager | 33-query-manager | |
| 34 | 34-query-manager-show-deleted.png | w12-query-manager | 34-query-manager-show-deleted | Stateful template mock (`templateStoreHandlers`). |
| 35 | 35-create-query-dialog.png | w12-query-manager | 35-create-query-dialog | |
| 36 | 36-create-query-dialog-scrolled.png | w12-query-manager | 36-create-query-dialog-scrolled | |
| 37 | 37-edit-query-dialog.png | w12-query-manager | 37-edit-query-dialog | |
| 38 | 38-edit-query-dialog-scrolled.png | w12-query-manager | 38-edit-query-dialog-scrolled | |
| 39 | 39-edit-query-dialog-managed.png | w12-query-manager | 39-edit-query-dialog-managed | |
| 40 | 40-export-import-exported.png | w13-export-import | 40-export-import-exported | Page has an "Export / Import" heading (legacy had none). |
| 41 | 41-share-link-opened.png | w08-share | 41-share-link-opened | Opened by an `execute=1` link, which runs immediately (as legacy). |

W10 Clone has no legacy screen; `w10-clone` asserts behaviour only (template clone = sibling "Copy of ..." in edit mode; Kusto clone = new root tab).
