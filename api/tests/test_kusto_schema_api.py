import json
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from tim_api.auth import Principal, get_current_principal
from tim_api.auth.dependencies import get_obo_provider
from tim_api.kusto.query_client import (
    KustoForbiddenError,
    KustoQueryClient,
    KustoQueryError,
    get_kusto_client,
)
from tim_api.main import create_app

PRINCIPAL = Principal(oid="o", name="alice@example.com", tenant_id="t", token=SecretStr("x"))
DOC = {"Databases": {"Sec": {"Name": "Sec", "Tables": {}}}}
CLUSTER = "https://c1.westeurope.kusto.windows.net"


class FakeObo:
    def __init__(self) -> None:
        self.calls: list[tuple[Principal, str]] = []

    async def get_token(self, principal: Principal, cluster_url: str) -> str:
        self.calls.append((principal, cluster_url))
        return "kusto-token"


class FakeKusto:
    def __init__(self) -> None:
        self.rows: list[dict[str, Any]] = [{"ClusterSchema": json.dumps(DOC)}]
        self.error: Exception | None = None
        self.calls: list[tuple[str, str, str]] = []

    async def show_schema(
        self, cluster_url: str, database: str, token: str
    ) -> list[dict[str, Any]]:
        self.calls.append((cluster_url, database, token))
        if self.error:
            raise self.error
        return self.rows


@pytest.fixture
def obo() -> FakeObo:
    return FakeObo()


@pytest.fixture
def kusto() -> FakeKusto:
    return FakeKusto()


@pytest.fixture
def client(obo: FakeObo, kusto: FakeKusto) -> Iterator[TestClient]:
    app = create_app()
    app.dependency_overrides[get_current_principal] = lambda: PRINCIPAL
    app.dependency_overrides[get_obo_provider] = lambda: obo
    fake: KustoQueryClient = kusto  # type: ignore[assignment]
    app.dependency_overrides[get_kusto_client] = lambda: fake
    with TestClient(app) as c:
        yield c


def post(client: TestClient, cluster: str = CLUSTER) -> Any:
    return client.post("/api/kusto/schema", json={"cluster": cluster, "database": "Sec"})


def test_happy_path_normalises_cluster(client: TestClient, obo: FakeObo, kusto: FakeKusto) -> None:
    r = post(client, CLUSTER.upper().replace("HTTPS", "https") + "/")
    assert r.status_code == 200
    assert r.json() == {"schema": DOC}
    assert obo.calls == [(PRINCIPAL, CLUSTER)]
    assert kusto.calls == [(CLUSTER, "Sec", "kusto-token")]


@pytest.mark.parametrize(
    "rows",
    [
        [{"DatabaseSchema": json.dumps(DOC)}],
        [{"Whatever": json.dumps(DOC)}],
        [{"ClusterSchema": DOC}],
    ],
    ids=["database-schema", "single-unknown-column", "already-parsed"],
)
def test_column_variants(client: TestClient, kusto: FakeKusto, rows: list[dict[str, Any]]) -> None:
    kusto.rows = rows
    r = post(client)
    assert r.status_code == 200
    assert r.json() == {"schema": DOC}


@pytest.mark.parametrize(
    "rows",
    [
        [],
        [{"A": "1", "B": "2"}],
        [{"ClusterSchema": "not json"}],
        [{"ClusterSchema": "[1]"}],
        [{"ClusterSchema": None}],
    ],
    ids=["no-rows", "ambiguous-columns", "bad-json", "not-object", "null"],
)
def test_unusable_result_is_502(client: TestClient, kusto: FakeKusto, rows: list[Any]) -> None:
    kusto.rows = rows
    r = post(client)
    assert r.status_code == 502
    assert r.json()["type"] == "urn:tim:problem:upstream"


@pytest.mark.parametrize(
    "cluster",
    ["http://c1.westeurope.kusto.windows.net", "https://c1.kusto.windows.net.evil.com", ""],
)
def test_bad_cluster_400_before_token(
    client: TestClient, obo: FakeObo, kusto: FakeKusto, cluster: str
) -> None:
    r = post(client, cluster)
    assert r.status_code == 400
    assert obo.calls == []
    assert kusto.calls == []
    if cluster:
        assert r.json()["type"] == "urn:tim:problem:cluster-not-allowed"
        assert "cluster" in r.json()["errors"]


def test_unauthenticated_401(obo: FakeObo, kusto: FakeKusto) -> None:
    app = create_app()
    app.dependency_overrides[get_obo_provider] = lambda: obo
    with TestClient(app) as c:
        r = post(c)
    assert r.status_code == 401
    assert obo.calls == []


def test_kusto_error_502(client: TestClient, kusto: FakeKusto) -> None:
    kusto.error = KustoQueryError("Secret internals")
    r = post(client)
    assert r.status_code == 502
    assert "Secret" not in r.text


def test_kusto_forbidden_403(client: TestClient, kusto: FakeKusto) -> None:
    kusto.error = KustoForbiddenError("denied")
    r = post(client)
    assert r.status_code == 403
    assert r.json()["type"] == "urn:tim:problem:forbidden"


def test_missing_database_400(client: TestClient) -> None:
    r = client.post("/api/kusto/schema", json={"cluster": CLUSTER})
    assert r.status_code == 400
