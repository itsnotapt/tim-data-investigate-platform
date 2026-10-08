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
from storage_contract import T0, make_run, make_template

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


def test_migrations_upgrade_and_downgrade(scratch_dsn: str) -> None:
    assert _tables(scratch_dsn) == set()
    migrate(scratch_dsn)
    assert _tables(scratch_dsn) == {"query_templates", "query_runs"}

    def indexes(conn: Connection) -> set[str]:
        insp = inspect(conn)
        return {
            str(i["name"]) for t in ("query_templates", "query_runs") for i in insp.get_indexes(t)
        }

    found = asyncio.run(_with_conn(scratch_dsn, indexes))
    assert {
        "ix_query_templates_updated_uuid",
        "ix_query_runs_requested_by",
        "ix_query_runs_expires_at",
        "ix_query_runs_created_executed",
    } <= found

    migrate(scratch_dsn)  # idempotent
    migrate(scratch_dsn, "base", down=True)
    assert _tables(scratch_dsn) == set()
    migrate(scratch_dsn)  # and repeatable
    assert _tables(scratch_dsn) == {"query_templates", "query_runs"}


def test_migration_matches_table_definitions(scratch_dsn: str) -> None:
    migrate(scratch_dsn)

    def diff(conn: Connection) -> list[Any]:
        return list(compare_metadata(MigrationContext.configure(conn), metadata))

    assert asyncio.run(_with_conn(scratch_dsn, diff)) == []


async def test_python_none_is_sql_null(postgres_dsn: str) -> None:
    storage = PostgresStorage(postgres_dsn)
    try:
        template = make_template()
        await storage.templates.create(template.model_copy(update={"params": None}))
        run = make_run()
        await storage.runs.create(run)

        async def rows(conn: Any) -> Any:
            t = await conn.execute(
                text("SELECT params IS NULL FROM query_templates WHERE uuid = :u"),
                {"u": template.uuid},
            )
            r = await conn.execute(
                text("SELECT result_data IS NULL, execution_metrics IS NULL FROM query_runs")
            )
            return t.scalar_one(), r.one()

        tnull, (rnull, mnull) = await _with_conn(postgres_dsn, rows, autocommit=True)
        assert tnull and rnull and mnull
    finally:
        await storage.aclose()


async def test_unreachable_database() -> None:
    storage = PostgresStorage("postgresql+asyncpg://u:p@127.0.0.1:1/none")
    try:
        assert await storage.health() is False
        with pytest.raises(StorageUnavailableError):
            await storage.templates.get(uuid.uuid4())
        with pytest.raises(StorageUnavailableError):
            await storage.runs.get_for_owner(uuid.uuid4(), "alice", T0)
        assert await sweep_expired(storage) == 0  # logged, not raised
    finally:
        await storage.aclose()
