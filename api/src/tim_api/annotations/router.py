"""``/api/annotations``: change ids' annotations, and the change feed (ADR-0020)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from tim_api.actions.models import Instance
from tim_api.annotations.models import AnnotationChangesPage, AnnotationsChange, ChangedAnnotations
from tim_api.auth.dependencies import get_current_principal
from tim_api.auth.principal import Principal
from tim_api.config import Settings, get_settings
from tim_api.deps import get_annotation_store
from tim_api.errors import UnprocessableError
from tim_api.storage import AnnotationEdit, AnnotationStore

router = APIRouter(prefix="/api/annotations", tags=["annotations"])

Caller = Annotated[Principal, Depends(get_current_principal)]
Store = Annotated[AnnotationStore, Depends(get_annotation_store)]

# Changed ids per page of the feed, give or take the rest of the page's last change.
CHANGES_PAGE_SIZE = 1000


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
    """Change every id's annotations in one transaction under one version. ``label`` sets the
    label, ``null`` clears it, and leaving it out keeps it."""
    if "label" not in body.model_fields_set:
        raise UnprocessableError({"body": ["Give at least one change: label"]})
    if body.label is not None and body.label not in label_keys:
        raise UnprocessableError({"label": [f"Unknown label: {body.label}"]})
    ids = set(body.ids)
    if len(ids) > settings.max_annotation_ids:
        raise UnprocessableError(
            {"ids": [f"At most {settings.max_annotation_ids:,} ids; {len(ids):,} given"]}
        )
    changed = await store.change(
        ids,
        AnnotationEdit(set_label=True, label=body.label),
        by=principal.name,
        at=datetime.now(UTC),
    )
    return ChangedAnnotations(changes=changed.changes, version=changed.version)


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
