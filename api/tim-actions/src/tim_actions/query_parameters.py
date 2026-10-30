"""Query parameters: the ``parameters`` param of an action that runs the analyst's query,
``[{name, type, value}]``, in order, each typed with one of the types its connection takes."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, ClassVar, cast

from tim_actions.action import Action, Pivot, QueryParameter, QueryParameterType
from tim_actions.params import PARAM_NAME, Param, ParamKind, ParamsError, validate_params

QUERY_PARAMETER_TYPES: Mapping[QueryParameterType, ParamKind] = {
    "string": "string",
    "long": "number",
    "real": "number",
    "bool": "boolean",
    "datetime": "datetime",
    "timespan": "timespan",
    "dynamic": "json",
}
"""Every type a query parameter can be, each with the param kind of its value. A connection type
takes some of them."""


@dataclass(frozen=True)
class CheckedParameter:
    """A ``parameters`` entry, checked: a param with its name and the kind of its type, the type,
    and the value converted for the kind (a ``long`` is an ``int``)."""

    param: Param
    type: QueryParameterType
    value: Any


def check_declared(
    declared: Sequence[tuple[Any, Any]], types: Mapping[QueryParameterType, ParamKind]
) -> None:
    """Raises ``ParamsError`` keyed ``params.parameters`` when a ``(name, type)`` of ``declared``
    has a name that isn't a valid or unique query parameter name, or a type not in ``types``."""
    problems: list[str] = []
    names: list[str] = [str(name) for name, _ in declared]
    for name, type_ in declared:
        if not isinstance(name, str) or not PARAM_NAME.match(name):
            problems.append(
                f"{name}: name must start with a letter or _ and hold only letters, digits and _"
            )
        elif names.count(name) > 1:
            problems.append(f"{name}: names must be unique")
        elif type_ not in types:
            problems.append(f"{name}: type must be one of {', '.join(types)}")
    if problems:
        raise ParamsError({"params.parameters": list(dict.fromkeys(problems))})


def checked_parameters(
    entries: Any, types: Mapping[QueryParameterType, ParamKind]
) -> list[CheckedParameter]:
    """``parameters``, ``[{name, type, value}]``, checked against ``types``, each type with the
    param kind of its value, in order. Raises ``ParamsError`` keyed ``params.parameters`` when the
    list is malformed, and ``params.parameters.<name>`` when a value doesn't fit its type."""
    if entries is None:
        return []
    if not isinstance(entries, list) or not all(
        isinstance(entry, dict) and set(entry) == {"name", "type", "value"} for entry in entries
    ):
        raise ParamsError({"params.parameters": ["Must be a list of {name, type, value}"]})
    check_declared([(entry["name"], entry["type"]) for entry in entries], types)
    params = [Param(entry["name"], types[entry["type"]]) for entry in entries]
    values = {entry["name"]: entry["value"] for entry in entries}
    errors: dict[str, list[str]] = {}
    try:
        converted = validate_params(params, values)
    except ParamsError as exc:
        errors = {
            f"params.parameters.{key.removeprefix('params.')}": m for key, m in exc.errors.items()
        }
        converted = {}
    for entry in entries:
        value = converted.get(entry["name"])
        if entry["type"] == "long" and value is not None:
            if isinstance(value, float) and not value.is_integer():
                errors[f"params.parameters.{entry['name']}"] = ["Must be a whole number"]
            else:
                converted[entry["name"]] = int(value)
    if errors:
        raise ParamsError(errors)
    return [
        CheckedParameter(param, entry["type"], converted.get(param.name))
        for param, entry in zip(params, entries, strict=True)
    ]


def params_and_values(entries: Sequence[CheckedParameter]) -> tuple[list[Param], dict[str, Any]]:
    """The params of checked ``parameters`` entries, in order, and their values by param name."""
    return [e.param for e in entries], {e.param.name: e.value for e in entries}


@dataclass(frozen=True)
class PresetFileParams:
    """The params of the action file of a preset with query parameters, in their order, and how
    it pivots."""

    params: tuple[Param, ...]
    pivot: Pivot


def preset_file_params(
    query_parameters: Sequence[QueryParameter], types: Mapping[QueryParameterType, ParamKind]
) -> PresetFileParams | None:
    """Each query parameter of a preset as a param, in order: a fixed one with its value as the
    default, a From row one with its columns. A ``dynamic`` one is a ``json`` param, ``many``
    unless its fixed value is not a list. Like the preset, it pivots on ``rows`` when every From
    row query parameter has columns. ``None`` when a type isn't one of ``types``."""
    if any(p.type not in types for p in query_parameters):
        return None
    params = []
    for p in query_parameters:
        kind = types[p.type]
        many = p.type == "dynamic" and (p.from_columns is not None or isinstance(p.value, list))
        if p.from_columns is None:
            params.append(Param(p.name, kind, many=many, default=p.value))
        else:
            params.append(Param(p.name, kind, many=many, from_columns=p.from_columns))
    from_row = [p.from_columns for p in query_parameters if p.from_columns is not None]
    return PresetFileParams(tuple(params), "rows" if from_row and all(from_row) else "none")


class TakesQueryParameters(Action):
    """An action whose ``parameters`` param holds query parameters of ``parameter_types``."""

    parameter_types: ClassVar[Mapping[QueryParameterType, ParamKind]]
    """The types a query parameter can be, each with the param kind of its value."""

    def check_params(
        self, values: Mapping[str, Any], *, connections: Mapping[str, str] | None = None
    ) -> dict[str, Any]:
        """The params' own checks, and those of each ``parameters`` entry."""
        errors: dict[str, list[str]] = {}
        checked: dict[str, Any] = {}
        try:
            checked = super().check_params(values, connections=connections)
        except ParamsError as exc:
            errors = exc.errors
        try:
            self.parameter_entries(values)
        except ParamsError as exc:
            errors |= exc.errors
        if errors:
            raise ParamsError(errors)
        return checked

    def declared_query_parameters(
        self, declared: Sequence[tuple[str, str]]
    ) -> list[QueryParameter]:
        """``declared``, each a name and a type, as query parameters without values; raises
        ``ParamsError`` as ``check_declared`` does, by this action's ``parameter_types``."""
        check_declared(declared, self.parameter_types)
        return [QueryParameter(name, cast(QueryParameterType, type_)) for name, type_ in declared]

    def declare_statement(self, query_parameters: Sequence[QueryParameter]) -> str:
        """The statement that declares ``query_parameters`` before the query, by name and type,
        as it runs and is shown above the query; empty when the query declares nothing, as by
        default."""
        return ""

    def parameter_entries(self, values: Mapping[str, Any]) -> list[CheckedParameter]:
        """The ``parameters`` entries of ``values``, checked; raises ``ParamsError``."""
        return checked_parameters(values.get("parameters"), self.parameter_types)

    def preset_file_params(
        self,
        params: Mapping[str, Any],
        query_parameters: Sequence[QueryParameter],
        required: Sequence[str],
    ) -> PresetFileParams | None:
        """The params of the action file of a preset (``preset_file_params``), by this action's
        ``parameter_types``; ``None`` when a ``required`` param of the preset isn't a non-empty
        string or a query parameter's type isn't one of them."""
        if not all(isinstance(params.get(n), str) and params[n] for n in required):
            return None
        return preset_file_params(query_parameters, self.parameter_types)
