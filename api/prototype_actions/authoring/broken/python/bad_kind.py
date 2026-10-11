from builtin import KqlQuery
from interface import Param, hash_values

action = KqlQuery(
    key="tim.sign_ins_for_user",
    name="Sign-ins for user",
    connection="kusto-main",
    database="Security",
    kql="SigninLogs | where TimeGenerated > ago(days * 1d)",
    params=(Param("days", "integer", default=1),),
    id=hash_values,
)
