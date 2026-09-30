"""Authentication: the caller's identity (``Principal``) and the dependency that provides it."""

from tim_api.auth.principal import DEV_PRINCIPAL, Principal, get_current_principal

__all__ = ["DEV_PRINCIPAL", "Principal", "get_current_principal"]
