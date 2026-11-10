from pathlib import Path

import pytest
import yaml
from tim_actions import Action
from tim_actions.kusto import KqlQuery, KustoConnection
from tim_actions.testing import Connections, load_actions
from tim_demo.kusto_save import KustoSave

CONFIG = Path(__file__).parents[1] / "config"


@pytest.fixture
def tim_connections() -> Connections:
    """The demo's connections file: its one connection, security."""
    connections = Connections()
    for connection in yaml.safe_load((CONFIG / "connections.yaml").read_text()):
        connections.add(KustoConnection.model_validate(connection))
    return connections


@pytest.fixture
def actions() -> dict[str, Action]:
    """The demo's query actions, by key: every action of its action files except its sink."""
    loaded = load_actions(CONFIG / "actions", [KqlQuery, KustoSave])
    return {key: action for key, action in loaded.items() if isinstance(action, Action)}
