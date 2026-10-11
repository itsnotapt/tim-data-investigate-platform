"""PROTOTYPE, throwaway: walks the action interface through startup, the catalogue, pivots and
runs, printing the state after each step.

    python3 api/prototype_actions/demo.py            # everything
    python3 api/prototype_actions/demo.py pivots     # one section: startup|catalogue|run-kql|
                                                     #   pivots|dev-json|errors

Question: what Python interface do actions and action types implement, so that packages outside
TIM can add their own? Assumption: the audience is action authors, so the prototype is Python to
read (interface.py, builtin.py, contoso_tim_actions/) plus this script, not a clickable page.
Stdlib only; Kusto and Snowflake are faked (fakes.py).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE / "site")]  # site/ holds the fake installed package

import builtin  # noqa: E402
from fakes import OKTA_LOGINS, SIGN_INS  # noqa: E402
from interface import Analyst, Connection, PivotContext  # noqa: E402
from tim_side import Registry, catalogue, check_params, discover, menu_for, run_action  # noqa: E402

ANALYST = Analyst(
    oid="0000-ana", upn="carl@contoso.com", name="Carl", tenant_id="tid", token="eyJ...secret"
)

CONNECTIONS = [  # instance config; format is the "Connections and auth" ticket's call
    Connection("kusto-main", "kusto", "https://contoso.kusto.windows.net", "obo"),
    Connection("kusto-help", "kusto", "https://help.kusto.windows.net", "obo"),
    Connection("snowflake-okta", "snowflake", "contoso-okta.snowflakecomputing.com",
               "external_oauth"),
]


def heading(text: str) -> None:
    print(f"\n{'=' * 100}\n{text}\n{'=' * 100}")


def show(label: str, value: object) -> None:
    print(f"  {label}: {json.dumps(value, default=str)}")


def show_result(result: dict) -> None:
    show("params", result["params"])
    show("details", result["details"])
    print("  columns:")
    for c in result["columns"]:
        print(f"    {c['name']:<20} {c['type']:<9} {'hidden' if c['hidden'] else ''}")
    print("  rows (id | values):")
    for r in result["rows"]:
        print(f"    {r['id']:<34} | {json.dumps(r['values'])}")


def startup() -> Registry:
    heading("STARTUP: discover providers, check connections against installed hooks")
    registry = Registry(discover(builtin.provider()), CONNECTIONS)
    show("actions", list(registry.actions))
    show("backends", {b: h.__name__ for b, h in registry.hook_types.items()})
    show("connections", {c.name: c.backend for c in CONNECTIONS})
    return registry


def section_catalogue(registry: Registry) -> None:
    heading("CATALOGUE: what the browser gets (no code: run, resolve and id stay server-side)")
    print(json.dumps(catalogue(registry), indent=2))


def pivot(registry: Registry, label: str, context: PivotContext, pick: str) -> None:
    print(f"\n--- {label}")
    show("clicked row", context.row)
    show("selected rows", len(context.rows))
    show("clicked cell", {context.column: context.value})
    show("context menu offers", menu_for(catalogue(registry), context))
    action = next(a for a in registry.actions.values() if a.name == pick)
    resolved = action.resolve(context)
    print(f"  picked {pick!r}; resolve() ->")
    show("resolved params", resolved)
    try:
        check_params(action, resolved, registry)
    except ValueError as exc:
        print(f"  not every required param is filled ({exc}): the tab opens with the form, no run")
        return
    print("  every required param filled: runs at once")
    show_result(run_action(registry, action.key, resolved, ANALYST))


def section_run_kql(registry: Registry) -> None:
    heading("NEW MENU > Kusto > Run KQL (columns declared at run time from Kusto)")
    show_result(run_action(registry, "tim.run_kql", {
        "connection": "kusto-main",
        "database": "Security",
        "query": "SigninLogs | where TimeGenerated between (_startTime .. _endTime) | take 3",
        "startTime": "2026-10-10T00:00:00+00:00",
        "endTime": "2026-10-11T00:00:00+00:00",
    }, ANALYST))


def section_pivots(registry: Registry) -> None:
    heading("PIVOTS: menu filtered by declared columns, params resolved by the action's code")
    pivot(registry, "Right-click Ana's sign-in, Ana and Ben selected -> Okta (many rows)",
          PivotContext(row=SIGN_INS[0], rows=[SIGN_INS[0], SIGN_INS[2]],
                       column="IPAddress", value=SIGN_INS[0]["IPAddress"]),
          "Okta logins for users")
    pivot(registry, "Right-click an Okta row (column ACTOR_UPN) -> Kusto sign-ins (one row)",
          PivotContext(row=OKTA_LOGINS[1], rows=[OKTA_LOGINS[1]],
                       column="ACTOR_UPN", value=OKTA_LOGINS[1]["ACTOR_UPN"]),
          "Sign-ins for user")
    row_without_user = {"Timestamp": "2026-10-10T10:00:00Z", "DeviceName": "ws-042"}
    pivot(registry, "Right-click a device row: user pivots are not offered",
          PivotContext(row=row_without_user, rows=[row_without_user],
                       column="DeviceName", value="ws-042"),
          "JSON (development)")


def section_dev_json(registry: Registry) -> None:
    heading("DEV JSON with typed-in rows: no declared columns or id, so both are inferred/hashed")
    rows = [{"when": "2026-10-10T08:00:00Z", "n": 1, "tags": ["a"]}, {"when": "x", "n": 2.5}]
    show_result(run_action(registry, "tim.dev_json", {"rows": json.dumps(rows)}, ANALYST))


def section_errors(registry: Registry) -> None:
    heading("ERRORS: params checked by TIM before run(); startup refuses broken config")
    for raw in ({"connection": "snowflake-okta", "database": "x", "query": "T"},
                {"connection": "kusto-main", "database": "Security"}):
        try:
            check_params(registry.actions["tim.run_kql"], raw, registry)
        except ValueError as exc:
            show(f"Run KQL {raw}", str(exc))
    try:
        Registry([builtin.provider()], CONNECTIONS)  # contoso not installed
    except RuntimeError as exc:
        show("startup without contoso_tim_actions", str(exc))


SECTIONS = {
    "catalogue": section_catalogue,
    "run-kql": section_run_kql,
    "pivots": section_pivots,
    "dev-json": section_dev_json,
    "errors": section_errors,
}

if __name__ == "__main__":
    reg = startup()
    for name in sys.argv[1:] or SECTIONS:
        if name != "startup":
            SECTIONS[name](reg)
