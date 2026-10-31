"""``/api/runs``: runs of an action and their rows."""

from __future__ import annotations

from enum import StrEnum
from uuid import UUID

from pydantic import Field, JsonValue
from tim_actions import ColumnType, DetailValue

from tim_api.models_common import ApiModel, UtcDatetime, omitted


class RunStatus(StrEnum):
    """A run waiting for a concurrency slot is ``running`` too."""

    RUNNING = "running"
    SUCCEEDED = "succeeded"
    ERROR = "error"
    TIMED_OUT = "timedOut"
    CANCELLED = "cancelled"


class InputColumn(ApiModel):
    name: str = Field(min_length=1)
    type: ColumnType


class SinkInput(ApiModel):
    """The rows a sink writes, each a row's ``data``, and their columns."""

    columns: list[InputColumn]
    rows: list[dict[str, JsonValue]]


class StartRun(ApiModel):
    """Body of ``POST /api/runs``. The params are validated against the action's; ``input`` is
    for a sink, and only a sink."""

    action: str
    params: dict[str, JsonValue] = Field(default_factory=dict)
    input: SinkInput | None = None


class RunAction(ApiModel):
    key: str
    name: str


class RunColumn(ApiModel):
    """A result column: ``declared`` by the action or the run, else inferred from the rows."""

    name: str
    type: ColumnType
    declared: bool


class Run(ApiModel):
    """A run without its rows. Server-produced only, never a request.

    ``params`` are the resolved params, ``{}`` for a sink. ``details`` holds TIM's ``duration``
    (seconds) and ``rowCount`` first, or a sink's ``duration`` and ``inputRowCount``, then the
    action's own, in the order they were reported. ``columns`` and ``rowCount`` are set once a
    query action's run succeeds, never for a sink; ``error`` is a message safe to show.
    """

    run_id: UUID
    status: RunStatus
    action: RunAction
    params: dict[str, JsonValue]
    owner: str
    started_at: UtcDatetime
    finished_at: UtcDatetime | None = omitted()
    expires_at: UtcDatetime
    details: dict[str, DetailValue] = Field(default_factory=dict)
    columns: list[RunColumn] | None = omitted()
    row_count: int | None = omitted()
    error: str | None = omitted()


class RunRow(ApiModel):
    """One result row. ``row`` is its row number, unique within the run."""

    row: int
    data: dict[str, JsonValue]


class RowsPage(ApiModel):
    """``lastRow`` is the run's row count."""

    rows: list[RunRow]
    last_row: int
