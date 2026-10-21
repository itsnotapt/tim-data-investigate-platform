"""The authenticated caller (ADR-0005); the resolving dependency is in ``dependencies.py``.

Identity always comes from the token, never from the request body.
"""

from __future__ import annotations

from uuid import NAMESPACE_URL, uuid5

from pydantic import BaseModel, ConfigDict, SecretStr


class Principal(BaseModel):
    """The caller. ``token`` is the raw bearer token (needed later for OBO); never logged."""

    model_config = ConfigDict(frozen=True)

    oid: str
    name: str
    tenant_id: str
    token: SecretStr | None = None


# Fixed identity used when TIM_AUTH_DISABLED is on (development only) and the request has no
# stub token.
DEV_PRINCIPAL = Principal(
    oid="00000000-0000-0000-0000-000000000001",
    name="dev.user@example.com",
    tenant_id="00000000-0000-0000-0000-0000000000aa",
    token=SecretStr("dev-token"),
)

STUB_TOKEN_PREFIX = "dev:"  # noqa: S105 - a prefix, not a secret


def stub_principal(token: str) -> Principal | None:
    """The analyst a stub token (``dev:<upn>``) names, with an oid derived from the upn, when
    TIM_AUTH_DISABLED is on; ``None`` when the upn is blank."""
    upn = token.removeprefix(STUB_TOKEN_PREFIX).strip()
    if not upn:
        return None
    return Principal(
        oid=str(uuid5(NAMESPACE_URL, f"tim-dev-user:{upn}")),
        name=upn,
        tenant_id=DEV_PRINCIPAL.tenant_id,
        token=SecretStr(token),
    )
