"""Kusto endpoints: ``POST /api/kusto/schema``."""

from __future__ import annotations

import json
import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends

from tim_api.auth.dependencies import get_current_principal, get_obo_provider
from tim_api.auth.obo import OboTokenProvider
from tim_api.auth.principal import Principal
from tim_api.config import Settings, get_settings
from tim_api.errors import problem_exception
from tim_api.kusto.models import SchemaRequest, SchemaResponse
from tim_api.kusto.query_client import (
    KustoForbiddenError,
    KustoQueryClient,
    KustoQueryError,
    get_kusto_client,
)
from tim_api.kusto.validation import validate_cluster_url

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/kusto", tags=["kusto"])

# Result column holding the schema document; ``ClusterSchema`` and ``DatabaseSchema`` are accepted.
SCHEMA_COLUMNS = ("ClusterSchema", "DatabaseSchema")


def extract_schema(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Parse the schema JSON document out of the ``.show schema as json`` result.

    Raises ``ValueError`` (safe, generic message) if no usable document is found.
    """
    if not rows:
        raise ValueError("no rows")
    row = rows[0]
    raw: Any = None
    for name in SCHEMA_COLUMNS:
        if name in row:
            raw = row[name]
            break
    else:
        if len(row) != 1:
            raise ValueError("unknown schema column")
        raw = next(iter(row.values()))
    # The command returns a JSON string; the SDK may already hand back a parsed object.
    doc = json.loads(raw) if isinstance(raw, str) else raw
    if not isinstance(doc, dict):
        raise ValueError("schema is not a JSON object")
    return doc


@router.post("/schema", response_model=SchemaResponse, response_model_by_alias=True)
async def get_schema(
    body: SchemaRequest,
    principal: Annotated[Principal, Depends(get_current_principal)],
    settings: Annotated[Settings, Depends(get_settings)],
    obo: Annotated[OboTokenProvider, Depends(get_obo_provider)],
    kusto: Annotated[KustoQueryClient, Depends(get_kusto_client)],
) -> SchemaResponse:
    cluster = validate_cluster_url(body.cluster, settings)  # before any token exchange
    token = await obo.get_token(principal, cluster)
    try:
        rows = await kusto.show_schema(cluster, body.database, token)
    except KustoForbiddenError:
        raise problem_exception(403, "Access to the Kusto database was denied") from None
    except KustoQueryError:
        raise problem_exception(502, "The Kusto cluster could not return the schema") from None
    try:
        schema = extract_schema(rows)
    except ValueError:
        logger.warning("Unrecognised .show schema as json result", exc_info=True)
        raise problem_exception(502, "The Kusto cluster returned an unrecognised schema") from None
    return SchemaResponse(schema_=schema)
