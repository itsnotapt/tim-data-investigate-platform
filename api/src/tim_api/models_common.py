"""Shared Pydantic building blocks: camelCase base model, UTC datetimes, non-blank strings."""

from datetime import UTC, datetime
from typing import Annotated

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    PlainSerializer,
    StringConstraints,
)
from pydantic.alias_generators import to_camel


class ApiModel(BaseModel):
    """Base for API bodies: camelCase JSON, unknown input fields ignored."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        serialize_by_alias=True,
        extra="ignore",
    )


def _to_utc(value: datetime) -> datetime:
    """Offset input is converted to UTC; input without an offset is treated as UTC."""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def format_utc(value: datetime) -> str:
    """ISO 8601 UTC with `Z`; milliseconds only when the value has a sub-second part."""
    value = _to_utc(value)
    if value.microsecond == 0:
        return value.strftime("%Y-%m-%dT%H:%M:%SZ")
    return value.strftime("%Y-%m-%dT%H:%M:%S.") + f"{value.microsecond // 1000:03d}Z"


UtcDatetime = Annotated[
    datetime,
    AfterValidator(_to_utc),
    PlainSerializer(format_utc, return_type=str, when_used="json"),
]


def _non_blank(value: str) -> str:
    if not value.strip():
        raise ValueError("must not be blank")
    return value


NonBlankStr = Annotated[str, AfterValidator(_non_blank)]


Database = Annotated[str, StringConstraints(min_length=1, max_length=256)]
