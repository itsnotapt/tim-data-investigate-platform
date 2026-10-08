from __future__ import annotations

import pytest

from tim_api.config import Settings
from tim_api.kusto.validation import (
    InvalidClusterError,
    normalise_host_pattern,
    validate_cluster_url,
)


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
    "https://evilkusto.windows.net",
    "https://x.kusto.fabric.microsoft.com",
]


@pytest.mark.parametrize("url", BAD)
def test_rejects(url: str) -> None:
    with pytest.raises(InvalidClusterError) as info:
        validate_cluster_url(url, DEFAULT)
    assert isinstance(info.value, ValueError)
    assert "Invalid cluster URL" in str(info.value)


def test_not_in_list_reason() -> None:
    with pytest.raises(InvalidClusterError) as info:
        validate_cluster_url("https://evil.com", DEFAULT)
    assert str(info.value) == "Invalid cluster URL: host is not in the allowed cluster list."


def test_error_message_does_not_echo_input() -> None:
    with pytest.raises(InvalidClusterError) as info:
        validate_cluster_url("https://secret-host.evil.com", DEFAULT)
    assert "secret-host" not in str(info.value)


def allowed(url: str, patterns: str) -> bool:
    try:
        validate_cluster_url(url, make_settings(allowed_kusto_hosts=patterns))
    except InvalidClusterError:
        return False
    return True


@pytest.mark.parametrize(
    ("patterns", "url", "ok"),
    [
        # exact
        ("Only.Kusto.Windows.Net", "https://only.kusto.windows.net", True),
        ("only.kusto.windows.net", "https://ONLY.kusto.windows.net/", True),
        ("only.kusto.windows.net", "https://other.kusto.windows.net", False),
        ("only.kusto.windows.net", "https://x.only.kusto.windows.net", False),
        # single-label wildcard
        ("*.d.example", "https://a.d.example", True),
        ("*.d.example", "https://a.b.d.example", False),
        ("*.d.example", "https://d.example", False),
        ("*.kusto.windows.net", "https://evilkusto.windows.net", False),
        ("*.kusto.windows.net", "https://help.kusto.windows.net", True),
        # multi-label wildcard
        ("**.d.example", "https://a.d.example", True),
        ("**.d.example", "https://a.b.d.example", True),
        ("**.d.example", "https://a.b.c.d.example", True),
        ("**.d.example", "https://d.example", False),
        ("**.d.example", "https://ad.example", False),
        ("**.kusto.windows.net", "https://evilkusto.windows.net", False),
        ("**.kusto.windows.net", "https://kusto.windows.net", False),
        # multiple entries, any match wins
        ("a.example, *.b.example", "https://a.example", True),
        ("a.example, *.b.example", "https://x.b.example", True),
        ("a.example, *.b.example", "https://x.c.example", False),
        # trailing-dot patterns
        ("*.kusto.windows.net.", "https://help.kusto.windows.net", True),
        ("exact.example.", "https://exact.example", True),
        # case and IDN
        ("*.MÜNCHEN.example", "https://x.münchen.example", True),
        ("*.MÜNCHEN.example", "https://X.XN--MNCHEN-3YA.example", True),
        ("*.xn--mnchen-3ya.example", "https://x.münchen.example", True),
        ("*.MÜNCHEN.example", "https://x.berlin.example", False),
        # opt-in Fabric
        (
            "**.kusto.windows.net,**.kusto.fabric.microsoft.com",
            "https://x.kusto.fabric.microsoft.com",
            True,
        ),
        ("**.kusto.windows.net", "https://x.kusto.fabric.microsoft.com", False),
    ],
)
def test_pattern_matching(patterns: str, url: str, ok: bool) -> None:
    assert allowed(url, patterns) is ok


@pytest.mark.parametrize(
    ("url", "ok"),
    [
        ("https://help.kusto.windows.net", True),
        ("https://contoso.westus2.kusto.windows.net", True),
        ("https://kusto.windows.net", False),
        ("https://x.kusto.fabric.microsoft.com", False),
    ],
)
def test_default_list(url: str, ok: bool) -> None:
    assert allowed(url, "") is ok
    if ok:
        assert validate_cluster_url(url, DEFAULT) == url


@pytest.mark.parametrize(
    ("entry", "normalised"),
    [
        ("  Host.Example ", "host.example"),
        ("*.Example.COM.", "*.example.com"),
        ("**.münchen.example", "**.xn--mnchen-3ya.example"),
    ],
)
def test_normalise_host_pattern(entry: str, normalised: str) -> None:
    assert normalise_host_pattern(entry) == normalised


@pytest.mark.parametrize(
    "entry",
    [
        "*foo.com",
        "a.*.com",
        "***.com",
        "f*.com",
        "a.b.*",
        "*",
        "**",
        "*.",
        "a..com",
        ".a.com",
        "*..com",
        "a.com..",
        "10.0.0.1",
        "*.10.0.0.1",
        "https://x.com",
        "x.com:443",
        "x.com/path",
        "u@x.com",
        "-bad.com",
        "bad_label.com",
        "",
    ],
)
def test_normalise_host_pattern_rejects(entry: str) -> None:
    with pytest.raises(ValueError, match="invalid host pattern"):
        normalise_host_pattern(entry)
