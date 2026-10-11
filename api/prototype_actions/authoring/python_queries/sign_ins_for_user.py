from builtin import KqlQuery
from interface import Param, first_of

action = KqlQuery(
    key="tim.sign_ins_for_user",
    name="Sign-ins for user",
    menu=("Entra",),
    connection="kusto-main",
    database="Security",
    kql="""
        declare query_parameters(upn:string, days:int = 1);
        SigninLogs
        | where TimeGenerated > ago(days * 1d)
        | where UserPrincipalName == upn
    """,
    params=(
        Param("upn", label="User", from_columns=("UserPrincipalName", "AccountUpn", "ACTOR_UPN")),
        Param("days", "int", default=1),
    ),
    id=first_of("CorrelationId"),
)
