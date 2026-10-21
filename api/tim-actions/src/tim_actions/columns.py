"""Columns an action, or a run, declares for its results."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field, StrictBool, StrictInt
from pydantic.dataclasses import dataclass

from tim_actions._common import STRICT, NonBlankStr

ColumnType = Literal["string", "number", "boolean", "datetime", "timespan", "json"]


@dataclass(frozen=True, config=STRICT)
class Column:
    """A declared result column, with the grid's initial settings for it. ``calculated`` is an AG
    Grid calculated-column expression, such as ``[Bytes] / 1024``: the grid computes the column
    from the row's other columns."""

    name: NonBlankStr
    type: ColumnType
    title: NonBlankStr | None = None
    hidden: StrictBool = False
    width: Annotated[StrictInt, Field(gt=0)] | None = None
    pinned: Literal["left", "right"] | None = None
    sort: Literal["asc", "desc"] | None = None
    group: StrictBool = False
    calculated: NonBlankStr | None = None
