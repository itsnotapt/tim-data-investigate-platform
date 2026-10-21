"""``tim-api``: commands for operators and action authors, run in the api image.

- ``tim-api schema actions|connections`` prints the JSON Schema of the installed action types'
  action files, or of the connections file for the installed connection types, for
  ``yaml-language-server``.
- ``tim-api check [--actions <dir>] [--connections <file>]`` runs the startup validation of the
  installed providers, the action files and the connections file, without a database,
  credentials or other settings.

``--dev-actions`` adds the development actions and action types, as ``TIM_DEV_ACTIONS`` does.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path

from tim_actions import Provider
from tim_actions.connections_file import connections_file_schema
from tim_actions.files import action_files_schema

from tim_api.actions import InstanceConfigError, Registry, build_registry, load_providers


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="tim-api")
    sub = parser.add_subparsers(dest="command", required=True)
    schema = sub.add_parser("schema", help="print the JSON Schema of a file TIM reads")
    schema.add_argument(
        "file",
        choices=["actions", "connections"],
        help="actions: an action file; connections: the connections file",
    )
    check = sub.add_parser("check", help="validate as startup does, without a database")
    check.add_argument("--actions", type=Path, help="the action files directory")
    check.add_argument("--connections", type=Path, help="the connections file")
    for command in (schema, check):
        command.add_argument(
            "--dev-actions",
            action="store_true",
            help="include the development actions, as TIM_DEV_ACTIONS=true does",
        )
    return parser


def _checked_registry(
    providers: Sequence[Provider] | None,
    actions_dir: Path | None,
    *,
    action_files: bool,
    dev_actions: bool,
    connections_file: Path | None = None,
) -> Registry | None:
    """The registry, or ``None`` with its problems printed."""
    try:
        return build_registry(
            load_providers(providers, dev_actions=dev_actions),
            actions_dir,
            action_files=action_files,
            connections_file=connections_file,
        )
    except InstanceConfigError as exc:
        print(exc, file=sys.stderr)
        return None


def main(argv: Sequence[str] | None = None, *, providers: Sequence[Provider] | None = None) -> int:
    """Run a command; ``providers`` replaces discovery through the ``tim.actions`` entry
    points."""
    args = build_parser().parse_args(argv)
    if args.command == "schema":
        registry = _checked_registry(
            providers, None, action_files=False, dev_actions=args.dev_actions
        )
        if registry is None:
            return 1
        schema = (
            action_files_schema(registry.action_types)
            if args.file == "actions"
            else connections_file_schema(registry.hooks)
        )
        print(json.dumps(schema, indent=2))
        return 0
    if args.actions is not None and not args.actions.is_dir():
        print(f"error: --actions: no directory {args.actions}", file=sys.stderr)
        return 2
    if args.connections is not None and not args.connections.is_file():
        print(f"error: --connections: no file {args.connections}", file=sys.stderr)
        return 2
    registry = _checked_registry(
        providers,
        args.actions,
        action_files=True,
        dev_actions=args.dev_actions,
        connections_file=args.connections,
    )
    if registry is None:
        return 1
    for reason in registry.left_out:
        print(reason)
    print(f"OK: {len(registry.actions)} actions, {len(registry.connections)} connections")
    return 0


if __name__ == "__main__":
    sys.exit(main())
