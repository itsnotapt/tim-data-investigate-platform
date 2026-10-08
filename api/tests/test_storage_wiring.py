import pytest
from app_factory import create_test_app
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from tim_api.config import Settings, SettingsError, get_settings
from tim_api.deps import get_run_store, get_template_store
from tim_api.storage import (
    MemoryStorage,
    PostgresStorage,
    QueryRunStore,
    TemplateStore,
    build_storage,
)


def test_memory_url_selects_memory(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TIM_ENVIRONMENT", "development")
    monkeypatch.setenv("TIM_DATABASE_URL", "memory://")
    assert isinstance(build_storage(get_settings()), MemoryStorage)


def test_memory_url_rejected_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
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
        templates: TemplateStore = Depends(get_template_store),  # noqa: B008
        runs: QueryRunStore = Depends(get_run_store),  # noqa: B008
    ) -> dict[str, bool]:
        return {
            "templates": isinstance(templates, TemplateStore),
            "runs": isinstance(runs, QueryRunStore),
        }

    with TestClient(app) as client:
        assert client.get("/_probe").json() == {"templates": True, "runs": True}
