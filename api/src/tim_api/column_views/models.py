"""Column view models."""

from typing import Any, Literal
from uuid import UUID

from tim_api.models_common import ApiModel, NonBlankStr, UtcDatetime, omitted

Visibility = Literal["private", "shared"]


class SavedFrom(ApiModel):
    """The action, and the preset when there is one, of the tab the view was saved from."""

    action: NonBlankStr
    preset_id: UUID | None = omitted()


class ColumnViewFields(ApiModel):
    """The fields the owner writes: the ``PUT`` body. ``state`` is a partial AG Grid
    ``GridState``, whose keys only the browser decides (ADR-0022)."""

    name: NonBlankStr
    visibility: Visibility = "private"
    state: dict[str, Any]


class NewColumnView(ColumnViewFields):
    """The ``POST`` body: ``savedFrom`` is fixed at creation."""

    saved_from: SavedFrom


class StoredColumnView(NewColumnView):
    view_id: UUID
    owner: str
    created_at: UtcDatetime
    updated_at: UtcDatetime


class ColumnView(StoredColumnView):
    """A column view as one analyst sees it: ``owned`` is whether they own it, ``hidden``
    whether they hid it."""

    owned: bool
    hidden: bool
