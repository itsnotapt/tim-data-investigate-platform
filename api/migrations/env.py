"""Alembic environment (async). The URL is ``TIM_DATABASE_URL`` unless a caller (tests) sets
``config.attributes["url"]``. Only reads that one variable so migrations can run without the
rest of the app configuration."""

import asyncio
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from tim_api.storage.postgres import metadata

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = metadata


def _url() -> str:
    url = config.attributes.get("url") or os.environ.get("TIM_DATABASE_URL")
    if not url:
        raise RuntimeError("TIM_DATABASE_URL is not set")
    if not str(url).startswith("postgresql+asyncpg://"):
        raise RuntimeError("TIM_DATABASE_URL must start with postgresql+asyncpg://")
    return str(url)


def run_migrations_offline() -> None:
    context.configure(url=_url(), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def _run(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = create_async_engine(_url(), poolclass=pool.NullPool)
    async with engine.connect() as connection:
        await connection.run_sync(_run)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
