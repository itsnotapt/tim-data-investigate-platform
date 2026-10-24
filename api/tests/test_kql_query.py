"""``kql_query`` action files over ``/api/runs``: a fixed Kusto connection, database and KQL,
with the params sent as Kusto query parameters. OBO is faked at ``token_for``, and Kusto at the
SDK client."""

import asyncio
import json
import os
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx2 as httpx
import pytest
from app_factory import AuthKit, create_test_app
from fastapi.testclient import TestClient
from kusto_fakes import CLUSTER, AzureObo, FakeKusto, FakeObo, connections_file, open_client
from scripted_actions import CancellableHook
from tim_actions import Provider
from tim_actions.kusto import KqlQuery, KustoHook

from tim_api.actions import InstanceConfigError

# Read before the autouse fixture in conftest.py clears TIM_* variables.
LIVE_CLUSTER = os.environ.get("TIM_TEST_KUSTO_CLUSTER")
LIVE_DATABASE = os.environ.get("TIM_TEST_KUSTO_QUERY_DATABASE", "Research")
FIXTURES = Path(__file__).parent / "fixtures" / "action_files"
STORMS_KQL = (FIXTURES / "kql_query" / "storms.kql").read_text()
STORMS_PARAMS = {
    "states": ["TEXAS", "FLORIDA"],
    "source": "Trained Spotter",
    "minDamage": 1500.5,
    "fatal": True,
    "since": "2007-09-01T00:00:00Z",
    "within": "PT36H",
    "tags": ["Hail", 2],
}


@pytest.fixture
def kusto(monkeypatch: pytest.MonkeyPatch) -> FakeKusto:
    fake = FakeKusto()
    monkeypatch.setattr(KustoHook, "client_factory", staticmethod(fake.client))
    return fake


@pytest.fixture
async def client(
    auth: AuthKit, kusto: FakeKusto, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[httpx.AsyncClient]:
    async with open_client(
        auth, FakeObo(), tmp_path, monkeypatch, actions_dir=FIXTURES / "kql_query"
    ) as client:
        yield client


async def start(client: httpx.AsyncClient, action: str, **params: Any) -> dict[str, Any]:
    response = await client.post("/api/runs", json={"action": action, "params": params})
    assert response.status_code == 200, response.text
    run: dict[str, Any] = response.json()
    return run


def sent_parameters(kusto: FakeKusto) -> dict[str, str]:
    [(_, _, properties)] = kusto.queries
    parameters: dict[str, str] = json.loads(properties.to_json())["Parameters"]
    return parameters


async def test_the_params_reach_kusto_as_typed_query_parameters(
    client: httpx.AsyncClient, kusto: FakeKusto
) -> None:
    run = await start(client, "acme.storms", **STORMS_PARAMS)
    assert run["status"] == "succeeded", run.get("error")

    [(database, kql, _)] = kusto.queries
    assert (database, kql) == ("Samples", STORMS_KQL)
    assert kusto.clients == [(CLUSTER, f"obo:alice@example.com:{CLUSTER}/.default")]
    assert sent_parameters(kusto) == {
        "states": 'dynamic(["TEXAS","FLORIDA"])',
        "source": "Trained Spotter",
        "minDamage": "1500.5",
        "fatal": "true",
        "since": "datetime(2007-09-01T00:00:00.0000000Z)",
        "within": "timespan(1.12:00:00)",
        "tags": 'dynamic(["Hail",2])',
    }


async def test_the_action_pivots_on_its_from_columns(client: httpx.AsyncClient) -> None:
    actions = (await client.get("/api/instance")).json()["actions"]
    [storms] = [action for action in actions if action["key"] == "acme.storms"]
    assert storms["connections"] == ["security"]
    assert storms["pivot"] == {"rows": "rows", "columns": [["State"]]}


LIVE_ACTION = """\
type: kql_query
key: acme.echo
name: Echo
pivot: none
connection: security
database: {database}
id: s
params:
  - {{name: s, kind: string}}
  - {{name: n, kind: number}}
  - {{name: b, kind: boolean}}
  - {{name: d, kind: datetime}}
  - {{name: t, kind: timespan}}
  - {{name: ds, kind: datetime, many: true}}
  - {{name: j, kind: json}}
kql: |
  declare query_parameters(s: string, n: real, b: bool, d: datetime, t: timespan, ds: dynamic,
      j: dynamic);
  print s = s, n = n, b = b, d = d, t = t, firstD = todatetime(ds[0]), j = j
"""


@pytest.mark.kusto
@pytest.mark.skipif(not LIVE_CLUSTER, reason="TIM_TEST_KUSTO_CLUSTER not set")
async def test_kql_query_binds_params_on_a_real_cluster(
    auth: AuthKit, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Needs an ``AZURE_*`` identity that can query ``TIM_TEST_KUSTO_QUERY_DATABASE``."""
    assert LIVE_CLUSTER
    actions = tmp_path / "actions"
    actions.mkdir()
    (actions / "echo.yaml").write_text(LIVE_ACTION.format(database=LIVE_DATABASE))
    params = {
        "s": 'it\'s "quoted"; | take 0',
        "n": 2.5,
        "b": True,
        "d": "2026-10-01T12:30:00Z",
        "t": "PT1H30M",
        "ds": ["2026-01-02T03:04:05Z"],
        "j": {"a": [1, None]},
    }
    async with open_client(
        auth,
        AzureObo(),
        tmp_path,
        monkeypatch,
        cluster=LIVE_CLUSTER.rstrip("/"),
        database=LIVE_DATABASE,
        actions_dir=actions,
    ) as client:
        run = (
            await client.post("/api/runs", json={"action": "acme.echo", "params": params})
        ).json()
        async with asyncio.timeout(60):
            while run["status"] == "running":
                await asyncio.sleep(0.5)
                run = (await client.get(f"/api/runs/{run['runId']}")).json()
        assert run["status"] == "succeeded", run.get("error")
        rows = (await client.get(f"/api/runs/{run['runId']}/rows")).json()["rows"]
    assert [row["data"] for row in rows] == [
        {
            "s": 'it\'s "quoted"; | take 0',
            "n": 2.5,
            "b": True,
            "d": "2026-10-01T12:30:00Z",
            "t": "01:30:00",
            "firstD": "2026-01-02T03:04:05Z",
            "j": {"a": [1, None]},
        }
    ]


def test_bad_kql_query_files_stop_startup(
    kusto: FakeKusto, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    connections = tmp_path / "connections.yaml"
    connections.write_text(
        connections_file(CLUSTER, "Samples")
        + (FIXTURES.parent / "connections" / "fake.yaml").read_text()
    )
    monkeypatch.setenv("TIM_CONNECTIONS_FILE", str(connections))
    monkeypatch.setenv("TIM_ACTIONS_DIR", str(FIXTURES / "kql_query_errors"))
    provider = Provider(action_types=[KqlQuery], hooks=[KustoHook, CancellableHook])
    with (
        pytest.raises(InstanceConfigError) as caught,
        TestClient(create_test_app(providers=[provider])),
    ):
        pass

    at = FIXTURES / "kql_query_errors" / "actions.yaml"
    assert caught.value.problems == [
        f"{at}:7: kql_file: no file missing.kql next to the action file",
        f"{at}:32: params: query: a kql_query param is a Kusto query parameter, so "
        "its kind is one of string, number, boolean, datetime, timespan, json, not kql",
        f"{at}:10: action acme.nowhere: no connection named nowhere",
        f"{at}:18: action acme.not_kusto: connection fake is fake, not kusto",
    ]
