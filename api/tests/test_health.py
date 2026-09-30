import pytest
from fastapi.testclient import TestClient

from tim_api.main import create_app


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


@pytest.mark.parametrize("probe", ["liveness", "readiness"])
def test_probe_returns_204(client: TestClient, probe: str) -> None:
    response = client.get(f"/api/healthChecks/{probe}")
    assert response.status_code == 204
    assert response.content == b""
