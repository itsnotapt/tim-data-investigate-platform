---
status: accepted
date: 2026-09-29
---

# PostgreSQL for templates, presets, column views, runs and annotations

TIM persists query templates, presets, column views, runs (with their rows), Kusto query runs and annotations, so it uses **one store: PostgreSQL**. The previous backend switched between Couchbase, Mongo/Cosmos and Redis via `DATABASE_TYPE`, each with different TTL handling and some broken; that switch is not carried over.

- Access goes through a small repository interface (`api/src/tim_api/storage/`), with a Postgres implementation plus an in-memory one for unit tests.
- Tooling:
  - SQLAlchemy 2.x async with the `asyncpg` driver
  - Alembic migrations
  - tests against a real Postgres, set with `TIM_TEST_DATABASE_URL` (or a temporary `pgserver` instance)
- Schema:
  - `query_templates`: `uuid` PK; scalar columns for list/filter fields (`name`, `query_type`, `is_deleted`, `is_managed`, `updated`, `created_by`, `updated_by`); JSON columns for `path`, `params`, `fields`, `columns`.
  - `presets`: `preset_id` PK, `owner` (from the token), `name`, `visibility` (`private` or `shared`), `action`, JSON columns `menu_path`, `params` and `inputs`, `created_at`, `updated_at`; index on `(created_at, preset_id)`.
  - `preset_hidden`: PK `(preset_id, analyst)`, `preset_id` references `presets` `ON DELETE CASCADE`. A row means the analyst hid the preset.
  - `column_views`: `view_id` PK, `owner` (from the token), `name`, `visibility` (`private` or `shared`), `saved_from_action`, `saved_from_preset_id`, JSONB `state`, `created_at`, `updated_at`; index on `(created_at, view_id)` ([0022](0022-column-views-store-grid-state.md)).
  - `column_view_hidden`: PK `(view_id, analyst)`, `view_id` references `column_views` `ON DELETE CASCADE`. A row means the analyst hid the column view.
  - `runs`: `run_id` PK, `owner`, `status`, `action`, `params`, `details`, `columns`, `row_count`, `error`, `started_at`, `finished_at`, `expires_at`, `cancel_requested`.
  - `run_rows`: `UNLOGGED`, PK `(run_id, ordinal)`, `id`, `data jsonb`, `ON DELETE CASCADE` ([0012](0012-query-run-limits-and-lifecycle.md)).
  - `annotation_clock`, `id_state`, `label_changes`, `tags`, `comments` ([0020](0020-annotations-in-postgres.md)).
  - `query_runs`: `query_run_id` PK, `requested_by` (from the token), `status`, `execute_date_time_utc`, `expires_at`, JSON columns `kusto_query`, `execution_metrics`, `result_data`, and `main_error`.
- Retention: runs expire via `expires_at`, and a periodic cleanup task deletes expired runs, the same way for every run. A startup sweep marks runs left in `running` or `created` as `error`. Values are in [ADR-0012](0012-query-run-limits-and-lifecycle.md).
- Data from the previous stores is not migrated.

Decided by the user.

## Consequences

- Compose has a `postgres` service; there is no Couchbase, Redis or Mongo configuration.
- JSON field names on the wire are camelCase. Mapping column names to JSON happens in the Pydantic layer.
