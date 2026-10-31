"""Run SQL (``tim.run_sql``) over ``/api/runs``, and the editor schema over
``POST /api/connections/{name}/schema``, on Snowflake connections from the connections file. OBO
is faked at ``token_for``, and Snowflake at the connector."""

import asyncio
import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx2 as httpx
import pytest
from app_factory import AuthKit
from kusto_fakes import ALICE, AzureObo, FakeObo
from snowflake.connector import errors as sf_errors
from snowflake_fakes import CONNECTIONS, SCOPE, FakeConnector, described, open_client
from tim_actions.snowflake import SnowflakeHook

from tim_api.auth.obo import OboAuthError
from tim_api.config import get_settings

# Read before the autouse fixture in conftest.py clears TIM_* variables.
LIVE_ACCOUNT = os.environ.get("TIM_TEST_SNOWFLAKE_ACCOUNT")
LIVE_WAREHOUSE = os.environ.get("TIM_TEST_SNOWFLAKE_WAREHOUSE", "")
LIVE_SCOPE = os.environ.get("TIM_TEST_SNOWFLAKE_SCOPE", "")
LIVE_TENANT_ID = os.environ.get("TIM_TEST_AUTH_TENANT_ID", "")
LIVE_CLIENT_ID = os.environ.get("TIM_TEST_AUTH_CLIENT_ID")
LIVE_CLIENT_SECRET = os.environ.get("TIM_TEST_AUTH_CLIENT_SECRET", "")

FIXED, TEXT, TIMESTAMP_NTZ = 0, 2, 8


class Env:
    def __init__(self, client: httpx.AsyncClient, sdk: FakeConnector, obo: FakeObo) -> None:
        self.client = client
        self.sdk = sdk
        self.obo = obo

    async def start(self, connection: str = "warehouse", **params: Any) -> httpx.Response:
        body = {"action": "tim.run_sql", "params": {"connection": connection, **params}}
        return await self.client.post("/api/runs", json=body)

    async def wait(self, run_id: str) -> dict[str, Any]:
        async with asyncio.timeout(10):
            while True:
                body: dict[str, Any] = (await self.client.get(f"/api/runs/{run_id}")).json()
                if body["status"] != "running":
                    return body
                await asyncio.sleep(0.02)

    async def rows(self, run_id: str) -> list[dict[str, Any]]:
        rows = (await self.client.get(f"/api/runs/{run_id}/rows")).json()["rows"]
        return [r["data"] for r in rows]


@pytest.fixture
def sdk(monkeypatch: pytest.MonkeyPatch) -> FakeConnector:
    fake = FakeConnector()
    fake.result = (
        described(("ID", FIXED), ("UPN", TEXT), ("AT", TIMESTAMP_NTZ)),
        [(7, "alice@contoso.com", datetime(2026, 1, 2, 3, 4, 5))],
    )
    monkeypatch.setattr(SnowflakeHook, "connect_factory", staticmethod(fake))
    return fake


@pytest.fixture
async def env(
    auth: AuthKit, sdk: FakeConnector, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[Env]:
    obo = FakeObo()
    async with open_client(auth, tmp_path, monkeypatch, obo=obo) as client:
        yield Env(client, sdk, obo)


async def test_run_sql_returns_the_querys_rows_as_the_analyst(env: Env) -> None:
    started = await env.start(sql="SELECT * FROM SIGNINS", idColumn="ID")
    assert started.status_code == 200
    run = started.json()
    assert run["status"] == "succeeded", run.get("error")
    assert run["columns"] == [
        {"name": "ID", "type": "number", "declared": True},
        {"name": "UPN", "type": "string", "declared": True},
        {"name": "AT", "type": "datetime", "declared": True},
    ]
    assert await env.rows(run["runId"]) == [
        {"ID": 7, "UPN": "alice@contoso.com", "AT": "2026-01-02T03:04:05Z"}
    ]
    [login] = env.sdk.logins
    assert (login["authenticator"], login["token"]) == ("oauth", f"obo:{ALICE}:{SCOPE}")
    assert env.sdk.executed == ["SELECT * FROM SIGNINS"]
    assert env.obo.calls[0] == (ALICE, SCOPE)


async def test_run_sqls_query_parameters_are_bound_by_position(env: Env) -> None:
    sql = "SELECT * FROM SIGNINS WHERE UPN = :1 AND AT >= :2"
    started = await env.start(
        sql=sql,
        parameters=[
            {"name": "upn", "type": "string", "value": "alice@contoso.com"},
            {"name": "since", "type": "datetime", "value": "2026-01-02T00:00:00Z"},
        ],
    )
    assert started.json()["status"] == "succeeded", started.json().get("error")
    assert env.sdk.executed == [sql]
    assert env.sdk.binds == [["alice@contoso.com", datetime(2026, 1, 2, tzinfo=UTC)]]


@pytest.mark.parametrize(
    ("parameters", "errors"),
    [
        (
            [{"name": "within", "type": "timespan", "value": "PT1H"}],
            {
                "params.parameters": [
                    "within: type must be one of string, long, real, bool, datetime, dynamic"
                ]
            },
        ),
        (
            [{"name": "since", "type": "datetime", "value": "yesterday"}],
            {"params.parameters.since": ["Must be an ISO 8601 datetime"]},
        ),
    ],
)
async def test_bad_query_parameters_are_unprocessable(
    env: Env, parameters: Any, errors: dict[str, list[str]]
) -> None:
    response = await env.start(sql="SELECT :1", parameters=parameters)
    assert (response.status_code, response.json()["errors"]) == (422, errors)
    assert env.sdk.logins == []


async def test_with_workload_identity_run_sql_runs_as_tim(env: Env) -> None:
    run = (await env.start("warehouse-tim", sql="SELECT 1")).json()
    assert run["status"] == "succeeded", run.get("error")
    [login] = env.sdk.logins
    assert login["authenticator"] == "WORKLOAD_IDENTITY"
    assert "token" not in login
    assert env.obo.calls == []


async def test_an_obo_error_answers_the_post_and_starts_no_run(env: Env) -> None:
    env.obo.error = OboAuthError("consent")
    response = await env.start(sql="SELECT 1")
    assert (response.status_code, response.json()["detail"]) == (
        403,
        "Consent or sign-in is required for the downstream service",
    )
    assert env.sdk.logins == []


async def test_a_workload_identity_failure_ends_the_run_with_its_message(env: Env) -> None:
    env.sdk.login_error = sf_errors.DatabaseError("Failed to authenticate with WIF", errno=250001)
    started = await env.start("warehouse-tim", sql="SELECT 1")
    assert started.status_code == 200
    run = started.json()
    assert (run["status"], run["error"]) == ("error", "Failed to authenticate with WIF")


async def test_a_snowflake_error_ends_the_run_with_its_message(env: Env) -> None:
    env.sdk.result = sf_errors.ProgrammingError(
        "SQL compilation error: Object 'NOPE' does not exist", errno=2003, sqlstate="42S02"
    )
    run = (await env.start(sql="SELECT * FROM NOPE")).json()
    assert (run["status"], run["error"]) == (
        "error",
        "SQL compilation error: Object 'NOPE' does not exist",
    )


async def test_cancel_aborts_the_query_on_snowflake(env: Env) -> None:
    env.sdk.hold = True
    started = await env.start(sql="SELECT SYSTEM$WAIT(60)")
    assert started.status_code == 202
    run_id = started.json()["runId"]
    assert await asyncio.to_thread(env.sdk.querying.wait, 5)

    cancelled = await env.client.post(f"/api/runs/{run_id}/cancel")
    assert cancelled.status_code == 200
    assert (await env.wait(run_id))["status"] == "cancelled"
    assert env.sdk.aborted == ["01b2-query"]


async def test_the_editor_schema_is_the_accounts_tree_as_the_analyst(env: Env) -> None:
    env.sdk.answers = {
        "SHOW TERSE DATABASES": (described(("name", TEXT)), [("SALES",)]),
        '"SALES".INFORMATION_SCHEMA.COLUMNS': (
            described(
                ("TABLE_SCHEMA", TEXT),
                ("TABLE_NAME", TEXT),
                ("COLUMN_NAME", TEXT),
                ("DATA_TYPE", TEXT),
            ),
            [("PUBLIC", "ORDERS", "ID", "NUMBER")],
        ),
    }
    response = await env.client.post("/api/connections/warehouse/schema", json={"scope": {}})
    assert response.status_code == 200
    assert response.json() == {
        "kind": "sql",
        "schema": {
            "databases": [
                {
                    "name": "SALES",
                    "schemas": [
                        {
                            "name": "PUBLIC",
                            "tables": [
                                {"name": "ORDERS", "columns": [{"name": "ID", "type": "NUMBER"}]}
                            ],
                        }
                    ],
                }
            ]
        },
    }
    [login] = env.sdk.logins
    assert login["token"] == f"obo:{ALICE}:{SCOPE}"


async def test_an_editor_schema_snowflake_refuses_is_a_bad_gateway_with_its_message(
    env: Env,
) -> None:
    env.sdk.login_error = sf_errors.DatabaseError("Invalid OAuth access token", errno=390303)
    response = await env.client.post("/api/connections/warehouse/schema", json={"scope": {}})
    assert (response.status_code, response.json()["detail"]) == (502, "Invalid OAuth access token")


async def test_an_instance_with_only_workload_identity_connections_needs_no_obo_credential(
    auth: AuthKit, sdk: FakeConnector, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("TIM_AUTH_CLIENT_SECRET")
    as_tim = CONNECTIONS[CONNECTIONS.index("- name: warehouse-tim") :]
    async with open_client(auth, tmp_path, monkeypatch, obo=None, connections=as_tim) as client:
        body = {
            "action": "tim.run_sql",
            "params": {"connection": "warehouse-tim", "sql": "SELECT 1"},
        }
        run = (await client.post("/api/runs", json=body)).json()
    assert run["status"] == "succeeded", run.get("error")
    [login] = sdk.logins
    assert login["authenticator"] == "WORKLOAD_IDENTITY"


LIVE_CONNECTIONS = f"""\
- name: warehouse
  title: Warehouse
  type: snowflake
  auth: obo
  scope: {LIVE_SCOPE}
  account: {LIVE_ACCOUNT}
  warehouse: {LIVE_WAREHOUSE}
"""


LIVE_SQL = """SELECT :1 AS N, :2 AS S,
  :3 = '2026-01-02 03:04:05 +02:00'::TIMESTAMP_TZ AS SAME_INSTANT,
  ARRAY_SIZE(PARSE_JSON(:4)) AS K"""


async def run_sql_on_the_real_account(client: httpx.AsyncClient) -> None:
    """Run SQL with a query parameter of each kind Snowflake binds differently: a number, a
    string, a datetime read as UTC, and a list read with ``PARSE_JSON``."""
    parameters = [
        {"name": "n", "type": "long", "value": 1},
        {"name": "s", "type": "string", "value": "x"},
        {"name": "at", "type": "datetime", "value": "2026-01-02T01:04:05Z"},
        {"name": "upns", "type": "dynamic", "value": ["alice@contoso.com", "bob@contoso.com"]},
    ]
    body = {
        "action": "tim.run_sql",
        "params": {
            "connection": "warehouse",
            "sql": LIVE_SQL,
            "idColumn": "N",
            "parameters": parameters,
        },
    }
    run: dict[str, Any] = (await client.post("/api/runs", json=body)).json()
    async with asyncio.timeout(60):
        while run["status"] == "running":
            await asyncio.sleep(0.5)
            run = (await client.get(f"/api/runs/{run['runId']}")).json()
    assert run["status"] == "succeeded", run.get("error", run)
    assert [(c["name"], c["type"]) for c in run["columns"]] == [
        ("N", "number"),
        ("S", "string"),
        ("SAME_INSTANT", "boolean"),
        ("K", "number"),
    ]
    rows = (await client.get(f"/api/runs/{run['runId']}/rows")).json()["rows"]
    assert [r["data"] for r in rows] == [{"N": 1, "S": "x", "SAME_INSTANT": True, "K": 2}]

    schema = await client.post("/api/connections/warehouse/schema", json={"scope": {}})
    assert schema.status_code == 200
    assert schema.json()["kind"] == "sql"


@pytest.mark.snowflake
@pytest.mark.skipif(not LIVE_ACCOUNT, reason="TIM_TEST_SNOWFLAKE_ACCOUNT not set")
async def test_run_sql_on_a_real_account(
    auth: AuthKit, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Needs ``TIM_TEST_SNOWFLAKE_WAREHOUSE`` and ``TIM_TEST_SNOWFLAKE_SCOPE``, and a
    ``DefaultAzureCredential`` (the Azure CLI) of a member user that Snowflake's External OAuth
    integration accepts. Its token for the scope stands in for TIM's OBO exchange."""
    obo: Any = AzureObo()
    async with open_client(
        auth, tmp_path, monkeypatch, obo=obo, connections=LIVE_CONNECTIONS
    ) as client:
        await run_sql_on_the_real_account(client)


@pytest.mark.snowflake
@pytest.mark.skipif(
    not (LIVE_ACCOUNT and LIVE_CLIENT_ID),
    reason="TIM_TEST_SNOWFLAKE_ACCOUNT or TIM_TEST_AUTH_* not set",
)
async def test_run_sql_on_a_real_account_through_tims_obo_exchange(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """TIM as deployed: it validates the analyst's Entra token and exchanges it for the scope's.
    Needs, as well, ``TIM_TEST_AUTH_TENANT_ID``, ``TIM_TEST_AUTH_CLIENT_ID`` and
    ``TIM_TEST_AUTH_CLIENT_SECRET`` of an API app with consent to the scope, which the Azure CLI
    may sign in to."""
    from azure.identity import DefaultAzureCredential

    monkeypatch.setenv("TIM_AUTH_TENANT_ID", LIVE_TENANT_ID)
    monkeypatch.setenv("TIM_AUTH_CLIENT_ID", LIVE_CLIENT_ID or "")
    monkeypatch.setenv("TIM_AUTH_CLIENT_SECRET", LIVE_CLIENT_SECRET)
    get_settings.cache_clear()
    token = DefaultAzureCredential().get_token(f"api://{LIVE_CLIENT_ID}/.default").token
    async with open_client(
        None, tmp_path, monkeypatch, obo=None, connections=LIVE_CONNECTIONS, token=token
    ) as client:
        await run_sql_on_the_real_account(client)
