"""Declaring actions, params, columns and providers: an invalid declaration fails when it is
constructed."""

from collections.abc import Iterator, Mapping
from typing import Any

import pytest
from pydantic import ValidationError

from tim_actions import Action, Column, Hook, Param, Provider, RunContext


def test_a_param_with_every_field() -> None:
    param = Param(
        "kql",
        "kql",
        title="Query",
        required=False,
        default="T | take 10",
        schema_from=("connection", "database"),
        help="Any KQL",
    )
    assert param.title == "Query"
    assert param.from_columns == ()


def test_the_title_defaults_to_the_name() -> None:
    assert Param("user", "string").title == "user"


@pytest.mark.parametrize(
    ("args", "kwargs", "message"),
    [
        (("user name", "string"), {}, "letters, digits and _"),
        (("1user", "string"), {}, "letters, digits and _"),
        (("user", "text"), {}, "Input should be 'string'"),
        (("connection", "connection"), {}, "connection_type is required"),
        (("user", "string"), {"connection_type": "kusto"}, "only for kind connection"),
        (
            ("c", "connection"),
            {"connection_type": "kusto", "choices": ("prod",)},
            "choices are not allowed for kind connection",
        ),
        (("n", "number"), {"default": "ten"}, "default: Must be a number"),
        (("n", "number"), {"many": True, "default": 1}, "default: Must be a list"),
        (("n", "number"), {"choices": (1, "two")}, "choices: Must be a number"),
        (("n", "number"), {"choices": (1,), "default": 2}, "default: Must be one of: 1"),
        (("kql", "kql"), {"many": True}, "many is not allowed"),
        (("user", "string"), {"schema_from": ("connection",)}, "only for kind kql or sql"),
        (("user", "string"), {"from_columns": ("User", " ")}, "from_columns"),
        (("user", "string"), {"title": " "}, "title"),
        (("user", "string"), {"colour": "red"}, "colour"),
    ],
)
def test_an_invalid_param_fails_on_construction(
    args: tuple[Any, ...], kwargs: dict[str, Any], message: str
) -> None:
    with pytest.raises(ValidationError, match=message):
        Param(*args, **kwargs)


def test_a_column() -> None:
    column = Column("Timestamp", "datetime", pinned="left", sort="desc", width=180)
    assert (column.title, column.hidden, column.group) == (None, False, False)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"name": "Timestamp", "type": "date"},
        {"name": " ", "type": "string"},
        {"name": "A", "type": "string", "pinned": "middle"},
        {"name": "A", "type": "string", "sort": "up"},
        {"name": "A", "type": "string", "width": 0},
    ],
)
def test_an_invalid_column_fails_on_construction(kwargs: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        Column(**kwargs)


class Users(Action):
    def run(self, params: Mapping[str, Any], ctx: RunContext) -> Iterator[Mapping[str, Any]]:
        yield {"User": "alice"}


class FileUsers(Users):
    type_name = "users"


class KustoHook(Hook):
    connection_type = "kusto"

    def cancel(self) -> None:
        pass


def test_an_action_with_its_menu_path_and_pivot_columns() -> None:
    action = Users(
        key="acme.users-v2",
        name="Users",
        menu=" Identity / Entra ",
        params=[
            Param("user", "string", from_columns=("UserPrincipalName", "Upn")),
            Param("tenant", "string", from_columns=("TenantId",)),
            Param("since", "datetime", required=False, from_columns=("Timestamp",)),
            Param("note", "string"),
        ],
        columns=[Column("User", "string")],
        id=["UserId", "Upn"],
        pivot="row",
    )
    assert action.menu_path == ["Identity", "Entra"]
    assert action.pivot_columns() == [["UserPrincipalName", "Upn"], ["TenantId"]]
    assert action.connections() == ()


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"key": "Acme.Users"}, "key"),
        ({"key": "acme users"}, "key"),
        ({"name": " "}, "name"),
        ({"menu": "Identity//Entra"}, "every folder in the path must be non-blank"),
        ({"pivot": "cell"}, "pivot"),
        ({"params": [Param("a", "string"), Param("a", "number")]}, "names must be unique"),
        (
            {"params": [Param("kql", "kql", schema_from=("connection",))]},
            r"params.kql.schema_from: unknown params \['connection'\]",
        ),
        (
            {"columns": [Column("A", "string"), Column("A", "number")]},
            "columns: names must be unique",
        ),
        ({"id": []}, "give a column name"),
        ({"id": " "}, "id"),
        ({"colour": "red"}, "colour"),
    ],
)
def test_an_invalid_action_fails_on_construction(kwargs: dict[str, Any], message: str) -> None:
    with pytest.raises(ValidationError, match=message):
        Users(**({"key": "acme.users", "name": "Users", "pivot": "row"} | kwargs))


def test_an_action_must_say_whether_it_pivots() -> None:
    with pytest.raises(ValidationError, match="pivot"):
        Users(key="acme.users", name="Users")  # type: ignore[call-arg]


def test_an_action_type_must_implement_run() -> None:
    class NoRun(Action):
        pass

    with pytest.raises(TypeError, match="abstract"):
        NoRun(key="a", name="A", pivot="none")  # type: ignore[abstract]


def test_a_provider_lists_actions_action_types_and_hooks() -> None:
    provider = Provider(
        actions=[Users(key="a", name="A", pivot="none")],
        action_types=[FileUsers],
        hooks=[KustoHook],
    )
    assert (len(provider.actions), provider.action_types, provider.hooks) == (
        1,
        [FileUsers],
        [KustoHook],
    )


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"actions": [{"key": "a"}]}, "actions"),
        ({"action_types": [Users]}, "Users has no type_name"),
        ({"hooks": [Hook]}, "Hook has no connection_type"),
    ],
)
def test_an_invalid_provider_fails_on_construction(kwargs: dict[str, Any], message: str) -> None:
    with pytest.raises(ValidationError, match=message):
        Provider(**kwargs)


def test_a_hook_has_no_editor_schema_unless_it_gives_one() -> None:
    assert KustoHook().editor_schema({"database": "Security"}) is None


def test_a_json_default_must_be_json() -> None:
    with pytest.raises(ValidationError, match="default: Must be JSON"):
        Param("filter", "json", default={"since": object()})
