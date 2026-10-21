"""Param validation and conversion, through the package's public exports."""

from datetime import UTC, datetime, timedelta

import pytest

from tim_actions import Param, ParamKind, ParamsError, validate_params


def errors_of(params: list[Param], values: dict[str, object]) -> dict[str, list[str]]:
    with pytest.raises(ParamsError) as caught:
        validate_params(params, values)
    return caught.value.errors


def test_a_required_param_without_a_value_is_an_error_keyed_by_its_name() -> None:
    assert errors_of([Param("user", "string")], {}) == {"params.user": ["Required"]}


def test_a_valid_string_passes_through() -> None:
    assert validate_params([Param("user", "string")], {"user": "alice"}) == {"user": "alice"}


@pytest.mark.parametrize(
    ("kind", "value", "expected"),
    [
        ("string", "alice", "alice"),
        ("kql", "T | take 1", "T | take 1"),
        ("sql", "SELECT 1", "SELECT 1"),
        ("number", 3, 3),
        ("number", 2.5, 2.5),
        ("boolean", False, False),
        ("datetime", "2026-10-20T08:00:00+02:00", datetime(2026, 10, 20, 6, 0, tzinfo=UTC)),
        ("datetime", "2026-10-20T08:00:00Z", datetime(2026, 10, 20, 8, 0, tzinfo=UTC)),
        ("datetime", "2026-10-20T08:00:00", datetime(2026, 10, 20, 8, 0, tzinfo=UTC)),
        ("timespan", "PT1H30M", timedelta(hours=1, minutes=30)),
        ("timespan", "01:30:00", timedelta(hours=1, minutes=30)),
        ("json", {"a": [1, None]}, {"a": [1, None]}),
        ("json", [], []),
    ],
)
def test_each_kind_converts_its_wire_value(
    kind: ParamKind, value: object, expected: object
) -> None:
    assert validate_params([Param("p", kind)], {"p": value}) == {"p": expected}


@pytest.mark.parametrize(
    ("kind", "value"),
    [
        ("string", 3),
        ("number", "3"),
        ("number", True),
        ("boolean", "true"),
        ("boolean", 1),
        ("datetime", "yesterday"),
        ("datetime", 1700000000),
        ("timespan", "1h"),
        ("timespan", 3600),
        ("kql", ["T"]),
    ],
)
def test_a_value_of_the_wrong_shape_is_an_error(kind: ParamKind, value: object) -> None:
    assert list(errors_of([Param("p", kind)], {"p": value})) == ["params.p"]


def test_a_many_valued_param_converts_each_value() -> None:
    params = [Param("since", "datetime", many=True)]
    assert validate_params(params, {"since": ["2026-10-20T00:00:00Z", "2026-10-21"]}) == {
        "since": [datetime(2026, 10, 20, tzinfo=UTC), datetime(2026, 10, 21, tzinfo=UTC)]
    }


def test_a_many_valued_param_names_the_bad_value() -> None:
    errors = errors_of([Param("n", "number", many=True)], {"n": [1, "two"]})
    assert errors == {"params.n": ["Value 2: Must be a number"]}


def test_a_many_valued_param_takes_a_list() -> None:
    assert errors_of([Param("n", "number", many=True)], {"n": 1}) == {
        "params.n": ["Must be a list"]
    }


def test_an_empty_list_is_missing() -> None:
    assert errors_of([Param("n", "number", many=True)], {"n": []}) == {"params.n": ["Required"]}


def test_a_missing_param_takes_its_default_converted() -> None:
    params = [Param("window", "timespan", default="P1D")]
    assert validate_params(params, {}) == {"window": timedelta(days=1)}


def test_an_optional_param_without_a_value_or_default_is_none() -> None:
    assert validate_params([Param("user", "string", required=False)], {}) == {"user": None}


def test_a_blank_string_is_missing() -> None:
    assert errors_of([Param("kql", "kql")], {"kql": "  "}) == {"params.kql": ["Required"]}


def test_a_value_for_an_undeclared_param_is_an_error() -> None:
    errors = errors_of([Param("user", "string")], {"user": "alice", "other": 1})
    assert errors == {"params.other": ["Unknown param"]}


def test_every_bad_param_is_reported_at_once() -> None:
    params = [Param("a", "number"), Param("b", "boolean")]
    assert set(errors_of(params, {"a": "x"})) == {"params.a", "params.b"}


def test_a_value_outside_the_choices_is_an_error() -> None:
    params = [Param("level", "string", choices=("low", "high"))]
    assert validate_params(params, {"level": "high"}) == {"level": "high"}
    assert errors_of(params, {"level": "mid"}) == {"params.level": ["Must be one of: low, high"]}


def test_choices_apply_to_each_value_of_a_many_valued_param() -> None:
    params = [Param("level", "number", many=True, choices=(1, 2))]
    assert errors_of(params, {"level": [1, 3]}) == {
        "params.level": ["Value 2: Must be one of: 1, 2"]
    }


def test_a_connection_param_names_a_connection_of_its_type() -> None:
    params = [Param("connection", "connection", connection_type="kusto")]
    connections = {"prod": "kusto", "warehouse": "snowflake"}
    assert validate_params(params, {"connection": "prod"}, connections=connections) == {
        "connection": "prod"
    }
    with pytest.raises(ParamsError) as caught:
        validate_params(params, {"connection": "warehouse"}, connections=connections)
    assert caught.value.errors == {"params.connection": ["No kusto connection named warehouse"]}
