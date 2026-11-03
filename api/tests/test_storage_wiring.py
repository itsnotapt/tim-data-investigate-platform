import pytest
from app_factory import create_test_app
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from tim_api.config import Settings, SettingsError, get_settings
from tim_api.deps import get_run_store
from tim_api.storage import PostgresRunStore, PostgresStorage, build_storage


@pytest.mark.parametrize("environment", ["development", "production"])
def test_memory_url_is_refused(monkeypatch: pytest.MonkeyPatch, environment: str) -> None:
    monkeypatch.setenv("TIM_ENVIRONMENT", environment)
    monkeypatch.setenv("TIM_DATABASE_URL", "memory://")
    with pytest.raises(SettingsError, match="TIM_DATABASE_URL"):
        get_settings()


async def test_postgres_url_selects_postgres() -> None:
    storage = build_storage(Settings(_env_file=None))
    assert isinstance(storage, PostgresStorage)
    await storage.aclose()


def test_dependencies_resolve_from_lifespan() -> None:
    app: FastAPI = create_test_app()

    @app.get("/_probe")
    def probe(
        runs: PostgresRunStore = Depends(get_run_store),  # noqa: B008
    ) -> dict[str, bool]:
        return {
            "runs": isinstance(runs, PostgresRunStore),
        }

    with TestClient(app) as client:
        assert client.get("/_probe").json() == {"runs": True}
