"""Single source of truth for the tag tables (backend-api.md#kusto-tables, P2-14).

Columns, types, JSON mapping names and paths are identical to the legacy ``*Table`` classes
(backend/Tim.Backend/Models/TaggedEvents/Tables/{SavedEvent,EventTag,EventComment}Table.cs).
Ingestion row keys (``router.py``) are the camelCase paths below.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

SAVED_EVENT_TABLE = "SavedEvent"
EVENT_TAG_TABLE = "EventTag"
EVENT_COMMENT_TABLE = "EventComment"


@dataclass(frozen=True)
class Column:
    name: str
    kusto_type: str
    path: str  # JSON mapping path, e.g. "$.eventId"


@dataclass(frozen=True)
class TableSpec:
    name: str
    mapping_name: str
    columns: tuple[Column, ...]

    @property
    def row_keys(self) -> tuple[str, ...]:
        return tuple(c.path.removeprefix("$.") for c in self.columns)


def _col(name: str, kusto_type: str) -> Column:
    return Column(name, kusto_type, f"$.{name[0].lower()}{name[1:]}")


TABLES: tuple[TableSpec, ...] = (
    TableSpec(
        SAVED_EVENT_TABLE,
        "SavedEventMapping",
        (
            _col("EventId", "string"),
            _col("EventTime", "datetime"),
            _col("DateTimeUtc", "datetime"),
            _col("CreatedBy", "string"),
            _col("EventAsJson", "dynamic"),
        ),
    ),
    TableSpec(
        EVENT_TAG_TABLE,
        "EventTagMapping",
        (
            _col("EventId", "string"),
            _col("DateTimeUtc", "datetime"),
            _col("CreatedBy", "string"),
            _col("Tag", "string"),
            _col("IsDeleted", "bool"),
        ),
    ),
    TableSpec(
        EVENT_COMMENT_TABLE,
        "EventCommentMapping",
        (
            _col("EventId", "string"),
            _col("DateTimeUtc", "datetime"),
            _col("CreatedBy", "string"),
            _col("Comment", "string"),
            _col("Determination", "string"),
            _col("IsDeleted", "bool"),
        ),
    ),
)

_BY_NAME = {t.name: t for t in TABLES}


def mapping_name(table: str) -> str:
    return _BY_NAME[table].mapping_name


def _kql_single_quoted(text: str) -> str:
    return "'" + text.replace("\\", "\\\\").replace("'", "\\'") + "'"


def mapping_json(spec: TableSpec) -> str:
    """Compact JSON ingestion-mapping array (``column``/``path``/``datatype``)."""
    return json.dumps(
        [{"column": c.name, "path": c.path, "datatype": c.kusto_type} for c in spec.columns],
        separators=(",", ":"),
    )


def create_table_command(spec: TableSpec) -> str:
    cols = ", ".join(f"{c.name}:{c.kusto_type}" for c in spec.columns)
    return f".create-merge table {spec.name} ({cols})"


def create_mapping_command(spec: TableSpec) -> str:
    return (
        f'.create-or-alter table {spec.name} ingestion json mapping "{spec.mapping_name}" '
        f"{_kql_single_quoted(mapping_json(spec))}"
    )


def streaming_policy_command(spec: TableSpec) -> str:
    return f".alter table {spec.name} policy streamingingestion enable"


def all_commands() -> list[str]:
    """Tables first, then mappings, then policies (mappings need the tables to exist)."""
    return (
        [create_table_command(t) for t in TABLES]
        + [create_mapping_command(t) for t in TABLES]
        + [streaming_policy_command(t) for t in TABLES]
    )
