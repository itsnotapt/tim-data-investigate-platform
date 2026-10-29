"""``/api/me``: the name the API knows the caller by."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from tim_api.auth.dependencies import get_current_principal
from tim_api.auth.models import Me
from tim_api.auth.principal import Principal

router = APIRouter(tags=["auth"])


@router.get("/api/me")
def get_me(principal: Annotated[Principal, Depends(get_current_principal)]) -> Me:
    """The signed-in analyst's name, from their access token."""
    return Me(name=principal.name)
