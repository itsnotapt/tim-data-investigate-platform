"""``POST /api/connections/{name}/schema``: the editor schema from a connection's hook, on the
Kusto connection ``security``. OBO is faked at ``token_for``, and Kusto at the SDK client."""

import json
from collections.abc import AsyncIterator
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import httpx2 as httpx
import pytest
from app_factory import AuthKit
from azure.kusto.data import ClientRequestProperties
from azure.kusto.data import exceptions as kusto_exc
from kusto_fakes import ALICE, CLUSTER, FakeObo, open_client
from tim_actions.kusto import KustoHook

from tim_api.auth.obo import OboAuthError, OboUnavailableError, OboUpstreamError

SCHEMA = {
    "Databases": {
        "Samples": {
            "Name": "Samples",
            "Tables": {
                "StormEvents": {
                    "Name": "StormEvents",
                    "OrderedColumns": [{"Name": "State", "CslType": "string"}],
                }
            },
            "Functions": {},
        }
    }
}


class FakeKusto:
    """Kusto as the SDK client sees it, answering ``.show schema as json`` with ``schema``, or
    raising ``error``."""

    def __init__(self) -> None:
        self.schema: dict[str, Any] = SCHEMA
        self.error: Exception | None = None
        self.clients: list[tuple[str, str]] = []
        self.commands: list[tuple[str | None, str]] = []

    def client(self, cluster: str, token: str) -> "FakeKusto.Client":
        self.clients.append((cluster, token))
        return FakeKusto.Client(self)

    class Client:
        def __init__(self, kusto: "FakeKusto") -> None:
            self._kusto = kusto

        def execute_mgmt(
            self, database: str | None, query: str, properties: ClientRequestProperties
        ) -> Any:
            self._kusto.commands.append((database, query))
            if self._kusto.error is not None:
                raise self._kusto.error
            table = SimpleNamespace(
                raw_columns=[{"ColumnName": "DatabaseSchema", "ColumnType": "string"}],
                raw_rows=[[json.dumps(self._kusto.schema)]],
            )
            return SimpleNamespace(primary_results=[table])

        def close(self) -> None:
            pass


class Env:
    def __init__(self, client: httpx.AsyncClient, kusto: FakeKusto, obo: FakeObo) -> None:
        self.client = client
        self.kusto = kusto
        self.obo = obo

    async def schema(self, name: str = "security", **scope: Any) -> httpx.Response:
        return await self.client.post(f"/api/connections/{name}/schema", json={"scope": scope})


@pytest.fixture
async def env(auth: AuthKit, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[Env]:
    kusto, obo = FakeKusto(), FakeObo()
    monkeypatch.setattr(KustoHook, "client_factory", staticmethod(kusto.client))
    async with open_client(auth, obo, tmp_path, monkeypatch) as client:
        yield Env(client, kusto, obo)


async def test_kusto_gives_the_scopes_database_schema_as_the_analyst(env: Env) -> None:
    response = await env.schema(database="Samples")
    assert response.status_code == 200
    assert response.json() == {"kind": "kql", "schema": SCHEMA}
    scope = f"{CLUSTER}/.default"
    assert env.kusto.clients == [(CLUSTER, f"obo:{ALICE}:{scope}")]
    assert env.kusto.commands == [("Samples", ".show schema as json")]


async def test_without_a_database_there_is_no_content(env: Env) -> None:
    response = await env.schema()
    assert (response.status_code, response.content) == (204, b"")
    assert env.kusto.commands == []


async def test_an_unknown_connection_is_not_found(env: Env) -> None:
    response = await env.schema("nope", database="Samples")
    assert (response.status_code, response.json()["detail"]) == (404, "Connection not found")
    assert env.obo.calls == []


@pytest.mark.parametrize(
    ("error", "status", "detail"),
    [
        (
            OboAuthError("consent"),
            403,
            "Consent or sign-in is required for the downstream service",
        ),
        (OboUpstreamError("down"), 502, "The identity provider could not be reached"),
        (OboUnavailableError("no token"), 503, "Token exchange is not available"),
    ],
)
async def test_an_obo_error_maps_as_on_runs(
    env: Env, error: Exception, status: int, detail: str
) -> None:
    env.obo.error = error
    response = await env.schema(database="Samples")
    assert (response.status_code, response.json()["detail"]) == (status, detail)
    assert env.kusto.commands == []


async def test_a_kusto_error_is_a_bad_gateway_with_its_message(env: Env) -> None:
    env.kusto.error = kusto_exc.KustoServiceError("'Nope' was not found\n   at Kusto.Engine.Run()")
    response = await env.schema(database="Nope")
    assert (response.status_code, response.json()["detail"]) == (502, "'Nope' was not found")
