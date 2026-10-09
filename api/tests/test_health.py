from collections.abc import Iterator

import pytest
from app_factory import create_test_app
from fastapi.testclient import TestClient


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(create_test_app()) as c:  # lifespan wires storage for readiness
        yield c


@pytest.mark.parametrize("probe", ["liveness", "readiness"])
def test_probe_returns_204(client: TestClient, probe: str) -> None:
    response = client.get(f"/api/healthChecks/{probe}")
    assert response.status_code == 204
    assert response.content == b""
