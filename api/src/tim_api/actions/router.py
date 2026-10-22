"""``GET /api/instance`` and ``POST /api/actions/{key}/resolve``."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request
from tim_actions import Action
from tim_actions import PivotCell as ActionPivotCell
from tim_actions import resolve_pivot as resolve_action_pivot

from tim_api.actions.models import Instance, PivotResolution, ResolvePivot
from tim_api.auth import get_current_principal
from tim_api.config import Settings, get_settings
from tim_api.errors import UnprocessableError, problem_exception

router = APIRouter(tags=["instance"], dependencies=[Depends(get_current_principal)])


@router.get("/api/instance")
def get_instance(request: Request) -> Instance:
    """The instance's actions, connections, labels and limits."""
    instance: Instance = request.app.state.instance
    return instance


def _refusal(action: Action, rows: int, max_rows: int) -> str | None:
    """Why the action can't be resolved from ``rows`` selected rows, or ``None``."""
    if action.pivot == "none":
        return "Not offered as a pivot"
    if action.pivot == "row" and rows > 1:
        return "Takes one row"
    if rows > max_rows:
        return f"At most {max_rows:,} rows; {rows:,} selected"
    return None


# A sync route, so an action's ``resolve()`` runs in a worker thread.
@router.post("/api/actions/{key}/resolve")
def resolve_pivot(
    key: Annotated[str, Path()],
    body: ResolvePivot,
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
) -> PivotResolution:
    """A pivot into the action: its params resolved from the selected rows, and the required
    params left without a value. ``422`` when the action isn't offered on these rows."""
    actions: dict[str, Action] = request.app.state.actions
    action = actions.get(key)
    if action is None:
        raise problem_exception(404, "Action not found")
    pivot = body.pivot
    refusal = _refusal(action, len(pivot.rows), settings.max_pivot_rows)
    if refusal is not None:
        raise UnprocessableError({"pivot.rows": [refusal]})
    cell = ActionPivotCell(pivot.cell.column, pivot.cell.value) if pivot.cell else None
    resolved = resolve_action_pivot(action, pivot.rows, cell)
    return PivotResolution(
        params=resolved.params,
        missing=list(resolved.missing),
        reasons={name: reason for name, reason in resolved.missing.items() if reason},
    )
