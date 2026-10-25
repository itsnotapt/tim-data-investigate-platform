"""``storm_summary``: an action type whose pivot needs code, not just ``from_columns``."""

from __future__ import annotations

from collections.abc import Iterator, Mapping, Sequence
from datetime import datetime
from typing import Any, Self

from pydantic import field_validator
from tim_actions import (
    Action,
    ActionDocument,
    ConnectionName,
    Param,
    PivotContext,
    Resolved,
    RowId,
    RunContext,
    RunError,
)
from tim_actions.files import DocumentBase
from tim_actions.kusto import KustoHook, query_parameters

KQL = """\
declare query_parameters(states: dynamic, since: datetime, until: datetime);
StormEvents
| where State in (states) and StartTime between (since .. until)
| summarize Events = count(), Deaths = sum(DeathsDirect + DeathsIndirect),
    Damage = sum(DamageProperty + DamageCrops) by State, EventType
| order by State asc, Events desc
"""

PARAMS = (
    Param("states", "string", title="States", many=True, from_columns=("State",)),
    Param("since", "datetime", title="Since"),
    Param("until", "datetime", title="Until"),
)


def _instant(value: str) -> datetime:
    return datetime.fromisoformat(value)


class _SummaryId(RowId):
    """A summary row's state and event type, with the run's window: an annotation on a row
    stays with the window it counted."""

    columns = ("State", "EventType")

    def __init__(self, since: datetime, until: datetime) -> None:
        self.window = (since, until)

    def __call__(self, row: Mapping[str, Any]) -> Any:
        if row.get("State") is None or row.get("EventType") is None:
            return None
        return (row["State"], row["EventType"], *self.window)


class StormSummaryFile(ActionDocument):
    """A ``storm_summary`` action in an action file: the Kusto connection and database holding
    ``StormEvents``. The params are the action type's own."""

    connection: ConnectionName
    database: str

    @field_validator("params")
    @classmethod
    def _no_params(cls, value: tuple[Param, ...]) -> tuple[Param, ...]:
        if value:
            raise ValueError("storm_summary declares its own params")
        return value


class StormSummary(Action):
    """Storm events counted by state and event type over a time window."""

    type_name = "storm_summary"
    File = StormSummaryFile

    params: Sequence[Param] = PARAMS
    connection: ConnectionName
    database: str

    @classmethod
    def from_file(cls, file: DocumentBase) -> Self:
        """The file's fields, keeping the action type's params."""
        return cls.model_validate(
            {name: value for name, value in file if name not in ("type", "params")}
        )

    def connections(self) -> Mapping[str, str]:
        return {self.connection: "kusto"}

    def pivot_columns(self) -> list[list[str]]:
        """Offered on rows with a state, a start and an end; a pivot sees only these
        columns."""
        return [["State"], ["StartTime"], ["EndTime"]]

    def resolve(self, context: PivotContext) -> Resolved:
        """The selected rows' states, from the earliest ``StartTime`` to the latest
        ``EndTime``."""
        resolved = super().resolve(context)
        starts = [row["StartTime"] for row in context.rows if row.get("StartTime")]
        ends = [row["EndTime"] for row in context.rows if row.get("EndTime")]
        if starts:
            resolved.params["since"] = min(starts, key=_instant)
            resolved.missing.pop("since", None)
        if ends:
            resolved.params["until"] = max(ends, key=_instant)
            resolved.missing.pop("until", None)
        return resolved

    def row_id(self, params: Mapping[str, Any]) -> RowId:
        return _SummaryId(params["since"], params["until"])

    def run(self, params: Mapping[str, Any], ctx: RunContext) -> Iterator[Mapping[str, Any]]:
        hook = ctx.hook(self.connection)
        if not isinstance(hook, KustoHook):
            raise RunError(f"{self.connection} is not a Kusto connection")
        result = hook.query(
            self.database,
            KQL,
            deadline=ctx.deadline,
            parameters=query_parameters(self.params, params),
        )
        ctx.declare_columns(result.columns)
        yield from result.rows
