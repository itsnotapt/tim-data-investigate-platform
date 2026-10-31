---
status: accepted
date: 2026-10-30
---

# A row's `id` is the value of the Id column, computed in the browser

The server computed each row's `id` when a run executed, so an analyst who found the results had no `id` (or the wrong one) had to change the Id column and run again before annotating. A row's `id` is now computed in the browser, from one column of the results, the Id column, which the analyst can switch on results they already have.

- **The `id`.** It is the value of the row's Id column: a string as it is, anything else as JSON. A missing or `null` value, `""` and a value over 512 characters give no `id`.
- **Where it starts.** The Id column starts as the action's `id`, or as the `idColumn` param of Run KQL, Run SQL and `dev_json`. The analyst can switch it without rerunning, from a cell's context menu or the Id column pill.
- **Browser only.** The server stores and sends no `id`s: `run_rows` has no `id` column, the rows page carries no annotations, and a run has no `id` warnings. Annotations reach rows from the browser's copy of the change feed.
- **One column.** An action's `id` is one column name. An `id` made of several columns is built in the query, such as `extend SummaryId = strcat(State, "|", EventType)`. `RowId`, `IdColumns`, `Action.row_id` and the list form of `id` are gone.
- **Share links.** A link carries `idColumn` when it differs from the column the results start with.

Decided by the user. Supersedes the `id` part of [0017](0017-actions-from-providers.md) and [0020](0020-annotations-in-postgres.md). Related: [architecture](../architecture.md#the-id-column).

## Considered Options

| Option | Pros | Cons |
|---|---|---|
| Keep server ids; rerun to change them | No browser logic | Annotating after setting the Id column costs a rerun, and a slow query runs again |
| Keep `run_rows.id`, recompute it on the server when the column changes | Ids stay queryable per run | A new endpoint and a rewrite of every row, for a choice that only changes how rows are read |
| A list of alternative columns, or the canonical JSON of several columns | Handles a composite key without the query author | More rules (first non-empty, canonical form, warnings) for something a query author can do with one column |
| Browser-only ids from one column | No rerun; one rule; a smaller rows page | See Consequences |

## Consequences

- An analyst annotates without rerunning, and switching the Id column back shows the old annotations again.
- Ids aren't queryable on the server per run.
- The rows page is smaller: no `id` and no annotations.
- A share link carries the Id column, so the recipient sees the same labels.
- Annotations show only once the browser's copy of the change feed is loaded.
- A composite `id` is the query author's job.
