"""How each result row gets its ``id``."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Mapping, Sequence
from typing import Any

import pydantic_core

MAX_ID_CHARS = 512
"""The longest ``id`` TIM stores; a row with a longer one gets no ``id``."""


class RowId(ABC):
    """Gives each row its ``id``. TIM stores ``None`` and ``""`` as no ``id``.

    ``columns`` are the result columns it reads: each one missing from the results adds a
    ``warning`` run detail, and never fails the run.
    """

    columns: tuple[str, ...] = ()

    @abstractmethod
    def __call__(self, row: Mapping[str, Any]) -> Any:
        """The row's ``id``, or ``None``."""


class IdColumns(RowId):
    """The first non-empty value of ``columns``, skipping ``None`` and ``""``."""

    def __init__(self, columns: Sequence[str]) -> None:
        self.columns = tuple(columns)

    def __call__(self, row: Mapping[str, Any]) -> Any:
        for column in self.columns:
            value = row.get(column)
            if value is not None and value != "":
                return value
        return None


def canonical_id(value: Any) -> str | None:
    """An ``id`` in the text form TIM stores: a string as is, anything else as its compact JSON
    text (so the number ``1`` and the string ``"1"`` match). ``None`` and ``""`` are no ``id``."""
    value = pydantic_core.to_jsonable_python(value, inf_nan_mode="null")
    if value is None or value == "":
        return None
    if isinstance(value, str):
        return value
    return pydantic_core.to_json(value).decode()


def id_warnings(row_id: RowId | None, columns: Sequence[str], long_ids: int) -> list[str]:
    """The ``warning`` run details a run's ids give: ``row_id``'s columns missing from the
    result ``columns``, when it has any, and the number of rows whose ``id`` was too long."""
    found: list[str] = []
    if row_id is not None and columns:
        missing = [c for c in row_id.columns if c not in columns]
        if len(missing) == 1:
            found.append(f"Id column {missing[0]} not in results")
        elif missing:
            found.append(f"Id columns {', '.join(missing)} not in results")
    if long_ids:
        found.append(f"{long_ids} row(s) have an id over {MAX_ID_CHARS} characters and get no id")
    return found
