"""Tagged event endpoints.

Row keys are the camelCase JSON paths of the ``<Table>Mapping`` ingestion mappings, listed in
the column order of the Kusto tables.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response, status

from tim_api.auth.dependencies import get_current_principal
from tim_api.auth.principal import Principal
from tim_api.models_common import format_utc
from tim_api.tagged_events.ingest import TagIngestClient, get_tag_ingest_client
from tim_api.tagged_events.kusto_schema import (
    EVENT_COMMENT_TABLE,
    EVENT_TAG_TABLE,
    SAVED_EVENT_TABLE,
    mapping_name,
)
from tim_api.tagged_events.models import EventCommentBatch, EventTagBatch, SavedEventBatch

router = APIRouter(prefix="/api/taggedevents", tags=["taggedevents"])

Caller = Annotated[Principal, Depends(get_current_principal)]
Ingest = Annotated[TagIngestClient, Depends(get_tag_ingest_client)]


def _now() -> str:
    return format_utc(datetime.now(UTC))


async def _ingest(client: TagIngestClient, table: str, rows: list[dict[str, Any]]) -> Response:
    await client.ingest(table, mapping_name(table), rows)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/savedEvents", status_code=status.HTTP_204_NO_CONTENT)
async def save_events(items: SavedEventBatch, principal: Caller, client: Ingest) -> Response:
    now = _now()
    rows = [
        {
            "eventId": i.event_id,
            "eventTime": format_utc(i.event_time),
            "dateTimeUtc": now,
            "createdBy": principal.name,
            "eventAsJson": i.event_as_json,
        }
        for i in items
    ]
    return await _ingest(client, SAVED_EVENT_TABLE, rows)


@router.post("/tags", status_code=status.HTTP_204_NO_CONTENT)
async def add_tags(items: EventTagBatch, principal: Caller, client: Ingest) -> Response:
    now = _now()
    rows = [
        {
            "eventId": i.event_id,
            "dateTimeUtc": now,
            "createdBy": principal.name,
            "tag": i.tag,
            "isDeleted": i.is_deleted,
        }
        for i in items
    ]
    return await _ingest(client, EVENT_TAG_TABLE, rows)


@router.post("/comments", status_code=status.HTTP_204_NO_CONTENT)
async def add_comments(items: EventCommentBatch, principal: Caller, client: Ingest) -> Response:
    now = _now()
    rows = [
        {
            "eventId": i.event_id,
            "dateTimeUtc": now,
            "createdBy": principal.name,
            "comment": i.comment,
            "determination": i.determination,
            "isDeleted": i.is_deleted,
        }
        for i in items
    ]
    return await _ingest(client, EVENT_COMMENT_TABLE, rows)
