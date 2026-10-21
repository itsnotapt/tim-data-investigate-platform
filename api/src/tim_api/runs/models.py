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


class StartRun(ApiModel):
    """Body of ``POST /api/runs``. The params are validated against the action's."""

    action: str
    params: dict[str, JsonValue] = Field(default_factory=dict)


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

    ``params`` are the resolved params. ``details`` holds TIM's ``duration`` (seconds) and
    ``rowCount`` first, then the action's own, in the order they were reported. ``columns`` and
    ``rowCount`` are set once the run succeeds; ``error`` is a message safe to show.
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
    """One result row. ``row`` is its row number, unique within the run; ``id`` is what it is
    annotated by, and may repeat."""

    row: int
    id: str | None
    data: dict[str, JsonValue]


class RowsPage(ApiModel):
    """``lastRow`` is the run's row count."""

    rows: list[RunRow]
    last_row: int
