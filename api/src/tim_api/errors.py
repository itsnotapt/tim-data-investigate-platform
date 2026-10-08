"""Problem-details error envelope and exception handlers .

Every non-2xx response is ``application/problem+json`` with ``type``, ``title``, ``status``,
``detail``, ``traceId`` and (validation only) ``errors``. Details are fixed, safe strings:
never stack traces, paths, SQL, tokens or upstream bodies. The full exception of an
unhandled error is logged server-side together with the ``traceId``.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from http import HTTPStatus
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import Field
from starlette.exceptions import HTTPException as StarletteHTTPException

from tim_api.auth.obo import OboAuthError, OboUnavailableError, OboUpstreamError
from tim_api.kusto.validation import InvalidClusterError
from tim_api.models_common import ApiModel
from tim_api.observability import get_trace_id, log_safe
from tim_api.storage import AlreadyExistsError, NotFoundError, StorageUnavailableError
from tim_api.tagged_events.ingest import TagIngestError

logger = logging.getLogger("tim_api")

PROBLEM_CONTENT_TYPE = "application/problem+json"

_TYPES: dict[int, tuple[str, str]] = {
    400: ("validation", "Validation failed"),
    401: ("unauthorized", "Unauthorized"),
    403: ("forbidden", "Forbidden"),
    404: ("not-found", "Not found"),
    409: ("conflict", "Conflict"),
    413: ("too-large", "Payload too large"),
    500: ("internal", "Internal error"),
    502: ("upstream", "Upstream failure"),
    503: ("unavailable", "Service unavailable"),
}

# Keys of the errors object use the JSON names, not the Python attribute names.
_FIELD_NAMES = {"from_": "from"}
_LOCATION_PREFIXES = {"body", "query", "path", "header", "cookie"}


class ProblemDetails(ApiModel):
    """The one error body (RFC 7807 style)."""

    type: str
    title: str
    status: int
    detail: str
    trace_id: str
    errors: dict[str, list[str]] | None = Field(default=None)


def problem_response(
    request: Request,
    status_code: int,
    detail: str,
    *,
    errors: dict[str, list[str]] | None = None,
    headers: Mapping[str, str] | None = None,
    slug: str | None = None,
) -> JSONResponse:
    default_slug, title = _TYPES.get(status_code, (f"http-{status_code}", _phrase(status_code)))
    slug = slug or default_slug
    body = ProblemDetails(
        type=f"urn:tim:problem:{slug}",
        title=title,
        status=status_code,
        detail=detail,
        trace_id=get_trace_id(request),
        errors=errors,
    )
    return JSONResponse(
        body.model_dump(mode="json", exclude_none=True),
        status_code=status_code,
        media_type=PROBLEM_CONTENT_TYPE,
        headers=dict(headers) if headers else None,
    )


def problem_exception(status_code: int, detail: str) -> StarletteHTTPException:
    """An exception that the handlers render as a problem response with a fixed ``detail``."""
    return StarletteHTTPException(status_code=status_code, detail=detail)


def _phrase(status_code: int) -> str:
    try:
        return HTTPStatus(status_code).phrase
    except ValueError:
        return "Error"


def _field_path(loc: tuple[Any, ...], error_type: str) -> str:
    if error_type == "json_invalid":
        return "body"
    parts = list(loc)
    if parts and parts[0] in _LOCATION_PREFIXES:
        parts = parts[1:]
    if not parts:
        return str(loc[0]) if loc else "body"
    return ".".join(_FIELD_NAMES.get(str(p), str(p)) for p in parts)


def validation_errors(exc: RequestValidationError) -> dict[str, list[str]]:
    errors: dict[str, list[str]] = {}
    for err in exc.errors():
        message = "Malformed JSON" if err["type"] == "json_invalid" else str(err["msg"])
        errors.setdefault(_field_path(tuple(err["loc"]), err["type"]), []).append(message)
    return errors


def unhandled_response(request: Request, exc: BaseException) -> JSONResponse:
    """Generic 500; the exception (with stack) is logged here and never returned."""
    trace_id = get_trace_id(request)
    logger.error(
        "Unhandled exception traceId=%s method=%s path=%s",
        trace_id,
        request.method,
        log_safe(request.url.path),
        exc_info=(type(exc), exc, exc.__traceback__),
    )
    return problem_response(request, 500, "Internal error")


def register_exception_handlers(app: FastAPI) -> None:
    async def http_error(request: Request, exc: Exception) -> JSONResponse:
        assert isinstance(exc, StarletteHTTPException)  # noqa: S101
        detail = (
            exc.detail if isinstance(exc.detail, str) and exc.detail else _phrase(exc.status_code)
        )
        return problem_response(request, exc.status_code, detail, headers=exc.headers)

    async def validation_error(request: Request, exc: Exception) -> JSONResponse:
        assert isinstance(exc, RequestValidationError)  # noqa: S101
        return problem_response(
            request, 400, "One or more fields are invalid", errors=validation_errors(exc)
        )

    def fixed(
        status_code: int,
        detail: str,
        headers: Mapping[str, str] | None = None,
        slug: str | None = None,
    ) -> Any:
        async def handler(request: Request, exc: Exception) -> JSONResponse:
            return problem_response(request, status_code, detail, headers=headers, slug=slug)

        return handler

    async def invalid_cluster(request: Request, exc: Exception) -> JSONResponse:
        return problem_response(
            request,
            400,
            "The cluster is not allowed",
            errors={"cluster": [str(exc)]},
            slug="cluster-not-allowed",
        )

    async def unhandled(request: Request, exc: Exception) -> JSONResponse:
        return unhandled_response(request, exc)

    app.add_exception_handler(StarletteHTTPException, http_error)
    app.add_exception_handler(RequestValidationError, validation_error)
    app.add_exception_handler(NotFoundError, fixed(404, "Resource not found"))
    app.add_exception_handler(AlreadyExistsError, fixed(409, "Resource already exists"))
    app.add_exception_handler(StorageUnavailableError, fixed(503, "Service unavailable"))
    app.add_exception_handler(
        # OBO refused (interaction/consent required) -> 403.
        OboAuthError,
        fixed(
            403,
            "Consent or sign-in is required for the downstream service",
            slug="consent-required",
        ),
    )
    app.add_exception_handler(
        OboUpstreamError, fixed(502, "The identity provider could not be reached")
    )
    app.add_exception_handler(OboUnavailableError, fixed(503, "Token exchange is not available"))
    app.add_exception_handler(TagIngestError, fixed(502, "Tag ingestion failed"))
    app.add_exception_handler(InvalidClusterError, invalid_cluster)
    app.add_exception_handler(Exception, unhandled)
