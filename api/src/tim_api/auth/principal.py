"""The authenticated caller (ADR-0005); the resolving dependency is in ``dependencies.py``.

Identity always comes from the token, never from the request body.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, SecretStr


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
