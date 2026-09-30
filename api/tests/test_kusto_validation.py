from __future__ import annotations

import pytest

from tim_api.config import Settings
from tim_api.kusto.validation import InvalidClusterError, validate_cluster_url


def make_settings(**overrides: object) -> Settings:
    base: dict[str, object] = {
        "auth_tenant_id": "t",
        "auth_client_id": "c",
        "tag_cluster_uri": "https://tags.kusto.windows.net",
        "database_url": "postgresql+asyncpg://u:p@localhost/db",
    }
    base.update(overrides)
    return Settings(_env_file=None, **base)  # type: ignore[arg-type]


DEFAULT = make_settings()

OK = [
    ("https://contoso.westus2.kusto.windows.net", "https://contoso.westus2.kusto.windows.net"),
    ("https://contoso.westus2.kusto.windows.net/", "https://contoso.westus2.kusto.windows.net"),
    ("https://CONTOSO.WestUS2.Kusto.Windows.NET", "https://contoso.westus2.kusto.windows.net"),
    ("https://c.kusto.windows.net:443", "https://c.kusto.windows.net"),
    ("  https://c.kusto.windows.net\n", "https://c.kusto.windows.net"),
    ("HTTPS://c.kusto.windows.net", "https://c.kusto.windows.net"),
    ("https://x.kusto.fabric.microsoft.com", "https://x.kusto.fabric.microsoft.com"),
    ("https://münchen.kusto.windows.net", "https://xn--mnchen-3ya.kusto.windows.net"),
]


@pytest.mark.parametrize(("url", "expected"), OK)
def test_accepts_and_normalises(url: str, expected: str) -> None:
    assert validate_cluster_url(url, DEFAULT) == expected


BAD = [
    "",
    "   ",
    "http://c.kusto.windows.net",
    "file:///etc/passwd",
    "ftp://c.kusto.windows.net",
    "c.kusto.windows.net",
    "//c.kusto.windows.net",
    "contoso.westus2",
    "https:c.kusto.windows.net",
    "https://",
    "https://127.0.0.1",
    "https://[::1]",
    "https://[::1]:443",
    "https://2130706433",
    "https://user@c.kusto.windows.net",
    "https://user:pw@c.kusto.windows.net",
    "https://c.kusto.windows.net:8080",
    "https://c.kusto.windows.net:80",
    "https://c.kusto.windows.net:",
    "https://c.kusto.windows.net:abc",
    "https://c.kusto.windows.net/db",
    "https://c.kusto.windows.net/?a=1",
    "https://c.kusto.windows.net?a=1",
    "https://c.kusto.windows.net#f",
    "https://c.kusto.windows.net\\@evil.com",
    "https://c.kusto.windows.net evil.com",
    "https://evil-kusto.windows.net",
    "https://kusto.windows.net.evil.com",
    "https://kusto.windows.net",
    "https://.kusto.windows.net",
    "https://c.kusto.windows.net.",
    "https://evil.com",
    "https://c.kusto.windows.net@evil.com",
    "https://xn--zz-.kusto.windows.net",
]


@pytest.mark.parametrize("url", BAD)
def test_rejects(url: str) -> None:
    with pytest.raises(InvalidClusterError) as info:
        validate_cluster_url(url, DEFAULT)
    assert isinstance(info.value, ValueError)
    assert "Invalid cluster URL" in str(info.value)


def test_error_message_does_not_echo_input() -> None:
    with pytest.raises(InvalidClusterError) as info:
        validate_cluster_url("https://secret-host.evil.com", DEFAULT)
    assert "secret-host" not in str(info.value)


STRICT = make_settings(allowed_kusto_hosts="Only.Kusto.Windows.Net")


@pytest.mark.parametrize(
    ("url", "ok"),
    [
        ("https://only.kusto.windows.net", True),
        ("https://ONLY.kusto.windows.net/", True),
        ("https://other.kusto.windows.net", False),
        ("https://x.only.kusto.windows.net", False),
    ],
)
def test_strict_host_list(url: str, ok: bool) -> None:
    if ok:
        assert validate_cluster_url(url, STRICT) == "https://only.kusto.windows.net"
    else:
        with pytest.raises(InvalidClusterError):
            validate_cluster_url(url, STRICT)


def test_strict_list_overrides_suffixes() -> None:
    with pytest.raises(InvalidClusterError):
        validate_cluster_url("https://c.kusto.fabric.microsoft.com", STRICT)


@pytest.mark.parametrize(
    ("suffixes", "url", "ok"),
    [
        ("corp.example", "https://a.corp.example", True),  # no leading dot configured
        (".corp.example", "https://a.corp.example", True),
        (".corp.example", "https://acorp.example", False),
        (".corp.example", "https://c.kusto.windows.net", False),  # default replaced
        ("", "https://c.kusto.windows.net", False),  # empty list allows nothing
    ],
)
def test_custom_suffixes(suffixes: str, url: str, ok: bool) -> None:
    s = make_settings(allowed_kusto_suffixes=suffixes)
    if ok:
        assert validate_cluster_url(url, s) == url
    else:
        with pytest.raises(InvalidClusterError):
            validate_cluster_url(url, s)
