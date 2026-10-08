"""Entra ID access-token validation (ADR-0005).

Accepts v1 and v2 tokens of the single configured tenant: signature via the tenant JWKS
(RS256 only), ``aud`` = ``api://{clientId}`` or the bare client id, ``iss`` = the v1 STS issuer
or the v2 authority issuer, ``exp``/``nbf``/``iat`` required with a small leeway.

Failures raise :class:`InvalidTokenError` whose message is generic; token contents are never
included in messages or logs.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

import httpx2
import jwt
from jwt import PyJWK
from pydantic import SecretStr

from tim_api.auth.principal import Principal
from tim_api.config import Settings

logger = logging.getLogger("tim_api.auth")

JwksFetcher = Callable[[str], Awaitable[dict[str, Any]]]

ALGORITHMS = ["RS256"]
LEEWAY_SECONDS = 60
JWKS_TTL_SECONDS = 3600.0
JWKS_MIN_REFETCH_SECONDS = 30.0
_NAME_CLAIMS = ("unique_name", "upn", "preferred_username")


class InvalidTokenError(Exception):
    """The bearer token is missing, malformed, or failed validation."""


async def fetch_jwks_http(url: str) -> dict[str, Any]:
    """Default fetcher: GET the JWKS document."""
    async with httpx2.AsyncClient(timeout=10.0) as client:
        response = await client.get(url)
        response.raise_for_status()
        data = response.json()
    if not isinstance(data, dict):
        raise ValueError("JWKS document is not an object")
    return data


class JwksCache:
    """Key set with a TTL; an unknown ``kid`` triggers at most one rate-limited refetch."""

    def __init__(
        self,
        url: str,
        fetcher: JwksFetcher,
        *,
        ttl: float = JWKS_TTL_SECONDS,
        min_refetch_interval: float = JWKS_MIN_REFETCH_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._url = url
        self._fetcher = fetcher
        self._ttl = ttl
        self._min_refetch = min_refetch_interval
        self._clock = clock
        self._keys: dict[str, PyJWK] = {}
        self._fetched_at: float | None = None
        self._lock = asyncio.Lock()

    async def _refresh(self) -> None:
        try:
            document = await self._fetcher(self._url)
        except Exception:
            logger.warning("JWKS fetch failed")
            self._fetched_at = self._clock()  # rate-limit retries; keep any stale keys
            return
        keys: dict[str, PyJWK] = {}
        for entry in document.get("keys", []):
            try:
                if entry.get("kid") and entry.get("kty") == "RSA":
                    keys[entry["kid"]] = PyJWK(entry)
            except Exception:  # noqa: S112 - skip unusable keys
                continue
        self._keys = keys
        self._fetched_at = self._clock()

    async def get_key(self, kid: str) -> PyJWK:
        async with self._lock:
            now = self._clock()
            if (
                self._fetched_at is None
                or now - self._fetched_at >= self._ttl
                or (kid not in self._keys and now - self._fetched_at >= self._min_refetch)
            ):
                await self._refresh()
        key = self._keys.get(kid)
        if key is None:
            raise InvalidTokenError("unknown signing key")
        return key


def _claim_str(claims: dict[str, Any], name: str) -> str | None:
    value = claims.get(name)
    return value if isinstance(value, str) and value else None


class TokenValidator:
    def __init__(self, settings: Settings, fetcher: JwksFetcher | None = None) -> None:
        tenant = settings.auth_tenant_id
        client = settings.auth_client_id
        authority = settings.auth_authority_host.rstrip("/")
        self._tenant = tenant
        self._audiences = [f"api://{client}", client]
        self._issuers = [f"https://sts.windows.net/{tenant}/", f"{authority}/{tenant}/v2.0"]
        self._jwks = JwksCache(
            f"{authority}/{tenant}/discovery/v2.0/keys", fetcher or fetch_jwks_http
        )

    async def validate(self, token: str) -> Principal:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError:
            raise InvalidTokenError("malformed token") from None
        kid = header.get("kid")
        if header.get("alg") not in ALGORITHMS or not isinstance(kid, str) or not kid:
            raise InvalidTokenError("unsupported token header")
        key = await self._jwks.get_key(kid)
        try:
            claims: dict[str, Any] = jwt.decode(
                token,
                key.key,
                algorithms=ALGORITHMS,
                audience=self._audiences,
                issuer=self._issuers,
                leeway=LEEWAY_SECONDS,
                options={"require": ["exp", "nbf", "iat", "aud", "iss"]},
            )
        except jwt.PyJWTError:
            raise InvalidTokenError("token validation failed") from None

        oid = _claim_str(claims, "oid")
        tid = _claim_str(claims, "tid")
        name = next((v for c in _NAME_CLAIMS if (v := _claim_str(claims, c))), None)
        if oid is None or tid != self._tenant or name is None:
            raise InvalidTokenError("required claims missing")
        return Principal(oid=oid, name=name, tenant_id=tid, token=SecretStr(token))
