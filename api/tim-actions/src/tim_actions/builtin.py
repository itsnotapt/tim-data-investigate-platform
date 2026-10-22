"""TIM's built-in provider, registered through the ``tim.actions`` entry point like any other.
A connection type and its actions are included when its extra is installed."""

from importlib.util import find_spec

from tim_actions.provider import Provider


def _installed(module: str) -> bool:
    try:
        return find_spec(module) is not None
    except ModuleNotFoundError:  # a parent package is missing
        return False


def provider() -> Provider:
    if not _installed("azure.kusto.data"):  # no kusto extra
        return Provider()
    from tim_actions.kusto import RUN_KQL, KqlQuery, KustoHook

    return Provider(actions=[RUN_KQL], action_types=[KqlQuery], hooks=[KustoHook])
