"""``/api/connections``: the editor schema of a connection, from its connection type's hook."""

from __future__ import annotations

import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends
from tim_actions import RunError

from tim_api.auth.dependencies import get_current_principal, get_obo_provider
from tim_api.auth.obo import OboTokenProvider
from tim_api.auth.principal import Principal
from tim_api.connections.models import EditorSchemaRequest, EditorSchemaResponse
from tim_api.errors import problem_exception
from tim_api.runs.connections import Connections, get_connections

router = APIRouter(prefix="/api/connections", tags=["connections"])


@router.post("/{name}/schema", response_model=EditorSchemaResponse)
async def get_editor_schema(
    name: str,
    body: EditorSchemaRequest,
    principal: Annotated[Principal, Depends(get_current_principal)],
    connections: Annotated[Connections, Depends(get_connections)],
    obo: Annotated[OboTokenProvider, Depends(get_obo_provider)],
) -> EditorSchemaResponse:
    """The editor schema for ``scope`` on the connection ``name``, got as the analyst. The
    connection's ``obo`` token is got first, so OBO problems answer as they do on runs."""
    if name not in connections.types():
        raise problem_exception(404, "Connection not found")
    opened = await connections.open(frozenset({name}), principal, obo)
    try:
        schema = await asyncio.to_thread(opened.hook(name).editor_schema, body.scope)
    except RunError as exc:
        raise problem_exception(502, str(exc)) from None
    if schema is None:
        return EditorSchemaResponse(kind=None, schema_=None)
    return EditorSchemaResponse(kind=schema.kind, schema_=schema.schema)
