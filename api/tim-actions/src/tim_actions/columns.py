"""Columns an action, or a run, declares for its results."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field, StrictBool, StrictInt, ValidationInfo, field_validator
from pydantic.dataclasses import dataclass

from tim_actions._common import STRICT, NonBlankStr

ColumnType = Literal["string", "number", "boolean", "datetime", "timespan", "json"]

TIM_COLUMNS = ("tim:label", "tim:tags", "tim:commentText", "tim:comments")
"""TIM's own grid columns. A declared one only gives the grid its settings: it holds no data and
is not one of the run's columns."""


@dataclass(frozen=True, config=STRICT)
class Column:
    """A declared result column, with the grid's initial settings for it. ``calculated`` is an AG
    Grid calculated-column expression, such as ``[Bytes] / 1024``: the grid computes the column
    from the row's other columns. A ``tim:`` name declares settings of one of TIM's own columns
    (``TIM_COLUMNS``)."""

    name: NonBlankStr
    type: ColumnType
    title: NonBlankStr | None = None
    hidden: StrictBool = False
    width: Annotated[StrictInt, Field(gt=0)] | None = None
    pinned: Literal["left", "right"] | None = None
    sort: Literal["asc", "desc"] | None = None
    group: StrictBool = False
    calculated: NonBlankStr | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        if value.startswith("tim:") and value not in TIM_COLUMNS:
            raise ValueError(
                f"TIM's own columns are {', '.join(TIM_COLUMNS[:-1])} and {TIM_COLUMNS[-1]}"
            )
        return value

    @field_validator("calculated")
    @classmethod
    def _calculated(cls, value: str | None, info: ValidationInfo) -> str | None:
        if value is not None and str(info.data.get("name", "")).startswith("tim:"):
            raise ValueError("TIM's own columns can't be calculated")
        return value
