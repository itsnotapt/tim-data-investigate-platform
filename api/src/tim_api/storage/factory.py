"""Build the storage from ``TIM_DATABASE_URL``."""

from __future__ import annotations

from tim_api.config import Settings
from tim_api.storage.postgres import PostgresStorage


def build_storage(settings: Settings) -> PostgresStorage:
    """The PostgreSQL storage at ``TIM_DATABASE_URL``."""
    return PostgresStorage(settings.database_url.get_secret_value())
