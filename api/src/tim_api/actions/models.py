"""``GET /api/instance``: what the browser needs to know about this instance; and
``POST /api/actions/{key}/resolve``: a pivot's params."""

from __future__ import annotations

from typing import Literal

from pydantic import Field, JsonValue
from tim_actions import ColumnType, ParamKind
from tim_actions.labels_file import LabelColour, LabelSymbol

from tim_api.models_common import ApiModel, omitted


class CatalogueParam(ApiModel):
    """A param of an action, as the tab builds its form from it."""

    name: str
    title: str
    kind: ParamKind
    required: bool
    default: JsonValue = omitted()
    many: bool
    choices: list[JsonValue] | None = omitted()
    connection_type: str | None = omitted()
    from_columns: list[str] | None = omitted()
    schema_from: list[str] | None = omitted()
    help: str | None = omitted()


class CataloguePivot(ApiModel):
    """How an action is offered in the grid's context menu: on one row or several, when the row
    has one column from each group of alternatives."""

    rows: Literal["row", "rows"]
    columns: list[list[str]]


class CatalogueColumn(ApiModel):
    """A column the action declares, with the grid's initial settings for it."""

    name: str
    type: ColumnType
    title: str | None = omitted()
    hidden: bool
    width: int | None = omitted()
    pinned: Literal["left", "right"] | None = omitted()
    sort: Literal["asc", "desc"] | None = omitted()
    group: bool
    calculated: str | None = omitted()


class CatalogueAction(ApiModel):
    key: str
    kind: Literal["query"]
    name: str
    description: str | None = omitted()
    menu_path: list[str]
    connections: list[str]
    params: list[CatalogueParam]
    pivot: CataloguePivot | None
    columns: list[CatalogueColumn] | None = omitted()
    action_file: bool
    """Whether a preset of this action has an action file, from
    ``GET /api/presets/{presetId}/actionFile``."""


class InstanceConnection(ApiModel):
    """A connection as the browser sees it: never its endpoint or auth."""

    name: str
    type: str
    title: str
    editor: str | None = None
    databases: list[str] | None = omitted()


class InstanceLabel(ApiModel):
    """A label from the labels file: ``colour`` and ``symbol`` name ones the browser draws."""

    key: str
    name: str
    colour: LabelColour
    symbol: LabelSymbol | None = omitted()


class Limits(ApiModel):
    max_result_rows: int
    max_result_bytes: int
    max_pivot_rows: int
    rows_page_size: int
    run_timeout_seconds: int
    max_annotation_ids: int
    annotation_poll_seconds: int


class Instance(ApiModel):
    """``version`` changes whenever anything else here, or an installed provider, does."""

    version: str
    actions: list[CatalogueAction]
    connections: list[InstanceConnection]
    labels: list[InstanceLabel]
    limits: Limits


class PivotCell(ApiModel):
    """The cell the analyst right-clicked."""

    column: str
    value: JsonValue


class PivotRows(ApiModel):
    """The selected rows, by value, each trimmed to the action's pivot columns."""

    rows: list[dict[str, JsonValue]] = Field(min_length=1)
    cell: PivotCell | None = omitted()


class ResolvePivot(ApiModel):
    """Body of ``POST /api/actions/{key}/resolve``."""

    pivot: PivotRows


class PivotResolution(ApiModel):
    """A pivot's params, as wire values, and the params it couldn't fill.
    ``reasons`` says why for those that have a reason, such as rows that disagree."""

    params: dict[str, JsonValue]
    missing: list[str]
    reasons: dict[str, str]
