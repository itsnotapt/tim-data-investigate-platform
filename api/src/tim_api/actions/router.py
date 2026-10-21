"""``GET /api/instance``."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from tim_api.actions.models import Instance
from tim_api.auth import get_current_principal

router = APIRouter(tags=["instance"], dependencies=[Depends(get_current_principal)])


@router.get("/api/instance")
def get_instance(request: Request) -> Instance:
    """The instance's actions, connections, labels and limits."""
    instance: Instance = request.app.state.instance
    return instance
