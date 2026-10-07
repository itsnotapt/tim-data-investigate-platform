"""On-Behalf-Of exchange: the caller's API token -> a Kusto token for one cluster (ADR-0005).

* One ``msal.ConfidentialClientApplication`` per provider (i.e. per process) with MSAL's shared
  in-memory token cache, so repeat calls are served from cache.
* Credential: ``TIM_AUTH_CLIENT_SECRET`` if set, else a client assertion read from the federated
  / workload-identity token file (``AZURE_FEDERATED_TOKEN_FILE``). With neither, construction
  fails with :class:`OboConfigError` (raised at startup when auth is enabled).
* Scope: ``TIM_KUSTO_OBO_SCOPE`` with ``{cluster}`` replaced by the already validated, normalised
  cluster URL.
* MSAL is blocking, so calls run in a worker thread.

Tokens (the user assertion and the result) are never logged or put in exception messages.
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from pathlib import Path
from typing import Any, Protocol

import msal

from tim_api.auth.principal import Principal
from tim_api.config import Settings

logger = logging.getLogger("tim_api.auth")

FEDERATED_TOKEN_FILE_ENV = "AZURE_FEDERATED_TOKEN_FILE"  # noqa: S105 - env var name, not a secret
_REAUTH_ERRORS = frozenset({"invalid_grant", "interaction_required"})


class OboError(Exception):
    """Base class for OBO failures."""


class OboAuthError(OboError):
    """The user's token can't be exchanged (expired, revoked, consent/MFA needed).

    Mapped to 403 ``consent-required``.
    """


class OboUpstreamError(OboError):
    """Entra or the network failed: map to 502."""


class OboUnavailableError(OboError):
    """OBO isn't available in this mode (auth disabled) or the caller has no token: map to 503."""


class OboConfigError(RuntimeError):
    """OBO is misconfigured (no client credential). Raised at startup; never holds secrets."""


class OboTokenProvider(Protocol):
    async def get_token(self, principal: Principal, cluster_url: str) -> str:
        """Kusto access token for ``cluster_url`` (validated and normalised by the caller)."""
        ...


class _MsalApp(Protocol):
    def acquire_token_on_behalf_of(
        self, user_assertion: str, scopes: list[str], claims_challenge: str | None = None
    ) -> dict[str, Any]: ...


MsalFactory = Any  # Callable[..., _MsalApp]; msal is untyped


def _default_factory(**kwargs: Any) -> _MsalApp:
    app: _MsalApp = msal.ConfidentialClientApplication(**kwargs)
    return app


def _federated_assertion(path: str) -> Any:
    # Re-read on every call: workload-identity tokens rotate.
    def read() -> str:
        return Path(path).read_text(encoding="utf-8").strip()

    return read


def _credential(settings: Settings) -> str | dict[str, Any]:
    if settings.auth_client_secret is not None:
        return settings.auth_client_secret.get_secret_value()
    token_file = os.environ.get(FEDERATED_TOKEN_FILE_ENV)
    if token_file:
        if not Path(token_file).is_file():
            raise OboConfigError(f"{FEDERATED_TOKEN_FILE_ENV} does not point to a readable file")
        return {"client_assertion": _federated_assertion(token_file)}
    raise OboConfigError(
        "No client credential for the OBO exchange: set TIM_AUTH_CLIENT_SECRET or provide a "
        f"federated identity token file via {FEDERATED_TOKEN_FILE_ENV}"
    )


class MsalOboTokenProvider:
    def __init__(self, settings: Settings, *, app_factory: MsalFactory = _default_factory) -> None:
        self._scope_template = settings.kusto_obo_scope
        authority = f"{settings.auth_authority_host.rstrip('/')}/{settings.auth_tenant_id}"
        # Credential is resolved now so misconfiguration fails at startup. The MSAL app itself is
        # built lazily (its constructor does authority discovery over the network) and once.
        self._app_kwargs: dict[str, Any] = {
            "client_id": settings.auth_client_id,
            "client_credential": _credential(settings),
            "authority": authority,
        }
        self._app_factory = app_factory
        self._app: _MsalApp | None = None
        self._app_lock = threading.Lock()

    def _get_app(self) -> _MsalApp:
        """Runs in a worker thread: the single shared app (and its token cache)."""
        with self._app_lock:
            if self._app is None:
                self._app = self._app_factory(**self._app_kwargs)
            return self._app

    def _exchange(self, user_assertion: str, scopes: list[str]) -> dict[str, Any]:
        return self._get_app().acquire_token_on_behalf_of(user_assertion, scopes)

    def scope_for(self, cluster_url: str) -> str:
        return self._scope_template.replace("{cluster}", cluster_url.rstrip("/"))

    async def get_token(self, principal: Principal, cluster_url: str) -> str:
        if principal.token is None:
            raise OboUnavailableError("No user token available for the OBO exchange")
        scope = self.scope_for(cluster_url)
        try:
            result = await asyncio.to_thread(
                self._exchange,
                principal.token.get_secret_value(),
                [scope],
            )
        except Exception as exc:
            # Only the exception type is logged: messages may echo request details.
            logger.warning("OBO exchange failed (%s)", type(exc).__name__)
            raise OboUpstreamError("OBO token exchange failed") from None

        token = result.get("access_token")
        if isinstance(token, str) and token:
            return token

        error = str(result.get("error", "unknown_error"))
        logger.warning("OBO exchange rejected: error=%s scope=%s", error, scope)
        if error in _REAUTH_ERRORS:
            raise OboAuthError("User token cannot be exchanged; sign in again")
        raise OboUpstreamError(f"OBO token exchange failed ({error})")


class DisabledOboTokenProvider:
    """Used when auth is disabled (dev): there is no real user token to exchange."""

    async def get_token(self, principal: Principal, cluster_url: str) -> str:
        raise OboUnavailableError(
            "Kusto access on behalf of a user is unavailable while TIM_AUTH_DISABLED=true"
        )


def build_obo_provider(settings: Settings) -> OboTokenProvider:
    if settings.auth_disabled:
        return DisabledOboTokenProvider()
    return MsalOboTokenProvider(settings)
