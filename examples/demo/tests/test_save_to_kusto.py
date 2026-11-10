import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, ClassVar

import pytest
import yaml
from azure.kusto.data.exceptions import KustoServiceError
from tim_actions import Action, Analyst, RunError
from tim_actions.kusto import KqlQuery, KustoConnection, KustoHook
from tim_actions.testing import ActionFilesError, Connections, load_actions, run_sink
from tim_demo.kusto_save import KustoSave

CONFIG = Path(__file__).parents[1] / "config"
SAVE = KustoSave(
    key="demo.save-to-kusto",
    name="Save to Kusto",
    connection="security",
    database="Security",
    table="SavedRows",
)
ALICE = Analyst(name="Alice", upn="alice@demo.example")
ROWS: list[dict[str, Any]] = [
    {"EventId": "e1", "Host": "BGIST-L", "Timestamp": "2018-08-20T10:00:00Z", "Count": 3},
    {"EventId": "e2", "Host": "BGIST-L", "Raw": 'line one\nline "two"', "Tags": ["a", "b"]},
]


@dataclass
class Command:
    database: str | None
    text: str


@dataclass
class FakeClient:
    """The SDK client of a Kusto cluster: records each management command, or raises ``error``."""

    commands: list[Command] = field(default_factory=list)
    error: Exception | None = None
    closed: bool = False

    def execute_query(self, database: str, query: str, properties: Any) -> Any:
        raise AssertionError("a sink runs no queries")

    def execute_mgmt(self, database: str | None, query: str, properties: Any) -> Any:
        self.commands.append(Command(database, query))
        if self.error is not None:
            raise self.error

    def close(self) -> None:
        self.closed = True


@pytest.fixture
def cluster() -> FakeClient:
    """The Kusto SDK client behind the demo's security connection, recording each command."""
    return FakeClient()


@pytest.fixture
def connections(cluster: FakeClient) -> Connections:
    """The demo's security connection, reaching ``cluster``."""

    class Hook(KustoHook):
        client_factory: ClassVar[Any] = staticmethod(lambda _cluster, _token: cluster)

    connections = Connections()
    for connection in yaml.safe_load((CONFIG / "connections.yaml").read_text()):
        connections.add(KustoConnection.model_validate(connection), Hook)
    return connections


def records(command: Command) -> list[dict[str, Any]]:
    """The records after the command's ``<|``, one JSON object per line."""
    _, data = command.text.split("<|\n", 1)
    return [json.loads(line) for line in data.splitlines()]


def test_a_save_ingests_each_row_into_the_table_with_who_saved_it_and_when(
    cluster: FakeClient, connections: Connections
) -> None:
    before = datetime.now(UTC)

    run_sink(SAVE, ROWS, connections=connections, analyst=ALICE)

    after = datetime.now(UTC)
    [command] = cluster.commands
    assert command.database == "Security"
    assert command.text.startswith(
        ".ingest inline into table ['SavedRows'] with (format='multijson') <|\n"
    )
    saved = records(command)
    assert [{k: v for k, v in r.items() if k != "SavedAt"} for r in saved] == [
        {"SavedBy": "alice@demo.example", "Row": ROWS[0]},
        {"SavedBy": "alice@demo.example", "Row": ROWS[1]},
    ]
    for record in saved:
        assert before <= datetime.fromisoformat(record["SavedAt"]) <= after
    assert cluster.closed


def test_a_save_kusto_refuses_ends_in_error_with_its_message(
    cluster: FakeClient, connections: Connections
) -> None:
    cluster.error = KustoServiceError("Table 'SavedRows' could not be found")

    with pytest.raises(RunError, match=r"^Table 'SavedRows' could not be found$"):
        run_sink(SAVE, ROWS, connections=connections, analyst=ALICE)

    assert cluster.closed


def test_save_to_kusto_saves_to_the_saved_rows_table_of_the_security_logs() -> None:
    save = load_actions(CONFIG / "actions", [KqlQuery, KustoSave])["demo.save-to-kusto"]

    assert isinstance(save, KustoSave)
    assert (save.name, save.menu) == ("Save to Kusto", "Send to")
    assert (save.connection, save.database, save.table) == ("security", "Security", "SavedRows")


@pytest.mark.parametrize("table", ["Saved Rows", "SavedRows'] <| x", "1Saved", ""])
def test_a_table_that_is_not_a_plain_name_is_refused(tmp_path: Path, table: str) -> None:
    (tmp_path / "save.yaml").write_text(
        yaml.safe_dump(
            {
                "type": "kusto_save",
                "key": "demo.save",
                "name": "Save",
                "connection": "security",
                "database": "Security",
                "table": table,
            }
        )
    )

    with pytest.raises(ActionFilesError, match="table"):
        load_actions(tmp_path, [KustoSave])


def test_saved_events_reads_the_saved_rows_back_by_their_event(
    actions: dict[str, Action],
) -> None:
    saved = actions["demo.saved-events"]

    assert isinstance(saved, KqlQuery)
    assert (saved.name, saved.pivot, saved.id) == ("Saved events", "none", "EventId")
    assert (saved.connection, saved.database) == ("security", "Security")
    assert [column.name for column in saved.columns or ()][:5] == [
        "Timestamp",
        "Host",
        "SavedBy",
        "SavedAt",
        "EventId",
    ]


@pytest.mark.parametrize("database", ["", "  "])
def test_a_blank_database_is_refused(tmp_path: Path, database: str) -> None:
    (tmp_path / "save.yaml").write_text(
        yaml.safe_dump(
            {
                "type": "kusto_save",
                "key": "demo.save",
                "name": "Save",
                "connection": "security",
                "database": database,
                "table": "SavedRows",
            }
        )
    )

    with pytest.raises(ActionFilesError, match="database"):
        load_actions(tmp_path, [KustoSave])
