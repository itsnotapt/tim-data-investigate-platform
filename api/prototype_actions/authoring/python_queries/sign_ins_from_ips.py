from builtin import KqlQuery
from interface import Param, first_of

action = KqlQuery(
    key="tim.sign_ins_from_ips",
    name="Sign-ins from IPs",
    menu=("Entra",),
    pivot="rows",
    connection="kusto-main",
    database="Security",
    kql="""
        declare query_parameters(ips:dynamic, days:int = 1);
        SigninLogs
        | where TimeGenerated > ago(days * 1d)
        | where IPAddress in (ips)
    """,
    params=(
        Param("ips", label="IP addresses", many=True,
              from_columns=("IPAddress", "CLIENT_IP", "RemoteIP")),
        Param("days", "int", default=1),
    ),
    id=first_of("CorrelationId"),
)
