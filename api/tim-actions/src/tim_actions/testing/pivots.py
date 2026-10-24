"""Pivots, as TIM's resolve endpoint makes them."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from tim_actions import pivots
from tim_actions.action import Action
from tim_actions.pivots import PivotCell, Resolved


class PivotRefused(ValueError):
    """TIM doesn't offer the action on the selected rows; the message says why."""


def resolve_pivot(
    action: Action, rows: Sequence[Mapping[str, Any]], cell: PivotCell | None = None
) -> Resolved:
    """Resolve a pivot into ``action`` from the selected ``rows`` and the right-clicked
    ``cell``. Raises ``PivotRefused`` when the action isn't offered on the rows: it is no pivot,
    or takes one row and several are selected. The instance's limit on selected rows isn't
    checked."""
    refusal = pivots.pivot_refusal(action, len(rows))
    if refusal is not None:
        raise PivotRefused(refusal)
    return pivots.resolve_pivot(action, rows, cell)
