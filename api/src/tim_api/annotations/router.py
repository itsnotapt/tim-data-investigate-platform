"""``/api/annotations``: change ids' annotations, and the change feed (ADR-0020)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from tim_api.actions.models import Instance
from tim_api.annotations.models import (
    AnnotationChangesPage,
    AnnotationsChange,
    ChangedAnnotations,
    TagSuggestions,
)
from tim_api.auth.dependencies import get_current_principal
from tim_api.auth.principal import Principal
from tim_api.config import Settings, get_settings
from tim_api.deps import get_annotation_store
from tim_api.errors import UnprocessableError
from tim_api.storage import AnnotationEdit, AnnotationStore

router = APIRouter(prefix="/api/annotations", tags=["annotations"])
tags_router = APIRouter(prefix="/api/tags", tags=["annotations"])

Caller = Annotated[Principal, Depends(get_current_principal)]
Store = Annotated[AnnotationStore, Depends(get_annotation_store)]

# Changed ids per page of the feed, give or take the rest of the page's last change.
CHANGES_PAGE_SIZE = 1000
MAX_TAG_LENGTH = 100
# Tags per list of suggestions.
SUGGESTIONS = 10


def get_label_keys(request: Request) -> set[str]:
    instance: Instance = request.app.state.instance
    return {label.key for label in instance.labels}


@router.patch("", response_model=ChangedAnnotations)
async def change_annotations(
    body: AnnotationsChange,
    principal: Caller,
    store: Store,
    settings: Annotated[Settings, Depends(get_settings)],
    label_keys: Annotated[set[str], Depends(get_label_keys)],
) -> ChangedAnnotations:
    """Change every id's annotations in one transaction under one version: the label, the tags
    (added and removed, or replaced with ``setTags``) and a comment appended to each."""
    edit = _edit(body, label_keys)
    ids = set(body.ids)
    if len(ids) > settings.max_annotation_ids:
        raise UnprocessableError(
            {"ids": [f"At most {settings.max_annotation_ids:,} ids; {len(ids):,} given"]}
        )
    changed = await store.change(ids, edit, by=principal.name, at=datetime.now(UTC))
    return ChangedAnnotations(changes=changed.changes, version=changed.version)


def _edit(body: AnnotationsChange, label_keys: set[str]) -> AnnotationEdit:
    """The edit ``body`` asks for, with its tags and comment trimmed. Raises
    ``UnprocessableError`` when it is invalid."""
    set_label = "label" in body.model_fields_set
    if not (
        set_label
        or body.add_tags
        or body.remove_tags
        or body.set_tags is not None
        or body.comment is not None
    ):
        raise UnprocessableError(
            {"body": ["Give at least one change: label, addTags, removeTags, setTags or comment"]}
        )
    if body.label is not None and body.label not in label_keys:
        raise UnprocessableError({"label": [f"Unknown label: {body.label}"]})
    if body.set_tags is not None and (body.add_tags or body.remove_tags):
        raise UnprocessableError(
            {"setTags": ["setTags can't be combined with addTags or removeTags"]}
        )
    add_tags = _tags("addTags", body.add_tags)
    remove_tags = _tags("removeTags", body.remove_tags)
    if both := add_tags & remove_tags:
        raise UnprocessableError(
            {"removeTags": [f"Both added and removed: {', '.join(sorted(both))}"]}
        )
    comment = None if body.comment is None else body.comment.strip()
    if comment == "":
        raise UnprocessableError({"comment": ["A comment can't be blank"]})
    return AnnotationEdit(
        set_label=set_label,
        label=body.label,
        add_tags=add_tags,
        remove_tags=remove_tags,
        set_tags=None if body.set_tags is None else _tags("setTags", body.set_tags),
        comment=comment,
    )


def _tags(field: str, given: list[str]) -> frozenset[str]:
    """``given``, trimmed. Raises ``UnprocessableError`` for a blank or over-long tag."""
    tags = frozenset(tag.strip() for tag in given)
    if "" in tags:
        raise UnprocessableError({field: ["A tag can't be blank"]})
    if long := sorted(tag for tag in tags if len(tag) > MAX_TAG_LENGTH):
        raise UnprocessableError(
            {field: [f"At most {MAX_TAG_LENGTH} characters: {tag}" for tag in long]}
        )
    return tags


@router.get("/changes", response_model=AnnotationChangesPage)
async def annotation_changes(
    principal: Caller,
    store: Store,
    since: Annotated[int, Query(ge=0)],
) -> AnnotationChangesPage:
    """The ids changed after version ``since``, as they now are, in version order. Ask again
    from ``next`` while ``hasMore``."""
    page = await store.changes(since, CHANGES_PAGE_SIZE)
    last = page.changes[-1].version if page.changes else since
    return AnnotationChangesPage(changes=page.changes, next=last, has_more=page.has_more)


@tags_router.get("/suggestions", response_model=TagSuggestions)
async def tag_suggestions(principal: Caller, store: Store, prefix: str = "") -> TagSuggestions:
    """Tags that start with ``prefix``, ignoring case: the caller's own, most recently added
    first, then the others, on the most ids first."""
    return await store.tag_suggestions(prefix.strip(), by=principal.name, limit=SUGGESTIONS)
