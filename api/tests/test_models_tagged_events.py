from typing import Any

import pytest
from pydantic import TypeAdapter, ValidationError

from tim_api.tagged_events.models import (
    MAX_BATCH_ITEMS,
    MAX_EVENT_JSON_BYTES,
    EventComment,
    EventCommentBatch,
    EventTag,
    EventTagBatch,
    SavedEvent,
    SavedEventBatch,
)

SERVER_FIELDS = {"createdBy": "mallory", "dateTimeUtc": "2001-01-01T00:00:00Z"}


def locs(exc: ValidationError) -> list[str]:
    return [".".join(str(p) for p in e["loc"]) for e in exc.errors()]


def test_saved_event_round_trip() -> None:
    raw = {
        "eventId": "b2f1",
        "eventTime": "2026-03-14T09:31:02.114Z",
        "eventAsJson": {"ReportGuid": "b2f1", "Nested": {"a": [1, None]}},
    }
    model = SavedEvent.model_validate(raw)
    assert model.model_dump(mode="json") == raw


def test_event_tag_and_comment_defaults() -> None:
    tag = EventTag.model_validate({"eventId": "e1", "tag": "investigate"})
    assert tag.model_dump(mode="json") == {
        "eventId": "e1",
        "tag": "investigate",
        "isDeleted": False,
    }
    comment = EventComment.model_validate({"eventId": "e1", "determination": "malicious"})
    assert comment.model_dump(mode="json") == {
        "eventId": "e1",
        "determination": "malicious",
        "comment": None,
        "isDeleted": False,
    }
    assert EventTag.model_validate({"eventId": "e1", "tag": "t", "isDeleted": True}).is_deleted


@pytest.mark.parametrize(
    ("model", "body"),
    [
        (SavedEvent, {"eventId": "e", "eventTime": "2026-03-14T00:00:00Z", "eventAsJson": {}}),
        (EventTag, {"eventId": "e", "tag": "t"}),
        (EventComment, {"eventId": "e", "determination": "benign"}),
    ],
)
def test_client_supplied_server_fields_ignored(model: Any, body: dict[str, Any]) -> None:
    parsed = model.model_validate({**body, **SERVER_FIELDS})
    dumped = parsed.model_dump(mode="json")
    assert "createdBy" not in dumped and "dateTimeUtc" not in dumped


@pytest.mark.parametrize(
    ("model", "body", "missing"),
    [
        (SavedEvent, {"eventTime": "2026-03-14T00:00:00Z", "eventAsJson": {}}, "eventId"),
        (SavedEvent, {"eventId": "e", "eventAsJson": {}}, "eventTime"),
        (SavedEvent, {"eventId": "e", "eventTime": "2026-03-14T00:00:00Z"}, "eventAsJson"),
        (EventTag, {"eventId": "e"}, "tag"),
        (EventTag, {"tag": "t"}, "eventId"),
        (EventComment, {"eventId": "e"}, "determination"),
        (EventComment, {"determination": "d"}, "eventId"),
    ],
)
def test_required_fields(model: Any, body: dict[str, Any], missing: str) -> None:
    with pytest.raises(ValidationError) as exc:
        model.model_validate(body)
    assert locs(exc.value) == [missing]


@pytest.mark.parametrize(
    ("model", "body", "field"),
    [
        (
            SavedEvent,
            {"eventId": " ", "eventTime": "2026-03-14T00:00:00Z", "eventAsJson": {}},
            "eventId",
        ),
        (EventTag, {"eventId": "e", "tag": ""}, "tag"),
        (EventComment, {"eventId": "e", "determination": "  "}, "determination"),
    ],
)
def test_blank_rejected(model: Any, body: dict[str, Any], field: str) -> None:
    with pytest.raises(ValidationError) as exc:
        model.model_validate(body)
    assert locs(exc.value) == [field]


def test_event_json_size_cap() -> None:
    body = {"eventId": "e", "eventTime": "2026-03-14T00:00:00Z"}
    SavedEvent.model_validate({**body, "eventAsJson": {"x": "a" * 1000}})
    with pytest.raises(ValidationError) as exc:
        SavedEvent.model_validate({**body, "eventAsJson": {"x": "a" * MAX_EVENT_JSON_BYTES}})
    assert locs(exc.value) == ["eventAsJson"]


def test_event_as_json_must_be_object() -> None:
    with pytest.raises(ValidationError):
        SavedEvent.model_validate(
            {"eventId": "e", "eventTime": "2026-03-14T00:00:00Z", "eventAsJson": [1]}
        )


def test_batch_limits_and_indexed_errors() -> None:
    adapter = TypeAdapter(EventTagBatch)
    with pytest.raises(ValidationError):
        adapter.validate_python([])
    ok = {"eventId": "e", "tag": "t"}
    assert len(adapter.validate_python([ok] * MAX_BATCH_ITEMS)) == MAX_BATCH_ITEMS
    with pytest.raises(ValidationError):
        adapter.validate_python([ok] * (MAX_BATCH_ITEMS + 1))
    with pytest.raises(ValidationError) as exc:
        adapter.validate_python([ok, {"eventId": "e", "tag": ""}, {"tag": "t"}])
    assert locs(exc.value) == ["1.tag", "2.eventId"]
    with pytest.raises(ValidationError):
        TypeAdapter(SavedEventBatch).validate_python([])
    with pytest.raises(ValidationError):
        TypeAdapter(EventCommentBatch).validate_python({"eventId": "e"})
