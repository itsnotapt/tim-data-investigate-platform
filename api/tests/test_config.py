from pathlib import Path

import pytest
from pydantic import ValidationError

from tim_api.config import DEFAULT_ALLOWED_KUSTO_HOSTS, Settings, SettingsError, get_settings


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
    assert s.allowed_kusto_hosts == list(DEFAULT_ALLOWED_KUSTO_HOSTS) == ["**.kusto.windows.net"]
    assert s.max_result_rows == 100_000
    assert s.max_result_bytes == 64 * 1024 * 1024
    assert s.query_timeout_seconds == 600
    assert s.run_retention_seconds == 86_400
    assert s.kusto_obo_scope == "{cluster}/.default"


def test_list_parsing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TIM_CORS_ALLOWED_ORIGINS", "http://a.test, https://b.test ,")
    monkeypatch.setenv(
        "TIM_ALLOWED_KUSTO_HOSTS", "One.Kusto.Windows.NET, *.Kusto.chinacloudapi.cn."
    )
    s = make()
    assert s.cors_allowed_origins == ["http://a.test", "https://b.test"]
    assert s.allowed_kusto_hosts == ["one.kusto.windows.net", "*.kusto.chinacloudapi.cn"]


def test_empty_list_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TIM_CORS_ALLOWED_ORIGINS", "")
    assert make().cors_allowed_origins == []


@pytest.mark.parametrize("value", ["", "   ", " , ,"])
def test_blank_allowed_hosts_gives_default(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    monkeypatch.setenv("TIM_ALLOWED_KUSTO_HOSTS", value)
    assert make().allowed_kusto_hosts == ["**.kusto.windows.net"]
    assert get_settings().allowed_kusto_hosts == ["**.kusto.windows.net"]


BAD_PATTERNS = [
    "*foo.com",
    "a.*.com",
    "***.com",
    "f*.com",
    "a.b.*",
    "*",
    "**",
    "a..com",
    ".a.com",
    "*..com",
    "a.com..",
    "10.0.0.1",
    "*.10.0.0.1",
    "https://x.com",
    "x.com:443",
    "x.com/p",
    "u@x.com",
    "bad_label.com",
]


@pytest.mark.parametrize("pattern", BAD_PATTERNS)
def test_invalid_allowed_host_pattern_rejected(pattern: str) -> None:
    with pytest.raises(ValidationError, match="invalid host pattern"):
        make(allowed_kusto_hosts=f"ok.example,{pattern}")


@pytest.mark.parametrize("pattern", BAD_PATTERNS)
def test_invalid_allowed_host_pattern_fails_startup(
    monkeypatch: pytest.MonkeyPatch, pattern: str
) -> None:
    monkeypatch.setenv("TIM_ALLOWED_KUSTO_HOSTS", f"ok.example,{pattern}")
    with pytest.raises(SettingsError) as info:
        get_settings()
    message = str(info.value)
    assert "TIM_ALLOWED_KUSTO_HOSTS" in message
    assert repr(pattern) in message


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


def test_empty_optional_secret_is_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    """Compose passes unset optional variables as empty strings (must not become a secret)."""
    monkeypatch.setenv("TIM_AUTH_CLIENT_SECRET", "")
    monkeypatch.setenv("TIM_TAG_INGEST_URL", "")
    s = make()
    assert s.auth_client_secret is None
    assert s.tag_ingest_url is None
