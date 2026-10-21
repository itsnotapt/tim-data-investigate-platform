"""``GET /api/instance``: what the browser needs to know about this instance."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field, JsonValue
from tim_actions import ParamKind

from tim_api.models_common import ApiModel


def _omitted() -> Any:
    """An optional key, left out of the JSON when it has no value."""
    return Field(default=None, exclude_if=lambda value: value is None)


class CatalogueParam(ApiModel):
    """A param of an action, as the tab builds its form from it."""

    name: str
    title: str
    kind: ParamKind
    required: bool
    default: JsonValue = _omitted()
    many: bool
    choices: list[JsonValue] | None = _omitted()
    connection_type: str | None = _omitted()
    from_columns: list[str] | None = _omitted()
    schema_from: list[str] | None = _omitted()
    help: str | None = _omitted()


class CataloguePivot(ApiModel):
    """How an action is offered in the grid's context menu: on one row or several, when the row
    has one column from each group of alternatives."""

    rows: Literal["row", "rows"]
    columns: list[list[str]]


class CatalogueAction(ApiModel):
    key: str
    kind: Literal["query"]
    name: str
    description: str | None = _omitted()
    menu_path: list[str]
    connections: list[str]
    params: list[CatalogueParam]
    pivot: CataloguePivot | None


class InstanceConnection(ApiModel):
    """A connection as the browser sees it: never its endpoint or auth."""

    name: str
    type: str
    title: str
    editor: str | None = None
    databases: list[str] | None = _omitted()


class InstanceLabel(ApiModel):
    key: str
    name: str
    colour: str
    symbol: str | None = _omitted()


class Limits(ApiModel):
    max_result_rows: int
    max_result_bytes: int
    run_timeout_seconds: int


class Instance(ApiModel):
    """``version`` changes whenever anything else here, or an installed provider, does."""

    version: str
    actions: list[CatalogueAction]
    connections: list[InstanceConnection]
    labels: list[InstanceLabel]
    limits: Limits
