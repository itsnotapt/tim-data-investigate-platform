"""App construction for tests."""

import json
import time
from collections.abc import Callable

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI
from jwt.algorithms import RSAAlgorithm

from tim_api.auth import TokenValidator, get_token_validator
from tim_api.config import Settings, get_settings
from tim_api.main import create_app
from tim_api.query_runs.runner import RACE_SECONDS
from tim_api.storage import MemoryStorage, Storage


def create_test_app(
    *,
    storage_factory: Callable[[Settings], Storage] | None = None,
    race_seconds: float = RACE_SECONDS,
) -> FastAPI:
    """``create_app`` backed by the in-memory store unless a ``storage_factory`` is given.

    The default test environment names a Postgres DSN (production settings), so an app built
    without this would try to reach a database on startup.
    """
    return create_app(
        storage_factory=storage_factory or (lambda _settings: MemoryStorage()),
        race_seconds=race_seconds,
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

    def headers(self, name: str = "alice@example.com", oid: str = "oid-1") -> dict[str, str]:
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
        }
        token = jwt.encode(claims, self._key, algorithm="RS256", headers={"kid": AUTH_KID})
        return {"Authorization": f"Bearer {token}"}
