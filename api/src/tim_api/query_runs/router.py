"""Query-run endpoints: ``POST /api/kusto/query`` and ``GET /api/kusto/query/{queryRunId}``."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Path, Request, Response

from tim_api.auth.dependencies import get_current_principal, get_obo_provider
from tim_api.auth.obo import OboTokenProvider
from tim_api.auth.principal import Principal
from tim_api.config import Settings, get_settings
from tim_api.deps import get_run_store
from tim_api.errors import problem_exception
from tim_api.kusto.query_client import KustoQueryClient, get_kusto_client
from tim_api.kusto.validation import validate_cluster_url
from tim_api.observability import get_trace_id
from tim_api.query_runs.models import KustoQueryRequest, KustoQueryRun, QueryRunStatus
from tim_api.query_runs.runner import RunManager
from tim_api.storage import QueryRunStore

router = APIRouter(prefix="/api/kusto", tags=["kusto"])

Caller = Annotated[Principal, Depends(get_current_principal)]


def _status_code(run: KustoQueryRun) -> int:
    return 202 if run.status is QueryRunStatus.CREATED else 200


def get_run_tasks(request: Request) -> set[asyncio.Task[KustoQueryRun]]:
    tasks: set[asyncio.Task[KustoQueryRun]] = request.app.state.run_tasks
    return tasks


def get_run_slots(request: Request) -> asyncio.Semaphore:
    slots: asyncio.Semaphore = request.app.state.run_slots
    return slots


@router.post("/query", response_model=KustoQueryRun, responses={202: {"model": KustoQueryRun}})
async def start_query(
    body: KustoQueryRequest,
    request: Request,
    response: Response,
    principal: Caller,
    settings: Annotated[Settings, Depends(get_settings)],
    obo: Annotated[OboTokenProvider, Depends(get_obo_provider)],
    kusto: Annotated[KustoQueryClient, Depends(get_kusto_client)],
    store: Annotated[QueryRunStore, Depends(get_run_store)],
    tasks: Annotated[set[asyncio.Task[KustoQueryRun]], Depends(get_run_tasks)],
    slots: Annotated[asyncio.Semaphore, Depends(get_run_slots)],
) -> KustoQueryRun:
    cluster = validate_cluster_url(body.cluster, settings)  # before any token use
    if "\x00" in body.query or "\x00" in body.database:
        # PostgreSQL text cannot hold NUL; such a query is never meaningful.
        raise problem_exception(400, "query and database must not contain NUL characters")
    # Auth errors (401/403/502/503) surface synchronously, before a run exists.
    token = await obo.get_token(principal, cluster)
    manager = RunManager(store, kusto, settings, tasks, slots=slots)
    run = await manager.start(
        body, cluster=cluster, owner=principal.name, token=token, trace_id=get_trace_id(request)
    )
    response.status_code = _status_code(run)
    return run


@router.get("/query/{queryRunId}", response_model=KustoQueryRun)
async def get_query_run(
    query_run_id: Annotated[UUID, Path(alias="queryRunId")],
    response: Response,
    principal: Caller,
    store: Annotated[QueryRunStore, Depends(get_run_store)],
) -> KustoQueryRun:
    run = await store.get_for_owner(query_run_id, principal.name, datetime.now(UTC))
    if run is None:  # unknown, expired or someone else's: identical
        raise problem_exception(404, "Query run not found")
    response.status_code = _status_code(run)
    return run
