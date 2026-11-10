"""The demo instance's provider: the ``kusto_save`` sink type."""

from tim_actions import Provider

from tim_demo.kusto_save import KustoSave


def provider() -> Provider:
    return Provider(action_types=[KustoSave])
