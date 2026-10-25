from pathlib import Path
from typing import Any

import pytest
from pydantic import SecretStr

from tim_api.auth import Principal
from tim_api.auth.obo import (
    DisabledOboTokenProvider,
    MsalOboTokenProvider,
    OboAuthError,
    OboConfigError,
    OboUnavailableError,
    OboUpstreamError,
    build_obo_provider,
)
from tim_api.config import Settings

PRINCIPAL = Principal(oid="o", name="u@example.com", tenant_id="t", token=SecretStr("user-jwt"))
APP_SECRET = "app-secret"  # noqa: S105
SCOPE = "https://c1.westeurope.kusto.windows.net/.default"


class FakeApp:
    def __init__(self) -> None:
        self.init_kwargs: dict[str, Any] = {}
        self.calls: list[tuple[str, list[str]]] = []
        self.result: dict[str, Any] | Exception = {"access_token": "kusto-token"}

    def acquire_token_on_behalf_of(self, user_assertion: str, scopes: list[str]) -> dict[str, Any]:
        self.calls.append((user_assertion, scopes))
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def _settings(monkeypatch: pytest.MonkeyPatch, secret: str | None = APP_SECRET) -> Settings:
    monkeypatch.delenv("AZURE_FEDERATED_TOKEN_FILE", raising=False)
    monkeypatch.delenv("TIM_AUTH_CLIENT_SECRET", raising=False)
    if secret is not None:
        monkeypatch.setenv("TIM_AUTH_CLIENT_SECRET", secret)
    return Settings()


def _provider(settings: Settings) -> tuple[MsalOboTokenProvider, FakeApp]:
    app = FakeApp()

    def factory(**kwargs: Any) -> FakeApp:
        app.init_kwargs = kwargs
        return app

    return MsalOboTokenProvider(settings, app_factory=factory), app


def test_scope_and_user_assertion_are_passed_through(monkeypatch: pytest.MonkeyPatch) -> None:
    provider, app = _provider(_settings(monkeypatch))
    other = "api://other/.default"
    assert provider.token_for(PRINCIPAL, SCOPE) == "kusto-token"
    provider.token_for(PRINCIPAL, other)
    assert app.calls == [("user-jwt", [SCOPE]), ("user-jwt", [other])]


def test_app_created_once_and_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    created = 0

    def factory(**kwargs: Any) -> FakeApp:
        nonlocal created
        created += 1
        return FakeApp()

    provider = MsalOboTokenProvider(_settings(monkeypatch), app_factory=factory)
    for _ in range(3):
        provider.token_for(PRINCIPAL, SCOPE)
    assert created == 1

    provider, app = _provider(_settings(monkeypatch))
    provider.token_for(PRINCIPAL, SCOPE)
    assert app.init_kwargs["client_id"] == "client-id"
    assert app.init_kwargs["client_credential"] == "app-secret"
    assert app.init_kwargs["authority"] == "https://login.microsoftonline.com/tenant-id"


@pytest.mark.parametrize("error", ["invalid_grant", "interaction_required"])
def test_reauth_errors_map_to_auth_error(monkeypatch: pytest.MonkeyPatch, error: str) -> None:
    provider, app = _provider(_settings(monkeypatch))
    app.result = {"error": error, "error_description": "AADSTS65001 secret-detail"}
    with pytest.raises(OboAuthError) as info:
        provider.token_for(PRINCIPAL, SCOPE)
    assert "secret-detail" not in str(info.value)


def test_other_error_dict_maps_to_upstream(monkeypatch: pytest.MonkeyPatch) -> None:
    provider, app = _provider(_settings(monkeypatch))
    app.result = {"error": "temporarily_unavailable", "error_description": "503"}
    with pytest.raises(OboUpstreamError):
        provider.token_for(PRINCIPAL, SCOPE)
    app.result = {}
    with pytest.raises(OboUpstreamError):
        provider.token_for(PRINCIPAL, SCOPE)


def test_exception_maps_to_upstream_without_leaking(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    provider, app = _provider(_settings(monkeypatch))
    app.result = ConnectionError("boom user-jwt")
    with pytest.raises(OboUpstreamError) as info:
        provider.token_for(PRINCIPAL, SCOPE)
    assert "user-jwt" not in str(info.value)
    assert "user-jwt" not in caplog.text


def test_missing_user_token(monkeypatch: pytest.MonkeyPatch) -> None:
    provider, _ = _provider(_settings(monkeypatch))
    with pytest.raises(OboUnavailableError):
        provider.token_for(PRINCIPAL.model_copy(update={"token": None}), SCOPE)


def test_missing_credential_fails_clearly(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = _settings(monkeypatch, secret=None)
    with pytest.raises(OboConfigError, match="TIM_AUTH_CLIENT_SECRET"):
        build_obo_provider(settings)


def test_without_a_credential_obo_is_unavailable_when_not_required(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = build_obo_provider(_settings(monkeypatch, secret=None), credential_required=False)
    with pytest.raises(OboUnavailableError, match="No client credential"):
        provider.token_for(PRINCIPAL, SCOPE)


def test_federated_assertion_used_without_secret(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    settings = _settings(monkeypatch, secret=None)
    token_file = tmp_path / "token"
    token_file.write_text("fed-1\n")
    monkeypatch.setenv("AZURE_FEDERATED_TOKEN_FILE", str(token_file))
    provider, app = _provider(settings)
    provider.token_for(PRINCIPAL, SCOPE)
    credential = app.init_kwargs["client_credential"]
    assert credential["client_assertion"]() == "fed-1"
    token_file.write_text("fed-2")
    assert credential["client_assertion"]() == "fed-2"


def test_federated_file_must_exist(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    settings = _settings(monkeypatch, secret=None)
    monkeypatch.setenv("AZURE_FEDERATED_TOKEN_FILE", str(tmp_path / "nope"))
    with pytest.raises(OboConfigError, match="AZURE_FEDERATED_TOKEN_FILE"):
        build_obo_provider(settings)


def test_auth_disabled_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TIM_ENVIRONMENT", "development")
    monkeypatch.setenv("TIM_AUTH_DISABLED", "true")
    provider = build_obo_provider(Settings())
    assert isinstance(provider, DisabledOboTokenProvider)
    with pytest.raises(OboUnavailableError, match="AUTH_DISABLED"):
        provider.token_for(PRINCIPAL, SCOPE)


def test_default_factory_builds_real_msal_app(monkeypatch: pytest.MonkeyPatch) -> None:
    # Constructing the real app does no network I/O for a secret credential.
    provider = build_obo_provider(_settings(monkeypatch))
    assert isinstance(provider, MsalOboTokenProvider)


def test_dependency_caches_provider_on_app(monkeypatch: pytest.MonkeyPatch) -> None:
    from typing import Annotated

    from fastapi import Depends, FastAPI
    from fastapi.testclient import TestClient

    from tim_api.auth import OboTokenProvider, get_obo_provider

    monkeypatch.setenv("TIM_AUTH_CLIENT_SECRET", "s")
    app = FastAPI()
    seen: list[int] = []

    @app.get("/x")
    def x(p: Annotated[OboTokenProvider, Depends(get_obo_provider)]) -> None:
        seen.append(id(p))

    client = TestClient(app)
    client.get("/x")
    client.get("/x")
    assert len(set(seen)) == 1
