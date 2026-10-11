from builtin import KqlQuerry
from interface import hash_values

action = KqlQuerry(
    key="tim.sign_ins_for_user",
    name="Sign-ins for user",
    connection="kusto-main",
    database="Security",
    kql="SigninLogs",
    id=hash_values,
)
