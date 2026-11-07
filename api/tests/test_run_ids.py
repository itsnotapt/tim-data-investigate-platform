"""A run's ``id`` text: the browser's rule for a row's ``id``, which the duplicate counts use."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from tim_api.runs.ids import id_text

# Shared with the browser's tests of ``rowId``, so both sides give the same ``id``.
CASES = Path(__file__).parents[2] / "web" / "src" / "features" / "labels" / "idCases.json"


def _cases() -> list[Any]:
    cases: list[dict[str, Any]] = json.loads(CASES.read_text(encoding="utf-8"))["cases"]
    return [pytest.param(c["value"], c["id"], id=repr(c["value"])[:40]) for c in cases]


@pytest.mark.parametrize(("value", "expected"), _cases())
def test_a_value_gives_the_id_the_browser_computes(value: Any, expected: str | None) -> None:
    assert id_text(value) == expected
