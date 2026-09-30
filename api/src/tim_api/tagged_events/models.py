"""Tagged event request items (api-contract.md 3.11-3.13, 4).

`createdBy` and `dateTimeUtc` are server-set from the token and clock; they are deliberately not
fields here, so anything the client sends for them is dropped on parse (SEC-03).
"""

import json
from typing import Annotated, Any

from pydantic import Field, field_validator

from tim_api.models_common import ApiModel, NonBlankStr, UtcDatetime

MAX_BATCH_ITEMS = 1000
MAX_EVENT_JSON_BYTES = 1_000_000


class SavedEvent(ApiModel):
    event_id: NonBlankStr
    event_time: UtcDatetime
    event_as_json: dict[str, Any]

    @field_validator("event_as_json")
    @classmethod
    def _size_cap(cls, value: dict[str, Any]) -> dict[str, Any]:
        if len(json.dumps(value, separators=(",", ":")).encode()) > MAX_EVENT_JSON_BYTES:
            raise ValueError(f"serialised size exceeds {MAX_EVENT_JSON_BYTES} bytes")
        return value


class EventTag(ApiModel):
    event_id: NonBlankStr
    tag: NonBlankStr
    is_deleted: bool = False


class EventComment(ApiModel):
    event_id: NonBlankStr
    determination: NonBlankStr
    comment: str | None = None
    is_deleted: bool = False


SavedEventBatch = Annotated[list[SavedEvent], Field(min_length=1, max_length=MAX_BATCH_ITEMS)]
EventTagBatch = Annotated[list[EventTag], Field(min_length=1, max_length=MAX_BATCH_ITEMS)]
EventCommentBatch = Annotated[list[EventComment], Field(min_length=1, max_length=MAX_BATCH_ITEMS)]
