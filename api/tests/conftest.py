import os
from collections.abc import AsyncIterator, Iterator

import pytest
from app_factory import AuthKit
from cryptography.hazmat.primitives.asymmetric import rsa
from database import empty_database, migrate, postgres_server

from tim_api.config import get_settings
from tim_api.storage import PostgresStorage

# Read before the autouse fixture below clears TIM_* variables. CI sets this to a service DB.
EXTERNAL_TEST_DB = os.environ.get("TIM_TEST_DATABASE_URL")

REQUIRED_ENV = {
    "TIM_AUTH_TENANT_ID": "tenant-id",
    "TIM_AUTH_CLIENT_ID": "client-id",
    "TIM_AUTH_CLIENT_SECRET": "client-secret",  # OBO credential; required with an obo connection
}


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch, postgres_dsn: str) -> Iterator[None]:
    """Provide the required env, with the test database as ``TIM_DATABASE_URL``, ignore any
    local .env, and reset the settings cache."""
    for key in list(os.environ):
        if key.startswith("TIM_"):
            monkeypatch.delenv(key)
    for key, value in REQUIRED_ENV.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setenv("TIM_DATABASE_URL", postgres_dsn)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture(scope="session")
def _auth_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def auth(_auth_key: rsa.RSAPrivateKey) -> AuthKit:
    return AuthKit(_auth_key)


@pytest.fixture(scope="session")
def postgres_admin_dsn() -> Iterator[str]:
    """A running server (any database). ``TIM_TEST_DATABASE_URL`` wins; else a temp ``pgserver``."""
    with postgres_server(EXTERNAL_TEST_DB) as url:
        yield url


@pytest.fixture(scope="session")
def postgres_dsn(postgres_admin_dsn: str) -> str:
    """DSN of a database with the Alembic migrations applied."""
    migrate(postgres_admin_dsn)
    return postgres_admin_dsn


@pytest.fixture
async def storage(postgres_dsn: str) -> AsyncIterator[PostgresStorage]:
    """An empty store per test."""
    empty_database(postgres_dsn)
    store = PostgresStorage(postgres_dsn)
    yield store
    await store.aclose()
