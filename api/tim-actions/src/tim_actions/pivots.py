"""Pivots: an action's params resolved from the result rows an analyst selected."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from tim_actions.action import Action
    from tim_actions.params import Param


@dataclass(frozen=True)
class PivotCell:
    """The cell the analyst right-clicked."""

    column: str
    value: Any


@dataclass(frozen=True)
class PivotContext:
    """What a pivot resolves params from: the selected rows, each holding only the columns the
    action declared for pivots, and the cell the analyst right-clicked."""

    rows: Sequence[Mapping[str, Any]]
    cell: PivotCell | None = None


@dataclass(frozen=True)
class Resolved:
    """A pivot's params, as wire values, and the params it couldn't fill. ``missing`` maps each
    such param's name to why, or ``None`` when the rows simply have no value for it."""

    params: dict[str, Any] = field(default_factory=dict)
    missing: dict[str, str | None] = field(default_factory=dict)


def first_value(row: Mapping[str, Any], columns: Sequence[str]) -> Any:
    """The first non-empty value of ``columns`` in ``row``: ``None`` and ``""`` are empty."""
    return next((row[c] for c in columns if row.get(c) is not None and row.get(c) != ""), None)


def _distinct(values: Sequence[Any]) -> list[Any]:
    """The values in first-seen order, each once. Values may be unhashable (JSON)."""
    seen: list[Any] = []
    for value in values:
        if value not in seen:
            seen.append(value)
    return seen


def resolve_from_columns(params: Sequence[Param], context: PivotContext) -> Resolved:
    """The default ``resolve()``: each param with ``from_columns`` takes the first non-empty of
    them in each row. A ``many`` param takes the distinct values; a single-valued one takes the
    value the rows agree on, and is missing when they disagree. A required param left without a
    value or a default is missing."""
    resolved = Resolved()
    for param in params:
        values = _distinct(
            [
                value
                for row in context.rows
                if (value := first_value(row, param.from_columns)) is not None
            ]
        )
        if values and param.many:
            resolved.params[param.name] = values
        elif len(values) == 1:
            resolved.params[param.name] = values[0]
        elif values:
            resolved.missing[param.name] = (
                f"The {len(context.rows)} selected rows have different {param.title} values"
            )
        elif param.required and param.default is None:
            resolved.missing[param.name] = None
    return resolved


def pivot_input_columns(action: Action) -> set[str]:
    """The columns a pivot into ``action`` reads: those of ``pivot_columns()`` and each param's
    ``from_columns``."""
    columns = {column for group in action.pivot_columns() for column in group}
    return columns.union(*(param.from_columns for param in action.params))


def pivot_refusal(action: Action, rows: int) -> str | None:
    """Why ``action`` isn't offered on ``rows`` selected rows: it is no pivot, or takes one row
    and several are selected. ``None`` when it is offered."""
    if action.pivot == "none":
        return "Not offered as a pivot"
    if action.pivot == "row" and rows > 1:
        return "Takes one row"
    return None


def resolve_pivot(
    action: Action, rows: Sequence[Mapping[str, Any]], cell: PivotCell | None = None
) -> Resolved:
    """Resolve a pivot into ``action`` from ``rows`` and the right-clicked ``cell``. Its
    ``resolve()`` sees only the columns the action declared for pivots."""
    columns = pivot_input_columns(action)
    trimmed = [{name: value for name, value in row.items() if name in columns} for row in rows]
    return action.resolve(
        PivotContext(rows=trimmed, cell=cell if cell and cell.column in columns else None)
    )
