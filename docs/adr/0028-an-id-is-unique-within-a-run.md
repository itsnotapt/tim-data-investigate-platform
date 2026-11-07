---
status: accepted
date: 2026-11-07
---

# An `id` is unique within a run, and the api counts duplicates

When several rows of a run shared an `id`, annotating one annotated all of them, and nothing told the analyst. An `id` is now unique within a run: if the Id column has duplicates, it stays the Id column but no row has an `id`, and the analyst is told how many. The api counts each column's duplicates when the run finishes, because the browser can't know them before it has every page.

- **The rule.** A column with duplicates can't give ids. Saved annotations stay and show again once another Id column is chosen.
- **The count.** Each run column has `duplicates`, the number of extra rows: rows whose id text an earlier row of the column had. Blank values (null, `""`, over 512 UTF-16 code units) are skipped. Every column is counted, so the browser can disable a column before the analyst picks it.
- **One id rule.** The api forms id text exactly as the browser does: a string as it is, anything else as `JSON.stringify` writes it, numbers as JavaScript writes them. A shared fixture, `web/src/features/labels/idCases.json`, pins the two implementations together, and each side's tests read it.
- **How.** While the run's rows are stored, the worker keeps a 64-bit hash of each value's id text in a compact array per column. At the end it counts one column at a time (length minus the size of its set) and frees each before the next. Two different ids with the same hash count as a false duplicate: about 1 in 37 million for a 1M-row column.
- **In the browser.** The Id column pill warns, and its editor disables columns with duplicates from the moment it opens. Typing a column with duplicates is refused with a toast. The cell menu no longer switches the Id column. Rows without an `id` say why: no Id column, an empty value, or N duplicates found.
- **Cost.** Measured at 1M rows by 20 columns. The count alone takes about 8 s with a 254 MiB peak. Inside the real `ResultBuilder` it adds 9.2 s (15.9 s to 25.1 s) and 178 MiB to the peak.

Decided by the user. Supersedes the parts of [0020](0020-annotations-in-postgres.md) and [0025](0025-ids-from-the-id-column-in-the-browser.md) that let an `id` repeat within a run. It overturns 0025's "the server sends no warnings about `id`s": the server now counts duplicates, and the browser still computes each `id`. Related: [architecture](../architecture.md#the-id-column), [api](../api.md).

## Considered Options

| Option | Pros | Cons |
|---|---|---|
| Hashes in a compact array per column, counted one column at a time (chosen) | Exact apart from hash collisions; bounded memory | +9.2 s and +178 MiB at 1M rows by 20 columns |
| Sets of hashes for every column at once | 7 s | 380 MiB for 5 unique columns |
| Sorting the values | Exact | 77 s |
| Counting in Postgres with `count(*) - count(DISTINCT col)` | No worker memory | 62.5 s |
| HyperLogLog | Small and fast | Approximate; a false 0 would let duplicates through, and the message wants an exact count |
| Capping the count at 100 | Cheaper | The message wants the exact count |
| Live sets while rows arrive | Count ready at the last page | Memory of every distinct value of every column |
| A page-by-page or on-click check in the browser | No server work | Needs every page loaded; the analyst finds out only after choosing |
| Allow repeated ids, annotating all rows that share one | No check | One annotation lands on rows the analyst didn't mean |

## Consequences

- A run finishes up to 9 s later at 1M rows by 20 columns, and the worker needs 178 MiB more at its peak.
- A false duplicate from a hash collision hides every `id` of a column that is in fact unique. The odds are about 1 in 37 million per 1M-row column.
- Counts are exact, so the browser shows them as written, e.g. "999,950 duplicates found".
- The browser still forms ids itself. Its rule and the api's must stay equal, which the shared fixture checks.
- A run stored before this change has no `duplicates`, so the api can't read its columns. TIM is unreleased, so there is no migration.
