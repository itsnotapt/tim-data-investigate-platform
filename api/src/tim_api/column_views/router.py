"""``/api/columnViews``: an analyst's own column views and those shared with everyone."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Path, Response, status

from tim_api.auth import Principal, get_current_principal
from tim_api.column_views.models import (
    ColumnView,
    ColumnViewFields,
    NewColumnView,
    StoredColumnView,
)
from tim_api.deps import get_column_view_store
from tim_api.errors import problem_exception
from tim_api.storage import ColumnViewStore

router = APIRouter(
    prefix="/api/columnViews",
    tags=["column views"],
    dependencies=[Depends(get_current_principal)],
)

Store = Annotated[ColumnViewStore, Depends(get_column_view_store)]
Caller = Annotated[Principal, Depends(get_current_principal)]
ViewId = Annotated[UUID, Path(alias="viewId")]


def _now() -> datetime:
    # Millisecond precision: it is what the JSON form carries.
    now = datetime.now(UTC)
    return now.replace(microsecond=now.microsecond // 1000 * 1000)


async def _visible(store: ColumnViewStore, view_id: UUID, principal: Principal) -> ColumnView:
    view = await store.get(view_id, principal.name)
    if view is None or (view.owner != principal.name and view.visibility == "private"):
        raise problem_exception(404, "Column view not found")
    return view


async def _owned(store: ColumnViewStore, view_id: UUID, principal: Principal) -> ColumnView:
    view = await _visible(store, view_id, principal)
    if view.owner != principal.name:
        raise problem_exception(403, "Only the owner can change a column view")
    return view


@router.get("")
async def list_column_views(store: Store, principal: Caller) -> list[ColumnView]:
    return await store.list(principal.name)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_column_view(body: NewColumnView, store: Store, principal: Caller) -> ColumnView:
    now = _now()
    view = StoredColumnView(
        **body.model_dump(by_alias=False),
        view_id=uuid4(),
        owner=principal.name,
        created_at=now,
        updated_at=now,
    )
    await store.create(view)
    return ColumnView(**view.model_dump(by_alias=False), owned=True, hidden=False)


@router.put("/{viewId}")
async def replace_column_view(
    view_id: ViewId, body: ColumnViewFields, store: Store, principal: Caller
) -> ColumnView:
    await _owned(store, view_id, principal)
    await store.replace(view_id, body, updated_at=_now())
    return await _visible(store, view_id, principal)


@router.delete("/{viewId}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_column_view(view_id: ViewId, store: Store, principal: Caller) -> Response:
    await _owned(store, view_id, principal)
    await store.delete(view_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/{viewId}/hidden", status_code=status.HTTP_204_NO_CONTENT)
async def hide_column_view(view_id: ViewId, store: Store, principal: Caller) -> Response:
    await _visible(store, view_id, principal)
    await store.set_hidden(view_id, principal.name, hidden=True)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{viewId}/hidden", status_code=status.HTTP_204_NO_CONTENT)
async def unhide_column_view(view_id: ViewId, store: Store, principal: Caller) -> Response:
    await _visible(store, view_id, principal)
    await store.set_hidden(view_id, principal.name, hidden=False)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
