"""``GET /api/instance``, ``POST /api/actions/{key}/resolve`` and
``POST /api/actions/{key}/declareStatement``."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request, Response, status
from tim_actions import Action, ParamsError, Sink
from tim_actions import PivotCell as ActionPivotCell
from tim_actions import resolve_pivot as resolve_action_pivot
from tim_actions.pivots import pivot_refusal
from tim_actions.query_parameters import TakesQueryParameters

from tim_api.actions.models import (
    DeclareStatement,
    DeclareStatementRequest,
    Instance,
    PivotResolution,
    ResolvePivot,
)
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
    refusal = pivot_refusal(action, rows)
    if refusal is not None:
        return refusal
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
    actions: dict[str, Action | Sink] = request.app.state.actions
    action = actions.get(key)
    if not isinstance(action, Action):  # unknown, or a sink, which has no params to resolve
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


@router.post(
    "/api/actions/{key}/declareStatement",
    response_model=DeclareStatement,
    responses={204: {"description": "The action declares nothing for these query parameters"}},
)
def get_declare_statement(
    key: Annotated[str, Path()], body: DeclareStatementRequest, request: Request
) -> DeclareStatement | Response:
    """The statement the action puts before its query to declare the query parameters, by name
    and type; ``204`` when it declares nothing. ``422`` when a name isn't a valid query parameter
    name or a type isn't one the action takes."""
    actions: dict[str, Action | Sink] = request.app.state.actions
    action = actions.get(key)
    if not isinstance(action, Action):
        raise problem_exception(404, "Action not found")
    if not isinstance(action, TakesQueryParameters):
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    try:
        declared = action.declared_query_parameters([(p.name, p.type) for p in body.parameters])
    except ParamsError as exc:
        raise UnprocessableError(exc.errors) from None
    statement = action.declare_statement(declared)
    if not statement:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    return DeclareStatement(declare_statement=statement)
