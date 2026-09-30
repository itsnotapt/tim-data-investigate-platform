"""Query template models (api-contract.md section 4, "QueryTemplate")."""

import re
from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import Field, ValidationInfo, field_validator

from tim_api.models_common import ApiModel, NonBlankStr, UtcDatetime


class QueryType(StrEnum):
    VIEW = "view"
    QUERY = "query"


class QueryParam(ApiModel):
    """Template parameter. `type` is a free string; `values` is required when `type == "array"`."""

    type: NonBlankStr
    default: Any | None = None
    optional: bool | None = None
    multiple: bool | None = None
    hint: str | None = None
    values: list[str] | None = Field(default=None, validate_default=True)

    @field_validator("values")
    @classmethod
    def _values_for_array(cls, value: list[str] | None, info: ValidationInfo) -> list[str] | None:
        if info.data.get("type") == "array" and not value:
            raise ValueError("required and non-empty when type is 'array'")
        return value


class QueryField(ApiModel):
    """Input field definition. `type` is a free string; `multiple` and `match` have extra rules."""

    type: NonBlankStr
    # Python name `from_` (keyword). Error locs for a missing value report `from_`; the API
    # error handler must map it to the JSON name `from`.
    from_: str | None = Field(default=None, alias="from", validate_default=True)
    regex: str | None = Field(default=None, validate_default=True)

    @field_validator("from_")
    @classmethod
    def _from_for_multiple(cls, value: str | None, info: ValidationInfo) -> str | None:
        if info.data.get("type") == "multiple" and not value:
            raise ValueError("required when type is 'multiple'")
        return value

    @field_validator("regex")
    @classmethod
    def _regex_for_match(cls, value: str | None, info: ValidationInfo) -> str | None:
        if info.data.get("type") == "match":
            if not value:
                raise ValueError("required when type is 'match'")
            try:
                re.compile(value)
            except re.error as exc:
                raise ValueError(f"is not a valid regular expression: {exc.msg}") from None
        return value


class QueryTemplateFields(ApiModel):
    """Client-editable template fields (shared by create, replace and the stored record)."""

    name: NonBlankStr
    is_managed: bool = False
    query_type: QueryType
    menu: NonBlankStr
    summary: NonBlankStr
    path: list[str]
    cluster: str
    database: NonBlankStr
    column_id: str | None = None
    params: dict[str, QueryParam] | None = None
    fields: dict[str, QueryField] | None = Field(default=None, validate_default=True)
    columns: dict[str, Any] | None = None
    query: NonBlankStr

    @field_validator("fields")
    @classmethod
    def _fields_for_query(
        cls, value: dict[str, QueryField] | None, info: ValidationInfo
    ) -> dict[str, QueryField] | None:
        if info.data.get("query_type") == QueryType.QUERY and not value:
            raise ValueError("required when queryType is 'query'")
        return value


class QueryTemplateReplace(QueryTemplateFields):
    """PUT body: `uuid` must match the path; `isDeleted` and audit fields are not accepted."""

    uuid: UUID


class QueryTemplateCreate(QueryTemplateReplace):
    """POST body: audit fields (`createdBy`, `updatedBy`, `updated`) are ignored if sent."""

    is_deleted: bool = False

    @field_validator("is_deleted")
    @classmethod
    def _not_deleted(cls, value: bool) -> bool:
        if value:
            raise ValueError("must be absent or false when creating a template")
        return value


class QueryTemplate(QueryTemplateReplace):
    """Stored/returned template. Also the target of PATCH re-validation."""

    is_deleted: bool = False
    updated: UtcDatetime
    created_by: str
    updated_by: str
