"""Playwright's tim-api: resets a Postgres database, migrates it and serves the api on it.

Run from Playwright's ``webServer`` with the api's environment:
``uv run --project ../api python e2e/api_server.py <port>``. The database is
``TIM_TEST_DATABASE_URL``, emptied first, or else a temporary ``pgserver`` that is deleted on
exit. Every other ``TIM_*`` variable comes from the caller.
"""

from __future__ import annotations

import asyncio
import os
import signal
import sys
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import uvicorn
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

API_DIR = Path(__file__).resolve().parents[2] / "api"


def _asyncpg_url(url: str) -> str:
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+asyncpg://" + url[len(prefix) :]
    return url


@contextmanager
def _database() -> Iterator[str]:
    """``TIM_TEST_DATABASE_URL``, or a temporary ``pgserver`` for as long as the api runs."""
    external = os.environ.get("TIM_TEST_DATABASE_URL")
    if external:
        yield _asyncpg_url(external)
        return
    import pgserver  # type: ignore[import-untyped,unused-ignore]

    server = pgserver.get_server(  # type: ignore[attr-defined,unused-ignore]
        Path(tempfile.mkdtemp(prefix="timpg")), cleanup_mode="delete"
    )
    try:
        yield _asyncpg_url(server.get_uri())
    finally:
        server.cleanup()


async def _empty(url: str) -> None:
    engine = create_async_engine(url)
    async with engine.begin() as conn:
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
    await engine.dispose()


def _reset(url: str) -> None:
    """Empty the database, then apply the migrations."""
    asyncio.run(_empty(url))
    # No ini file, so alembic leaves the api's logging alone.
    config = Config()
    config.set_main_option("script_location", str(API_DIR / "migrations"))
    config.attributes["url"] = url
    command.upgrade(config, "head")


def main(port: int) -> None:
    # uvicorn shuts down on SIGTERM, then raises it again: exit through the context managers,
    # so a temporary pgserver is stopped and deleted.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    with _database() as url:
        _reset(url)
        os.environ["TIM_DATABASE_URL"] = url
        uvicorn.run("tim_api.main:app", host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main(int(sys.argv[1]))
