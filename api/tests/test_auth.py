import logging
from typing import Annotated

import pytest
from app_factory import create_test_app
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from tim_api.auth import DEV_PRINCIPAL, Principal, get_current_principal
from tim_api.config import SettingsError, get_settings


def _app() -> FastAPI:
    app = create_test_app()

    @app.get("/test/whoami")
    def whoami(principal: Annotated[Principal, Depends(get_current_principal)]) -> dict[str, str]:
        return {"oid": principal.oid, "name": principal.name, "tid": principal.tenant_id}

    return app


def test_disabled_in_development_returns_dev_principal(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setenv("TIM_ENVIRONMENT", "development")
    monkeypatch.setenv("TIM_AUTH_DISABLED", "true")
    with caplog.at_level(logging.WARNING, logger="tim_api"), TestClient(_app()) as client:
        first = client.get("/test/whoami")
        client.get("/test/whoami")
    assert first.status_code == 200
    assert first.json() == {
        "oid": DEV_PRINCIPAL.oid,
        "name": DEV_PRINCIPAL.name,
        "tid": DEV_PRINCIPAL.tenant_id,
    }
    warnings = [r for r in caplog.records if "AUTHENTICATION IS DISABLED" in r.message]
    assert len(warnings) == 1  # once at startup, not per request


def test_production_with_auth_disabled_fails_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TIM_ENVIRONMENT", "production")
    monkeypatch.setenv("TIM_AUTH_DISABLED", "true")
    with pytest.raises(SettingsError, match="TIM_AUTH_DISABLED"):
        get_settings()


def test_production_with_auth_disabled_refuses_to_start(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TIM_ENVIRONMENT", "production")
    monkeypatch.setenv("TIM_AUTH_DISABLED", "true")
    with pytest.raises(SettingsError), TestClient(create_test_app()):
        pass


def test_enabled_without_token_returns_401() -> None:
    with TestClient(_app()) as client:
        response = client.get("/test/whoami")
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


def test_enabled_with_garbage_token_returns_401_without_echoing_it() -> None:
    with TestClient(_app()) as client:
        response = client.get("/test/whoami", headers={"Authorization": "Bearer abc"})
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert "abc" not in response.text
