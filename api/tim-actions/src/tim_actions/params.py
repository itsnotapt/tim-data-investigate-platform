"""Params: the named, typed values an action takes, declared as data and validated before run."""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from pydantic import JsonValue, StrictBool, TypeAdapter, ValidationError, model_validator
from pydantic.dataclasses import dataclass

from tim_actions._common import STRICT, NonBlankStr

ParamKind = Literal[
    "string", "number", "boolean", "datetime", "timespan", "json", "kql", "sql", "connection"
]


class ParamsError(ValueError):
    """Param values that failed validation. ``errors`` is keyed ``params.<name>``."""

    def __init__(self, errors: dict[str, list[str]]) -> None:
        super().__init__("; ".join(f"{key}: {', '.join(msgs)}" for key, msgs in errors.items()))
        self.errors = errors


PARAM_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
"""A param name: a letter or ``_``, then letters, digits and ``_``."""
# Kinds the tab edits as one value: an editor or a connection pick.
_SINGLE_ONLY: frozenset[str] = frozenset({"kql", "sql", "connection"})


@dataclass(frozen=True, config=STRICT)
class Param:
    """A param an action declares.

    ``default`` and ``choices`` are wire values, as the browser sends them, and are served
    to it unchanged. ``from_columns`` lists the result columns a pivot takes the value from,
    first non-empty one wins. ``schema_from`` names the params that scope a ``kql``/``sql``
    editor's schema.
    """

    name: str
    kind: ParamKind
    title: NonBlankStr | None = None
    required: StrictBool = True
    default: Any = None
    many: StrictBool = False
    choices: tuple[Any, ...] = ()
    connection_type: NonBlankStr | None = None
    schema_from: tuple[NonBlankStr, ...] = ()
    from_columns: tuple[NonBlankStr, ...] = ()
    help: NonBlankStr | None = None

    @model_validator(mode="after")
    def _check(self) -> Param:
        if not PARAM_NAME.match(self.name):
            raise ValueError(
                "name must start with a letter or _ and hold only letters, digits and _"
            )
        if self.kind == "connection" and self.connection_type is None:
            raise ValueError("connection_type is required for kind connection")
        if self.kind != "connection" and self.connection_type is not None:
            raise ValueError("connection_type is only for kind connection")
        if self.kind == "connection" and self.choices:
            raise ValueError(
                "choices are not allowed for kind connection: they are the connections"
            )
        if self.many and self.kind in _SINGLE_ONLY:
            raise ValueError(f"many is not allowed for kind {self.kind}")
        if self.schema_from and self.kind not in ("kql", "sql"):
            raise ValueError("schema_from is only for kind kql or sql")
        for choice in self.choices:
            try:
                _CONVERTERS[self.kind](choice)
            except _Invalid as exc:
                raise ValueError(f"choices: {exc}") from None
        if not _is_missing(self, self.default):
            try:
                _convert(self, self.default, None)
            except _Invalid as exc:
                raise ValueError(f"default: {exc}") from None
        if self.title is None:
            object.__setattr__(self, "title", self.name)
        return self


class _Invalid(ValueError):
    """One value that doesn't fit its kind; the message is shown to the analyst."""


def _string(value: Any) -> str:
    if not isinstance(value, str):
        raise _Invalid("Must be a string")
    return value


_WHOLE_NUMBER = re.compile(r"-?[0-9]+")


def _number(value: Any) -> int | float:
    """A JSON number, or a whole number as a string of digits: the web sends one beyond
    ±(2^53 - 1) as its digits, which a JSON number would round."""
    if isinstance(value, str) and _WHOLE_NUMBER.fullmatch(value):
        return int(value)
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise _Invalid("Must be a number")
    return value


def _boolean(value: Any) -> bool:
    if not isinstance(value, bool):
        raise _Invalid("Must be true or false")
    return value


def _datetime(value: Any) -> datetime:
    """ISO 8601; a value without an offset is UTC."""
    try:
        parsed = datetime.fromisoformat(_string(value))
    except ValueError:
        raise _Invalid("Must be an ISO 8601 datetime") from None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


_TIMEDELTA = TypeAdapter(timedelta)


def _timespan(value: Any) -> timedelta:
    """An ISO 8601 duration (``PT1H30M``) or ``HH:MM:SS``."""
    try:
        return _TIMEDELTA.validate_python(_string(value))
    except (ValidationError, _Invalid):
        raise _Invalid("Must be an ISO 8601 duration or HH:MM:SS") from None


_JSON: TypeAdapter[JsonValue] = TypeAdapter(JsonValue)


def _json(value: Any) -> Any:
    try:
        return _JSON.validate_python(value)
    except ValidationError:
        raise _Invalid("Must be JSON") from None


_CONVERTERS: dict[str, Callable[[Any], Any]] = {
    "string": _string,
    "number": _number,
    "boolean": _boolean,
    "datetime": _datetime,
    "timespan": _timespan,
    "json": _json,
    "kql": _string,
    "sql": _string,
    "connection": _string,
}


def _is_missing(param: Param, value: Any) -> bool:
    if param.many:
        return value is None or value == []
    return value is None or (isinstance(value, str) and not value.strip())


def _convert_one(param: Param, value: Any, connections: Mapping[str, str] | None) -> Any:
    """Convert one value. ``connections`` of ``None`` skips the connection check."""
    converted = _CONVERTERS[param.kind](value)
    if param.choices and converted not in [_CONVERTERS[param.kind](c) for c in param.choices]:
        raise _Invalid("Must be one of: " + ", ".join(str(c) for c in param.choices))
    if (
        param.kind == "connection"
        and connections is not None
        and connections.get(converted) != param.connection_type
    ):
        raise _Invalid(f"No {param.connection_type} connection named {converted}")
    return converted


def _convert(param: Param, value: Any, connections: Mapping[str, str] | None) -> Any:
    if not param.many:
        return _convert_one(param, value, connections)
    if not isinstance(value, list):
        raise _Invalid("Must be a list")
    converted = []
    for position, item in enumerate(value, start=1):
        try:
            converted.append(_convert_one(param, item, connections))
        except _Invalid as exc:
            raise _Invalid(f"Value {position}: {exc}") from None
    return converted


def validate_params(
    params: Sequence[Param],
    values: Mapping[str, Any],
    *,
    connections: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Validate ``values`` against ``params`` and return them converted, keyed by param name.

    ``connections`` maps the instance's connection names to their connection types; a
    ``connection`` param must name one of its ``connection_type``, so without ``connections``
    no value fits it.
    """
    errors: dict[str, list[str]] = {}
    converted: dict[str, Any] = {}
    declared = {param.name for param in params}
    for name in values:
        if name not in declared:
            errors[f"params.{name}"] = ["Unknown param"]
    for param in params:
        value = values.get(param.name)
        if _is_missing(param, value):
            value = param.default
        if _is_missing(param, value):
            if param.required:
                errors[f"params.{param.name}"] = ["Required"]
            else:
                converted[param.name] = None
            continue
        try:
            converted[param.name] = _convert(param, value, connections or {})
        except _Invalid as exc:
            errors[f"params.{param.name}"] = [str(exc)]
    if errors:
        raise ParamsError(errors)
    return converted
