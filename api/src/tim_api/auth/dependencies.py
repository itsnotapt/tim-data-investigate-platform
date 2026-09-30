"""FastAPI dependency that resolves the caller from the bearer token (ADR-0005)."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Request, status

from tim_api.auth.jwt import InvalidTokenError, TokenValidator
from tim_api.auth.obo import OboTokenProvider, build_obo_provider
from tim_api.auth.principal import DEV_PRINCIPAL, Principal
from tim_api.config import Settings, get_settings


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or missing credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_token_validator(
    request: Request, settings: Annotated[Settings, Depends(get_settings)]
) -> TokenValidator:
    """One validator per app (it owns the JWKS cache); tests override this dependency."""
    validator: TokenValidator | None = getattr(request.app.state, "token_validator", None)
    if validator is None:
        validator = TokenValidator(settings)
        request.app.state.token_validator = validator
    return validator


async def get_current_principal(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    validator: Annotated[TokenValidator, Depends(get_token_validator)],
) -> Principal:
    if settings.auth_disabled:
        # Settings already refuse this in production; re-check as defence in depth.
        if settings.environment == "production":
            raise RuntimeError("auth bypass is not allowed in production")
        return DEV_PRINCIPAL

    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token:
        raise _unauthorized()
    try:
        return await validator.validate(token)
    except InvalidTokenError:
        raise _unauthorized() from None


def get_obo_provider(
    request: Request, settings: Annotated[Settings, Depends(get_settings)]
) -> OboTokenProvider:
    """One provider per app (it owns the MSAL app and token cache); tests override this."""
    provider: OboTokenProvider | None = getattr(request.app.state, "obo_provider", None)
    if provider is None:
        provider = build_obo_provider(settings)
        request.app.state.obo_provider = provider
    return provider
