"""Select the storage implementation from ``TIM_DATABASE_URL``."""

from __future__ import annotations

from tim_api.config import Settings
from tim_api.storage.base import Storage
from tim_api.storage.memory import MemoryStorage
from tim_api.storage.postgres import PostgresStorage

MEMORY_URL_PREFIX = "memory://"


def build_storage(settings: Settings) -> Storage:
    """``memory://`` selects the in-memory store (dev/tests only); otherwise PostgreSQL."""
    url = settings.database_url.get_secret_value()
    if url.startswith(MEMORY_URL_PREFIX):
        return MemoryStorage()
    return PostgresStorage(url)
