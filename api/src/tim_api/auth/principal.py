"""The authenticated caller and the FastAPI dependency that resolves it (ADR-0005).

Identity always comes from the token, never from the request body (SEC-03).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, SecretStr

from tim_api.config import Settings, get_settings


class Principal(BaseModel):
    """The caller. ``token`` is the raw bearer token (needed later for OBO); never logged."""

    model_config = ConfigDict(frozen=True)

    oid: str
    name: str
    tenant_id: str
    token: SecretStr | None = None


# Fixed identity used when TIM_AUTH_DISABLED is on (development only).
DEV_PRINCIPAL = Principal(
    oid="00000000-0000-0000-0000-000000000001",
    name="dev.user@example.com",
    tenant_id="00000000-0000-0000-0000-0000000000aa",
    token=SecretStr("dev-token"),
)


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_principal(
    request: Request, settings: Annotated[Settings, Depends(get_settings)]
) -> Principal:
    if settings.auth_disabled:
        # Settings already refuse this in production; re-check as defence in depth.
        if settings.environment == "production":
            raise RuntimeError("auth bypass is not allowed in production")
        return DEV_PRINCIPAL

    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise _unauthorized("Missing bearer token")

    # TODO(P2): validate the JWT against the tenant JWKS (signature, exp/nbf, aud, iss) and
    # build the Principal from its claims (oid, unique_name -> upn -> preferred_username, tid).
    # Until then a presented token is rejected rather than trusted.
    raise _unauthorized("Token validation is not implemented yet")
