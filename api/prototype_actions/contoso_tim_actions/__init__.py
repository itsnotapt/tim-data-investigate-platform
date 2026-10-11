"""PROTOTYPE, throwaway: a package outside TIM that adds a backend and an action.

It ships the Snowflake hook and the SnowflakeQuery action type to show a package can add a
backend; TIM may well ship Snowflake itself. Its ``pyproject.toml`` would say:

    [project.entry-points."tim.actions"]
    contoso = "contoso_tim_actions:provider"

which the fake ``site/contoso_tim_actions-0.1.0.dist-info`` stands in for.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from fakes import FakeSnowflakeCursor
from interface import Action, Column, Hook, Param, Provider, Row, RunContext, from_columns


class SnowflakeHook(Hook):
    backend = "snowflake"

    def get_conn(self) -> FakeSnowflakeCursor:
        # Real: OBO for api://<snowflake-app>/session:role-any, then
        # snowflake.connector.connect(account=..., authenticator="oauth", token=...).
        # One login per run: Snowflake sessions can't be shared across analysts.
        return FakeSnowflakeCursor(self.connection.endpoint, as_user=self.analyst.upn)


class SnowflakeQuery(Action):
    """Action type for fixed SQL with pyformat binds; a list param expands to ``(a, b, ...)``."""

    def __init__(self, *, connection: str, sql: str, **action: Any) -> None:
        super().__init__(**action)
        self.connection, self.sql = connection, sql

    def run(self, params: dict[str, Any], ctx: RunContext) -> Iterable[Row]:
        hook = ctx.hook(self.connection)
        assert isinstance(hook, SnowflakeHook)
        cursor = hook.get_conn()
        cursor.execute(self.sql, params)
        ctx.detail("snowflakeQueryId", cursor.sfqid)
        yield from cursor


okta_logins = SnowflakeQuery(
    key="contoso.okta_logins",
    name="Okta logins for users",
    menu=("Okta",),
    pivot="rows",
    connection="snowflake-okta",
    sql="""
        select event_time, actor_upn, client_ip, outcome, uuid
        from okta.logs.system_log
        where actor_upn in %(upns)s and event_time > dateadd(day, -%(days)s, current_timestamp)
    """,
    params=(
        Param("upns", many=True, label="Users",
              from_columns=("UserPrincipalName", "AccountUpn", "ACTOR_UPN")),
        Param("days", "int", default=7),
    ),
    columns=(
        Column("EVENT_TIME", "datetime"),
        Column("ACTOR_UPN"),
        Column("CLIENT_IP"),
        Column("OUTCOME"),
        Column("UUID", hidden=True),
    ),
    id=from_columns("UUID"),
)


def provider() -> Provider:
    return Provider(name="contoso", actions=[okta_logins], hooks=[SnowflakeHook])
