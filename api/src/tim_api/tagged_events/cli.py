"""``python -m tim_api.tagged_events.cli create-tables``.

Creates/updates the tag tables, JSON ingestion mappings and streaming-ingestion policy in the tag
cluster/database. All commands are idempotent.
Any failure is printed and the exit status is non-zero.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Callable, Sequence
from typing import Any

from tim_api.tagged_events.kusto_schema import all_commands

ClientFactory = Callable[[str], Any]


def _default_client(cluster_uri: str) -> Any:
    from azure.identity import DefaultAzureCredential
    from azure.kusto.data import KustoClient, KustoConnectionStringBuilder

    kcsb = KustoConnectionStringBuilder.with_azure_token_credential(
        cluster_uri, DefaultAzureCredential()
    )
    return KustoClient(kcsb)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m tim_api.tagged_events.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    create = sub.add_parser("create-tables", help="create tag tables, mappings, streaming policy")
    create.add_argument("--dry-run", action="store_true", help="print the commands, run nothing")
    create.add_argument("--cluster-uri", default=os.environ.get("TIM_TAG_CLUSTER_URI"))
    create.add_argument("--database", default=os.environ.get("TIM_TAG_DATABASE", "Research"))
    return parser


def main(argv: Sequence[str] | None = None, client_factory: ClientFactory | None = None) -> int:
    args = build_parser().parse_args(argv)
    commands = all_commands()
    if args.dry_run:
        for command in commands:
            print(command)
        return 0
    if not args.cluster_uri:
        print("error: set TIM_TAG_CLUSTER_URI or pass --cluster-uri", file=sys.stderr)
        return 2
    cluster = args.cluster_uri.rstrip("/")
    client = (client_factory or _default_client)(cluster)
    try:
        for command in commands:
            print(f"[{args.database}] {command[:70]}")
            client.execute_mgmt(args.database, command)
    except Exception as exc:
        print(f"error: command failed: {command}\n{type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    finally:
        close = getattr(client, "close", None)
        if close is not None:
            close()
    print(f"done: {len(commands)} commands applied to {cluster} / {args.database}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
