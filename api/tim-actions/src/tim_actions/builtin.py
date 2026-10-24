"""TIM's built-in provider, registered through the ``tim.actions`` entry point like any other.
A connection type and its actions are included when its extra is installed."""

from importlib.util import find_spec

from tim_actions.action import Action
from tim_actions.hooks import Hook
from tim_actions.provider import Provider


def _installed(module: str) -> bool:
    try:
        return find_spec(module) is not None
    except ModuleNotFoundError:  # a parent package is missing
        return False


def provider() -> Provider:
    actions: list[Action] = []
    action_types: list[type[Action]] = []
    hooks: list[type[Hook]] = []
    if _installed("azure.kusto.data"):  # the kusto extra
        from tim_actions.kusto import RUN_KQL, KqlQuery, KustoHook

        actions.append(RUN_KQL)
        action_types.append(KqlQuery)
        hooks.append(KustoHook)
    if _installed("snowflake.connector"):  # the snowflake extra
        from tim_actions.snowflake import RUN_SQL, SnowflakeHook

        actions.append(RUN_SQL)
        hooks.append(SnowflakeHook)
    return Provider(actions=actions, action_types=action_types, hooks=hooks)
