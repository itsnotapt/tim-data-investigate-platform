import logging
from collections.abc import Iterator
from typing import Annotated, Any

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field

from tim_api.auth.obo import OboAuthError, OboUnavailableError, OboUpstreamError
from tim_api.main import create_app
from tim_api.models_common import ApiModel
from tim_api.storage import (
    AlreadyExistsError,
    MemoryStorage,
    NotFoundError,
    StorageUnavailableError,
)

PROBLEM = "application/problem+json"
SECRET_TEXT = "boom-secret-internal-detail"  # noqa: S105


class Field_(ApiModel):
    from_: str = Field(alias="from")
    query_type: str


class Body(ApiModel):
    items: list[Field_]
    name: str


class Plain(BaseModel):
    n: int


def _app() -> FastAPI:
    app = create_app()

    @app.post("/t/body")
    def body(payload: Body) -> dict[str, str]:
        return {"name": payload.name}

    @app.get("/t/query")
    def query(n: int) -> dict[str, int]:
        return {"n": n}

    @app.get("/t/boom")
    def boom() -> None:
        raise RuntimeError(SECRET_TEXT)

    @app.get("/t/http")
    def http() -> None:
        raise HTTPException(418, "teapot", headers={"X-Extra": "1"})

    @app.get("/t/notfound")
    def notfound() -> None:
        raise NotFoundError("template abc")

    @app.get("/t/exists")
    def exists() -> None:
        raise AlreadyExistsError("template abc")

    @app.get("/t/obo/{kind}")
    def obo(kind: Annotated[str, "kind"]) -> None:
        raise {
            "auth": OboAuthError("secret"),
            "upstream": OboUpstreamError("secret"),
            "unavailable": OboUnavailableError("secret"),
            "storage": StorageUnavailableError("secret"),
        }[kind]

    return app


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(_app(), raise_server_exceptions=False) as c:
        yield c


def _check_envelope(response: Any, status: int, slug: str) -> dict[str, Any]:
    assert response.status_code == status
    assert response.headers["content-type"] == PROBLEM
    body = response.json()
    assert body["type"] == f"urn:tim:problem:{slug}"
    assert body["status"] == status
    assert body["title"]
    assert body["detail"]
    assert body["traceId"] == response.headers["x-trace-id"]
    result: dict[str, Any] = body
    return result


class FakeStorage(MemoryStorage):
    def __init__(self, healthy: bool = True, raises: bool = False) -> None:
        super().__init__()
        self._healthy = healthy
        self._raises = raises

    async def health(self) -> bool:
        if self._raises:
            raise ConnectionError("db password=hunter2")
        return self._healthy


@pytest.mark.parametrize(("healthy", "raises"), [(False, False), (True, True)])
def test_readiness_503_when_storage_down(
    monkeypatch: pytest.MonkeyPatch, healthy: bool, raises: bool
) -> None:
    monkeypatch.setattr(
        "tim_api.main.build_storage", lambda _s: FakeStorage(healthy=healthy, raises=raises)
    )
    with TestClient(create_app()) as client:
        response = client.get("/api/healthChecks/readiness")
        assert client.get("/api/healthChecks/liveness").status_code == 204
    body = _check_envelope(response, 503, "unavailable")
    assert "hunter2" not in response.text
    assert "storage" not in body["detail"].lower()


def test_readiness_204_when_healthy(client: TestClient) -> None:
    response = client.get("/api/healthChecks/readiness")
    assert response.status_code == 204
    assert "x-trace-id" in response.headers


def test_unhandled_error_is_sanitised_and_logged(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO, logger="tim_api"):
        response = client.get("/t/boom")
    body = _check_envelope(response, 500, "internal")
    assert body["detail"] == "Internal error"
    assert SECRET_TEXT not in response.text
    assert "Traceback" not in response.text
    assert "errors" not in body
    error_records = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert len(error_records) == 1
    assert body["traceId"] in error_records[0].getMessage()
    assert error_records[0].exc_info is not None
    assert SECRET_TEXT in str(error_records[0].exc_info[1])


def test_validation_body_is_400_with_camel_case_paths(client: TestClient) -> None:
    response = client.post("/t/body", json={"items": [{"queryType": 1}], "name": None})
    body = _check_envelope(response, 400, "validation")
    errors = body["errors"]
    assert "items.0.from" in errors  # from_ mapped back to `from`
    assert "items.0.queryType" in errors
    assert "name" in errors
    assert not any("from_" in k or "_" in k for k in errors)
    assert all(isinstance(v, list) and v for v in errors.values())


def test_validation_query_and_malformed_json(client: TestClient) -> None:
    body = _check_envelope(client.get("/t/query", params={"n": "x"}), 400, "validation")
    assert list(body["errors"]) == ["n"]
    response = client.post(
        "/t/body", content=b"{not json", headers={"content-type": "application/json"}
    )
    body = _check_envelope(response, 400, "validation")
    assert body["errors"] == {"body": ["Malformed JSON"]}


def test_http_exception_keeps_headers_and_detail(client: TestClient) -> None:
    response = client.get("/t/http")
    body = _check_envelope(response, 418, "http-418")
    assert body["detail"] == "teapot"
    assert response.headers["x-extra"] == "1"


def test_unknown_route_and_method_use_envelope(client: TestClient) -> None:
    _check_envelope(client.get("/api/nope"), 404, "not-found")
    response = client.post("/api/healthChecks/liveness")
    _check_envelope(response, 405, "http-405")
    assert "GET" in response.headers["allow"]


def test_not_found_and_conflict_mapping(client: TestClient) -> None:
    nf = _check_envelope(client.get("/t/notfound"), 404, "not-found")
    assert "abc" not in nf["detail"]
    _check_envelope(client.get("/t/exists"), 409, "conflict")


def test_obo_and_storage_mapping_never_leak_message(client: TestClient) -> None:
    r = client.get("/t/obo/auth")
    _check_envelope(r, 403, "consent-required")
    _check_envelope(client.get("/t/obo/upstream"), 502, "upstream")
    _check_envelope(client.get("/t/obo/unavailable"), 503, "unavailable")
    r = client.get("/t/obo/storage")
    _check_envelope(r, 503, "unavailable")
    assert "secret" not in r.text


def test_auth_401_uses_envelope(client: TestClient) -> None:
    # Reuse the real dependency through a protected test route.
    from tim_api.auth import get_current_principal

    app = _app()

    @app.get("/t/protected")
    def protected(
        _: Annotated[object, __import__("fastapi").Depends(get_current_principal)],
    ) -> None:
        return None

    with TestClient(app) as c:
        response = c.get("/t/protected", headers={"Authorization": "Bearer garbage-token"})
    _check_envelope(response, 401, "unauthorized")
    assert response.headers["www-authenticate"] == "Bearer"
    assert "garbage-token" not in response.text


def test_trace_id_from_traceparent_and_request_id(client: TestClient) -> None:
    tp = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
    response = client.get("/t/notfound", headers={"traceparent": tp})
    assert response.json()["traceId"] == tp == response.headers["x-trace-id"]

    response = client.get("/t/notfound", headers={"x-request-id": "req-123"})
    assert response.json()["traceId"] == "req-123" == response.headers["x-trace-id"]

    # Invalid values are ignored (log-injection safety): a fresh traceparent-style id is made.
    response = client.get("/t/notfound", headers={"x-request-id": "bad\tvalue with spaces"})
    assert response.headers["x-trace-id"].startswith("00-")
    response = client.get(
        "/t/notfound", headers={"traceparent": "00-" + "0" * 32 + "-" + "1" * 16 + "-01"}
    )
    assert response.headers["x-trace-id"] != "00-" + "0" * 32 + "-" + "1" * 16 + "-01"


def test_trace_ids_differ_per_request(client: TestClient) -> None:
    ids = {client.get("/api/healthChecks/liveness").headers["x-trace-id"] for _ in range(3)}
    assert len(ids) == 3


def test_request_log_line_and_no_authorization_logged(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    secret = "Bearer eyJsecret.token.value"  # noqa: S105
    with caplog.at_level(logging.DEBUG):
        client.post(
            "/t/body?token=qs-secret",
            json={"name": "body-secret"},
            headers={"Authorization": secret, "Cookie": "sid=cookie-secret"},
        )
        client.get("/t/boom", headers={"Authorization": secret})
    text = "\n".join(
        r.getMessage() + " " + (str(r.exc_info[1]) if r.exc_info else "")
        for r in caplog.records
        if r.name == "tim_api"
    )
    assert "POST /t/body -> 400" in text
    assert "traceId=" in text
    assert "ms" in text
    for leaked in ("eyJsecret", "Bearer", "qs-secret", "body-secret", "cookie-secret"):
        assert leaked not in text


def test_cors_allowed_origin_gets_headers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TIM_CORS_ALLOWED_ORIGINS", "https://tim.example.com, https://other.example")
    with TestClient(_app(), raise_server_exceptions=False) as client:
        ok = client.get("/api/healthChecks/liveness", headers={"Origin": "https://tim.example.com"})
        bad = client.get("/api/healthChecks/liveness", headers={"Origin": "https://evil.example"})
        err = client.get("/t/boom", headers={"Origin": "https://tim.example.com"})
        pre = client.options(
            "/t/body",
            headers={
                "Origin": "https://tim.example.com",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
        bad_pre = client.options(
            "/t/body",
            headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
        )
    assert ok.headers["access-control-allow-origin"] == "https://tim.example.com"
    assert "x-trace-id" in ok.headers["access-control-expose-headers"].lower()
    assert "access-control-allow-origin" not in bad.headers
    assert err.status_code == 500
    assert err.headers["access-control-allow-origin"] == "https://tim.example.com"
    assert pre.status_code == 200
    assert "access-control-allow-credentials" not in pre.headers
    assert "authorization" in pre.headers["access-control-allow-headers"].lower()
    assert bad_pre.status_code == 400
    assert "access-control-allow-origin" not in bad_pre.headers


def test_cors_disabled_when_no_origins(client: TestClient) -> None:
    response = client.get(
        "/api/healthChecks/liveness", headers={"Origin": "https://tim.example.com"}
    )
    assert response.status_code == 204
    assert not [h for h in response.headers if h.startswith("access-control")]
