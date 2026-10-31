"""Run KQL (``tim.run_kql``) over ``/api/runs``, on a Kusto connection from the connections file.
OBO is faked at ``token_for``, and Kusto at the SDK client."""

import asyncio
import json
import os
from collections.abc import AsyncIterator
from datetime import timedelta
from pathlib import Path
from typing import Any

import httpx2 as httpx
import pytest
from app_factory import AuthKit
from azure.kusto.data import ClientRequestProperties
from azure.kusto.data import exceptions as kusto_exc
from kusto_fakes import ALICE, CLUSTER, AzureObo, FakeKusto, FakeObo, open_client
from tim_actions.kusto import KustoHook

from tim_api.auth.obo import OboAuthError, OboUnavailableError, OboUpstreamError

# Read before the autouse fixture in conftest.py clears TIM_* variables.
LIVE_CLUSTER = os.environ.get("TIM_TEST_KUSTO_CLUSTER")
LIVE_DATABASE = os.environ.get("TIM_TEST_KUSTO_QUERY_DATABASE", "Research")


class Env:
    def __init__(self, client: httpx.AsyncClient, kusto: FakeKusto, obo: FakeObo) -> None:
        self.client = client
        self.kusto = kusto
        self.obo = obo

    async def start(self, **params: Any) -> httpx.Response:
        body = {"action": "tim.run_kql", "params": {"connection": "security", **params}}
        return await self.client.post("/api/runs", json=body)

    async def wait(self, run_id: str) -> dict[str, Any]:
        async with asyncio.timeout(10):
            while True:
                body: dict[str, Any] = (await self.client.get(f"/api/runs/{run_id}")).json()
                if body["status"] != "running":
                    return body
                await asyncio.sleep(0.02)


@pytest.fixture
def kusto(monkeypatch: pytest.MonkeyPatch) -> FakeKusto:
    fake = FakeKusto()
    monkeypatch.setattr(KustoHook, "client_factory", staticmethod(fake.client))
    return fake


@pytest.fixture
async def env(
    auth: AuthKit, kusto: FakeKusto, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[Env]:
    obo = FakeObo()
    async with open_client(auth, obo, tmp_path, monkeypatch) as client:
        yield Env(client, kusto, obo)


async def test_run_kql_returns_the_querys_rows_as_the_analyst(env: Env) -> None:
    started = await env.start(database="Samples", kql="StormEvents | take 2", idColumn="EventId")
    assert started.status_code == 200
    run = started.json()
    assert run["status"] == "succeeded"
    assert run["rowCount"] == 2
    assert run["columns"] == [
        {"name": "EventId", "type": "number", "declared": True},
        {"name": "State", "type": "string", "declared": True},
        {"name": "StartTime", "type": "datetime", "declared": True},
        {"name": "Duration", "type": "timespan", "declared": True},
        {"name": "Damage", "type": "number", "declared": True},
        {"name": "Fatal", "type": "boolean", "declared": True},
        {"name": "Extra", "type": "json", "declared": True},
    ]
    assert {k: v for k, v in run["details"].items() if k not in ("duration", "rowCount")} == {
        "executionTime": 0.25,
        "cpuTime": "00:00:00.0312500",
        "memoryPeakPerNode": 1048576,
        "extentsScanned": 4,
        "extentsTotal": 10,
    }

    rows = (await env.client.get(f"/api/runs/{run['runId']}/rows")).json()["rows"]
    assert [r["data"] for r in rows] == [
        {
            "EventId": 61032,
            "State": "ATLANTIC SOUTH",
            "StartTime": "2007-09-29T08:11:00Z",
            "Duration": "00:30:00",
            "Damage": 1.5,
            "Fatal": False,
            "Extra": {"a": 1},
        },
        {
            "EventId": 60904,
            "State": "FLORIDA",
            "StartTime": "2007-09-18T20:00:00.1Z",
            "Duration": "1.00:00:00",
            "Damage": 0,
            "Fatal": True,
            "Extra": None,
        },
    ]

    scope = f"{CLUSTER}/.default"
    assert env.kusto.clients == [(CLUSTER, f"obo:{ALICE}:{scope}")]
    [(database, kql, properties)] = env.kusto.queries
    assert (database, kql) == ("Samples", "StormEvents | take 2")
    timeout: Any = properties.get_option(ClientRequestProperties.request_timeout_option_name, None)
    assert timedelta(seconds=50) < timeout <= timedelta(seconds=60)
    assert env.obo.calls[0] == (ALICE, scope)


async def test_cancel_cancels_the_query_on_kusto(env: Env) -> None:
    env.kusto.hold = True
    started = await env.start(database="Samples", kql="StormEvents")
    assert started.status_code == 202
    run_id = started.json()["runId"]
    assert await asyncio.to_thread(env.kusto.querying.wait, 5)

    cancelled = await env.client.post(f"/api/runs/{run_id}/cancel")
    assert cancelled.status_code == 200
    assert (await env.wait(run_id))["status"] == "cancelled"
    [(_, _, properties)] = env.kusto.queries
    assert env.kusto.commands == [("Samples", f'.cancel query "{properties.client_request_id}"')]


async def test_a_kusto_error_ends_the_run_with_its_message(env: Env) -> None:
    env.kusto.error = kusto_exc.KustoServiceError(
        "Semantic error: 'StormEvent' could not be resolved\n   at Kusto.Engine.Run()"
    )
    run = (await env.start(database="Samples", kql="StormEvent")).json()
    assert run["status"] == "error"
    assert run["error"] == "Semantic error: 'StormEvent' could not be resolved"


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
async def test_an_obo_error_answers_the_post_and_starts_no_run(
    env: Env, error: Exception, status: int, detail: str
) -> None:
    env.obo.error = error
    response = await env.start(database="Samples", kql="StormEvents")
    assert (response.status_code, response.json()["detail"]) == (status, detail)
    assert env.kusto.queries == []


def sent_parameters(kusto: FakeKusto) -> dict[str, str]:
    [(_, _, properties)] = kusto.queries
    parameters: dict[str, str] = json.loads(properties.to_json())["Parameters"]
    return parameters


async def test_query_parameters_are_declared_before_the_kql_and_sent_typed(env: Env) -> None:
    kql = "StormEvents\n| where State in (States) and StartTime > Since | take Limit"
    started = await env.start(
        database="Samples",
        kql=kql,
        parameters=[
            {"name": "States", "type": "dynamic", "value": ["TEXAS", "FLORIDA"]},
            {"name": "Since", "type": "datetime", "value": "2007-09-01T00:00:00Z"},
            {"name": "Limit", "type": "long", "value": 10},
            {"name": "Ratio", "type": "real", "value": 0.5},
            {"name": "Fatal", "type": "bool", "value": True},
            {"name": "Within", "type": "timespan", "value": "PT36H"},
            {"name": "Source", "type": "string", "value": "Trained Spotter"},
        ],
    )
    assert started.json()["status"] == "succeeded", started.json().get("error")

    [(_, sent, _)] = env.kusto.queries
    assert sent == (
        "declare query_parameters(States:dynamic, Since:datetime, Limit:long, Ratio:real, "
        "Fatal:bool, Within:timespan, Source:string);\n" + kql
    )
    assert sent_parameters(env.kusto) == {
        "States": 'dynamic(["TEXAS","FLORIDA"])',
        "Since": "datetime(2007-09-01T00:00:00.0000000Z)",
        "Limit": "10",
        "Ratio": "0.5",
        "Fatal": "true",
        "Within": "timespan(1.12:00:00)",
        "Source": "Trained Spotter",
    }


async def test_without_query_parameters_the_kql_is_sent_as_written(env: Env) -> None:
    await env.wait(
        (await env.start(database="Samples", kql="StormEvents", parameters=[])).json()["runId"]
    )
    [(_, sent, _)] = env.kusto.queries
    assert (sent, sent_parameters(env.kusto)) == ("StormEvents", {})


@pytest.mark.parametrize(
    ("parameters", "errors"),
    [
        (
            [{"name": "Since", "type": "datetime", "value": "yesterday"}],
            {"params.parameters.Since": ["Must be an ISO 8601 datetime"]},
        ),
        (
            [{"name": "Limit", "type": "long", "value": None}],
            {"params.parameters.Limit": ["Required"]},
        ),
        (
            [{"name": "Limit", "type": "long", "value": 1.5}],
            {"params.parameters.Limit": ["Must be a whole number"]},
        ),
        (
            [{"name": "Limit", "type": "int64", "value": 1}],
            {
                "params.parameters": [
                    "Limit: type must be one of string, long, real, bool, "
                    "datetime, timespan, dynamic"
                ]
            },
        ),
        (
            [{"name": "1st", "type": "long", "value": 1}],
            {
                "params.parameters": [
                    "1st: name must start with a letter or _ and hold only letters, digits and _"
                ]
            },
        ),
        (
            [{"name": "a", "type": "long", "value": 1}, {"name": "a", "type": "long", "value": 2}],
            {"params.parameters": ["a: names must be unique"]},
        ),
        ({"a": 1}, {"params.parameters": ["Must be a list of {name, type, value}"]}),
    ],
)
async def test_bad_query_parameters_are_unprocessable(
    env: Env, parameters: Any, errors: dict[str, list[str]]
) -> None:
    response = await env.start(database="Samples", kql="StormEvents", parameters=parameters)
    assert (response.status_code, response.json()["errors"]) == (422, errors)
    assert env.kusto.queries == []


async def test_an_unknown_connection_is_unprocessable(env: Env) -> None:
    response = await env.start(connection="nowhere", database="Samples", kql="StormEvents")
    assert response.status_code == 422
    assert set(response.json()["errors"]) == {"params.connection"}
    assert env.obo.calls == []


async def live_run(client: httpx.AsyncClient, body: dict[str, Any]) -> dict[str, Any]:
    """Starts a run and waits for it to finish."""
    run: dict[str, Any] = (await client.post("/api/runs", json=body)).json()
    async with asyncio.timeout(60):
        while run["status"] == "running":
            await asyncio.sleep(0.5)
            run = (await client.get(f"/api/runs/{run['runId']}")).json()
    return run


@pytest.mark.kusto
@pytest.mark.skipif(not LIVE_CLUSTER, reason="TIM_TEST_KUSTO_CLUSTER not set")
async def test_run_kql_on_a_real_cluster(
    auth: AuthKit, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Needs an ``AZURE_*`` identity that can query ``TIM_TEST_KUSTO_QUERY_DATABASE``."""
    assert LIVE_CLUSTER
    cluster, database = LIVE_CLUSTER.rstrip("/"), LIVE_DATABASE
    async with open_client(
        auth, AzureObo(), tmp_path, monkeypatch, cluster=cluster, database=database
    ) as client:
        body = {
            "action": "tim.run_kql",
            "params": {
                "connection": "security",
                "database": database,
                "kql": "print n = 1, s = 'x'",
                "idColumn": "n",
            },
        }
        run = await live_run(client, body)
        assert run["status"] == "succeeded", run.get("error")
        assert [(c["name"], c["type"]) for c in run["columns"]] == [
            ("n", "number"),
            ("s", "string"),
        ]
        assert "executionTime" in run["details"]
        rows = (await client.get(f"/api/runs/{run['runId']}/rows")).json()["rows"]
        assert [r["data"] for r in rows] == [{"n": 1, "s": "x"}]


@pytest.mark.kusto
@pytest.mark.skipif(not LIVE_CLUSTER, reason="TIM_TEST_KUSTO_CLUSTER not set")
async def test_run_kql_with_query_parameters_on_a_real_cluster(
    auth: AuthKit, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Kusto accepts the declare statement and a value of each type."""
    assert LIVE_CLUSTER
    cluster, database = LIVE_CLUSTER.rstrip("/"), LIVE_DATABASE
    async with open_client(
        auth, AzureObo(), tmp_path, monkeypatch, cluster=cluster, database=database
    ) as client:
        body = {
            "action": "tim.run_kql",
            "params": {
                "connection": "security",
                "database": database,
                "kql": "print n = Limit + 1, s = Source, t = Since + Within, f = not(Fatal),"
                " r = Ratio * 2, c = array_length(States)",
                "idColumn": "n",
                "parameters": [
                    {"name": "States", "type": "dynamic", "value": ["TEXAS", "FLORIDA"]},
                    {"name": "Since", "type": "datetime", "value": "2007-09-01T00:00:00Z"},
                    {"name": "Limit", "type": "long", "value": 10},
                    {"name": "Ratio", "type": "real", "value": 0.25},
                    {"name": "Fatal", "type": "bool", "value": True},
                    {"name": "Within", "type": "timespan", "value": "PT36H"},
                    {"name": "Source", "type": "string", "value": "Trained 'Spotter'"},
                ],
            },
        }
        run = await live_run(client, body)
        assert run["status"] == "succeeded", run.get("error")
        rows = (await client.get(f"/api/runs/{run['runId']}/rows")).json()["rows"]
        assert [r["data"] for r in rows] == [
            {
                "n": 11,
                "s": "Trained 'Spotter'",
                "t": "2007-09-02T12:00:00Z",
                "f": False,
                "r": 0.5,
                "c": 2,
            }
        ]
