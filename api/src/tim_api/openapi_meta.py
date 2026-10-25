"""OpenAPI metadata that FastAPI cannot derive from the route signatures.

Applied as a post-processing step so the published spec (``/api/openapi.json`` and
``web/src/lib/api/openapi.json``) carries:

* stable ``operationId`` values (they become the function names of the generated web client);
* the documented problem-details responses. FastAPI's default ``422`` becomes ``422 validation``,
  on every operation whose params or body it validates; ``400`` is on every operation with a
  JSON body, which can be unparseable;
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
    400: "Malformed JSON (`bad-request`).",
    401: "Missing, invalid or expired token (`unauthorized`).",
    403: "Consent required, or only the owner may change it (`consent-required` / `forbidden`).",
    404: "Not found (`not-found`).",
    409: (
        "Already exists, the run has not succeeded, or the preset has no action file "
        "(`conflict` / `run-not-succeeded` / `no-action-file`)."
    ),
    410: "The run's results are no longer available (`results-gone`).",
    422: "Invalid values, keyed by field such as `params.<name>` (`validation`).",
    500: "Unhandled error (`internal`).",
    502: "Upstream failure (`upstream`).",
    503: "Dependency unavailable (`unavailable`).",
}

# (method, path) -> (operationId, documented error statuses besides 401/500, which every
# authenticated operation gets, and 400/422, which come from the operation's params and body).
_OPERATIONS: dict[tuple[str, str], tuple[str, tuple[int, ...]]] = {
    ("get", "/api/healthChecks/liveness"): ("liveness", ()),
    ("get", "/api/healthChecks/readiness"): ("readiness", (503,)),
    ("get", "/api/instance"): ("getInstance", ()),
    ("post", "/api/actions/{key}/resolve"): ("resolvePivot", (404,)),
    # The connection's obo token is got first, hence 403/502/503; 502 also when the hook fails.
    ("post", "/api/connections/{name}/schema"): ("getEditorSchema", (403, 404, 502, 503)),
    # Each obo connection's token is got before the run exists, hence 403/502/503 here.
    ("post", "/api/runs"): ("startRun", (403, 502, 503)),
    ("get", "/api/runs/{runId}"): ("getRun", (404,)),
    ("post", "/api/runs/{runId}/cancel"): ("cancelRun", (404,)),
    ("get", "/api/runs/{runId}/rows"): ("getRunRows", (404, 409, 410)),
    ("get", "/api/presets"): ("listPresets", ()),
    ("post", "/api/presets"): ("createPreset", ()),
    ("put", "/api/presets/{presetId}"): ("replacePreset", (403, 404)),
    ("delete", "/api/presets/{presetId}"): ("deletePreset", (403, 404)),
    ("put", "/api/presets/{presetId}/hidden"): ("hidePreset", (404,)),
    ("delete", "/api/presets/{presetId}/hidden"): ("unhidePreset", (404,)),
    ("get", "/api/presets/{presetId}/actionFile"): ("getPresetActionFile", (404, 409)),
    ("get", "/api/columnViews"): ("listColumnViews", ()),
    ("post", "/api/columnViews"): ("createColumnView", ()),
    ("put", "/api/columnViews/{viewId}"): ("replaceColumnView", (403, 404)),
    ("delete", "/api/columnViews/{viewId}"): ("deleteColumnView", (403, 404)),
    ("put", "/api/columnViews/{viewId}/hidden"): ("hideColumnView", (404,)),
    ("delete", "/api/columnViews/{viewId}/hidden"): ("unhideColumnView", (404,)),
    ("patch", "/api/annotations"): ("changeAnnotations", ()),
    ("get", "/api/annotations/changes"): ("getAnnotationChanges", ()),
    ("get", "/api/annotations/history"): ("getAnnotationHistory", ()),
    ("get", "/api/tags/suggestions"): ("getTagSuggestions", ()),
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
            statuses = set(errors)
            if responses.pop("422", None) is not None:
                statuses.add(422)
            if "requestBody" in operation:
                statuses.add(400)
            if operation_id not in _PUBLIC:
                statuses |= {401, 500}
                operation["security"] = [{BEARER: []}]
            for status in statuses:
                responses[str(status)] = _problem_response(status)
    return spec


def install_openapi(app: FastAPI) -> None:
    def openapi() -> dict[str, Any]:
        if app.openapi_schema is None:
            app.openapi_schema = build_openapi(app)
        return app.openapi_schema

    app.openapi = openapi  # type: ignore[method-assign]
