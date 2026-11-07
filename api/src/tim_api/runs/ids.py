"""Counting a run's duplicate ids per column, by the browser's own rule for a row's ``id``.

The browser computes each row's ``id`` from its Id column's value (ADR 0025): a string as it
is, anything else as ``JSON.stringify`` writes it, and none for ``null``, ``""`` or more than
512 UTF-16 code units. ``id_text`` writes the same text from a stored row's value, so a column
the server counts as duplicate-free gives every row a distinct ``id`` in the browser
(ADR 0028).
"""

from __future__ import annotations

import json
import re
from array import array
from collections.abc import Mapping
from typing import Any

MAX_ID_LENGTH = 512

# The largest integer a JavaScript number holds exactly.
_EXACT_INT = 2**53

# Object keys JavaScript lists first, in ascending order: array indices up to 2**32 - 2.
_ARRAY_INDEX = re.compile(r"^(?:0|[1-9][0-9]*)$")
_MAX_ARRAY_INDEX = 2**32 - 2

_LONE_SURROGATE = re.compile(r"[\ud800-\udfff]")


def _utf16_length(text: str) -> int:
    if len(text) * 2 <= MAX_ID_LENGTH:
        return len(text)
    return len(text) + sum(1 for c in text if ord(c) > 0xFFFF)


def _number_text(value: float) -> str:
    """A finite ``value`` as JavaScript writes it (ECMAScript Number::toString)."""
    if value == 0:
        return "0"
    if value < 0:
        return "-" + _number_text(-value)
    # repr gives the shortest digits that round-trip, as JavaScript does.
    mantissa, _, exponent = repr(value).partition("e")
    whole, _, fraction = mantissa.partition(".")
    digits = whole + fraction
    point = len(whole) + (int(exponent) if exponent else 0)
    stripped = digits.lstrip("0")
    point -= len(digits) - len(stripped)
    digits = stripped.rstrip("0")
    k, n = len(digits), point
    if k <= n <= 21:
        return digits + "0" * (n - k)
    if 0 < n <= 21:
        return digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return "0." + "0" * -n + digits
    e = n - 1
    sign = "+" if e >= 0 else "-"
    head = digits if k == 1 else digits[0] + "." + digits[1:]
    return f"{head}e{sign}{abs(e)}"


def _int_text(value: int) -> str:
    if -_EXACT_INT <= value <= _EXACT_INT:
        return str(value)
    # JSON.parse reads a large integer as the nearest double, and one too large for a double as
    # Infinity, which JSON.stringify writes as null.
    try:
        return _number_text(float(value))
    except OverflowError:
        return "null"


def _string_json(value: str) -> str:
    text = json.dumps(value, ensure_ascii=False)
    if _LONE_SURROGATE.search(value) is None:
        return text
    # JSON.stringify escapes a lone surrogate, in lowercase hex.
    return _LONE_SURROGATE.sub(lambda m: f"\\u{ord(m.group()):04x}", text)


def _key_order(key: str) -> tuple[int, int]:
    if _ARRAY_INDEX.match(key) and int(key) <= _MAX_ARRAY_INDEX:
        return (0, int(key))
    return (1, 0)


def _stringify(value: Any) -> str:
    """``value`` as JavaScript's ``JSON.stringify`` writes it."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        return _int_text(value)
    if isinstance(value, float):
        # NaN and the infinities never reach a stored row; JSON.stringify writes them as null.
        return _number_text(value) if value - value == 0 else "null"
    if isinstance(value, str):
        return _string_json(value)
    if isinstance(value, list):
        return "[" + ",".join(_stringify(v) for v in value) + "]"
    if isinstance(value, Mapping):
        # Sorting is stable, so the other keys keep their order.
        keys = sorted(value, key=_key_order)
        return "{" + ",".join(f"{_string_json(k)}:{_stringify(value[k])}" for k in keys) + "}"
    raise TypeError(f"not a JSON value: {type(value).__name__}")


def id_text(value: Any) -> str | None:
    """The ``id`` the browser computes from a stored value, or ``None`` for a value that gives
    no ``id``."""
    if value is None:
        return None
    text = value if isinstance(value, str) else _stringify(value)
    if text == "" or _utf16_length(text) > MAX_ID_LENGTH:
        return None
    return text


class DuplicateCounter:
    """Counts, for each column, the rows whose ``id`` text an earlier row already had.

    While rows are added it keeps only a 64-bit hash of each ``id``. ``duplicates`` then counts
    one column at a time, so only one column's set of hashes is ever in memory. Two different
    ``id``s with the same hash count as a duplicate: about 1 in 37 million for 1M rows.
    """

    def __init__(self) -> None:
        self._hashes: dict[str, array[int]] = {}
        self._counts: dict[str, int] | None = None

    def add(self, name: str, value: Any) -> None:
        text = id_text(value)
        if text is None:
            return
        hashes = self._hashes.get(name)
        if hashes is None:
            hashes = self._hashes[name] = array("q")
        hashes.append(hash(text))

    def duplicates(self) -> Mapping[str, int]:
        """Each column's duplicate count; a column without an ``id`` in any row is absent.
        Counted on the first call, which frees the hashes."""
        if self._counts is None:
            counts: dict[str, int] = {}
            while self._hashes:
                name, hashes = self._hashes.popitem()
                counts[name] = len(hashes) - len(set(hashes))
            self._counts = counts
        return self._counts
