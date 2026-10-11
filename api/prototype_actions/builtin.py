"""PROTOTYPE, throwaway: what TIM itself would ship: the Kusto hook, the KqlQuery action type,
Run KQL and the development JSON action.

In the real code tim-api declares its own ``tim.actions`` entry point for these, so built-ins
and packages are discovered the same way.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from typing import Any

from fakes import FakeKustoClient
from interface import (
    Action,
    Column,
    ColumnType,
    Hook,
    Param,
    PivotContext,
    Provider,
    Row,
    RunContext,
    first_of,
)

_KUSTO_TYPES: dict[str, ColumnType] = {
    "datetime": "datetime", "timespan": "timespan", "int": "number", "long": "number",
    "real": "number", "decimal": "number", "bool": "bool", "dynamic": "json",
}


class KustoHook(Hook):
    backend = "kusto"

    def get_conn(self) -> FakeKustoClient:
        # Real: OBO-exchange self.analyst.token for f"{endpoint}/.default" (ADR-0009), then
        # KustoClient(KustoConnectionStringBuilder.with_aad_user_token_authentication(...)).
        return FakeKustoClient(self.connection.endpoint, as_user=self.analyst.upn)

    def query(
        self, database: str, kql: str, params: dict[str, Any], ctx: RunContext
    ) -> list[Row]:
        """Run KQL with ``params`` as Kusto query parameters (bind, never string-spliced).

        Declares the result's columns and adds the Kusto stats to the run details.
        """
        # Lists go as dynamic: `declare query_parameters(upns:dynamic)`.
        parameters = {
            k: f"dynamic({json.dumps(v)})" if isinstance(v, list) else str(v)
            for k, v in params.items()
            if v is not None
        }
        result = self.get_conn().execute(database, kql, parameters)
        ctx.declare_columns(
            [Column(name, _KUSTO_TYPES.get(kind, "string")) for name, kind in result["columns"]]
        )
        ctx.detail("kustoStats", result["stats"])
        return result["rows"]


class RunKql(Action):
    """Ad-hoc KQL: the analyst picks the connection and writes the query."""

    def run(self, params: dict[str, Any], ctx: RunContext) -> Iterable[Row]:
        hook = ctx.hook(params["connection"])
        assert isinstance(hook, KustoHook)
        times = {"_startTime": params.get("startTime"), "_endTime": params.get("endTime")}
        return hook.query(params["database"], params["query"], times, ctx)


class KqlQuery(Action):
    """Action type for a fixed KQL query on a fixed connection; params bind as query parameters.

    The "Query authoring format" ticket decides whether authors write these in Python or in a
    query file that becomes one of these.
    """

    def __init__(self, *, connection: str, database: str, kql: str, **action: Any) -> None:
        super().__init__(**action)
        self.connection, self.database, self.kql = connection, database, kql

    def run(self, params: dict[str, Any], ctx: RunContext) -> Iterable[Row]:
        hook = ctx.hook(self.connection)
        assert isinstance(hook, KustoHook)
        return hook.query(self.database, self.kql, params, ctx)


class DevJson(Action):
    """Development only: returns the JSON it is given. As a pivot it echoes the selected rows."""

    def pivot_columns(self) -> list[list[str]]:
        return []  # offered on any row

    def resolve(self, context: PivotContext) -> dict[str, Any]:
        return {"rows": json.dumps(context.rows)}

    def run(self, params: dict[str, Any], ctx: RunContext) -> Iterable[Row]:
        rows = json.loads(params["rows"])
        ctx.detail("note", "development action: rows are echoed back")
        yield from rows


run_kql = RunKql(
    key="tim.run_kql",
    name="Run KQL",
    menu=("Kusto",),
    pivot="none",
    params=(
        Param("connection", "connection", backend="kusto"),
        Param("database"),
        Param("query", "kql"),
        Param("startTime", "datetime", required=False),
        Param("endTime", "datetime", required=False),
    ),
    columns=None,  # declared at run time from Kusto's column types
    id=first_of("EventId", "ReportId"),  # tag-friendly when the query keeps a known key
)

dev_json = DevJson(
    key="tim.dev_json",
    name="JSON (development)",
    menu=("Development",),
    pivot="rows",
    params=(Param("rows", "json"),),
)

sign_ins_for_user = KqlQuery(
    key="tim.sign_ins_for_user",
    name="Sign-ins for user",
    menu=("Entra",),
    connection="kusto-main",
    database="Security",
    kql="""
        declare query_parameters(upn:string, _startTime:datetime = ago(1d));
        SigninLogs | where TimeGenerated > _startTime | where UserPrincipalName == upn
    """,
    params=(Param("upn", from_columns=("UserPrincipalName", "AccountUpn", "ACTOR_UPN")),),
    id=first_of("CorrelationId"),
)


def provider() -> Provider:
    return Provider(name="tim", actions=[run_kql, dev_json, sign_ins_for_user], hooks=[KustoHook])
