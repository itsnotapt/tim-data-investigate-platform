"""Building a run's stored rows, columns and row count while ``run`` yields rows.

PostgreSQL JSONB and TEXT cannot store U+0000, so NUL characters in rows, details and
error text are replaced with U+FFFD before storing (``sanitise_nul``).
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any

import pydantic_core
from tim_actions import TIM_COLUMNS, Column, ColumnType

from tim_api.runs.models import RunColumn, RunRow

NUL_REPLACEMENT = "�"

_ISO_DATE = re.compile(
    r"^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$"
)


def sanitise_nul(value: Any) -> Any:
    """Replace U+0000 with U+FFFD in every string (keys and values) of a JSON-like value.

    Containers without a NUL are returned as is (no copy), so a large clean result is not
    duplicated in memory.
    """
    if isinstance(value, str):
        return value.replace("\x00", NUL_REPLACEMENT) if "\x00" in value else value
    if isinstance(value, dict):
        items = [(sanitise_nul(k), sanitise_nul(v)) for k, v in value.items()]
        if all(nk is k and nv is v for (nk, nv), (k, v) in zip(items, value.items(), strict=True)):
            return value
        return dict(items)
    if isinstance(value, list):
        new = [sanitise_nul(v) for v in value]
        if all(n is o for n, o in zip(new, value, strict=True)):
            return value
        return new
    return value


def to_json_value(value: Any) -> Any:
    """``value`` as JSON: datetimes and durations as ISO 8601, NaN and infinities as ``null``."""
    return pydantic_core.to_jsonable_python(value, inf_nan_mode="null")


class ResultLimitError(Exception):
    """The result went over the row or byte cap; the message names the limit."""


class RunNotSucceededError(Exception):
    """Rows were asked for of a run that hasn't succeeded."""


class ResultsGoneError(Exception):
    """A succeeded run's rows are no longer stored, after crash recovery or a failover."""


def _is_iso_date(value: str) -> bool:
    if not _ISO_DATE.match(value):
        return False
    try:
        datetime.fromisoformat(value)
    except ValueError:
        return False
    return True


def _type_of(value: Any) -> ColumnType | None:
    """The column type a JSON value suggests; ``None`` for ``null``, which suggests none."""
    if value is None:
        return None
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int | float):
        return "number"
    if isinstance(value, str):
        return "datetime" if _is_iso_date(value) else "string"
    return "json"


def _bigint_value(value: Any) -> Any:
    """A ``bigint`` column's value as TIM serves it: a whole number as its digits, anything
    else as it is."""
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    return value


class ResultBuilder:
    """Turns each row ``run`` yields into a stored row, and keeps the row count, the bytes
    (compact JSON per row, summed) and the columns: declared ones first, then the rest in
    first-seen order with their types inferred. A declared ``tim:`` column only sets up TIM's own
    grid column, so it is not one of the run's columns.

    Not thread-safe: one worker thread calls ``add`` and ``declare``.
    """

    def __init__(
        self,
        declared: Sequence[Column] | None,
        *,
        max_rows: int,
        max_bytes: int,
    ) -> None:
        self._declared: dict[str, ColumnType] = {}
        self.declare(declared or ())
        self._inferred: dict[str, ColumnType | None] = {}
        self._max_rows = max_rows
        self._max_bytes = max_bytes
        self.row_count = 0
        self.byte_count = 0

    def declare(self, columns: Sequence[Column]) -> None:
        """Columns the run declares, after the action's own; a name already declared keeps
        its first declaration."""
        for column in columns:
            if column.name not in TIM_COLUMNS:
                self._declared.setdefault(column.name, column.type)

    def add(self, row: Mapping[str, Any]) -> RunRow:
        if not isinstance(row, Mapping):
            raise TypeError(f"run yielded a {type(row).__name__}, not a mapping")
        if self.row_count >= self._max_rows:
            raise ResultLimitError(f"Result exceeds limit of {self._max_rows} rows")
        encoded = pydantic_core.to_json(dict(row), inf_nan_mode="null")
        self.byte_count += len(encoded)
        if self.byte_count > self._max_bytes:
            raise ResultLimitError(f"Result exceeds limit of {self._max_bytes} bytes")
        data: dict[str, Any] = sanitise_nul(pydantic_core.from_json(encoded))
        for name, value in data.items():
            if self._declared.get(name) == "bigint":
                data[name] = _bigint_value(value)
            self._infer(name, value)
        stored = RunRow(row=self.row_count, data=data)
        self.row_count += 1
        return stored

    def _infer(self, name: str, value: Any) -> None:
        if name in self._inferred:
            current = self._inferred[name]
            if current == "string":
                return
            found = _type_of(value)
            if found is None or found == current:
                return
            self._inferred[name] = found if current is None else "string"
        else:
            self._inferred[name] = _type_of(value)

    def columns(self) -> list[RunColumn]:
        declared = [RunColumn(name=n, type=t, declared=True) for n, t in self._declared.items()]
        inferred = [
            RunColumn(name=n, type=t or "string", declared=False)
            for n, t in self._inferred.items()
            if n not in self._declared
        ]
        return declared + inferred
