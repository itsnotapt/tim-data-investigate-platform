"""PROTOTYPE, throwaway: the same three queries written as Python and as YAML action files.

    uv run --project api --with pyyaml python api/prototype_actions/authoring/compare.py
    uv run --project api --with pyyaml python api/prototype_actions/authoring/compare.py errors
        # one section: side-by-side|same-actions|errors|escape-hatch|schema|locations

Question: how are queries written, a Python file per query or YAML files tied to a registered
action type? Assumption: the audience is people who write queries but not much Python, so the
prototype is the files themselves (python_queries/ next to yaml_queries/), what TIM makes of
each, and the error messages each gives, rather than a clickable page.

Kusto and Snowflake are faked (../fakes.py); the action interface is ../interface.py, the file
format ../action_files.py.
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE.parent), str(HERE.parent / "site")]

import builtin  # noqa: E402
import contoso_tim_actions  # noqa: E402
from action_files import ActionFileError, file_provider, file_schema, load_action_file  # noqa: E402
from demo import ANALYST, CONNECTIONS, heading, show, show_result  # noqa: E402
from fakes import OKTA_LOGINS, SIGN_INS  # noqa: E402
from interface import Action, PivotContext, Provider  # noqa: E402
from tim_side import Registry, catalogue, check_params, menu_for, run_action  # noqa: E402

QUERIES = ["sign_ins_for_user", "okta_admin_changes", "sign_ins_from_ips"]
FILE_TYPES = {t.type_name: t for t in (builtin.KqlQuery, contoso_tim_actions.SnowflakeQuery)}
BACKENDS = [builtin.KustoHook, contoso_tim_actions.SnowflakeHook]


def import_action(path: Path) -> Action:
    spec = importlib.util.spec_from_file_location(f"query_{path.stem}", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.action  # type: ignore[no-any-return]


def registry_of(name: str, actions: list[Action]) -> Registry:
    return Registry([Provider(name=name, actions=actions, hooks=BACKENDS)], CONNECTIONS)


def python_registry() -> Registry:
    return registry_of("python", [import_action(HERE / "python_queries" / f"{q}.py")
                                  for q in QUERIES])


def yaml_registry() -> Registry:
    return registry_of("yaml", [load_action_file(HERE / "yaml_queries" / f"{q}.yaml", FILE_TYPES)
                                for q in QUERIES])


def counted(path: Path) -> str:
    lines = [ln for ln in path.read_text().splitlines() if ln.strip() and not ln.startswith("#")]
    chars = sum(len(ln.strip()) for ln in lines)
    return f"{path.relative_to(HERE)}: {len(lines)} lines, {chars} characters"


# --- sections --------------------------------------------------------------------------------


def side_by_side() -> None:
    heading("SIDE BY SIDE: the same query in each format (comments and blank lines not counted)")
    for q in QUERIES:
        py, ym = HERE / "python_queries" / f"{q}.py", HERE / "yaml_queries" / f"{q}.yaml"
        left, right = py.read_text().splitlines(), ym.read_text().splitlines()
        width = max(map(len, left)) + 2
        print(f"\n--- {counted(py)}\n    {counted(ym)}")
        for i in range(max(len(left), len(right))):
            a = left[i] if i < len(left) else ""
            b = right[i] if i < len(right) else ""
            print(f"  {a:<{width}}| {b}")
        sidecar = HERE / "yaml_queries" / f"{q}.kql"
        if sidecar.exists():
            print(f"\n  {sidecar.name} (sidecar):")
            for ln in sidecar.read_text().splitlines():
                print(f"    {ln}")


def same_actions() -> None:
    heading("SAME ACTIONS: both formats give TIM the same catalogue entries, pivots and results")
    py, ym = python_registry(), yaml_registry()
    py_cat, ym_cat = catalogue(py), catalogue(ym)
    for p, y in zip(py_cat, ym_cat, strict=True):
        verdict = "identical" if p == y else f"DIFFERENT\n  python: {p}\n  yaml:   {y}"
        print(f"  catalogue entry {p['key']}: {verdict}")

    contexts = {
        "tim.sign_ins_for_user": PivotContext(row=OKTA_LOGINS[1], rows=[OKTA_LOGINS[1]],
                                              column="ACTOR_UPN", value="ben@contoso.com"),
        "contoso.okta_admin_changes": None,
        "tim.sign_ins_from_ips": PivotContext(row=SIGN_INS[0], rows=SIGN_INS[:2],
                                              column="IPAddress", value=SIGN_INS[0]["IPAddress"]),
    }
    for key, context in contexts.items():
        print(f"\n--- {key}")
        results = []
        for label, registry in (("python", py), ("yaml", ym)):
            action = registry.actions[key]
            if context is None:
                raw: dict[str, Any] = {"outcome": "SUCCESS"}
                print(f"  [{label}] New menu, analyst picks outcome=SUCCESS")
            else:
                print(f"  [{label}] menu offers {menu_for(catalogue(registry), context)}")
                raw = action.resolve(context)
            result = run_action(registry, key, raw, ANALYST)
            result["details"].pop("duration")
            results.append(result)
        print(f"  results identical: {results[0] == results[1]}")
        show_result(results[1])


def errors() -> None:
    heading("ERRORS: the same six mistakes in each format, as the author sees them at startup")
    for name in ("typo_key", "missing_id", "bad_kind", "unknown_type", "bad_indent",
                 "missing_kql_file"):
        print(f"\n--- {name}")
        try:
            load_action_file(HERE / "broken" / "yaml" / f"{name}.yaml", FILE_TYPES)
            print("  yaml:   loads without error")
        except ActionFileError as exc:
            for line in str(exc).splitlines():
                print(f"  yaml:   {line}")
        try:
            action = import_action(HERE / "broken" / "python" / f"{name}.py")
            print("  python: imports without error", end="")
            try:
                check_params(action, {"days": "1"}, registry_of("x", [action]))
                print("; params checked without error too: the bad kind is silently a string")
            except ValueError as exc:
                print(f"; {exc}")
        except BaseException as exc:  # noqa: BLE001
            frame = next((f for f in reversed(traceback.extract_tb(exc.__traceback__))
                          if "broken" in f.filename), None)
            where = f"{Path(frame.filename).name}:{frame.lineno}" if frame else ""
            if isinstance(exc, SyntaxError):
                where = f"{Path(exc.filename or '').name}:{exc.lineno}"
            print(f"  python: {where}: {type(exc).__name__}: {exc}")
    print("\n  In the editor, before anything runs: mypy reports typo_key, bad_kind and unknown_type"
          "\n  but not missing_id (KqlQuery.__init__ takes **action: Any, which hides Action's"
          "\n  fields); yaml-language-server reports all four from action-file.schema.json.")


def escape_hatch() -> None:
    heading("ESCAPE HATCH: a computed param (a window around the clicked row's time)")
    py = import_action(HERE / "escape_hatch" / "sign_ins_around_event.py")
    ym = load_action_file(HERE / "escape_hatch" / "sign_ins_around_event.yaml", FILE_TYPES)
    context = PivotContext(row=SIGN_INS[1], rows=[SIGN_INS[1]], column="IPAddress",
                           value=SIGN_INS[1]["IPAddress"])
    for label, action in (("python: custom resolve() in a subclass", py),
                          ("yaml: plain kql_query, the KQL computes the window", ym)):
        registry = registry_of(label, [action])
        print(f"\n--- {label}")
        resolved = action.resolve(context)
        show("resolved params (what the form shows)", resolved)
        result = run_action(registry, action.key, resolved, ANALYST)
        show("row count", result["details"]["rowCount"])


def schema() -> None:
    heading("SCHEMA: generated from the installed action types, for completion in the editor")
    out = HERE / "action-file.schema.json"
    out.write_text(json.dumps(file_schema(FILE_TYPES), indent=2) + "\n")
    print(f"  wrote {out.relative_to(HERE)} ({out.stat().st_size} bytes); YAML files point at it:")
    print("    # yaml-language-server: $schema=../action-file.schema.json")
    defs = json.loads(out.read_text())["$defs"]
    for name in ("KqlQueryFile", "SnowflakeQueryFile"):
        props = defs[name]["properties"]
        required = defs[name].get("required", [])
        print(f"  {name}: required {required}; all fields {list(props)}")


def locations() -> None:
    heading("LOCATIONS: files from a package and from the instance, same loader")
    os.environ.setdefault("TIM_ACTION_FILES", str(HERE / "yaml_queries"))
    instance_dir = Path(os.environ["TIM_ACTION_FILES"])
    providers = [
        builtin.provider(),
        contoso_tim_actions.provider(),
        # A package ships files as package data: file_provider("contoso", files(pkg) / "queries")
        # Instance files are mounted from a ConfigMap: no image build to add a query.
        file_provider("instance", instance_dir, FILE_TYPES),
    ]
    try:
        Registry(providers, CONNECTIONS)
    except RuntimeError as exc:
        print(f"  startup refuses: {exc}")
        print("  (the instance files reuse keys the packages already ship; dropping theirs)")
    providers[0] = Provider(name="tim", actions=[builtin.run_kql, builtin.dev_json],
                            hooks=[builtin.KustoHook], action_types=[builtin.KqlQuery])
    providers[1] = Provider(name="contoso", actions=[contoso_tim_actions.okta_logins],
                            hooks=[contoso_tim_actions.SnowflakeHook],
                            action_types=[contoso_tim_actions.SnowflakeQuery])
    registry = Registry(providers, CONNECTIONS)
    for provider in providers:
        show(provider.name, [a.key for a in provider.actions])
    show("file types installed", sorted(t.type_name for p in providers
                                         for t in p.action_types))  # type: ignore[attr-defined]
    show("actions", list(registry.actions))


SECTIONS = {
    "side-by-side": side_by_side,
    "same-actions": same_actions,
    "errors": errors,
    "escape-hatch": escape_hatch,
    "schema": schema,
    "locations": locations,
}

if __name__ == "__main__":
    for section in sys.argv[1:] or SECTIONS:
        SECTIONS[section]()
