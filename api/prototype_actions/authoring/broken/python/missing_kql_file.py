from pathlib import Path

from builtin import KqlQuery
from interface import hash_values

action = KqlQuery(
    key="tim.sign_ins_from_ips",
    name="Sign-ins from IPs",
    connection="kusto-main",
    database="Security",
    kql=(Path(__file__).parent / "sign_ins_from_ip.kql").read_text(),
    id=hash_values,
)
