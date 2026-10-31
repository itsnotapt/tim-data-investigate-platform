---
status: accepted
date: 2026-09-29
---

# PostgreSQL for runs, presets, column views and annotations

TIM persists runs (with their rows), presets, column views and annotations, so it uses **one store: PostgreSQL**. The previous backend switched between Couchbase, Mongo/Cosmos and Redis via `DATABASE_TYPE`, each with different TTL handling and some broken; that switch is not carried over.

- Access goes through a small repository interface (`api/src/tim_api/storage/`), with a Postgres implementation plus an in-memory one for unit tests.
- Tooling:
  - SQLAlchemy 2.x async with the `asyncpg` driver
  - Alembic migrations
  - tests against a real Postgres, set with `TIM_TEST_DATABASE_URL` (or a temporary `pgserver` instance)
- Schema:
  - `presets`: `preset_id` PK, `owner` (from the token), `name`, `visibility` (`private` or `shared`), `action`, JSON columns `menu_path`, `params` and `inputs`, `created_at`, `updated_at`; index on `(created_at, preset_id)`.
  - `preset_hidden`: PK `(preset_id, analyst)`, `preset_id` references `presets` `ON DELETE CASCADE`. A row means the analyst hid the preset.
  - `column_views`: `view_id` PK, `owner` (from the token), `name`, `visibility` (`private` or `shared`), `saved_from_action`, `saved_from_preset_id`, JSONB `state`, `created_at`, `updated_at`; index on `(created_at, view_id)` ([0022](0022-column-views-store-grid-state.md)).
  - `column_view_hidden`: PK `(view_id, analyst)`, `view_id` references `column_views` `ON DELETE CASCADE`. A row means the analyst hid the column view.
  - `runs`: `run_id` PK, `owner`, `status`, `action`, `params`, `details`, `columns`, `row_count`, `error`, `started_at`, `finished_at`, `expires_at`, `cancel_requested`, `heartbeat_at` (not indexed, so its updates can be HOT).
  - `run_rows`: `UNLOGGED`, PK `(run_id, row_number)`, `data json`, `ON DELETE CASCADE` ([0012](0012-query-run-limits-and-lifecycle.md)).
    - `data` is `json`, not `jsonb`, so a row keeps the key order the run produced.
    - `jsonb` sorts an object's keys (shorter first, then by bytes) at every level.
    - Nothing queries inside a row, so no `jsonb` operator or index is lost.
    - `runs.details` is `json` for the same reason.
  - `annotation_clock`, `id_state`, `label_changes`, `tags`, `comments` ([0020](0020-annotations-in-postgres.md)).
- Retention: runs expire via `expires_at`, and a periodic cleanup task deletes expired runs. A startup sweep marks runs left `running` as `error`. Values are in [ADR-0012](0012-query-run-limits-and-lifecycle.md).
- Data from the previous stores is not migrated.

Decided by the user.

## Consequences

- Compose has a `postgres` service; there is no Couchbase, Redis or Mongo configuration.
- JSON field names on the wire are camelCase. Mapping column names to JSON happens in the Pydantic layer.
