"""A provider's own tests on ``tim_actions.testing`` and its plugin's fixtures, run by pytest in
a process that can't import the ``kusto`` extra, as with only ``tim-actions`` installed."""

import sys

import pytest

PROVIDER = '''
"""A throwaway provider: an action that queries tickets, a file type and a sink."""

from collections.abc import Iterator, Mapping, Sequence
from typing import Any

from tim_actions import (
    Action, ActionDocument, Column, Hook, Param, RunContext, Sink, SinkDocument
)


class Tickets(Hook):
    connection_type = "tickets"

    def cancel(self) -> None:
        pass

    def search(self, user: str) -> list[dict[str, Any]]:
        token = self.token_for("api://tickets/.default")
        return [{"Ticket": f"T-{user}", "Token": token}]


class TicketsFile(ActionDocument):
    pass


class UserTickets(Action):
    type_name = "user_tickets"
    File = TicketsFile

    def connections(self) -> Mapping[str, str]:
        return {"tickets": "tickets"}

    def run(self, params: Mapping[str, Any], ctx: RunContext) -> Iterator[Mapping[str, Any]]:
        hook = ctx.hook("tickets")
        assert isinstance(hook, Tickets)
        ctx.detail("analyst", ctx.analyst.upn)
        yield from hook.search(params["user"])


class SaveFile(SinkDocument):
    pass


class Save(Sink):
    type_name = "save"
    File = SaveFile

    def run(
        self, columns: Sequence[Column], rows: Sequence[Mapping[str, Any]], ctx: RunContext
    ) -> None:
        ctx.detail("saved", len(rows))
'''

TESTS = """
from pathlib import Path

import pytest

from acme_tim import Save, Tickets, UserTickets
from tim_actions import Analyst, Connection
from tim_actions.testing import Connections, load_actions, resolve_pivot, run_action, run_sink

FILE = (
    "type: user_tickets\\nkey: acme.tickets\\nname: Tickets\\npivot: row\\nid: Ticket\\n"
    "params: [{name: user, kind: string, from_columns: [User]}]\\n"
    "---\\ntype: save\\nkey: acme.save\\nname: Save\\n"
)


@pytest.fixture
def tim_connections() -> Connections:
    connections = Connections(token_for=lambda scope: f"obo {scope}")
    connections.add(
        Connection(name="tickets", title="Tickets", type="tickets", auth="obo", scope="api://t"),
        Tickets,
    )
    return connections


def test_the_provider(tmp_path: Path, tim_connections: Connections, tim_analyst: Analyst) -> None:
    (tmp_path / "acme.yaml").write_text(FILE)
    actions = load_actions(tmp_path, [UserTickets, Save])
    tickets, save = actions["acme.tickets"], actions["acme.save"]
    assert isinstance(tickets, UserTickets) and isinstance(save, Save)

    resolved = resolve_pivot(tickets, [{"User": "alice", "Host": "h-1"}])
    result = run_action(tickets, resolved.params, connections=tim_connections)
    assert result.rows == [{"Ticket": "T-alice", "Token": "obo api://tickets/.default"}]
    assert result.ids == ["T-alice"]
    assert result.details == {"analyst": tim_analyst.upn}

    assert run_sink(save, result.rows).details == {"saved": 1}
"""

# Runs pytest as if the kusto and snowflake extras weren't installed: importing azure or snowflake
# fails.
WITHOUT_EXTRAS = (
    "import sys; sys.modules['azure'] = None; sys.modules['snowflake'] = None; import pytest; "
    "raise SystemExit(pytest.main(sys.argv[1:]))"
)


def test_a_provider_tests_its_actions_with_only_tim_actions_installed(
    pytester: pytest.Pytester,
) -> None:
    pytester.makepyfile(acme_tim=PROVIDER, test_acme=TESTS)
    result = pytester.run(sys.executable, "-c", WITHOUT_EXTRAS, "-p", "no:cacheprovider", "-q")
    assert result.ret == 0, result.stdout.str()
    result.stdout.fnmatch_lines(["1 passed*"])
