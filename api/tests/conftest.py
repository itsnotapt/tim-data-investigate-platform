import os
from collections.abc import Iterator

import pytest

from tim_api.config import get_settings

REQUIRED_ENV = {
    "TIM_AUTH_TENANT_ID": "tenant-id",
    "TIM_AUTH_CLIENT_ID": "client-id",
    "TIM_TAG_CLUSTER_URI": "https://tags.westeurope.kusto.windows.net",
    "TIM_DATABASE_URL": "postgresql+asyncpg://tim:s3cret-pw@localhost:5432/tim",
}


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Provide the required env, ignore any local .env, and reset the settings cache."""
    for key in list(os.environ):
        if key.startswith("TIM_"):
            monkeypatch.delenv(key)
    for key, value in REQUIRED_ENV.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
