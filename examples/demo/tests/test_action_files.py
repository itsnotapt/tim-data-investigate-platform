import re
from pathlib import Path

from tim_actions.kusto import KqlQuery
from tim_actions.testing import load_actions

CONFIG = Path(__file__).parents[1] / "config"


def test_every_action_is_bounded_by_a_time_window_and_a_row_limit() -> None:
    for action in load_actions(CONFIG / "actions", [KqlQuery]).values():
        assert isinstance(action, KqlQuery)
        assert "Timestamp between (" in action.kql, action.key
        assert re.search(r"^\| take \d+$", action.kql, re.MULTILINE), action.key
