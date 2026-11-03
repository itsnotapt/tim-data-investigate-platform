"""The PostgreSQL server the tests run against, its migrations, and emptying it between tests."""

import asyncio
import tempfile
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

API_DIR = Path(__file__).resolve().parent.parent

NO_POSTGRES = (
    "no Postgres for the tests: set TIM_TEST_DATABASE_URL to a server, "
    "or install pgserver (uv sync) to start one"
)


def asyncpg_url(url: str) -> str:
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+asyncpg://" + url[len(prefix) :]
    return url


@contextmanager
def postgres_server(test_database_url: str | None) -> Iterator[str]:
    """The URL of a running server: ``test_database_url``, else a temporary ``pgserver``.
    Fails the tests when there is neither."""
    if test_database_url:
        yield asyncpg_url(test_database_url)
        return
    try:
        import pgserver  # type: ignore[import-untyped,unused-ignore]
    except ImportError:
        pytest.fail(NO_POSTGRES, pytrace=False)
    pgdata = Path(tempfile.mkdtemp(prefix="timpg"))
    server = pgserver.get_server(  # type: ignore[attr-defined,unused-ignore]
        pgdata, cleanup_mode="delete"
    )
    try:
        yield asyncpg_url(server.get_uri())
    finally:
        server.cleanup()


def alembic_config(url: str) -> Config:
    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "migrations"))
    cfg.attributes["url"] = url
    return cfg


def _in_a_thread[**P](fn: Callable[P, object], *args: P.args, **kwargs: P.kwargs) -> None:
    """Run ``fn`` in a worker thread, which has no running event loop."""
    with ThreadPoolExecutor(max_workers=1) as pool:
        pool.submit(fn, *args, **kwargs).result()


def migrate(url: str, revision: str = "head", *, down: bool = False) -> None:
    """Run Alembic in a worker thread: its async env.py needs a thread without a running loop."""
    action = command.downgrade if down else command.upgrade
    _in_a_thread(action, alembic_config(url), revision)


async def _empty(url: str) -> None:
    engine = create_async_engine(url)
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "TRUNCATE runs, run_rows, presets, preset_hidden, "
                    "column_views, column_view_hidden, "
                    "id_state, label_changes, tags, comments"
                )
            )
            await conn.execute(text("UPDATE annotation_clock SET version = 0"))
    finally:
        await engine.dispose()


def empty_database(url: str) -> None:
    """Delete everything stored in the migrated database at ``url``. Callable with or without a
    running event loop."""
    _in_a_thread(asyncio.run, _empty(url))
