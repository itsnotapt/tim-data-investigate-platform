from builtin import KqlQuery
from interface import Param

action = KqlQuery(
    key="tim.sign_ins_for_user",
    name="Sign-ins for user",
    connection="kusto-main",
    database="Security",
    kql="SigninLogs | where UserPrincipalName == upn",
    params=(Param("upn", from_columns=("UserPrincipalName",)),),
)
