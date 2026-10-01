# User workflows (legacy)

> **Archive.** This document describes the legacy system (Vue 2 + .NET 6), which was removed from the repo in P5-12. Paths and `file:line` citations refer to commit `8a2ff2e` (`git show 8a2ff2e:<path>`). Kept for reference; not maintained.

End-to-end features the rewrite must support. Screenshot numbers refer to [screenshots/](screenshots/README.md).

| # | Workflow | Steps | Screens |
|---|---|---|---|
| W1 | **Sign in & bootstrap** | `/config.js` → MSAL popup → load templates + query options → column views → tree loads tabs from IndexedDB | 01, 04 |
| W2 | **Ad-hoc Kusto query** | NewQueryButton ("Get Started" / tree `+` / "New") → "New query" → tab created (tree shows "[draft]") in edit mode → pick Cluster/Database (schema loads for IntelliSense) → edit Summary + KQL → "Save Changes & Run" with time range (default Last 15 minutes) → tree spinner → badge count → grid with execution stats; tab "[new]" until visited | 05, 07, 08–12, 15 |
| W3 | **Explore results** | Quick UI filter; side bar Columns/Filters; column menu; row grouping with `dcount`; save/apply/rename/delete named **column views** (global) | 17–20 |
| W4 | **Pivot** | Right-click row (optionally multi-select) → template path submenu → query template → `buildParams` from clicked row / selected rows (`multiple`) / regex-matching columns (`match`) → child TemplateQueryResult under current tab. Auto-runs if data complete (Shift in Template tab suppresses); incomplete ⇒ opens in edit mode and navigates | 21, 23, 26, 27 |
| W5 | **Open a template directly** | NewQueryButton → Views/Queries (searchable, nested by path) → item → tab in edit mode with defaults → dynamic param form + query preview → Save & Run | 06, 31, 32, 29 |
| W6 | **Tag events** | Quick: right-click → Tag Events → Quick Malicious/Suspicious/Benign (saves events + comment, row recolours). Detailed: "Customise tag events" dialog (determination/comment/tags with Ignore/Override/Append/Remove). Inline: edit `TagEvent.Comment` cell on saved rows. Queries must include `{{> getTagEvents}}` / TagEvent column to show tag state | 22, 25 |
| W7 | **Inspect row** | Right-click → "Show details" → 900px right drawer, key/value (objects as YAML); follows focused cell | 24 |
| W8 | **Share templated query** | Template tab → "Share Link" → clipboard `…/#/share/<templateUuid>?p=<b64 params>&execute=0` → recipient's ShareQuery recreates tab (runs only if `execute=1`) | 41, 00 |
| W9 | **Convert template to KQL** | "Convert" → confirm → tab becomes ad-hoc KustoQueryResult with rendered KQL (irreversible) | 30 |
| W10 | **Clone** | Kusto tab: Clone → new root tab. Template tab: Clone → sibling under same parent | – |
| W11 | **Manage tabs** | Check tree nodes (cascade to children) → Remove (deletes tabs + cached rows); "Reload templates" | 16, 27 |
| W12 | **Manage templates** | Hamburger → Query Manager → filter / Show deleted → Create/Edit dialog (YAML params/fields/columns + Handlebars query) → bulk Delete/Restore; managed templates read-only | 02, 33–39 |
| W13 | **Backup/restore tabs** | Settings → Export / Import → Export copies JSON to clipboard; Import writes IndexedDB, then refresh | 40 |
| W14 | **Help** | Help menu (Wiki, Report a bug); Query Help dialog (required fields, time params, getTagEvents, example) | 03, 13, 14 |

## Conventions queries must follow (from QueryHelperDialog)
- `EventId` (string) — unique per event; required for tagging and row identity (or template `columnId`).
- `EventTime` (datetime) — required for tagging.
- `Cluster` — used by pivot templates whose cluster is `{{Cluster}}`.
- Time range: `declare query_parameters(StartTime:datetime, EndTime:datetime);`.
- Tag state: template queries use `{{> getTagEvents}}` then `| invoke getTagEvents()` to add `TagEvent`.
