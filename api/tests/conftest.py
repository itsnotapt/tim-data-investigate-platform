import os
import tempfile
from collections.abc import AsyncIterator, Iterator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from tim_api.config import get_settings
from tim_api.storage import MemoryStorage, PostgresStorage, Storage

# Read before the autouse fixture below clears TIM_* variables. CI sets this to a service DB.
EXTERNAL_TEST_DB = os.environ.get("TIM_TEST_DATABASE_URL")
API_DIR = Path(__file__).resolve().parent.parent

REQUIRED_ENV = {
    "TIM_AUTH_TENANT_ID": "tenant-id",
    "TIM_AUTH_CLIENT_ID": "client-id",
    "TIM_AUTH_CLIENT_SECRET": "client-secret",  # OBO credential; required at startup
    "TIM_TAG_CLUSTER_URI": "https://tags.westeurope.kusto.windows.net",
    "TIM_DATABASE_URL": "postgresql+asyncpg://tim:s3cret-pw@localhost:5432/tim",
}


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Provide the required env, ignore any local .env, and reset the settings cache."""
    for key in list(os.environ):
        if key.startswith("TIM_"):
            monkeypatch.delenv(key)
    for key, value in REQUIRED_ENV.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture(autouse=True)
def _memory_storage_for_app(monkeypatch: pytest.MonkeyPatch) -> None:
    """App lifespans in unit tests use the in-memory store even with the Postgres DSN above.

    Tests that exercise the real selection call ``tim_api.storage.build_storage`` directly.
    """
    monkeypatch.setattr("tim_api.main.build_storage", lambda _settings: MemoryStorage())


def _asyncpg_url(url: str) -> str:
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+asyncpg://" + url[len(prefix) :]
    return url


def alembic_config(url: str) -> Config:
    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "migrations"))
    cfg.attributes["url"] = url
    return cfg


def migrate(url: str, revision: str = "head", *, down: bool = False) -> None:
    """Run Alembic in a worker thread: its async env.py needs a thread without a running loop."""
    cfg = alembic_config(url)
    action = command.downgrade if down else command.upgrade
    with ThreadPoolExecutor(max_workers=1) as pool:
        pool.submit(action, cfg, revision).result()


@pytest.fixture(scope="session")
def postgres_admin_dsn(tmp_path_factory: pytest.TempPathFactory) -> Iterator[str]:
    """A running server (any database). ``TIM_TEST_DATABASE_URL`` wins; else a temp ``pgserver``."""
    if EXTERNAL_TEST_DB:
        yield _asyncpg_url(EXTERNAL_TEST_DB)
        return
    try:
        import pgserver  # type: ignore[import-untyped,unused-ignore]
    except ImportError:
        pytest.skip("no Postgres: set TIM_TEST_DATABASE_URL or install pgserver")
    pgdata = Path(tempfile.mkdtemp(prefix="timpg"))
    server = pgserver.get_server(  # type: ignore[attr-defined,unused-ignore]
        pgdata, cleanup_mode="delete"
    )
    try:
        yield _asyncpg_url(server.get_uri())
    finally:
        server.cleanup()


@pytest.fixture(scope="session")
def postgres_dsn(postgres_admin_dsn: str) -> str:
    """DSN of a database with the Alembic migrations applied."""
    migrate(postgres_admin_dsn)
    return postgres_admin_dsn


@pytest.fixture(params=["memory", "postgres"])
async def storage(request: pytest.FixtureRequest) -> AsyncIterator[Storage]:
    """Empty store per test, for every implementation."""
    if request.param == "memory":
        store: Storage = MemoryStorage()
    else:
        dsn: str = request.getfixturevalue("postgres_dsn")
        engine = create_async_engine(dsn)
        async with engine.begin() as conn:
            await conn.execute(text("TRUNCATE query_templates, query_runs"))
        await engine.dispose()
        store = PostgresStorage(dsn)
    yield store
    await store.aclose()
