import base64
import json
import time
from collections.abc import Iterator
from typing import Annotated, Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from jwt.algorithms import RSAAlgorithm

from tim_api.auth import (
    InvalidTokenError,
    Principal,
    TokenValidator,
    get_current_principal,
    get_token_validator,
)
from tim_api.auth.jwt import JwksCache, fetch_jwks_http
from tim_api.config import Settings, get_settings
from tim_api.main import create_app

TENANT = "tenant-id"
CLIENT = "client-id"
KID = "key-1"
V1_ISS = f"https://sts.windows.net/{TENANT}/"
V2_ISS = f"https://login.microsoftonline.com/{TENANT}/v2.0"


def _make_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _jwk(key: rsa.RSAPrivateKey, kid: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads(RSAAlgorithm.to_jwk(key.public_key()))
    return {**data, "kid": kid, "use": "sig", "alg": "RS256"}


@pytest.fixture(scope="module")
def key() -> rsa.RSAPrivateKey:
    return _make_key()


@pytest.fixture(scope="module")
def other_key() -> rsa.RSAPrivateKey:
    return _make_key()


class FakeFetcher:
    def __init__(self, keys: dict[str, rsa.RSAPrivateKey]) -> None:
        self.keys = keys
        self.calls: list[str] = []

    async def __call__(self, url: str) -> dict[str, Any]:
        self.calls.append(url)
        return {"keys": [_jwk(k, kid) for kid, k in self.keys.items()]}


def _claims(**overrides: Any) -> dict[str, Any]:
    now = int(time.time())
    claims: dict[str, Any] = {
        "aud": f"api://{CLIENT}",
        "iss": V1_ISS,
        "iat": now,
        "nbf": now,
        "exp": now + 600,
        "oid": "oid-1",
        "tid": TENANT,
        "unique_name": "alice@example.com",
    }
    claims.update(overrides)
    return {k: v for k, v in claims.items() if v is not None}


def _sign(
    claims: dict[str, Any],
    key: rsa.RSAPrivateKey,
    *,
    kid: str | None = KID,
    alg: str = "RS256",
) -> str:
    headers = {"kid": kid} if kid else {}
    return jwt.encode(claims, key, algorithm=alg, headers=headers)


@pytest.fixture
def fetcher(key: rsa.RSAPrivateKey) -> FakeFetcher:
    return FakeFetcher({KID: key})


@pytest.fixture
def validator(fetcher: FakeFetcher) -> TokenValidator:
    return TokenValidator(get_settings(), fetcher)


async def test_valid_v1_token(validator: TokenValidator, key: rsa.RSAPrivateKey) -> None:
    token = _sign(_claims(), key)
    principal = await validator.validate(token)
    assert (principal.oid, principal.name, principal.tenant_id) == (
        "oid-1",
        "alice@example.com",
        TENANT,
    )
    assert principal.token is not None
    assert principal.token.get_secret_value() == token
    assert token not in repr(principal)


async def test_valid_v2_token_bare_client_audience(
    validator: TokenValidator, key: rsa.RSAPrivateKey
) -> None:
    claims = _claims(aud=CLIENT, iss=V2_ISS, unique_name=None, preferred_username="bob@example.com")
    principal = await validator.validate(_sign(claims, key))
    assert principal.name == "bob@example.com"


async def test_jwks_url_uses_authority_and_tenant(
    validator: TokenValidator, key: rsa.RSAPrivateKey, fetcher: FakeFetcher
) -> None:
    await validator.validate(_sign(_claims(), key))
    assert fetcher.calls == [f"https://login.microsoftonline.com/{TENANT}/discovery/v2.0/keys"]


@pytest.mark.parametrize(
    ("claims", "kwargs"),
    [
        ({"aud": "api://someone-else"}, {}),
        ({"iss": "https://sts.windows.net/other-tenant/"}, {}),
        ({"iss": f"https://evil.example.com/{TENANT}/v2.0"}, {}),
        ({"exp": int(time.time()) - 3600}, {}),
        ({"nbf": int(time.time()) + 3600}, {}),
        ({"nbf": None}, {}),
        ({"iat": None}, {}),
        ({"exp": None}, {}),
        ({"tid": "other-tenant"}, {}),
        ({"oid": None}, {}),
        ({"unique_name": None}, {}),
    ],
)
async def test_rejected_claims(
    validator: TokenValidator,
    key: rsa.RSAPrivateKey,
    claims: dict[str, Any],
    kwargs: dict[str, Any],
) -> None:
    with pytest.raises(InvalidTokenError):
        await validator.validate(_sign(_claims(**claims), key, **kwargs))


async def test_small_leeway_accepts_just_expired(
    validator: TokenValidator, key: rsa.RSAPrivateKey
) -> None:
    await validator.validate(_sign(_claims(exp=int(time.time()) - 10), key))


async def test_bad_signature(validator: TokenValidator, other_key: rsa.RSAPrivateKey) -> None:
    with pytest.raises(InvalidTokenError):
        await validator.validate(_sign(_claims(), other_key))


def _unsigned_none_token() -> str:
    def enc(obj: dict[str, Any]) -> str:
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()

    return f"{enc({'alg': 'none', 'kid': KID, 'typ': 'JWT'})}.{enc(_claims())}."


async def test_alg_none_rejected(validator: TokenValidator) -> None:
    with pytest.raises(InvalidTokenError):
        await validator.validate(_unsigned_none_token())


async def test_hs256_rejected(validator: TokenValidator) -> None:
    token = jwt.encode(_claims(), "x" * 64, algorithm="HS256", headers={"kid": KID})
    with pytest.raises(InvalidTokenError):
        await validator.validate(token)


async def test_missing_kid_and_garbage_rejected(
    validator: TokenValidator, key: rsa.RSAPrivateKey
) -> None:
    for bad in (_sign(_claims(), key, kid=None), "not-a-jwt", "a.b.c"):
        with pytest.raises(InvalidTokenError):
            await validator.validate(bad)


async def test_unknown_kid_refetches_once_then_rate_limits(
    key: rsa.RSAPrivateKey, other_key: rsa.RSAPrivateKey
) -> None:
    now = [0.0]
    fetcher = FakeFetcher({KID: key})
    cache = JwksCache("u", fetcher, clock=lambda: now[0])
    await cache.get_key(KID)
    assert len(fetcher.calls) == 1

    # Key rotation: the new kid appears after the first fetch.
    fetcher.keys["key-2"] = other_key
    now[0] = 5.0  # inside the rate-limit window: no refetch
    with pytest.raises(InvalidTokenError):
        await cache.get_key("key-2")
    assert len(fetcher.calls) == 1

    now[0] = 100.0  # window elapsed: exactly one refetch, key found
    await cache.get_key("key-2")
    assert len(fetcher.calls) == 2
    await cache.get_key(KID)  # known kid: served from cache
    assert len(fetcher.calls) == 2


async def test_cache_ttl_expiry_refetches(key: rsa.RSAPrivateKey) -> None:
    now = [0.0]
    fetcher = FakeFetcher({KID: key})
    cache = JwksCache("u", fetcher, ttl=100, clock=lambda: now[0])
    await cache.get_key(KID)
    now[0] = 101.0
    await cache.get_key(KID)
    assert len(fetcher.calls) == 2


async def test_fetch_failure_is_invalid_token_and_keeps_stale_keys(
    key: rsa.RSAPrivateKey,
) -> None:
    now = [0.0]
    fetcher = FakeFetcher({KID: key})
    cache = JwksCache("u", fetcher, ttl=100, clock=lambda: now[0])
    await cache.get_key(KID)

    async def boom(_url: str) -> dict[str, Any]:
        raise RuntimeError("network down")

    cache._fetcher = boom
    now[0] = 200.0
    await cache.get_key(KID)  # stale key still served

    empty = JwksCache("u", boom, clock=lambda: now[0])
    with pytest.raises(InvalidTokenError):
        await empty.get_key(KID)


async def test_unusable_jwks_entries_are_skipped(key: rsa.RSAPrivateKey) -> None:
    async def fetch(_url: str) -> dict[str, Any]:
        return {"keys": [{"kid": "bad", "kty": "RSA", "n": "!", "e": "x"}, _jwk(key, KID)]}

    cache = JwksCache("u", fetch)
    await cache.get_key(KID)
    with pytest.raises(InvalidTokenError):
        await cache.get_key("bad")


async def test_default_fetcher_uses_httpx(monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx2

    def handler(request: httpx2.Request) -> httpx2.Response:
        assert str(request.url) == "https://idp.test/keys"
        return httpx2.Response(200, json={"keys": []})

    transport = httpx2.MockTransport(handler)
    real = httpx2.AsyncClient
    monkeypatch.setattr(httpx2, "AsyncClient", lambda **kw: real(transport=transport, **kw))
    assert await fetch_jwks_http("https://idp.test/keys") == {"keys": []}

    monkeypatch.setattr(
        httpx2,
        "AsyncClient",
        lambda **kw: real(
            transport=httpx2.MockTransport(lambda _r: httpx2.Response(200, json=[1])), **kw
        ),
    )
    with pytest.raises(ValueError, match="not an object"):
        await fetch_jwks_http("https://idp.test/keys")


@pytest.mark.parametrize(
    ("extra", "expected"),
    [
        ({"unique_name": "u", "upn": "p", "preferred_username": "pu"}, "u"),
        ({"unique_name": None, "upn": "p", "preferred_username": "pu"}, "p"),
        ({"unique_name": None, "upn": None, "preferred_username": "pu"}, "pu"),
    ],
)
async def test_username_fallback_order(
    validator: TokenValidator, key: rsa.RSAPrivateKey, extra: dict[str, Any], expected: str
) -> None:
    principal = await validator.validate(_sign(_claims(**extra), key))
    assert principal.name == expected


# --- endpoint level -------------------------------------------------------------------


@pytest.fixture
def client(validator: TokenValidator) -> Iterator[TestClient]:
    app: FastAPI = create_app()
    app.dependency_overrides[get_token_validator] = lambda: validator

    @app.get("/test/whoami")
    def whoami(principal: Annotated[Principal, Depends(get_current_principal)]) -> dict[str, str]:
        return {"oid": principal.oid, "name": principal.name}

    with TestClient(app) as c:
        yield c


def test_endpoint_valid_token(client: TestClient, key: rsa.RSAPrivateKey) -> None:
    response = client.get(
        "/test/whoami", headers={"Authorization": f"Bearer {_sign(_claims(), key)}"}
    )
    assert response.status_code == 200
    assert response.json() == {"oid": "oid-1", "name": "alice@example.com"}


def test_endpoint_missing_header(client: TestClient) -> None:
    response = client.get("/test/whoami")
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize("header", ["Basic abc", "Bearer", "Bearer ", "abc", "Bearer not.a.jwt"])
def test_endpoint_malformed_header(client: TestClient, header: str) -> None:
    response = client.get("/test/whoami", headers={"Authorization": header})
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


def test_endpoint_invalid_token_is_generic_and_does_not_echo(
    client: TestClient, other_key: rsa.RSAPrivateKey
) -> None:
    token = _sign(_claims(), other_key)
    response = client.get("/test/whoami", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert token not in response.text
    assert "alice" not in response.text


def test_default_validator_is_cached_on_app_state() -> None:
    app = create_app()

    @app.get("/test/whoami")
    def whoami(principal: Annotated[Principal, Depends(get_current_principal)]) -> dict[str, str]:
        return {"oid": principal.oid}

    with TestClient(app) as c:
        c.get("/test/whoami")
        first = app.state.token_validator
        c.get("/test/whoami")
        assert app.state.token_validator is first
    assert isinstance(get_settings(), Settings)
