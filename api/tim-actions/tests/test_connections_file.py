"""The connections file, loaded with the installed hooks: each connection validated by its
type's ``Connection`` model, each problem at its file and line."""

from pathlib import Path
from typing import ClassVar, Literal

import pytest

from tim_actions import Connection, Hook
from tim_actions.connections_file import connections_file_schema, load_connections_file
from tim_actions.kusto import KustoHook
from tim_actions.snowflake import SnowflakeHook


class LakeConnection(Connection):
    """A connection type with no default ``obo`` scope."""

    type: Literal["lake"]
    account: str


class LakeHook(Hook):
    connection_type = "lake"
    Connection: ClassVar[type[Connection]] = LakeConnection

    def cancel(self) -> None:
        pass


HOOKS: dict[str, type[Hook]] = {"kusto": KustoHook, "lake": LakeHook}


def load(
    tmp_path: Path, text: str | bytes, hooks: dict[str, type[Hook]] = HOOKS
) -> tuple[dict[str, Connection], list[str]]:
    path = tmp_path / "connections.yaml"
    if isinstance(text, bytes):
        path.write_bytes(text)
    else:
        path.write_text(text)
    loaded = load_connections_file(path, hooks)
    return loaded.connections, [p.removeprefix(f"{path}") for p in loaded.problems]


def test_loads_each_connection_with_its_types_model(tmp_path: Path) -> None:
    connections, problems = load(
        tmp_path,
        """\
- name: security
  title: Security
  type: kusto
  auth: obo
  cluster: https://Help.Kusto.Windows.Net/
  databases: [Samples]
- name: lake
  title: Lake
  type: lake
  auth: workload_identity
  account: acme
""",
    )
    assert problems == []
    security, lake = connections["security"], connections["lake"]
    assert security.cluster == "https://help.kusto.windows.net"  # type: ignore[attr-defined]
    assert security.obo_scope == "https://help.kusto.windows.net/.default"
    assert security.database_suggestions() == ("Samples",)
    assert (lake.obo_scope, lake.database_suggestions()) == (None, None)


def test_a_scope_in_the_file_wins_over_the_types_default(tmp_path: Path) -> None:
    connections, _ = load(
        tmp_path,
        "- {name: s, title: S, type: kusto, auth: obo, cluster: 'https://c.kusto.windows.net',"
        " scope: 'api://kusto/.default'}\n",
    )
    assert connections["s"].obo_scope == "api://kusto/.default"


def test_reports_each_problem_at_its_line(tmp_path: Path) -> None:
    _, problems = load(
        tmp_path,
        """\
- just text
- name: a
  title: A
  auth: obo
- name: b
  title: B
  type: snowflake
  auth: obo
- name: c
  title: C
  type: lake
  auth: obo
  account: acme
- name: d
  title: D
  type: kusto
  auth: obo
  cluster: https://d.kusto.windows.net
- name: d
  title: D again
  type: kusto
  auth: obo
  cluster: https://d2.kusto.windows.net
""",
    )
    assert problems == [
        ":1: [0]: a connection is a mapping of its fields",
        ":2: [1].type: required (installed connection types: kusto, lake)",
        ":7: [2].type: unknown connection type 'snowflake' (installed connection types: kusto, "
        "lake)",
        ":9: [3]: scope is required for auth obo",
        ":19: [5].name: duplicate connection name d",
    ]


@pytest.mark.parametrize(
    ("text", "problem"),
    [
        ("name: a\n", ":1: the connections file is a list of connections"),
        ("- [\n", ":2: not valid YAML"),
        ("- a: 1\n---\n- b: 2\n", ": give the connections in one YAML document"),
        (b"\xff\xfe", ": not UTF-8 text"),
    ],
)
def test_reports_a_file_that_is_not_a_list_of_connections(
    tmp_path: Path, text: str | bytes, problem: str
) -> None:
    connections, problems = load(tmp_path, text)
    assert connections == {}
    [only] = problems
    assert only.startswith(problem)


def test_the_schema_has_one_definition_per_connection_type() -> None:
    schema = connections_file_schema(HOOKS)
    assert schema["title"] == "TIM connections file"
    assert schema["type"] == "array"
    assert schema["items"]["discriminator"]["propertyName"] == "type"
    assert set(schema["$defs"]) == {"kusto", "lake"}
    assert schema["$defs"]["kusto"]["properties"]["type"]["const"] == "kusto"

    one = connections_file_schema({"kusto": KustoHook})
    assert one["items"] == {"$ref": "#/$defs/kusto"}
    assert connections_file_schema({})["maxItems"] == 0


def test_a_snowflake_connection_signs_in_with_obo_for_its_scope_or_as_tim_without_one(
    tmp_path: Path,
) -> None:
    connections, problems = load(
        tmp_path,
        """\
- name: warehouse
  title: Warehouse
  type: snowflake
  auth: obo
  scope: api://snowflake/session:role-any
  account: myorg-myaccount
  warehouse: ANALYSTS
  role: ANALYST
- name: warehouse-tim
  title: Warehouse as TIM
  type: snowflake
  auth: workload_identity
  account: myorg-myaccount
  warehouse: ANALYSTS
- name: no-scope
  title: No scope
  type: snowflake
  auth: obo
  account: myorg-myaccount
  warehouse: ANALYSTS
- name: no-warehouse
  title: No warehouse
  type: snowflake
  auth: workload_identity
  account: myorg-myaccount
- name: scope-as-tim
  title: Scope as TIM
  type: snowflake
  auth: workload_identity
  scope: api://snowflake/session:role-any
  account: myorg-myaccount
  warehouse: ANALYSTS
""",
        {"snowflake": SnowflakeHook},
    )
    assert connections["warehouse"].obo_scope == "api://snowflake/session:role-any"
    assert connections["warehouse-tim"].obo_scope is None
    assert problems == [
        ":15: [2]: scope is required for auth obo",
        ":21: [3].warehouse: Field required",
        ":26: [4]: scope is only for auth obo",
    ]
