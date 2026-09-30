from pathlib import Path

import pytest

from tim_api.config import Settings, SettingsError, get_settings


def make(**overrides: object) -> Settings:
    return Settings(_env_file=None, **overrides)  # type: ignore[arg-type]


def test_missing_required_var_names_it(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TIM_AUTH_CLIENT_ID")
    monkeypatch.delenv("TIM_DATABASE_URL")
    with pytest.raises(SettingsError) as info:
        get_settings()
    message = str(info.value)
    assert "TIM_AUTH_CLIENT_ID" in message
    assert "TIM_DATABASE_URL" in message
    assert "TIM_AUTH_TENANT_ID" not in message


def test_invalid_value_is_reported_without_echoing_it(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TIM_DATABASE_URL", "mysql://user:hunter2@host/db")
    with pytest.raises(SettingsError) as info:
        get_settings()
    assert "TIM_DATABASE_URL" in str(info.value)
    assert "hunter2" not in str(info.value)


def test_non_https_cluster_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TIM_TAG_CLUSTER_URI", "http://x.kusto.windows.net")
    with pytest.raises(SettingsError, match="TIM_TAG_CLUSTER_URI"):
        get_settings()


def test_defaults_applied() -> None:
    s = make()
    assert s.environment == "production"
    assert s.tag_database == "Research"
    assert s.tag_ingest_url is None
    assert s.tag_ingest_fake is False
    assert s.auth_client_secret is not None
    assert s.auth_disabled is False
    assert s.cors_allowed_origins == []
    assert s.allowed_kusto_hosts == []
    assert s.allowed_kusto_suffixes == [".kusto.windows.net", ".kusto.fabric.microsoft.com"]
    assert s.max_result_rows == 100_000
    assert s.max_result_bytes == 64 * 1024 * 1024
    assert s.query_timeout_seconds == 600
    assert s.run_retention_seconds == 86_400
    assert s.kusto_obo_scope == "{cluster}/.default"


def test_list_parsing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TIM_CORS_ALLOWED_ORIGINS", "http://a.test, https://b.test ,")
    monkeypatch.setenv("TIM_ALLOWED_KUSTO_SUFFIXES", ".Kusto.Windows.NET,.kusto.chinacloudapi.cn")
    monkeypatch.setenv("TIM_ALLOWED_KUSTO_HOSTS", "one.kusto.windows.net")
    s = make()
    assert s.cors_allowed_origins == ["http://a.test", "https://b.test"]
    assert s.allowed_kusto_suffixes == [".kusto.windows.net", ".kusto.chinacloudapi.cn"]
    assert s.allowed_kusto_hosts == ["one.kusto.windows.net"]


def test_empty_list_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TIM_CORS_ALLOWED_ORIGINS", "")
    assert make().cors_allowed_origins == []


def test_secrets_not_leaked(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TIM_AUTH_CLIENT_SECRET", "super-secret-value")
    s = make()
    for text in (repr(s), str(s), str(s.model_dump()), s.model_dump_json()):
        assert "super-secret-value" not in text
        assert "s3cret-pw" not in text
    assert s.auth_client_secret is not None
    assert s.auth_client_secret.get_secret_value() == "super-secret-value"


def test_production_with_auth_disabled_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TIM_AUTH_DISABLED", "true")
    monkeypatch.setenv("TIM_ENVIRONMENT", "production")
    with pytest.raises(SettingsError, match="TIM_AUTH_DISABLED"):
        get_settings()


def test_development_with_auth_disabled_allowed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TIM_AUTH_DISABLED", "true")
    monkeypatch.setenv("TIM_ENVIRONMENT", "development")
    assert get_settings().auth_disabled is True


def test_get_settings_is_cached() -> None:
    assert get_settings() is get_settings()


def test_reads_dotenv_file(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text("TIM_TAG_DATABASE=FromFile\n")
    assert Settings(_env_file=env_file).tag_database == "FromFile"
