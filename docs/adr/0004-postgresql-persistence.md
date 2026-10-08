---
status: accepted
date: 2026-09-29
---

# PostgreSQL for templates and query runs

The legacy backend switches between Couchbase, Mongo/Cosmos and Redis via `DATABASE_TYPE`, each with different TTL handling and some broken, while only two entities (`QueryTemplate` and `KustoQueryRun`) are persisted. The rewrite uses **one store: PostgreSQL**, and the 3-way switch is dropped.

The legacy persistence problems are described in `docs/current-system/backend-api.md` § Persistence, preserved at git tag `migration-complete`.

- Access goes through a small repository interface (`api/src/tim_api/storage/`), with a Postgres implementation plus an in-memory one for unit tests.
- Tooling:
  - SQLAlchemy 2.x async with the `asyncpg` driver
  - Alembic migrations
  - tests against a real Postgres, via testcontainers or the compose service
- Schema:
  - `query_templates`: `uuid` PK; scalar columns for list/filter fields (`name`, `query_type`, `is_deleted`, `is_managed`, `updated`, `created_by`, `updated_by`); JSONB for `path`, `params`, `fields`, `columns`.
  - `query_runs`: `query_run_id` PK, `requested_by` (from the token), `status`, `execute_date_time_utc`, `expires_at`, JSONB `kusto_query`, `execution_metrics`, `result_data` (or compressed `bytea` if size demands), `main_error`.
- Retention: runs expire via `expires_at`, and a periodic cleanup task deletes expired runs, the same way for every run (fixes BUG-01). A startup sweep marks runs left in `created` as `error` (fixes BUG-02). Values are in Q-021.
- No legacy data migration (Q-004).

Decided by the user (Q-001). Related: Q-001, Q-007, Q-021, BUG-01, BUG-02, BUG-07, BUG-08.

## Consequences

- Compose adds a `postgres` service; the Couchbase, Redis and Mongo config is dropped.
- JSON field names on the wire are unchanged. Mapping column names to JSON happens in the Pydantic layer.
