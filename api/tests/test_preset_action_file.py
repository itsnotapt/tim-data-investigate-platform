"""``GET /api/presets/{presetId}/actionFile``: a preset as an action file, which ``tim-api check``
accepts. Built-in providers, with a Kusto connection and the ``kql_query`` fixtures, or with
Snowflake connections."""

import os
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx2 as httpx
import pytest
import yaml
from app_factory import AuthKit
from kusto_fakes import FakeObo, connections_file, open_client
from snowflake_fakes import CONNECTIONS as SNOWFLAKE_CONNECTIONS
from snowflake_fakes import open_client as open_snowflake_client
from test_action_files import FIXTURES

from tim_api.cli import main

KQL = "SigninLogs\n| where UserPrincipalName == Upn and TimeGenerated > Since\n| take 10\n"

RUN_KQL_PRESET: dict[str, Any] = {
    "name": "Sign-ins by user",
    "menuPath": ["Identity", "Daily"],
    "visibility": "shared",
    "action": "tim.run_kql",
    "params": {
        "connection": "security",
        "database": "Samples",
        "kql": KQL,
        "idColumn": "CorrelationId",
    },
    "inputs": [
        {
            "name": "Upn",
            "source": "queryParameter",
            "type": "string",
            "fixed": False,
            "fromColumns": ["UserPrincipalName", "Upn"],
        },
        {
            "name": "Since",
            "source": "queryParameter",
            "type": "datetime",
            "fixed": True,
            "value": "2026-10-01T00:00:00Z",
        },
        {
            "name": "Hosts",
            "source": "queryParameter",
            "type": "dynamic",
            "fixed": False,
            "fromColumns": ["Host"],
        },
        {
            "name": "Limit",
            "source": "queryParameter",
            "type": "long",
            "fixed": False,
            "fromColumns": ["Limit"],
        },
    ],
}


SQL = """SELECT * FROM SIGNINS
WHERE UPN IN (SELECT value::string FROM TABLE(FLATTEN(PARSE_JSON(:1)))) AND AT >= :2
"""

RUN_SQL_PRESET: dict[str, Any] = {
    "name": "Sign-ins of users",
    "menuPath": ["Identity"],
    "visibility": "shared",
    "action": "tim.run_sql",
    "params": {"connection": "warehouse", "sql": SQL, "idColumn": "ID"},
    "inputs": [
        {
            "name": "upns",
            "source": "queryParameter",
            "type": "dynamic",
            "fixed": False,
            "fromColumns": ["UPN"],
        },
        {
            "name": "since",
            "source": "queryParameter",
            "type": "datetime",
            "fixed": True,
            "value": "2026-10-01T00:00:00Z",
        },
    ],
}


@pytest.fixture
async def client(
    auth: AuthKit, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[httpx.AsyncClient]:
    async with open_client(
        auth, FakeObo(), tmp_path, monkeypatch, actions_dir=FIXTURES / "kql_query"
    ) as client:
        yield client


async def action_file(client: httpx.AsyncClient, preset: dict[str, Any]) -> httpx.Response:
    created = await client.post("/api/presets", json=preset)
    assert created.status_code == 201, created.text
    return await client.get(f"/api/presets/{created.json()['presetId']}/actionFile")


async def test_a_run_kql_preset_is_a_kql_query_action_file(client: httpx.AsyncClient) -> None:
    response = await action_file(client, RUN_KQL_PRESET)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/yaml")
    assert "kql: |" in response.text
    assert yaml.safe_load(response.text) == {
        "type": "kql_query",
        "key": "sign-ins-by-user",
        "name": "Sign-ins by user",
        "menu": "Identity/Daily",
        "pivot": "rows",
        "connection": "security",
        "database": "Samples",
        "kql": "declare query_parameters(Upn:string, Since:datetime, Hosts:dynamic, Limit:long);\n"
        + KQL,
        "id": "CorrelationId",
        "params": [
            {"name": "Upn", "kind": "string", "from_columns": ["UserPrincipalName", "Upn"]},
            {"name": "Since", "kind": "datetime", "default": "2026-10-01T00:00:00Z"},
            {"name": "Hosts", "kind": "json", "many": True, "from_columns": ["Host"]},
            {"name": "Limit", "kind": "number", "from_columns": ["Limit"]},
        ],
    }


async def test_a_from_row_input_without_columns_makes_the_action_file_no_pivot(
    client: httpx.AsyncClient,
) -> None:
    inputs = [*RUN_KQL_PRESET["inputs"][:3], {**RUN_KQL_PRESET["inputs"][3], "fromColumns": []}]
    response = await action_file(client, {**RUN_KQL_PRESET, "inputs": inputs})

    document = yaml.safe_load(response.text)
    assert document["pivot"] == "none"
    assert document["params"][3] == {"name": "Limit", "kind": "number"}


async def test_tim_api_check_accepts_the_action_file(
    client: httpx.AsyncClient,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    response = await action_file(client, RUN_KQL_PRESET)
    actions = tmp_path / "actions"
    actions.mkdir()
    (actions / "preset.yaml").write_text(response.text)
    connections = tmp_path / "check-connections.yaml"
    connections.write_text(connections_file("https://help.kusto.windows.net", "Samples"))
    for key in [key for key in os.environ if key.startswith("TIM_")]:
        monkeypatch.delenv(key)

    code = main(["check", "--actions", str(actions), "--connections", str(connections)])

    out, err = capsys.readouterr()
    assert (code, err) == (0, ""), err
    assert out.splitlines()[-1].startswith("OK: "), out


async def test_a_preset_of_an_action_without_an_action_file_is_a_conflict(
    client: httpx.AsyncClient,
) -> None:
    storms = {
        **RUN_KQL_PRESET,
        "action": "acme.storms",
        "params": {"source": "Trained Spotter"},
        "inputs": [],
    }
    response = await action_file(client, storms)

    assert response.status_code == 409
    assert response.json()["type"].endswith(":no-action-file")


async def test_a_run_kql_preset_without_a_database_has_no_action_file(
    client: httpx.AsyncClient,
) -> None:
    params = {k: v for k, v in RUN_KQL_PRESET["params"].items() if k != "database"}
    response = await action_file(client, {**RUN_KQL_PRESET, "params": params})

    assert response.status_code == 409
    assert response.json()["type"].endswith(":no-action-file")


async def test_the_action_file_of_someone_elses_private_preset_is_not_found(
    client: httpx.AsyncClient, auth: AuthKit
) -> None:
    created = await client.post("/api/presets", json={**RUN_KQL_PRESET, "visibility": "private"})
    url = f"/api/presets/{created.json()['presetId']}/actionFile"

    response = await client.get(url, headers=auth.headers("bob@example.com", "oid-b"))
    unknown = await client.get("/api/presets/00000000-0000-0000-0000-000000000000/actionFile")

    assert (response.status_code, unknown.status_code) == (404, 404)


@pytest.fixture
async def snowflake_client(
    auth: AuthKit, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[httpx.AsyncClient]:
    async with open_snowflake_client(auth, tmp_path, monkeypatch, obo=FakeObo()) as client:
        yield client


async def test_a_run_sql_preset_is_a_snowflake_query_action_file_with_its_params_in_order(
    snowflake_client: httpx.AsyncClient,
) -> None:
    response = await action_file(snowflake_client, RUN_SQL_PRESET)

    assert response.status_code == 200
    assert "sql: |" in response.text
    assert yaml.safe_load(response.text) == {
        "type": "snowflake_query",
        "key": "sign-ins-of-users",
        "name": "Sign-ins of users",
        "menu": "Identity",
        "pivot": "rows",
        "connection": "warehouse",
        "sql": SQL,
        "id": "ID",
        "params": [
            {"name": "upns", "kind": "json", "many": True, "from_columns": ["UPN"]},
            {"name": "since", "kind": "datetime", "default": "2026-10-01T00:00:00Z"},
        ],
    }


async def test_tim_api_check_accepts_the_snowflake_query_action_file(
    snowflake_client: httpx.AsyncClient,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    response = await action_file(snowflake_client, RUN_SQL_PRESET)
    actions = tmp_path / "actions"
    actions.mkdir()
    (actions / "preset.yaml").write_text(response.text)
    connections = tmp_path / "check-connections.yaml"
    connections.write_text(SNOWFLAKE_CONNECTIONS)
    for key in [key for key in os.environ if key.startswith("TIM_")]:
        monkeypatch.delenv(key)

    code = main(["check", "--actions", str(actions), "--connections", str(connections)])

    out, err = capsys.readouterr()
    assert (code, err) == (0, ""), err
    assert out.splitlines()[-1].startswith("OK: "), out


async def test_a_run_sql_preset_with_a_timespan_has_no_action_file(
    snowflake_client: httpx.AsyncClient,
) -> None:
    within = {
        "name": "within",
        "source": "queryParameter",
        "type": "timespan",
        "fixed": True,
        "value": "PT1H",
    }
    preset = {**RUN_SQL_PRESET, "inputs": [*RUN_SQL_PRESET["inputs"], within]}
    response = await action_file(snowflake_client, preset)

    assert response.status_code == 409
    assert response.json()["type"].endswith(":no-action-file")
