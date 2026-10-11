"""A computed param needs code: the window is worked out from the clicked row in resolve().

In Python that is a subclass (a new action type) next to the action. As an action file it is
either pushed into the query (sign_ins_around_event.yaml) or the subclass moves into a package
as an action type with its own ``type_name``, and the file names that type.
"""

from datetime import datetime, timedelta
from typing import Any

from builtin import KqlQuery
from interface import Param, PivotContext, first_of


class SignInsAroundEvent(KqlQuery):
    def resolve(self, context: PivotContext) -> dict[str, Any]:
        params = super().resolve(context)
        when = datetime.fromisoformat(context.row["Timestamp"].replace("Z", "+00:00"))
        params["startTime"] = (when - timedelta(minutes=30)).isoformat()
        params["endTime"] = (when + timedelta(minutes=30)).isoformat()
        return params


action = SignInsAroundEvent(
    key="tim.sign_ins_around_event",
    name="Sign-ins around this event",
    menu=("Entra",),
    connection="kusto-main",
    database="Security",
    kql="""
        declare query_parameters(upn:string, startTime:datetime, endTime:datetime);
        SigninLogs
        | where TimeGenerated between (startTime .. endTime)
        | where UserPrincipalName == upn
    """,
    params=(
        Param("upn", from_columns=("UserPrincipalName", "AccountUpn")),
        Param("startTime", "datetime"),
        Param("endTime", "datetime"),
    ),
    id=first_of("CorrelationId"),
)
