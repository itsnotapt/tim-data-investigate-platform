"""Kusto cluster URL policy (SEC-01, Q-022).

Implements "Cluster validation" in docs/rewrite/api-contract.md. Must run before any
token is acquired or sent to the cluster.
"""

from __future__ import annotations

import ipaddress
import re
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

    if settings.allowed_kusto_hosts:
        allowed = {_ascii_host(h) for h in settings.allowed_kusto_hosts}
        if host not in allowed:
            raise _reject("host is not allowed")
    else:
        for suffix in settings.allowed_kusto_suffixes:
            dotted = "." + suffix.strip().lstrip(".").lower()
            # Label boundary: dotted starts with "."; require a non-empty label before it.
            if len(dotted) > 1 and host.endswith(dotted) and len(host) > len(dotted):
                break
        else:
            raise _reject("host is not an allowed Kusto domain")

    return f"https://{host}"
