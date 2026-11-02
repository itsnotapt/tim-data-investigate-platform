"""App construction for tests."""

import json
import time
from collections.abc import Callable, Sequence

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from database import empty_database
from fastapi import FastAPI
from jwt.algorithms import RSAAlgorithm
from tim_actions import Provider

from tim_api.auth import TokenValidator, get_token_validator
from tim_api.config import Settings, get_settings
from tim_api.main import create_app
from tim_api.runs.runner import (
    CANCEL_POLL_SECONDS,
    RACE_SECONDS,
    STALE_HEARTBEAT_SECONDS,
    STALE_SWEEP_SECONDS,
)
from tim_api.storage import PostgresStorage, build_storage


def empty_storage(settings: Settings) -> PostgresStorage:
    """The storage at ``TIM_DATABASE_URL``, the test database, emptied."""
    empty_database(settings.database_url.get_secret_value())
    return build_storage(settings)


def create_test_app(
    *,
    storage_factory: Callable[[Settings], PostgresStorage] = empty_storage,
    race_seconds: float = RACE_SECONDS,
    providers: Sequence[Provider] | None = (),
    cancel_poll_seconds: float = CANCEL_POLL_SECONDS,
    stale_heartbeat_seconds: float = STALE_HEARTBEAT_SECONDS,
    stale_sweep_seconds: float = STALE_SWEEP_SECONDS,
) -> FastAPI:
    """``create_app`` backed by the emptied test database unless a ``storage_factory`` is given.

    ``providers`` defaults to none; ``None`` discovers the installed ones.
    """
    return create_app(
        storage_factory=storage_factory,
        race_seconds=race_seconds,
        providers=providers,
        cancel_poll_seconds=cancel_poll_seconds,
        stale_heartbeat_seconds=stale_heartbeat_seconds,
        stale_sweep_seconds=stale_sweep_seconds,
    )


CLIENT_ID = "client-id"  # the TIM_AUTH_* values in conftest.REQUIRED_ENV
TENANT_ID = "tenant-id"
AUTH_KID = "test-key"


class AuthKit:
    """Signs real Entra-shaped bearer tokens; only the tenant's signing keys are faked."""

    def __init__(self, key: rsa.RSAPrivateKey) -> None:
        self._key = key

    async def _fetch_jwks(self, _url: str) -> dict[str, object]:
        public = json.loads(RSAAlgorithm.to_jwk(self._key.public_key()))
        return {"keys": [{**public, "kid": AUTH_KID, "use": "sig", "alg": "RS256"}]}

    def install(self, app: FastAPI) -> None:
        """Validate bearer tokens with the real validator against the test key set."""
        validator = TokenValidator(get_settings(), self._fetch_jwks)
        app.dependency_overrides[get_token_validator] = lambda: validator

    def headers(
        self, name: str = "alice@example.com", oid: str = "oid-1", **extra: str
    ) -> dict[str, str]:
        """A bearer header for ``name`` as ``unique_name``, with any ``extra`` claims."""
        now = int(time.time())
        claims = {
            "aud": f"api://{CLIENT_ID}",
            "iss": f"https://sts.windows.net/{TENANT_ID}/",
            "iat": now,
            "nbf": now,
            "exp": now + 3600,
            "oid": oid,
            "tid": TENANT_ID,
            "unique_name": name,
            **extra,
        }
        token = jwt.encode(claims, self._key, algorithm="RS256", headers={"kid": AUTH_KID})
        return {"Authorization": f"Bearer {token}"}
