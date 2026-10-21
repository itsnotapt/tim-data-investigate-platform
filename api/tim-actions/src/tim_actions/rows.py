"""How each result row gets its ``id``."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Mapping, Sequence
from typing import Any


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
