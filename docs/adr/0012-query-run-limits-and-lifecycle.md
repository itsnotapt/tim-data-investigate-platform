---
status: accepted
date: 2026-10-06
---

# Query-run limits and lifecycle

A query run is asynchronous and its results are stored in PostgreSQL ([0004](0004-postgresql-persistence.md)), so one large or slow query must not exhaust memory, the database or the process. Runs therefore have result caps that fail the run, a timeout, a concurrency limit and a bounded retention, and every outcome is saved as the run's final state.

A run is started by `POST /api/kusto/query` and read with `GET /api/kusto/query/{queryRunId}`. Code: `api/src/tim_api/query_runs/`, `api/src/tim_api/kusto/query_client.py`, `api/src/tim_api/storage/`.

- **Result caps are errors, not truncation.** `TIM_MAX_RESULT_ROWS` (default 100000) and `TIM_MAX_RESULT_BYTES` (default 64 MiB) are checked while rows stream in. Exceeding either ends the run as `error` with a message naming the limit. Partial results are never returned.
- **Timeout.** `TIM_QUERY_TIMEOUT_SECONDS` (default 600) bounds execution and is also sent to Kusto. A run that hits it ends as `timedOut`.
- **Concurrency.** `TIM_MAX_CONCURRENT_RUNS` (default 16) per process, using a semaphore. Waiting runs stay `created`, and the timeout starts only once a slot is taken.
- **NUL characters.** PostgreSQL JSONB and TEXT cannot store U+0000. Result data and error text have it replaced with U+FFFD before saving. A query or database name containing NUL is rejected up front with a 400.
- **Responses.** The `POST` waits up to 1 second. If the run finished it returns 200, otherwise 202 with the run in `created`. The `GET` uses the same rule (200 or 202). Auth and cluster errors come back synchronously, before a run exists.
- **Ownership and expiry.** A run is visible only to the user who started it. Unknown, expired and other users' runs all return the same 404. Runs expire `TIM_RUN_RETENTION_SECONDS` (default 24 h) after they last changed. A background sweep (`TIM_RUN_RETENTION_SWEEP_SECONDS`, default 300) deletes expired rows, but reads treat an expired run as missing even before the sweep.
- **Restarts.** At startup, runs still `created` for longer than the timeout are marked `error` ("Run interrupted by server restart"). On shutdown, in-flight tasks are cancelled and marked the same way.
- **Run tasks never raise.** Every outcome, including unexpected failures, is saved as the run's final state. Users see fixed, sanitised messages. Stack traces go to the log with the trace id.

Decided by the user. Related: [0004](0004-postgresql-persistence.md), [0009](0009-obo-token-exchange.md), [configuration](../configuration.md), [api](../api.md).

## Considered Options

| Option | Pros | Cons |
|---|---|---|
| Truncate at the cap | The user gets something | Silently wrong data, which is worse for investigations |
| Reject NUL runs | No rewriting | Fails whole queries over one stray character in data |
| Strip NUL | Smaller output | Joins neighbouring characters. U+FFFD shows that something was there |
| External job queue | Survives restarts, scales out | Extra infrastructure. Not needed at current scale |

## Consequences

- Users must narrow a query that exceeds a cap, for example with `take` or `summarize`.
- The concurrency limit is per process, so total load scales with replica count.
- Runs in flight when the process dies are lost and reported as interrupted.
