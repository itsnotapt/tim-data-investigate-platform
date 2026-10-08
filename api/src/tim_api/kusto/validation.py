"""Kusto cluster URL policy.

A cluster URL must be an absolute ``https`` URL with a plain DNS host (no credentials, port other
than 443, path, query or fragment) whose host matches an entry of the cluster allow-list.
Validation runs before any token is acquired or sent to the cluster.

Allow-list entries are host patterns, compared label by label:

* ``host.domain``: exactly that host.
* ``*.domain``: exactly one label in front of ``domain``.
* ``**.domain``: one or more labels in front of ``domain``.

``domain`` itself never matches a wildcard entry.
"""

from __future__ import annotations

import ipaddress
import re
from collections.abc import Iterable
from typing import TYPE_CHECKING
from urllib.parse import urlsplit

if TYPE_CHECKING:
    from tim_api.config import Settings

_LABEL = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
_FORBIDDEN_CHARS = re.compile(r"[\s\x00-\x1f\x7f\\]")


class InvalidClusterError(ValueError):
    """Cluster URL rejected by policy. ``str(exc)`` is safe to show to the user."""


def _reject(reason: str) -> InvalidClusterError:
    return InvalidClusterError(f"Invalid cluster URL: {reason}.")


def _ascii_host(host: str) -> str:
    """Lowercased ASCII (punycode) form of ``host``, or raise."""
    try:
        ascii_host = host.encode("idna").decode("ascii").lower()
    except UnicodeError:
        raise _reject("host is not a valid domain name") from None
    labels = ascii_host.split(".")
    if len(ascii_host) > 253 or not all(_LABEL.match(label) for label in labels):
        raise _reject("host is not a valid domain name")
    return ascii_host


def normalise_host_pattern(entry: str) -> str:
    """Normalised form of one allow-list entry (lowercase, punycode, no trailing dot).

    Raises ``ValueError`` naming the entry and the reason when the entry is not a valid pattern.
    """

    def bad(reason: str) -> ValueError:
        return ValueError(f"invalid host pattern {entry!r}: {reason}")

    text = entry.strip().lower()
    if not text:
        raise bad("must not be empty")
    if any(ch in text for ch in ("/", ":", "@", "[", "]")) or _FORBIDDEN_CHARS.search(text):
        raise bad("must be a bare host name without scheme, port, path or credentials")
    if text.endswith("."):
        text = text[:-1]

    labels = text.split(".")
    wildcard = ""
    if labels[0] in ("*", "**"):
        wildcard = labels.pop(0)
        if not labels:
            raise bad("a wildcard must be followed by a domain")
    elif "*" in labels[0]:
        raise bad("a wildcard must be the whole first label, `*` or `**`")
    if any("*" in label for label in labels):
        raise bad("a wildcard is only allowed as the whole first label")
    if any(not label for label in labels):
        raise bad("must not contain empty labels")

    domain = ".".join(labels)
    try:
        ascii_domain = domain.encode("idna").decode("ascii").lower()
    except UnicodeError:
        raise bad("not a valid domain name") from None
    if len(ascii_domain) > 253 or not all(_LABEL.match(label) for label in ascii_domain.split(".")):
        raise bad("not a valid domain name")
    if _is_ip_literal(ascii_domain):
        raise bad("must not be an IP address")
    return f"{wildcard}.{ascii_domain}" if wildcard else ascii_domain


def host_matches_pattern(host: str, pattern: str) -> bool:
    """Whether ASCII ``host`` matches a normalised ``pattern`` (see the module docstring)."""
    pattern_labels = pattern.split(".")
    wildcard = pattern_labels[0] if pattern_labels[0] in ("*", "**") else ""
    if wildcard:
        pattern_labels = pattern_labels[1:]
    host_labels = host.split(".")
    extra = len(host_labels) - len(pattern_labels)
    if host_labels[extra:] != pattern_labels:
        return False
    if wildcard == "*":
        return extra == 1
    if wildcard == "**":
        return extra >= 1
    return extra == 0


def host_is_allowed(host: str, patterns: Iterable[str]) -> bool:
    """Whether ASCII ``host`` matches any of the normalised ``patterns``."""
    return any(host_matches_pattern(host, pattern) for pattern in patterns)


def _is_ip_literal(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return False
    return True


def validate_cluster_url(url: str, settings: Settings) -> str:
    """Validate ``url`` against the cluster policy and return ``https://<host>``."""
    raw = url.strip() if isinstance(url, str) else ""
    if not raw:
        raise _reject("value is required")
    if _FORBIDDEN_CHARS.search(raw):
        raise _reject("contains whitespace or control characters")

    try:
        parts = urlsplit(raw)
    except ValueError:
        raise _reject("not a valid URL") from None

    if parts.scheme.lower() != "https" or not raw.lower().startswith("https://"):
        raise _reject("must be an absolute https URL")
    if parts.query or parts.fragment or "?" in raw or "#" in raw:
        raise _reject("must not contain a query or fragment")
    if parts.path not in ("", "/"):
        raise _reject("must not contain a path")

    netloc = parts.netloc
    if "@" in netloc:
        raise _reject("must not contain credentials")
    if "[" in netloc or "]" in netloc:
        raise _reject("must not be an IP address")
    try:
        port = parts.port
    except ValueError:
        raise _reject("invalid port") from None
    if netloc.endswith(":") or (port is not None and port != 443):
        raise _reject("port must be omitted or 443")

    hostname = parts.hostname
    if not hostname:
        raise _reject("host is missing")
    if _is_ip_literal(hostname):
        raise _reject("must not be an IP address")
    host = _ascii_host(hostname)
    if _is_ip_literal(host):
        raise _reject("must not be an IP address")

    if not host_is_allowed(host, settings.allowed_kusto_hosts):
        raise _reject("host is not in the allowed cluster list")

    return f"https://{host}"
