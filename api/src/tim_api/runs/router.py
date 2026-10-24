"""``/api/runs``: start, poll and cancel runs, and read their rows."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Query, Request, Response
from tim_actions import Action, Analyst, Column, ParamsError, Sink, validate_params
from tim_actions.action import run_connection_names

from tim_api.auth.dependencies import get_current_principal, get_obo_provider
from tim_api.auth.obo import OboTokenProvider
from tim_api.auth.principal import Principal
from tim_api.config import Settings, get_settings
from tim_api.deps import get_annotation_store, get_run_store
from tim_api.errors import UnprocessableError, problem_exception
from tim_api.observability import get_trace_id
from tim_api.runs.connections import Connections, get_connections
from tim_api.runs.models import RowsPage, Run, RunStatus, StartRun
from tim_api.runs.results import ResultsGoneError, RunNotSucceededError
from tim_api.runs.runner import RunInput, Runner
from tim_api.storage import AnnotationStore, RunStore

router = APIRouter(prefix="/api/runs", tags=["runs"])

Caller = Annotated[Principal, Depends(get_current_principal)]
RunId = Annotated[UUID, Path(alias="runId")]


def get_runner(request: Request) -> Runner:
    runner: Runner = request.app.state.runner
    return runner


def get_actions(request: Request) -> dict[str, Action | Sink]:
    actions: dict[str, Action | Sink] = request.app.state.actions
    return actions


def _run_input(action: Action | Sink, body: StartRun, max_rows: int) -> RunInput | None:
    """A sink's input, as its ``run`` takes it, or ``None`` for a query action. Raises
    ``UnprocessableError`` when the body's ``input`` doesn't suit the action."""
    given = body.input
    if not isinstance(action, Sink):
        if given is not None:
            raise UnprocessableError({"input": ["Only a sink takes input"]})
        return None
    if given is None:
        raise UnprocessableError({"input": ["A sink needs the rows to write"]})
    if len(given.rows) > max_rows:
        raise UnprocessableError(
            {"input.rows": [f"At most {max_rows:,} rows; {len(given.rows):,} given"]}
        )
    names = [column.name for column in given.columns]
    if len(set(names)) != len(names):
        raise UnprocessableError({"input.columns": ["Column names must be unique"]})
    columns = [Column(name=column.name, type=column.type) for column in given.columns]
    return RunInput(columns, given.rows)


async def _owned_run(store: RunStore, run_id: UUID, principal: Principal) -> Run:
    run = await store.get(run_id, datetime.now(UTC))
    if run is None or run.owner != principal.name:  # unknown, expired or someone else's
        raise problem_exception(404, "Run not found")
    return run


@router.post("", response_model=Run, responses={202: {"model": Run}})
async def start_run(
    body: StartRun,
    request: Request,
    response: Response,
    principal: Caller,
    actions: Annotated[dict[str, Action | Sink], Depends(get_actions)],
    runner: Annotated[Runner, Depends(get_runner)],
    connections: Annotated[Connections, Depends(get_connections)],
    obo: Annotated[OboTokenProvider, Depends(get_obo_provider)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Run:
    """Start a run; ``200`` when it ends within about a second, else ``202``. Each ``obo``
    connection's token is got first, so OBO problems answer this request. A sink takes the
    rows to write as ``input``, at most ``maxAnnotationIds`` of them."""
    action = actions.get(body.action)
    if action is None:
        raise UnprocessableError({"action": ["Unknown action"]})
    run_input = _run_input(action, body, settings.max_annotation_ids)
    declared = () if isinstance(action, Sink) else action.params
    try:
        params = validate_params(declared, body.params, connections=connections.types())
    except ParamsError as exc:
        raise UnprocessableError(exc.errors) from None
    run_connections = await connections.open(run_connection_names(action, params), principal, obo)
    run = await runner.start(
        action,
        params,
        run_input=run_input,
        analyst=Analyst(name=principal.name, upn=principal.name),
        owner=principal.name,
        connections=run_connections,
        trace_id=get_trace_id(request),
    )
    response.status_code = 202 if run.status is RunStatus.RUNNING else 200
    return run


@router.get("/{runId}", response_model=Run)
async def get_run(
    run_id: RunId,
    principal: Caller,
    store: Annotated[RunStore, Depends(get_run_store)],
) -> Run:
    return await _owned_run(store, run_id, principal)


@router.post("/{runId}/cancel", response_model=Run)
async def cancel_run(
    run_id: RunId,
    principal: Caller,
    store: Annotated[RunStore, Depends(get_run_store)],
    runner: Annotated[Runner, Depends(get_runner)],
) -> Run:
    """Cancel the run. It is ``cancelled`` once ``Hook.cancel()`` returns or the worker exits,
    which may be after this answers; a run that has ended comes back unchanged."""
    return await runner.cancel(await _owned_run(store, run_id, principal))


@router.get("/{runId}/rows", response_model=RowsPage)
async def get_rows(
    run_id: RunId,
    principal: Caller,
    store: Annotated[RunStore, Depends(get_run_store)],
    annotation_store: Annotated[AnnotationStore, Depends(get_annotation_store)],
    settings: Annotated[Settings, Depends(get_settings)],
    start_row: Annotated[int, Query(alias="startRow", ge=0)] = 0,
    end_row: Annotated[int | None, Query(alias="endRow", ge=0)] = None,
) -> RowsPage:
    """The rows with ``startRow <= row < endRow``, at most ``rowsPageSize`` of them, and their
    ids' annotations."""
    run = await _owned_run(store, run_id, principal)
    if run.status is not RunStatus.SUCCEEDED:
        raise RunNotSucceededError
    last = start_row + settings.rows_page_size
    end = last if end_row is None else min(end_row, last)
    if end < start_row:
        raise problem_exception(400, "endRow must not be less than startRow")
    rows = await store.rows(run_id, start_row, end)
    row_count = run.row_count or 0
    if not rows and row_count > 0 and not await store.has_rows(run_id):
        raise ResultsGoneError
    annotations = await annotation_store.of_ids({row.id for row in rows if row.id})
    return RowsPage(
        rows=rows,
        last_row=row_count,
        annotations=annotations.annotations,
        annotation_version=annotations.version,
    )
