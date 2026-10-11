"""PROTOTYPE, throwaway: TIM's side of the interface. Authors never import this.

Discovery at startup, the catalogue the browser gets, the browser's menu filter (in Python here,
TypeScript for real), param checking and the run loop. The result envelope is a placeholder:
the API contract is still unspecified on the map.
"""

from __future__ import annotations

import re
import time
from dataclasses import asdict
from datetime import datetime
from importlib.metadata import entry_points
from typing import Any

from interface import (
    Action,
    Analyst,
    Column,
    Connection,
    Hook,
    PivotContext,
    Provider,
    Row,
    RunContext,
)

ENTRY_POINT_GROUP = "tim.actions"


class Registry:
    def __init__(self, providers: list[Provider], connections: list[Connection]) -> None:
        self.actions: dict[str, Action] = {}
        self.hook_types: dict[str, type[Hook]] = {}
        for provider in providers:
            for hook_type in provider.hooks:
                if hook_type.backend in self.hook_types:
                    raise RuntimeError(f"{provider.name}: backend {hook_type.backend} is taken")
                self.hook_types[hook_type.backend] = hook_type
            for action in provider.actions:
                if action.key in self.actions:
                    raise RuntimeError(f"{provider.name}: action key {action.key} is taken")
                self.actions[action.key] = action
        self.connections = {c.name: c for c in connections}
        for c in connections:
            if c.backend not in self.hook_types:
                raise RuntimeError(f"connection {c.name}: no installed hook for {c.backend}")


def discover(builtins: Provider) -> list[Provider]:
    """Built-ins plus every installed package's ``tim.actions`` entry point."""
    providers = [builtins]
    for ep in entry_points(group=ENTRY_POINT_GROUP):
        provider = ep.load()()
        print(f"  discovered {ep.dist.name if ep.dist else '?'}: {ep.value} -> {provider.name}")
        providers.append(provider)
    return providers


def catalogue(registry: Registry) -> list[dict[str, Any]]:
    """What ``GET /api/actions`` might return: everything the New menu, context menu and param
    forms need. Code (run, resolve, id) stays on the server."""
    out = []
    for action in registry.actions.values():
        params = []
        for p in action.params:
            entry = {k: v for k, v in asdict(p).items() if v not in (None, (), False, "")}
            entry["required"] = p.required
            if p.kind == "connection":
                entry["choices"] = [
                    c.name for c in registry.connections.values() if c.backend == p.backend
                ]
            params.append(entry)
        out.append({
            "key": action.key,
            "name": action.name,
            "menu": list(action.menu),
            "params": params,
            "pivot": None if action.pivot == "none" else {
                "rows": action.pivot, "columns": action.pivot_columns()},
            "columns": [asdict(c) for c in action.columns] if action.columns else None,
        })
    return out


def menu_for(catalogue: list[dict[str, Any]], context: PivotContext) -> list[str]:
    """The browser's context-menu filter, from the catalogue alone."""
    offered = []
    for entry in catalogue:
        pivot = entry["pivot"]
        if pivot is None or (pivot["rows"] == "row" and len(context.rows) > 1):
            continue
        if all(any(col in context.row for col in group) for group in pivot["columns"]):
            offered.append(entry["name"])
    return offered


def check_params(action: Action, raw: dict[str, Any], registry: Registry) -> dict[str, Any]:
    """Fill defaults, enforce required, convert kinds. Raises ValueError with a form message."""
    params: dict[str, Any] = {}
    for p in action.params:
        value = raw.get(p.name, p.default)
        if value in (None, "", []):
            if p.required:
                raise ValueError(f"{p.name} is required")
            params[p.name] = None
            continue
        if p.kind == "int":
            value = int(value)
        elif p.kind == "datetime":
            datetime.fromisoformat(value)
        elif p.kind == "connection":
            conn = registry.connections.get(value)
            if conn is None or conn.backend != p.backend:
                raise ValueError(f"{p.name}: no {p.backend} connection {value}")
        params[p.name] = value
    return params


_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$")


def infer_columns(rows: list[Row]) -> list[Column]:
    columns: dict[str, Column] = {}
    for row in rows[:100]:
        for name, value in row.items():
            if name in columns or value is None:
                continue
            if isinstance(value, bool):
                kind = "bool"
            elif isinstance(value, int | float):
                kind = "number"
            elif isinstance(value, str) and _ISO_DATE.match(value):
                kind = "datetime"
            elif isinstance(value, dict | list):
                kind = "json"
            else:
                kind = "string"
            columns[name] = Column(name, kind)  # type: ignore[arg-type]
    return list(columns.values())


def run_action(
    registry: Registry, key: str, raw_params: dict[str, Any], analyst: Analyst
) -> dict[str, Any]:
    """One action run, synchronously. The real one is the RunManager task (ADR-0012 limits,
    timeout, rows stored one per row as the "Large results" ticket decides)."""
    action = registry.actions[key]
    params = check_params(action, raw_params, registry)

    def build_hook(name: str) -> Hook:
        connection = registry.connections[name]
        return registry.hook_types[connection.backend](connection, analyst)

    ctx = RunContext(analyst, build_hook)
    started = time.perf_counter()
    rows = [{"id": action.id(row), "values": row} for row in action.run(params, ctx)]
    columns = ctx.columns or list(action.columns or []) or infer_columns([r["values"] for r in rows])
    details = {
        "duration": round(time.perf_counter() - started, 4),
        "rowCount": len(rows),
        **ctx.details,
    }
    return {
        "action": key,
        "params": params,
        "details": details,
        "columns": [asdict(c) for c in columns],
        "rows": rows,
    }
