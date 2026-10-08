"""Authentication: the caller's identity (``Principal``) and the dependency that provides it."""

from tim_api.auth.dependencies import (
    get_current_principal,
    get_obo_provider,
    get_token_validator,
)
from tim_api.auth.jwt import InvalidTokenError, TokenValidator
from tim_api.auth.obo import (
    OboAuthError,
    OboConfigError,
    OboError,
    OboTokenProvider,
    OboUnavailableError,
    OboUpstreamError,
)
from tim_api.auth.principal import DEV_PRINCIPAL, Principal

__all__ = [
    "DEV_PRINCIPAL",
    "InvalidTokenError",
    "OboAuthError",
    "OboConfigError",
    "OboError",
    "OboTokenProvider",
    "OboUnavailableError",
    "OboUpstreamError",
    "Principal",
    "TokenValidator",
    "get_current_principal",
    "get_obo_provider",
    "get_token_validator",
]
