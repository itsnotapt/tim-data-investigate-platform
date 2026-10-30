---
status: accepted
date: 2026-10-20
---

# Column views store AG Grid's own state

Analysts save named column views (columns and filters), and AG Grid already has a serialisable state with its own migration across versions. A column view is a partial `GridState`, fitted in the browser to each result's columns before it's applied. The server checks only that it's a JSON object.

- **What's stored.** `columnOrder`, `columnSizing`, `columnVisibility`, `columnPinning`, `columnHeaderName`, `userColumns`, `sort`, `rowGroup`, `aggregation`, `pivot` and `filter`, with `partialColumnState: true`. Never side bar, selection, focus, scroll, expansion or quick filter. The browser alone decides the keys (`web/src/features/action-column-views/columnViewState.ts`); the API keeps `state` as JSONB (`api/src/tim_api/column_views/`).
- **Fit, then apply.** The browser drops unknown column ids and appends missing ones, then applies in place with `resetColumnState()` and `setState()`. Action-file column hints use AG Grid's `initial*` settings, so restored state wins over them.
- **Versioning.** `state.version` is stored exactly as `getState()` reported it. There is no TIM schema version, and stored column views are never rewritten: `setState()` runs AG Grid's own `migrateGridStateModel`, and the fit step handles the column ids it doesn't. Checking the state-migration notes is part of every AG Grid upgrade ([development.md](../development.md#ag-grid-upgrades)).
- **Default views** are kept per analyst in the browser's IndexedDB, and only column views are on the server (`/api/columnViews`).

Decided by the user. Related: [0006](0006-ag-grid-enterprise.md), [0004](0004-postgresql-persistence.md), [api](../api.md#column-views).

## Considered Options

| Option | Pros | Cons |
|---|---|---|
| TIM's own column-settings format | Independent of AG Grid | A second model to keep in step with every grid feature (calculated columns, filters, grouping) |
| Full `GridState` | Simple | Carries selection, scroll and side bar; a column view without pinning would unpin the action's pinned columns |
| A server-side key list or schema | Rejects junk | Every AG Grid upgrade that adds a key needs an API change |
| Remembering the last layout automatically | No Save step | A one-off change quietly sticks to future tabs |

## Consequences

- Column views saved with an older AG Grid keep working through its migration, but a key AG Grid drops without migrating is left unapplied by TIM's fit step.
- Default views don't follow an analyst between browsers.
