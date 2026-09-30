"""Regression tests named with the P5-09 security-review finding IDs (S-A..)."""

import logging
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from tim_api.auth import Principal, get_current_principal
from tim_api.main import create_app
from tim_api.observability import log_safe

PRINCIPAL = Principal(oid="oid-1", name="alice@example.com", tenant_id="t", token=SecretStr("x"))


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("TIM_MAX_REQUEST_BYTES", "2000")
    app = create_app()
    app.dependency_overrides[get_current_principal] = lambda: PRINCIPAL
    with TestClient(app) as c:
        yield c


def test_s_a03_oversized_content_length_is_413(client: TestClient) -> None:
    response = client.post("/api/taggedevents/tags", content=b"x" * 5000)
    assert response.status_code == 413
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.json()["traceId"]


def test_s_a03_chunked_body_over_limit_is_413(client: TestClient) -> None:
    def chunks() -> Iterator[bytes]:
        for _ in range(10):
            yield b"x" * 500

    response = client.post(
        "/api/taggedevents/tags", content=chunks(), headers={"content-type": "application/json"}
    )
    assert response.status_code == 413


def test_s_a03_body_under_limit_is_processed(client: TestClient) -> None:
    response = client.post("/api/taggedevents/tags", json=[])
    assert response.status_code == 400  # validation (empty batch), not 413


def test_s_a05_security_headers_on_every_response(client: TestClient) -> None:
    for response in (
        client.get("/api/healthChecks/liveness"),
        client.get("/api/templates/queries/not-a-uuid"),
        client.get("/nope"),
    ):
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["cache-control"] == "no-store"


def test_s_a06_control_characters_cannot_forge_log_lines(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    assert log_safe("a\nb\r\x1b") == "a\\x0ab\\x0d\\x1b"
    with caplog.at_level(logging.INFO, logger="tim_api"):
        client.get("/api/healthChecks/liveness%0AFAKE%20LOG%20LINE")
    assert caplog.records
    assert all("\n" not in r.getMessage() for r in caplog.records)
