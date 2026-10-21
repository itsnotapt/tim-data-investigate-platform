---
status: accepted
date: 2026-10-06
---

# Run limits and lifecycle

A run is asynchronous and stored in PostgreSQL ([0004](0004-postgresql-persistence.md)), so one large or slow run must not exhaust memory, the database or the process. Runs therefore have result caps that fail the run, a timeout, a concurrency limit and a bounded retention, and every outcome is saved as the run's final state. Rows are stored one per result row in the `UNLOGGED` table `run_rows`, kept only for succeeded runs: crash recovery empties it, and the rows endpoint then answers `410`.

A run is started by `POST /api/runs`, and read with `GET /api/runs/{runId}` and `GET /api/runs/{runId}/rows`; `POST /api/runs/{runId}/cancel` cancels it. The Kusto query run, started by `POST /api/kusto/query` and read with `GET /api/kusto/query/{queryRunId}`, keeps its whole result in one `jsonb` value and follows the same rules except where noted. Code: `api/src/tim_api/runs/`, `api/src/tim_api/query_runs/`, `api/src/tim_api/kusto/query_client.py`, `api/src/tim_api/storage/`.

- **Result caps are errors, not truncation.** `TIM_MAX_RESULT_ROWS` (default 1,000,000) and `TIM_MAX_RESULT_BYTES` (default 512 MiB, compact JSON per row, summed) are checked while rows stream in. Exceeding either ends the run as `error` with a message naming the limit. Partial results are never returned. A Kusto query run is capped at 100,000 rows and 64 MiB, or the configured caps when they are lower, because its one `jsonb` value cannot hold more.
- **Timeout.** `TIM_RUN_TIMEOUT_SECONDS` (default 600) bounds execution and is passed on to the connection where it has a server timeout, as Kusto does. A run that hits it ends as `timedOut`.
- **Concurrency.** `TIM_MAX_CONCURRENT_RUNS` (default 16) per process, one semaphore shared by runs and Kusto query runs. Waiting runs are `running` (Kusto query runs stay `created`), and the timeout starts only once a slot is taken.
- **Statuses.** `running | succeeded | error | timedOut | cancelled`. Cancel is owner only and idempotent, through `Hook.cancel()` called from another thread; any replica can take the request, because it is stored on the run and the replica executing it polls for it. Partial rows of a run that doesn't succeed are deleted at once.
- **NUL characters.** PostgreSQL JSONB and TEXT cannot store U+0000. Rows, ids, details and error text have it replaced with U+FFFD before saving. A Kusto query or database name containing NUL is rejected up front with a 400.
- **Responses.** The `POST` waits up to 1 second. If the run finished it returns 200, otherwise 202 with the run still running. Reads and cancel of a run always answer 200; the Kusto query run's `GET` answers 202 while it runs. Invalid params come back as 422 before a run exists, as do auth and cluster errors for a Kusto query run.
- **Ownership and expiry.** A run is visible only to the user who started it. Unknown, expired and other users' runs all return the same 404. Runs expire `TIM_RUN_RETENTION_SECONDS` (default 24 h) after they last changed. A background sweep (`TIM_RUN_RETENTION_SWEEP_SECONDS`, default 300) deletes expired runs a few at a time, but reads treat an expired run as missing even before the sweep.
- **Restarts.** At startup, runs still `running` (or `created`) for longer than the timeout are marked `error` ("Run interrupted by server restart"). On shutdown, in-flight runs are stopped and marked the same way.
- **Runs never raise.** Every outcome, including unexpected failures, is saved as the run's final state. Users see fixed, sanitised messages, or the message of the action's own `RunError`. Stack traces go to the log with the trace id.

Decided by the user. Related: [0004](0004-postgresql-persistence.md), [0009](0009-obo-token-exchange.md), [configuration](../configuration.md), [api](../api.md).

## Considered Options

| Option | Pros | Cons |
|---|---|---|
| Truncate at the cap | The user gets something | Silently wrong data, which is worse for investigations |
| Reject NUL runs | No rewriting | Fails whole queries over one stray character in data |
| Strip NUL | Smaller output | Joins neighbouring characters. U+FFFD shows that something was there |
| External job queue | Survives restarts, scales out | Extra infrastructure. Not needed at current scale |
| One `jsonb` value per run | Simple | A cap of about 256 MiB, and every read loads the whole value |
| AG Grid's server-side row model | No browser limit | Loses the quick filter, full export and filtered select-all; a later effort |
| A logged `run_rows` | Survives crashes | WAL for every result row, which can be rerun |

## Consequences

- Users must narrow a query that exceeds a cap, for example with `take` or `summarize`.
- The concurrency limit is per process, so total load scales with replica count.
- Runs in flight when the process dies are lost and reported as interrupted, and a crash loses the rows of succeeded runs, though not the runs themselves.
