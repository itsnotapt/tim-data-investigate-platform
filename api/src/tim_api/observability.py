"""Trace ids, stdlib logging setup, request logging and lazy CORS.

Nothing here logs headers or bodies: a request line contains method, path (no query string),
status, duration and trace id only, so ``Authorization`` values can never reach the logs.
"""

from __future__ import annotations

import logging
import re
import secrets
import time
from typing import TYPE_CHECKING

from fastapi import Request
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request as StarletteRequest
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from tim_api.config import get_settings

if TYPE_CHECKING:
    from starlette.responses import Response

logger = logging.getLogger("tim_api")

TRACE_HEADER = "x-trace-id"
_TRACEPARENT = re.compile(r"^[0-9a-f]{2}-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-[0-9a-f]{2}$")
_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
_HANDLER_MARK = "_tim_handler"
# API responses are JSON carrying user data: never sniffed, never cached by browsers/proxies.
_SECURITY_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"cache-control", b"no-store"),
]


_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f\u2028\u2029]")


def log_safe(value: str) -> str:
    """Escape control characters so a request path cannot forge log lines."""
    return _CONTROL.sub(lambda m: f"\\x{ord(m.group()):02x}", value)


def new_trace_id() -> str:
    return f"00-{secrets.token_hex(16)}-{secrets.token_hex(8)}-01"


def resolve_trace_id(request: Request) -> str:
    """Accept a valid W3C ``traceparent`` or a sane ``x-request-id``; else generate one."""
    traceparent = request.headers.get("traceparent", "").strip().lower()
    if _TRACEPARENT.match(traceparent):
        return traceparent
    request_id = request.headers.get("x-request-id", "").strip()
    if _REQUEST_ID.match(request_id):
        return request_id
    return new_trace_id()


def get_trace_id(request: Request) -> str:
    trace_id: str | None = getattr(request.state, "trace_id", None)
    if trace_id is None:  # error raised before the logging middleware ran
        trace_id = resolve_trace_id(request)
        request.state.trace_id = trace_id
    return trace_id


def configure_logging(level: str) -> None:
    """Stdlib logging for the ``tim_api`` tree; idempotent, level from ``TIM_LOG_LEVEL``."""
    log = logging.getLogger("tim_api")
    log.setLevel(level)
    if not any(getattr(h, _HANDLER_MARK, False) for h in log.handlers):
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
        setattr(handler, _HANDLER_MARK, True)
        log.addHandler(handler)


class BodySizeLimitMiddleware:
    """Reject request bodies over ``TIM_MAX_REQUEST_BYTES`` with 413.

    Checks ``Content-Length`` up front and counts streamed bytes (chunked uploads). Sits inside
    the logging middleware so the 413 carries a trace id. Settings are read on first request.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        from tim_api.errors import problem_exception, problem_response  # avoid an import cycle

        limit = get_settings().max_request_bytes
        declared = StarletteRequest(scope).headers.get("content-length", "")
        if declared.isdigit() and int(declared) > limit:
            response = problem_response(
                StarletteRequest(scope), 413, "Request body is too large", slug="too-large"
            )
            await response(scope, receive, send)
            return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise problem_exception(413, "Request body is too large")
            return message

        await self.app(scope, limited_receive, send)


class RequestLoggingMiddleware:
    """Pure ASGI middleware: assigns the trace id, logs one line per request."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        from tim_api.errors import unhandled_response  # avoid an import cycle

        request = StarletteRequest(scope, receive)
        trace_id = resolve_trace_id(request)
        request.state.trace_id = trace_id  # shares scope["state"] with downstream requests
        started = time.perf_counter()
        status_code = 500

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                headers = [
                    (k, v) for k, v in message["headers"] if k.lower() != TRACE_HEADER.encode()
                ]
                headers.append((TRACE_HEADER.encode(), trace_id.encode()))
                present = {k.lower() for k, _ in headers}
                for name, value in _SECURITY_HEADERS:
                    if name not in present:
                        headers.append((name, value))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception as exc:
            response: Response = unhandled_response(request, exc)
            await response(scope, receive, send_wrapper)
        finally:
            logger.info(
                "%s %s -> %d %.1fms traceId=%s",
                scope["method"],
                log_safe(scope["path"]),
                status_code,
                (time.perf_counter() - started) * 1000,
                trace_id,
            )


class LazyCORSMiddleware:
    """CORS from ``TIM_CORS_ALLOWED_ORIGINS``, resolved on first request.

    Settings are not read at import time (``app = create_app()`` must import without env).
    With an empty allow-list no CORS headers are sent at all.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self._inner: ASGIApp | None = None

    def _build(self) -> ASGIApp:
        origins = get_settings().cors_allowed_origins
        if not origins:
            return self.app
        return CORSMiddleware(
            self.app,
            allow_origins=origins,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
            allow_headers=["Authorization", "Content-Type", "traceparent", "x-request-id"],
            expose_headers=[TRACE_HEADER],
            allow_credentials=False,  # bearer tokens, not cookies
            max_age=600,
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "lifespan":
            await self.app(scope, receive, send)
            return
        if self._inner is None:
            self._inner = self._build()
        await self._inner(scope, receive, send)
