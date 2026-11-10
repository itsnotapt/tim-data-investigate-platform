"""``kusto_save``: a sink that ingests the selected rows into a table of a Kusto connection."""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Annotated, Any

from azure.kusto.data import ClientRequestProperties
from azure.kusto.data import exceptions as kusto_exc
from pydantic import Field
from tim_actions import Column, ConnectionName, RunContext, RunError, Sink, SinkDocument
from tim_actions.kusto import KustoHook, error_message

# A plain Kusto table name, which the command names as it is.
TableName = Annotated[str, Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]{0,1023}$")]
DatabaseName = Annotated[str, Field(pattern=r"\S")]


class KustoSaveFile(SinkDocument):
    connection: ConnectionName
    database: DatabaseName
    table: TableName


class KustoSave(Sink):
    """``kusto_save``: ingests each row into ``table`` in ``database`` of the Kusto
    ``connection``, as the analyst, with ``.ingest inline``. Each record is the row as ``Row``,
    with ``SavedAt`` (UTC) and ``SavedBy``, the analyst's upn."""

    type_name = "kusto_save"
    File = KustoSaveFile

    connection: ConnectionName
    database: DatabaseName
    table: TableName

    def connections(self) -> Mapping[str, str]:
        return {self.connection: "kusto"}

    def run(
        self, columns: Sequence[Column], rows: Sequence[Mapping[str, Any]], ctx: RunContext
    ) -> None:
        saved_at = datetime.now(UTC).isoformat()
        records = "\n".join(
            json.dumps({"SavedAt": saved_at, "SavedBy": ctx.analyst.upn, "Row": row})
            for row in rows
        )
        command = (
            f".ingest inline into table ['{self.table}'] with (format='multijson') <|\n{records}"
        )
        hook = ctx.hook(self.connection)
        if not isinstance(hook, KustoHook):
            raise RunError(f"{self.connection} is not a Kusto connection")
        try:
            client = hook.get_conn()
            try:
                client.execute_mgmt(
                    self.database,
                    command,
                    ClientRequestProperties(),  # type: ignore[no-untyped-call]
                )
            finally:
                client.close()
        except kusto_exc.KustoError as exc:
            raise RunError(error_message(exc)) from None
