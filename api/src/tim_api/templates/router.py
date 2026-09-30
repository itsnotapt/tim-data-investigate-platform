"""Query template endpoints (api-contract.md sections 3.5-3.10)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any, Literal
from uuid import UUID

import jsonpatch  # type: ignore[import-untyped,unused-ignore]
import jsonpointer  # type: ignore[import-untyped,unused-ignore]
from fastapi import APIRouter, Body, Depends, Query, Response, status
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError

from tim_api.auth import Principal, get_current_principal
from tim_api.deps import get_template_store
from tim_api.models_common import ApiModel, UtcDatetime
from tim_api.storage import NotFoundError, TemplateStore
from tim_api.templates.models import (
    QueryTemplate,
    QueryTemplateCreate,
    QueryTemplateFields,
    QueryTemplateReplace,
)

router = APIRouter(
    prefix="/api/templates/queries",
    tags=["templates"],
    dependencies=[Depends(get_current_principal)],
)

Store = Annotated[TemplateStore, Depends(get_template_store)]
Caller = Annotated[Principal, Depends(get_current_principal)]

# Server-owned; a patch touching them (or their children) is rejected. `/isDeleted` is allowed.
PROTECTED_PATHS = ("/uuid", "/createdBy", "/updatedBy", "/updated")


class PatchOperation(ApiModel):
    """One RFC 6902 operation. `move` and `copy` are rejected by the literal (400)."""

    op: Literal["add", "replace", "remove", "test"]
    path: str
    value: Any = None


def _now() -> datetime:
    # Millisecond precision: it is what the JSON form carries, so `since=<updated>` round-trips.
    now = datetime.now(UTC)
    return now.replace(microsecond=now.microsecond // 1000 * 1000)


def _invalid(*errors: tuple[tuple[str, ...], str]) -> RequestValidationError:
    """A 400 in the standard `errors` envelope; locations use the JSON names."""
    return RequestValidationError(
        [
            {"type": "value_error", "loc": ("body", *loc), "msg": msg, "input": None}
            for loc, msg in errors
        ]
    )


def _from_pydantic(exc: ValidationError) -> RequestValidationError:
    return RequestValidationError(
        [
            {"type": e["type"], "loc": ("body", *e["loc"]), "msg": e["msg"], "input": None}
            for e in exc.errors()
        ]
    )


def _is_protected(path: str) -> bool:
    return any(path == p or path.startswith(p + "/") for p in PROTECTED_PATHS)


@router.get("")
async def list_templates(
    store: Store,
    since: UtcDatetime | None = None,
    include_deleted: Annotated[bool, Query(alias="includeDeleted")] = False,
) -> list[QueryTemplate]:
    return await store.list(since=since, include_deleted=include_deleted)


@router.get("/{uuid}")
async def get_template(uuid: UUID, store: Store) -> QueryTemplate:
    template = await store.get(uuid)
    if template is None:
        raise NotFoundError(str(uuid))
    return template


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_template(
    body: QueryTemplateCreate, store: Store, principal: Caller, response: Response
) -> QueryTemplate:
    template = QueryTemplate(
        **body.model_dump(by_alias=False),
        updated=_now(),
        created_by=principal.name,
        updated_by=principal.name,
    )
    created = await store.create(template)
    response.headers["Location"] = f"/api/templates/queries/{created.uuid}"
    return created


@router.put("/{uuid}")
async def replace_template(
    uuid: UUID, body: QueryTemplateReplace, store: Store, principal: Caller
) -> QueryTemplate:
    if body.uuid != uuid:
        raise _invalid((("uuid",), "UUIDs don't match"))
    fields = QueryTemplateFields.model_validate(body.model_dump(by_alias=False))
    return await store.replace(uuid, fields, updated_by=principal.name, updated=_now())


@router.patch("/{uuid}")
async def patch_template(
    uuid: UUID,
    operations: Annotated[list[PatchOperation], Body(min_length=1)],
    store: Store,
    principal: Caller,
) -> QueryTemplate:
    current = await store.get(uuid)
    if current is None:
        raise NotFoundError(str(uuid))

    problems: list[tuple[tuple[str, ...], str]] = []
    for index, operation in enumerate(operations):
        if not operation.path.startswith("/"):
            problems.append(((str(index), "path"), "must be a JSON pointer starting with '/'"))
        elif _is_protected(operation.path):
            problems.append(((str(index), "path"), f"'{operation.path}' cannot be patched"))
    if problems:
        raise _invalid(*problems)

    document = current.model_dump(mode="json", by_alias=True)
    try:
        patched = jsonpatch.JsonPatch(
            [op.model_dump(exclude_unset=True) for op in operations]
        ).apply(document)
    except (jsonpatch.JsonPatchException, jsonpointer.JsonPointerException) as exc:
        raise _invalid(((), f"Invalid patch: {exc}")) from None
    if not isinstance(patched, dict):
        raise _invalid(((), "Patch result must be an object"))

    try:
        result = QueryTemplate.model_validate(
            {
                **patched,
                "uuid": uuid,
                "createdBy": current.created_by,
                "updatedBy": principal.name,
                "updated": _now(),
            }
        )
    except ValidationError as exc:
        raise _from_pydantic(exc) from None
    return await store.save(result)


@router.delete("/{uuid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(uuid: UUID, store: Store, principal: Caller) -> Response:
    await store.soft_delete(uuid, updated_by=principal.name, updated=_now())
    return Response(status_code=status.HTTP_204_NO_CONTENT)
