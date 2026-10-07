"""OpenAPI metadata that FastAPI cannot derive from the route signatures.

Applied as a post-processing step so the published spec (``/api/openapi.json`` and
``web/src/lib/api/openapi.json``) carries:

* stable ``operationId`` values (they become the function names of the generated web client);
* the documented problem-details responses (FastAPI's default ``422`` is replaced by ``400``,
  because validation failures are rendered as ``400 validation``);
* the Bearer security scheme on every authenticated operation.

Only the documentation changes here; runtime behaviour is untouched.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi

from tim_api.errors import PROBLEM_CONTENT_TYPE, ProblemDetails

BEARER = "bearerAuth"

_DESCRIPTIONS = {
    400: "Validation failed, or the cluster is not allowed (`validation` / `cluster-not-allowed`).",
    401: "Missing, invalid or expired token (`unauthorized`).",
    403: "Consent required or Kusto denied the user (`consent-required` / `forbidden`).",
    404: "Not found (`not-found`).",
    409: "Already exists (`conflict`).",
    500: "Unhandled error (`internal`).",
    502: "Upstream failure (`upstream`).",
    503: "Dependency unavailable (`unavailable`).",
}

# (method, path) -> (operationId, documented error statuses besides 401/500, which every
# authenticated operation gets).
_OPERATIONS: dict[tuple[str, str], tuple[str, tuple[int, ...]]] = {
    ("get", "/api/healthChecks/liveness"): ("liveness", ()),
    ("get", "/api/healthChecks/readiness"): ("readiness", (503,)),
    ("post", "/api/kusto/schema"): ("getSchema", (400, 403, 502)),
    # Token exchange failures happen before the run exists, hence 403/502/503 here.
    ("post", "/api/kusto/query"): ("runQuery", (400, 403, 502, 503)),
    ("get", "/api/kusto/query/{queryRunId}"): ("getQueryRun", (400, 404)),
    ("get", "/api/templates/queries"): ("listTemplates", (400,)),
    ("get", "/api/templates/queries/{uuid}"): ("getTemplate", (400, 404)),
    ("post", "/api/templates/queries"): ("createTemplate", (400, 409)),
    ("put", "/api/templates/queries/{uuid}"): ("replaceTemplate", (400, 404)),
    ("patch", "/api/templates/queries/{uuid}"): ("patchTemplate", (400, 404)),
    ("delete", "/api/templates/queries/{uuid}"): ("deleteTemplate", (400, 404)),
    ("post", "/api/taggedevents/savedEvents"): ("saveEvents", (400, 502)),
    ("post", "/api/taggedevents/tags"): ("tagEvents", (400, 502)),
    ("post", "/api/taggedevents/comments"): ("commentEvents", (400, 502)),
}
_PUBLIC = {"liveness", "readiness"}


def _problem_response(status: int) -> dict[str, Any]:
    response: dict[str, Any] = {
        "description": _DESCRIPTIONS[status],
        "content": {
            PROBLEM_CONTENT_TYPE: {"schema": {"$ref": "#/components/schemas/ProblemDetails"}}
        },
    }
    if status == 401:
        response["headers"] = {
            "WWW-Authenticate": {"description": "`Bearer`", "schema": {"type": "string"}}
        }
    return response


def build_openapi(app: FastAPI) -> dict[str, Any]:
    spec = get_openapi(
        title=app.title,
        version=app.version,
        openapi_version=app.openapi_version,
        description=app.description,
        routes=app.routes,
    )
    schemas: dict[str, Any] = spec.setdefault("components", {}).setdefault("schemas", {})
    schemas.pop("HTTPValidationError", None)
    schemas.pop("ValidationError", None)
    schemas["ProblemDetails"] = ProblemDetails.model_json_schema(
        ref_template="#/components/schemas/{model}", mode="serialization"
    )
    spec["components"]["securitySchemes"] = {BEARER: {"type": "http", "scheme": "bearer"}}

    for path, item in spec["paths"].items():
        for method, operation in item.items():
            operation_id, errors = _OPERATIONS[(method, path)]
            operation["operationId"] = operation_id
            responses: dict[str, Any] = operation["responses"]
            responses.pop("422", None)
            statuses = set(errors)
            if operation_id not in _PUBLIC:
                statuses |= {401, 500}
                operation["security"] = [{BEARER: []}]
            for status in statuses:
                responses[str(status)] = _problem_response(status)
            if operation_id == "createTemplate":
                responses["201"]["headers"] = {
                    "Location": {
                        "description": "`/api/templates/queries/{uuid}`",
                        "schema": {"type": "string"},
                    }
                }
    return spec


def install_openapi(app: FastAPI) -> None:
    def openapi() -> dict[str, Any]:
        if app.openapi_schema is None:
            app.openapi_schema = build_openapi(app)
        return app.openapi_schema

    app.openapi = openapi  # type: ignore[method-assign]
