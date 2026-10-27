"""PostgreSQL-specific behaviour beyond the shared contract, plus migrations."""

import asyncio
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from conftest import migrate
from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection, make_url
from sqlalchemy.ext.asyncio import create_async_engine
from storage_contract import T0, make_run

from tim_api.storage import PostgresStorage, StorageUnavailableError, sweep_expired
from tim_api.storage.postgres import metadata


async def _with_conn(dsn: str, fn: Any, *, autocommit: bool = False) -> Any:
    engine = create_async_engine(
        dsn, isolation_level="AUTOCOMMIT" if autocommit else "READ COMMITTED"
    )
    try:
        async with engine.connect() as conn:
            return await conn.run_sync(fn) if not autocommit else await fn(conn)
    finally:
        await engine.dispose()


@pytest.fixture
def scratch_dsn(postgres_admin_dsn: str) -> Iterator[str]:
    """A throwaway empty database on the test server (for migration tests)."""
    name = f"tim_mig_{uuid.uuid4().hex[:8]}"

    async def ddl(sql: str) -> None:
        async def run(conn: Any) -> None:
            await conn.execute(text(sql))

        await _with_conn(postgres_admin_dsn, run, autocommit=True)

    asyncio.run(ddl(f'CREATE DATABASE "{name}"'))
    try:
        yield make_url(postgres_admin_dsn).set(database=name).render_as_string(hide_password=False)
    finally:
        asyncio.run(ddl(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))


def _tables(dsn: str) -> set[str]:
    def run(conn: Connection) -> set[str]:
        return set(inspect(conn).get_table_names()) - {"alembic_version"}

    result: set[str] = asyncio.run(_with_conn(dsn, run))
    return result


ALL_TABLES = {
    "runs",
    "run_rows",
    "presets",
    "preset_hidden",
    "column_views",
    "column_view_hidden",
    "annotation_clock",
    "id_state",
    "label_changes",
    "tags",
    "comments",
}


def test_migrations_upgrade_and_downgrade(scratch_dsn: str) -> None:
    assert _tables(scratch_dsn) == set()
    migrate(scratch_dsn)
    assert _tables(scratch_dsn) == ALL_TABLES

    def indexes(conn: Connection) -> set[str]:
        insp = inspect(conn)
        return {str(i["name"]) for t in insp.get_table_names() for i in insp.get_indexes(t)}

    found = asyncio.run(_with_conn(scratch_dsn, indexes))
    assert {
        "ix_runs_expires_at",
        "ix_runs_running_started",
        "ix_presets_created_id",
        "ix_column_views_created_id",
        "ix_id_state_version",
        "ix_comments_id",
    } <= found

    migrate(scratch_dsn)  # idempotent
    migrate(scratch_dsn, "0007", down=True)
    assert _tables(scratch_dsn) == ALL_TABLES
    migrate(scratch_dsn, "0006", down=True)
    assert _tables(scratch_dsn) == ALL_TABLES | {"query_runs"}

    found = asyncio.run(_with_conn(scratch_dsn, indexes))
    assert {
        "ix_query_runs_requested_by",
        "ix_query_runs_expires_at",
        "ix_query_runs_created_executed",
    } <= found

    migrate(scratch_dsn, "0005", down=True)
    assert _tables(scratch_dsn) == ALL_TABLES | {"query_runs", "query_templates"}
    migrate(scratch_dsn, "0002", down=True)
    assert _tables(scratch_dsn) == {"query_templates", "query_runs", "runs", "run_rows"}
    migrate(scratch_dsn, "0001", down=True)
    assert _tables(scratch_dsn) == {"query_templates", "query_runs"}
    migrate(scratch_dsn, "base", down=True)
    assert _tables(scratch_dsn) == set()
    migrate(scratch_dsn)  # and repeatable
    assert _tables(scratch_dsn) == ALL_TABLES


def test_stored_rows_survive_the_change_of_run_rows_to_json(scratch_dsn: str) -> None:
    migrate(scratch_dsn, "0007")

    def store(conn: Connection) -> None:
        run_id = uuid.uuid4()
        conn.execute(
            text(
                "INSERT INTO runs (run_id, owner, status, action, params, details, started_at, "
                "expires_at) VALUES (:run_id, 'alice', 'running', '{}', '{}', '{}', now(), now())"
            ),
            {"run_id": run_id},
        )
        conn.execute(
            text(
                "INSERT INTO run_rows (run_id, ordinal, id, data) VALUES (:run_id, 0, 'e', :data)"
            ),
            {"run_id": run_id, "data": '{"b": 1, "a": {"y": 2}}'},
        )
        conn.commit()

    def stored(conn: Connection) -> tuple[str, str]:
        found = conn.execute(text("SELECT pg_typeof(data)::text, data::text FROM run_rows")).one()
        return str(found[0]), str(found[1])

    asyncio.run(_with_conn(scratch_dsn, store))
    migrate(scratch_dsn)
    assert asyncio.run(_with_conn(scratch_dsn, stored)) == ("json", '{"a": {"y": 2}, "b": 1}')
    migrate(scratch_dsn, "0007", down=True)
    assert asyncio.run(_with_conn(scratch_dsn, stored)) == ("jsonb", '{"a": {"y": 2}, "b": 1}')


def test_run_rows_are_unlogged_and_runs_are_logged(scratch_dsn: str) -> None:
    migrate(scratch_dsn)

    def persistence(conn: Connection) -> dict[str, str]:
        found = conn.execute(
            text(
                "SELECT relname, relpersistence::text FROM pg_class "
                "WHERE relname IN ('runs', 'run_rows')"
            )
        )
        return {str(name): str(kind) for name, kind in found}

    assert asyncio.run(_with_conn(scratch_dsn, persistence)) == {"runs": "p", "run_rows": "u"}


def test_migration_matches_table_definitions(scratch_dsn: str) -> None:
    migrate(scratch_dsn)

    def diff(conn: Connection) -> list[Any]:
        return list(compare_metadata(MigrationContext.configure(conn), metadata))

    assert asyncio.run(_with_conn(scratch_dsn, diff)) == []


async def test_python_none_is_sql_null(postgres_dsn: str) -> None:
    storage = PostgresStorage(postgres_dsn)
    try:
        await storage.runs.create(make_run())

        async def rows(conn: Any) -> Any:
            r = await conn.execute(text("SELECT columns IS NULL FROM runs"))
            return r.scalar_one()

        assert await _with_conn(postgres_dsn, rows, autocommit=True) is True
    finally:
        await storage.aclose()


async def test_unreachable_database() -> None:
    storage = PostgresStorage("postgresql+asyncpg://u:p@127.0.0.1:1/none")
    try:
        assert await storage.health() is False
        with pytest.raises(StorageUnavailableError):
            await storage.runs.get(uuid.uuid4(), T0)
        assert await sweep_expired(storage) == 0  # logged, not raised
    finally:
        await storage.aclose()
