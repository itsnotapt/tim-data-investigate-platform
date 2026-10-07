"""Contract conformance: the generated OpenAPI spec against the documented API contract.

Regenerate the snapshot with ``UPDATE_SNAPSHOTS=1 uv run pytest tests/test_openapi_contract.py``
and the web copy with ``uv run python -m tim_api.openapi_export``.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest

from tim_api.openapi_export import DEFAULT_OUT, generate_spec, render_spec

SNAPSHOT = Path(__file__).parent / "snapshots" / "openapi.json"
REGEN = "uv run python -m tim_api.openapi_export"

# (method, path, operationId, success statuses, documented error statuses).
CONTRACT: list[tuple[str, str, str, set[str], set[str]]] = [
    ("post", "/api/kusto/schema", "getSchema", {"200"}, {"400", "401", "403", "502"}),
    ("post", "/api/kusto/query", "runQuery", {"200", "202"}, {"400", "401"}),
    ("get", "/api/kusto/query/{queryRunId}", "getQueryRun", {"200"}, {"400", "401", "404"}),
    ("get", "/api/templates/queries", "listTemplates", {"200"}, {"400", "401"}),
    ("get", "/api/templates/queries/{uuid}", "getTemplate", {"200"}, {"400", "401", "404"}),
    ("post", "/api/templates/queries", "createTemplate", {"201"}, {"400", "401", "409"}),
    ("put", "/api/templates/queries/{uuid}", "replaceTemplate", {"200"}, {"400", "401", "404"}),
    ("patch", "/api/templates/queries/{uuid}", "patchTemplate", {"200"}, {"400", "401", "404"}),
    ("delete", "/api/templates/queries/{uuid}", "deleteTemplate", {"204"}, {"400", "401", "404"}),
    ("post", "/api/taggedevents/savedEvents", "saveEvents", {"204"}, {"400", "401", "502"}),
    ("post", "/api/taggedevents/tags", "tagEvents", {"204"}, {"400", "401", "502"}),
    ("post", "/api/taggedevents/comments", "commentEvents", {"204"}, {"400", "401", "502"}),
    ("get", "/api/healthChecks/liveness", "liveness", {"204"}, set()),
    ("get", "/api/healthChecks/readiness", "readiness", {"204"}, {"503"}),
]


@pytest.fixture(scope="module")
def spec() -> dict[str, Any]:
    return generate_spec()


def test_openapi_matches_snapshot() -> None:
    rendered = render_spec()
    if os.environ.get("UPDATE_SNAPSHOTS") == "1":
        SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
        SNAPSHOT.write_text(rendered, encoding="utf-8", newline="\n")
    assert SNAPSHOT.exists(), "missing snapshot; run with UPDATE_SNAPSHOTS=1"
    assert json.loads(SNAPSHOT.read_text(encoding="utf-8")) == json.loads(rendered), (
        "OpenAPI changed; review it, then run with UPDATE_SNAPSHOTS=1 and "
        f"regenerate the web copy with `{REGEN}`"
    )


def test_web_openapi_is_up_to_date() -> None:
    assert DEFAULT_OUT.exists(), f"missing {DEFAULT_OUT}; run `{REGEN}`"
    assert DEFAULT_OUT.read_text(encoding="utf-8") == render_spec(), f"stale; run `{REGEN}`"


def test_export_is_deterministic() -> None:
    assert render_spec() == render_spec()


@pytest.mark.parametrize(("method", "path", "operation_id", "success", "errors"), CONTRACT)
def test_contract_operation(
    spec: dict[str, Any],
    method: str,
    path: str,
    operation_id: str,
    success: set[str],
    errors: set[str],
) -> None:
    assert path in spec["paths"], path
    operation = spec["paths"][path].get(method)
    assert operation is not None, f"{method.upper()} {path} missing"
    assert operation["operationId"] == operation_id
    statuses = set(operation["responses"])
    assert success <= statuses
    assert errors <= statuses
    assert "422" not in statuses  # validation failures are 400 problem+json
    for status in errors:
        content = operation["responses"][status]["content"]
        ref = content["application/problem+json"]["schema"]["$ref"]
        assert ref == "#/components/schemas/ProblemDetails"
    is_public = path.startswith("/api/healthChecks")
    assert ("security" in operation) is not is_public


def test_no_undocumented_operations(spec: dict[str, Any]) -> None:
    actual = {(m, p) for p, item in spec["paths"].items() for m in item}
    assert actual == {(m, p) for m, p, *_ in CONTRACT}


def test_all_paths_under_api(spec: dict[str, Any]) -> None:
    assert all(p.startswith("/api/") for p in spec["paths"])


def test_request_and_response_schemas(spec: dict[str, Any]) -> None:
    paths = spec["paths"]

    def body_ref(path: str, method: str) -> str:
        schema = paths[path][method]["requestBody"]["content"]["application/json"]["schema"]
        return str(schema.get("$ref") or schema["items"]["$ref"])

    def ok_schema(path: str, method: str, status: str) -> dict[str, Any]:
        schema: dict[str, Any] = paths[path][method]["responses"][status]["content"][
            "application/json"
        ]["schema"]
        return schema

    assert body_ref("/api/kusto/schema", "post").endswith("/KustoClusterDatabase")
    assert body_ref("/api/kusto/query", "post").endswith("/KustoQueryRequest")
    assert body_ref("/api/templates/queries", "post").endswith("/QueryTemplateCreate")
    assert body_ref("/api/templates/queries/{uuid}", "put").endswith("/QueryTemplateReplace")
    assert body_ref("/api/templates/queries/{uuid}", "patch").endswith("/PatchOperation")
    assert body_ref("/api/taggedevents/savedEvents", "post").endswith("/SavedEvent")
    assert body_ref("/api/taggedevents/tags", "post").endswith("/EventTag")
    assert body_ref("/api/taggedevents/comments", "post").endswith("/EventComment")

    assert ok_schema("/api/kusto/query", "post", "200")["$ref"].endswith("/KustoQueryRun")
    assert ok_schema("/api/kusto/query", "post", "202")["$ref"].endswith("/KustoQueryRun")
    assert ok_schema("/api/kusto/query/{queryRunId}", "get", "200")["$ref"].endswith(
        "/KustoQueryRun"
    )
    assert ok_schema("/api/templates/queries", "get", "200")["items"]["$ref"].endswith(
        "/QueryTemplate"
    )
    assert ok_schema("/api/kusto/schema", "post", "200")["$ref"].endswith("/SchemaResponse")


def test_json_names_are_camel_case(spec: dict[str, Any]) -> None:
    schemas = spec["components"]["schemas"]
    # Kusto stats keys are data, returned as Kusto spells them.
    skip = {"KustoQueryStats"}
    for name, schema in schemas.items():
        if name in skip:
            continue
        for prop in schema.get("properties", {}):
            assert "_" not in prop, f"{name}.{prop}"
    assert {"traceId", "errors"} <= set(schemas["ProblemDetails"]["properties"])
    assert "queryRunId" in schemas["KustoQueryRun"]["properties"]
    assert {"includeDeleted", "since"} == {
        p["name"] for p in spec["paths"]["/api/templates/queries"]["get"]["parameters"]
    }


def test_enums_match_contract(spec: dict[str, Any]) -> None:
    schemas = spec["components"]["schemas"]
    assert schemas["QueryType"]["enum"] == ["view", "query"]
    assert schemas["QueryRunStatus"]["enum"] == ["created", "completed", "error", "timedOut"]


def test_create_template_documents_location_header(spec: dict[str, Any]) -> None:
    response = spec["paths"]["/api/templates/queries"]["post"]["responses"]["201"]
    assert "Location" in response["headers"]
