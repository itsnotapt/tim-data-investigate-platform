"""Pivots: resolving an action's params from the selected rows, through the default
``resolve()`` and ``resolve_pivot``."""

from collections.abc import Iterator, Mapping, Sequence
from typing import Any, ClassVar

from tim_actions import (
    Action,
    Param,
    PivotCell,
    PivotContext,
    Resolved,
    RunContext,
    resolve_pivot,
)


class Lookup(Action):
    def run(self, params: Mapping[str, Any], ctx: RunContext) -> Iterator[Mapping[str, Any]]:
        yield from ()


def lookup(*params: Param) -> Lookup:
    return Lookup(key="lookup", name="Lookup", params=params, pivot="rows")


def rows(*values: Mapping[str, Any]) -> Sequence[Mapping[str, Any]]:
    return list(values)


def test_a_many_param_takes_the_distinct_values_of_the_rows() -> None:
    action = lookup(Param("users", "string", many=True, from_columns=("User",)))
    resolved = action.resolve(
        PivotContext(rows=rows({"User": "bob"}, {"User": "alice"}, {"User": "bob"}))
    )
    assert resolved.params == {"users": ["bob", "alice"]}
    assert resolved.missing == {}


def test_a_single_param_takes_the_value_the_rows_agree_on_from_the_first_non_empty_column() -> None:
    action = lookup(Param("host", "string", from_columns=("Host", "Computer")))
    resolved = action.resolve(
        PivotContext(rows=rows({"Host": "", "Computer": "pc-1"}, {"Host": "pc-1"}, {"Host": None}))
    )
    assert resolved.params == {"host": "pc-1"}
    assert resolved.missing == {}


def test_a_single_param_whose_rows_disagree_is_missing_with_the_reason() -> None:
    action = lookup(
        Param("at", "datetime", title="Timestamp", from_columns=("Timestamp",)),
        Param("host", "string", from_columns=("Host",)),
    )
    resolved = action.resolve(
        PivotContext(
            rows=rows(
                {"Timestamp": "2026-01-01T00:00:00Z", "Host": "pc-1"},
                {"Timestamp": "2026-01-02T00:00:00Z", "Host": "pc-1"},
                {"Timestamp": "2026-01-01T00:00:00Z", "Host": "pc-1"},
            )
        )
    )
    assert resolved.params == {"host": "pc-1"}
    assert resolved.missing == {"at": "The 3 selected rows have different Timestamp values"}


def test_a_required_param_the_rows_give_no_value_is_missing_unless_it_has_a_default() -> None:
    action = lookup(
        Param("host", "string", from_columns=("Host",)),
        Param("user", "string"),
        Param("limit", "number", default=10),
        Param("note", "string", required=False, from_columns=("Note",)),
    )
    resolved = action.resolve(PivotContext(rows=rows({"Host": ""})))
    assert resolved.params == {}
    assert resolved.missing == {"host": None, "user": None}


class Storm(Lookup):
    """Resolves ``window`` from the rows' earliest and latest ``Timestamp``."""

    seen: ClassVar[list[PivotContext]] = []

    def pivot_columns(self) -> list[list[str]]:
        return [["Timestamp"]]

    def resolve(self, context: PivotContext) -> Resolved:
        self.seen.append(context)
        stamps = sorted(row["Timestamp"] for row in context.rows)
        return Resolved(params={"window": [stamps[0], stamps[-1]]})


def test_an_overridden_resolve_sees_only_the_declared_pivot_columns() -> None:
    action = Storm(
        key="storm",
        name="Storm",
        params=(
            Param("window", "datetime", many=True),
            Param("host", "string", required=False, from_columns=("Host",)),
        ),
        pivot="rows",
    )
    resolved = resolve_pivot(
        action,
        [
            {"Timestamp": "2026-01-02T00:00:00Z", "Host": "pc-1", "Secret": "s"},
            {"Timestamp": "2026-01-01T00:00:00Z", "Other": 1},
        ],
        PivotCell("Host", "pc-1"),
    )
    assert resolved.params == {"window": ["2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"]}
    assert action.seen == [
        PivotContext(
            rows=[
                {"Timestamp": "2026-01-02T00:00:00Z", "Host": "pc-1"},
                {"Timestamp": "2026-01-01T00:00:00Z"},
            ],
            cell=PivotCell("Host", "pc-1"),
        )
    ]
