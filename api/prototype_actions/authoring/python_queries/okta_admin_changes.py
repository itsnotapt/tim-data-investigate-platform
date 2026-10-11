from contoso_tim_actions import SnowflakeQuery
from interface import Column, Param, from_columns

action = SnowflakeQuery(
    key="contoso.okta_admin_changes",
    name="Okta admin changes",
    menu=("Okta",),
    description="Privilege grants and removals in Okta.",
    pivot="none",
    connection="snowflake-okta",
    sql="""
        select event_time, actor_upn, target_upn, event_type, outcome, uuid
        from okta.logs.system_log
        where event_type like 'user.account.privilege.%%'
          and event_time > dateadd(day, -%(days)s, current_timestamp)
          and (%(outcome)s is null or outcome = %(outcome)s)
    """,
    params=(
        Param("days", "int", default=7),
        Param("outcome", "choice", required=False, choices=("SUCCESS", "FAILURE")),
    ),
    columns=(
        Column("EVENT_TIME", "datetime"),
        Column("ACTOR_UPN"),
        Column("TARGET_UPN"),
        Column("EVENT_TYPE"),
        Column("OUTCOME"),
        Column("UUID", hidden=True),
    ),
    id=from_columns("UUID"),
)
