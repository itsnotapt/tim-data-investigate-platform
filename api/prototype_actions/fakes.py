"""PROTOTYPE, throwaway: stand-ins for the Kusto and Snowflake clients, so the demo runs offline.

They print what the real client would be sent, then return canned rows.
"""

from __future__ import annotations

from typing import Any

SIGN_INS = [
    {"Timestamp": "2026-10-10T08:01:12Z", "UserPrincipalName": "ana@contoso.com",
     "IPAddress": "203.0.113.7", "ResultType": 0, "CorrelationId": "c-111"},
    {"Timestamp": "2026-10-10T08:03:40Z", "UserPrincipalName": "ana@contoso.com",
     "IPAddress": "198.51.100.23", "ResultType": 50126, "CorrelationId": "c-112"},
    {"Timestamp": "2026-10-10T09:15:02Z", "UserPrincipalName": "ben@contoso.com",
     "IPAddress": "203.0.113.7", "ResultType": 0, "CorrelationId": "c-113"},
]

OKTA_LOGINS = [
    {"EVENT_TIME": "2026-10-10T07:59:58Z", "ACTOR_UPN": "ana@contoso.com",
     "CLIENT_IP": "203.0.113.7", "OUTCOME": "SUCCESS", "UUID": "okta-9f1"},
    {"EVENT_TIME": "2026-10-10T09:14:51Z", "ACTOR_UPN": "ben@contoso.com",
     "CLIENT_IP": "203.0.113.7", "OUTCOME": "SUCCESS", "UUID": "okta-9f2"},
]


class FakeKustoClient:
    def __init__(self, cluster: str, as_user: str) -> None:
        self.cluster = cluster
        self.as_user = as_user

    def execute(self, database: str, query: str, parameters: dict[str, str]) -> dict[str, Any]:
        print(f"    [kusto] {self.cluster}/{database} as {self.as_user}")
        print(f"    [kusto] query: {' '.join(query.split())}")
        print(f"    [kusto] query parameters: {parameters}")
        return {
            "columns": [("Timestamp", "datetime"), ("UserPrincipalName", "string"),
                        ("IPAddress", "string"), ("ResultType", "int"),
                        ("CorrelationId", "string")],
            "rows": SIGN_INS,
            "stats": {"execution_time": 0.42, "cpu": "00:00:00.1250000"},
        }


class FakeSnowflakeCursor:
    def __init__(self, account: str, as_user: str) -> None:
        self.account = account
        self.as_user = as_user
        self.rows: list[dict[str, Any]] = []
        self.sfqid = "01b7-fake-query-id"

    def execute(self, sql: str, binds: dict[str, Any]) -> None:
        print(f"    [snowflake] {self.account} as {self.as_user}")
        print(f"    [snowflake] sql: {' '.join(sql.split())}")
        print(f"    [snowflake] binds: {binds}")
        wanted = set(binds.get("upns") or [r["ACTOR_UPN"] for r in OKTA_LOGINS])
        self.rows = [r for r in OKTA_LOGINS if r["ACTOR_UPN"] in wanted]

    def __iter__(self):  # type: ignore[no-untyped-def]
        return iter(self.rows)
