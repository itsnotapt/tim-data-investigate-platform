import pytest
from app_factory import AuthKit, create_test_app
from fastapi.testclient import TestClient


def test_me_is_the_name_the_api_knows_the_analyst_by(auth: AuthKit) -> None:
    app = create_test_app()
    auth.install(app)
    headers = auth.headers("live.com#alice@example.com", preferred_username="alice@example.com")
    with TestClient(app, headers=headers) as client:
        response = client.get("/api/me")
    assert response.status_code == 200
    assert response.json() == {"name": "live.com#alice@example.com"}


def test_me_needs_a_signed_in_analyst() -> None:
    with TestClient(create_test_app()) as client:
        assert client.get("/api/me").status_code == 401


def test_me_is_the_stub_tokens_analyst_with_auth_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TIM_ENVIRONMENT", "development")
    monkeypatch.setenv("TIM_AUTH_DISABLED", "true")
    with TestClient(create_test_app()) as client:
        response = client.get("/api/me", headers={"Authorization": "Bearer dev:bob@example.com"})
    assert response.json() == {"name": "bob@example.com"}
