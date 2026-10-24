"""Action files, loaded as TIM loads them at startup."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from importlib.resources.abc import Traversable

from tim_actions.action import Action, ActionType, Sink
from tim_actions.files import add_file_actions, load_action_files


class ActionFilesError(ValueError):
    """Startup would refuse the action files; ``problems`` name each file, line and field."""

    def __init__(self, problems: Sequence[str]) -> None:
        super().__init__("Invalid action files:\n" + "\n".join(f"  - {p}" for p in problems))
        self.problems = list(problems)


def load_actions(
    directory: Traversable, action_types: Iterable[ActionType]
) -> dict[str, Action | Sink]:
    """The actions of the action files in ``directory``, by key, with ``action_types`` installed.
    Raises ``ActionFilesError`` with every problem startup would stop on, but checks no
    connections."""
    actions: dict[str, tuple[Action | Sink, str]] = {}
    types = {action_type.type_name or "": action_type for action_type in action_types}
    problems = add_file_actions(actions, load_action_files(directory, types), builtin=False)
    if problems:
        raise ActionFilesError(problems)
    return {key: action for key, (action, _) in actions.items()}
