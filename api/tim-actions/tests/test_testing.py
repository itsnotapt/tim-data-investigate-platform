"""``tim_actions.testing``: runs, pivots and action files as TIM handles them, without TIM."""

from collections.abc import Iterator, Mapping, Sequence
from pathlib import Path
from typing import Any

import pytest

from tim_actions import (
    Action,
    Analyst,
    Column,
    Connection,
    Hook,
    Param,
    ParamsError,
    PivotCell,
    RunContext,
    Sink,
    dev,
)
from tim_actions.testing import (
    ActionFilesError,
    Connections,
    PivotRefused,
    load_actions,
    resolve_pivot,
    run_action,
    run_sink,
)


class Hosts(Action):
    """Yields a row per host in its ``hosts`` param, declaring ``Seen`` and reporting a count."""

    def run(self, params: Mapping[str, Any], ctx: RunContext) -> Iterator[Mapping[str, Any]]:
        ctx.declare_columns([Column("Seen", "datetime"), Column("Host", "number")])
        ctx.detail("hosts", len(params["hosts"]))
        for host in params["hosts"]:
            yield {"Host": host, "Seen": params.get("since")}


HOSTS = Hosts(
    key="acme.hosts",
    name="Hosts",
    params=(
        Param("hosts", "string", many=True, from_columns=("Host",)),
        Param("since", "datetime", required=False),
    ),
    pivot="rows",
    columns=(Column("Host", "string"),),
    id="Host",
)


class Yields(Action):
    """Yields what it is given, reporting its ``warning``."""

    yields: list[Any]
    warning: str | None = None

    def run(self, params: Mapping[str, Any], ctx: RunContext) -> Iterator[Mapping[str, Any]]:
        if self.warning:
            ctx.detail("warning", self.warning)
        yield from self.yields


def test_run_action_validates_the_params_and_gives_each_row_its_id() -> None:
    result = run_action(HOSTS, {"hosts": ["h-1", "h-2"]})
    assert result.rows == [{"Host": "h-1", "Seen": None}, {"Host": "h-2", "Seen": None}]
    assert result.ids == ["h-1", "h-2"]


def test_run_action_refuses_params_tim_would_refuse() -> None:
    with pytest.raises(ParamsError):
        run_action(HOSTS, {"hosts": ["h-1"], "since": "yesterday"})


def test_run_action_gives_the_declared_columns_and_the_run_details() -> None:
    result = run_action(HOSTS, {"hosts": ["h-1"]})
    assert result.columns == [Column("Host", "string"), Column("Seen", "datetime")]
    assert result.details == {"hosts": 1}


def test_a_run_detail_is_a_string_key_with_a_string_number_or_bool_value() -> None:
    class Detail(Action):
        def run(self, params: Mapping[str, Any], ctx: RunContext) -> Iterator[Mapping[str, Any]]:
            ctx.detail("at", None)  # type: ignore[arg-type]
            yield from ()

    with pytest.raises(TypeError, match="a run detail is a string key"):
        run_action(Detail(key="d", name="D", pivot="none"))


def test_a_row_is_a_mapping() -> None:
    with pytest.raises(TypeError, match="run yielded a list, not a mapping"):
        run_action(Yields(key="y", name="Y", pivot="none", yields=[["h-1"]]))


def test_ids_are_in_tims_text_form() -> None:
    rows = [{"Id": 7}, {"Id": ""}, {"Id": "x"}, {"Id": None}, {"Id": {"a": 1.5}}]
    action = Yields(key="y", name="Y", pivot="none", id="Id", yields=rows)
    assert run_action(action).ids == ["7", None, "x", None, '{"a":1.5}']


def test_an_id_column_missing_from_the_results_adds_a_warning() -> None:
    action = Yields(
        key="y",
        name="Y",
        pivot="none",
        id=["Ticket", "Host"],
        yields=[{"Host": "h-1"}],
        warning="Slow",
    )
    assert run_action(action).details == {"warning": "Slow; Id column Ticket not in results"}
    assert run_action(action.model_copy(update={"yields": []})).details == {"warning": "Slow"}


class Ticketing(Hook):
    """A provider's own hook: what it was built with, and the token it got."""

    connection_type = "ticketing"

    def cancel(self) -> None:
        pass

    def token(self) -> str:
        return self.token_for("api://ticketing/.default")


class Tickets(Action):
    """Reports the token and connection its ``connection`` param's hook has, and reaches
    ``other`` when asked."""

    def run(self, params: Mapping[str, Any], ctx: RunContext) -> Iterator[Mapping[str, Any]]:
        hook = ctx.hook(params["other"] or params["connection"])
        assert isinstance(hook, Ticketing)
        yield {"Connection": hook.connection.name, "Token": hook.token()}


TICKETS = Tickets(
    key="acme.tickets",
    name="Tickets",
    params=(
        Param("connection", "connection", connection_type="ticketing"),
        Param("other", "string", required=False),
    ),
    pivot="none",
)


def ticketing(name: str) -> Connection:
    return Connection(name=name, title=name.title(), type="ticketing", auth="workload_identity")


def test_a_run_reaches_its_connections_through_their_hooks_with_the_connections_tokens() -> None:
    connections = Connections(token_for=lambda scope: f"token for {scope}")
    connections.add(ticketing("tickets"), Ticketing)
    result = run_action(TICKETS, {"connection": "tickets"}, connections=connections)
    assert result.rows == [{"Connection": "tickets", "Token": "token for api://ticketing/.default"}]


def test_a_connection_param_names_one_of_the_connections() -> None:
    connections = Connections()
    connections.add(ticketing("tickets"), Ticketing)
    with pytest.raises(ParamsError):
        run_action(TICKETS, {"connection": "other"}, connections=connections)
    with pytest.raises(ParamsError):
        run_action(TICKETS, {"connection": "tickets"})


def test_a_run_reaches_only_the_connections_its_action_declared() -> None:
    connections = Connections()
    connections.add(ticketing("tickets"), Ticketing)
    connections.add(ticketing("archive"), Ticketing)
    with pytest.raises(ValueError, match="did not declare the connection archive"):
        run_action(TICKETS, {"connection": "tickets", "other": "archive"}, connections=connections)


class Archive(Action):
    """Reaches its fixed ``archive`` connection."""

    def connections(self) -> Mapping[str, str]:
        return {"archive": "ticketing"}

    def run(self, params: Mapping[str, Any], ctx: RunContext) -> Iterator[Mapping[str, Any]]:
        ctx.hook("archive")
        yield from ()


ARCHIVE = Archive(key="acme.archive", name="Archive", pivot="none")


def test_a_fixed_connection_must_be_one_of_the_connections() -> None:
    with pytest.raises(LookupError, match="No connection named archive"):
        run_action(ARCHIVE)


def test_a_connection_added_without_a_hook_needs_a_fake_of_its_type() -> None:
    connections = Connections()
    connections.add(ticketing("archive"))
    with pytest.raises(LookupError, match="No hook answers the ticketing connection archive"):
        run_action(ARCHIVE, connections=connections)
    connections.answer("ticketing", Ticketing)
    assert run_action(ARCHIVE, connections=connections).rows == []


class Export(Sink):
    """Reports what it was given, reaching the ``archive`` connection."""

    def connections(self) -> Mapping[str, str]:
        return {"archive": "ticketing"}

    def run(
        self, columns: Sequence[Column], rows: Sequence[Mapping[str, Any]], ctx: RunContext
    ) -> None:
        hook = ctx.hook("archive")
        assert isinstance(hook, Ticketing)
        ctx.detail("columns", ",".join(f"{c.name}:{c.type}" for c in columns))
        ctx.detail("rows", len(rows))
        ctx.detail("by", f"{ctx.analyst.upn} with {hook.token()}")


EXPORT = Export(key="acme.export", name="Export")


def test_run_sink_gives_the_sink_the_rows_and_their_columns_and_returns_the_details() -> None:
    connections = Connections()
    connections.add(ticketing("archive"), Ticketing)
    result = run_sink(
        EXPORT,
        [{"Host": "h-1"}, {"Host": "h-2", "Bytes": 3}],
        columns=[Column("Host", "string"), Column("Bytes", "number")],
        connections=connections,
        analyst=Analyst("Bob", "bob@example.com"),
    )
    assert result.details == {
        "columns": "Host:string,Bytes:number",
        "rows": 2,
        "by": "bob@example.com with token for api://ticketing/.default",
    }


def test_run_sink_without_columns_gives_each_column_of_the_rows_as_a_string() -> None:
    connections = Connections()
    connections.add(ticketing("archive"), Ticketing)
    result = run_sink(
        EXPORT, [{"Host": "h-1"}, {"Bytes": 3, "Host": "h-2"}], connections=connections
    )
    assert result.details["columns"] == "Host:string,Bytes:string"


def test_resolve_pivot_gives_the_params_the_selected_rows_give() -> None:
    resolved = resolve_pivot(HOSTS, [{"Host": "h-1", "User": "alice"}, {"Host": "h-2"}])
    assert (resolved.params, resolved.missing) == ({"hosts": ["h-1", "h-2"]}, {})


def test_resolve_pivot_names_the_required_params_the_rows_leave_without_a_value() -> None:
    action = HOSTS.model_copy(
        update={"params": (Param("hosts", "string", from_columns=("Host",)),)}
    )
    assert resolve_pivot(action, [{"User": "alice"}], PivotCell("User", "alice")).missing == {
        "hosts": None
    }


@pytest.mark.parametrize(
    ("pivot", "rows", "refusal"),
    [("none", 1, "Not offered as a pivot"), ("row", 2, "Takes one row")],
)
def test_resolve_pivot_refuses_rows_tim_would_not_offer_the_action_on(
    pivot: str, rows: int, refusal: str
) -> None:
    action = HOSTS.model_copy(update={"pivot": pivot})
    with pytest.raises(PivotRefused, match=f"^{refusal}$"):
        resolve_pivot(action, [{"Host": "h-1"}] * rows)


def test_load_actions_gives_the_actions_of_a_directory_of_action_files(tmp_path: Path) -> None:
    (tmp_path / "rows.yaml").write_text("type: dev_rows\nkey: acme.rows\nname: Rows\npivot: none\n")
    (tmp_path / "sink.yml").write_text("type: dev_sink\nkey: acme.sink\nname: Sink\n")
    actions = load_actions(tmp_path, [dev.DevRows, dev.DevSink])
    assert {key: type(action) for key, action in actions.items()} == {
        "acme.rows": dev.DevRows,
        "acme.sink": dev.DevSink,
    }


def test_load_actions_refuses_files_startup_would_refuse(tmp_path: Path) -> None:
    (tmp_path / "a.yaml").write_text(
        "type: dev_rows\nkey: acme.rows\nname: Rows\npivot: none\n---\n"
        "type: dev_rows\nkey: tim.rows\nname: Mine\npivot: none\n---\n"
        "type: dev_sink\nkey: acme.sink\nname: Sink\n"
    )
    (tmp_path / "b.yaml").write_text("type: dev_rows\nkey: acme.rows\nname: Again\npivot: row\n")
    with pytest.raises(ActionFilesError) as raised:
        load_actions(tmp_path, [dev.DevRows])
    assert [problem.replace(f"{tmp_path}/", "") for problem in raised.value.problems] == [
        "a.yaml:11: type: unknown action type 'dev_sink' (installed action types: dev_rows)",
        "a.yaml:7: key: the tim. prefix is reserved for TIM's built-ins",
        "b.yaml:2: key: duplicate action key acme.rows, also in a.yaml:2",
    ]
    assert str(raised.value).startswith("Invalid action files:\n  - ")
