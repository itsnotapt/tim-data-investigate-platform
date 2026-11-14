"""Title templates: plain text with ``{…}`` placeholders, which the browser fills in (ADR 0029)."""

from __future__ import annotations

import json
import re
from collections.abc import Collection, Mapping
from typing import Any

_PLACEHOLDER = re.compile(r"\{([^{}]*)\}")
"""Each ``{…}`` placeholder of a title template, capturing what it names."""


def title_errors(title: str, names: Collection[str]) -> list[str]:
    """One error per placeholder of ``title`` that names nothing: none of ``names``, nor ``row.``
    and a column."""
    return [
        f"{{{name}}} names nothing"
        for name in _PLACEHOLDER.findall(title)
        if name not in names and not (name.startswith("row.") and name != "row.")
    ]


def _text(value: Any) -> str:
    """A value as a title shows it: a string as it is, anything else as JSON."""
    if isinstance(value, str):
        return value
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def _shown(value: Any) -> str:
    """A value in a title: an unset one as ``<not set>``, a list as ``[a]``, ``[a, b]`` or
    ``[a, b, … +N]``, anything else as ``_text`` shows it."""
    if value is None or value == "" or value == []:
        return "<not set>"
    if not isinstance(value, list):
        return _text(value)
    shown = [_text(each) for each in value[:2]]
    if len(value) > 2:
        shown.append(f"… +{len(value) - 2}")
    return f"[{', '.join(shown)}]"


def fill_title(title: str, values: Mapping[str, Any]) -> str:
    """``title`` with each placeholder that names one of ``values`` replaced by the value, shown
    as the browser shows it; the other placeholders stay."""
    return _PLACEHOLDER.sub(
        lambda match: _shown(values[match[1]]) if match[1] in values else match[0], title
    )
