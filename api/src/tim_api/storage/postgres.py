"""PostgreSQL storage (ADR-0004): SQLAlchemy 2.0 async + asyncpg.

Each method is one statement (or one short transaction), so it is safe to call concurrently.
Timestamps and identities are supplied by callers; the database never reads the clock.
Schema changes go through Alembic (``migrations/``); the app does not create tables itself.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Collection, Mapping, Sequence
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    PrimaryKeyConstraint,
    String,
    Table,
    Text,
    Uuid,
    any_,
    bindparam,
    delete,
    exists,
    func,
    insert,
    select,
    text,
    true,
    update,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSON, JSONB
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, create_async_engine

from tim_api.annotations.models import (
    Annotations,
    Comment,
    CommentEntry,
    HistoryEntry,
    LabelEntry,
    LabelState,
    TagSuggestions,
)
from tim_api.column_views.models import ColumnView, ColumnViewFields, StoredColumnView
from tim_api.presets.models import Preset, PresetFields, StoredPreset
from tim_api.runs.models import Run, RunAction, RunColumn, RunRow, RunStatus
from tim_api.storage.base import (
    AlreadyExistsError,
    AnnotationChanges,
    AnnotationEdit,
    AnnotationsChanged,
    AnnotationsOf,
    AnnotationStore,
    ColumnViewStore,
    NotFoundError,
    PresetStore,
    RunStore,
    Storage,
    StorageUnavailableError,
)

metadata = MetaData()

# none_as_null: Python ``None`` is stored as SQL NULL, never as the JSON literal ``null``.
_JSON = JSONB(none_as_null=True)
_TS = DateTime(timezone=True)

runs = Table(
    "runs",
    metadata,
    Column("run_id", Uuid, primary_key=True),
    Column("owner", Text, nullable=False),
    Column("status", String(16), nullable=False),
    Column("action", _JSON, nullable=False),
    Column("params", _JSON, nullable=False),
    # json, not jsonb: details keep the order they were reported in.
    Column("details", JSON(none_as_null=True), nullable=False),
    Column("columns", _JSON),
    Column("row_count", Integer),
    Column("error", Text),
    Column("started_at", _TS, nullable=False),
    Column("finished_at", _TS),
    Column("expires_at", _TS, nullable=False),
    Column("cancel_requested", Boolean, nullable=False, server_default=text("false")),
    # Not indexed (ADR-0004).
    Column("heartbeat_at", _TS, nullable=False),
    Index("ix_runs_expires_at", "expires_at"),
    # The sweep reaches the few runs still ``running`` through this index, then checks each
    # one's heartbeat.
    Index("ix_runs_running_started", "started_at", postgresql_where=text("status = 'running'")),
)

# UNLOGGED: no WAL for result rows, which a crash empties; the rows endpoint then answers 410
# (ADR-0012).
run_rows = Table(
    "run_rows",
    metadata,
    Column("run_id", Uuid, ForeignKey("runs.run_id", ondelete="CASCADE"), nullable=False),
    Column("ordinal", Integer, nullable=False),
    Column("id", Text),
    # json, not jsonb: a row keeps the key order the run produced, at every depth (ADR-0004).
    Column("data", JSON(none_as_null=True), nullable=False),
    PrimaryKeyConstraint("run_id", "ordinal"),
    prefixes=["UNLOGGED"],
)

presets = Table(
    "presets",
    metadata,
    Column("preset_id", Uuid, primary_key=True),
    Column("owner", Text, nullable=False),
    Column("name", Text, nullable=False),
    Column("menu_path", _JSON, nullable=False),
    Column("visibility", String(16), nullable=False),
    Column("action", Text, nullable=False),
    Column("params", _JSON, nullable=False),
    Column("inputs", _JSON, nullable=False),
    Column("created_at", _TS, nullable=False),
    Column("updated_at", _TS, nullable=False),
    # list() orders by (created_at, preset_id).
    Index("ix_presets_created_id", "created_at", "preset_id"),
)

preset_hidden = Table(
    "preset_hidden",
    metadata,
    Column("preset_id", Uuid, ForeignKey("presets.preset_id", ondelete="CASCADE"), nullable=False),
    Column("analyst", Text, nullable=False),
    PrimaryKeyConstraint("preset_id", "analyst"),
)

column_views = Table(
    "column_views",
    metadata,
    Column("view_id", Uuid, primary_key=True),
    Column("owner", Text, nullable=False),
    Column("name", Text, nullable=False),
    Column("visibility", String(16), nullable=False),
    Column("saved_from_action", Text, nullable=False),
    Column("saved_from_preset_id", Uuid),
    Column("state", _JSON, nullable=False),
    Column("created_at", _TS, nullable=False),
    Column("updated_at", _TS, nullable=False),
    # list() orders by (created_at, view_id).
    Index("ix_column_views_created_id", "created_at", "view_id"),
)

column_view_hidden = Table(
    "column_view_hidden",
    metadata,
    Column("view_id", Uuid, ForeignKey("column_views.view_id", ondelete="CASCADE"), nullable=False),
    Column("analyst", Text, nullable=False),
    PrimaryKeyConstraint("view_id", "analyst"),
)

# One row: the change feed's version. Every annotation change takes it first, so its row lock
# makes version order commit order (ADR-0020).
annotation_clock = Table(
    "annotation_clock",
    metadata,
    Column("one", Boolean, primary_key=True, server_default=true()),
    Column("version", BigInteger, nullable=False),
    CheckConstraint("one", name="ck_annotation_clock_one_row"),
)

# Kept when an id's annotations are all removed, so the removal reaches other browsers.
id_state = Table(
    "id_state",
    metadata,
    Column("id", Text, primary_key=True),
    Column("label", Text),
    Column("labelled_by", Text),
    Column("labelled_at", _TS),
    Column("version", BigInteger, nullable=False),
    Index("ix_id_state_version", "version"),
)

label_changes = Table(
    "label_changes",
    metadata,
    Column("id", Text, nullable=False),
    Column("label", Text),
    Column("changed_by", Text, nullable=False),
    Column("changed_at", _TS, nullable=False),
    Column("version", BigInteger, nullable=False),
    PrimaryKeyConstraint("id", "version"),
)

tags = Table(
    "tags",
    metadata,
    Column("id", Text, nullable=False),
    Column("tag", Text, nullable=False),
    Column("added_by", Text, nullable=False),
    Column("added_at", _TS, nullable=False),
    PrimaryKeyConstraint("id", "tag"),
)

comments = Table(
    "comments",
    metadata,
    Column("id", Text, nullable=False),
    Column("author", Text, nullable=False),
    Column("created_at", _TS, nullable=False),
    Column("text", Text, nullable=False),
    Column("version", BigInteger, nullable=False),
    Index("ix_comments_id", "id", "version"),
)


def _run_values(run: Run) -> dict[str, Any]:
    return {
        "run_id": run.run_id,
        "owner": run.owner,
        "status": run.status.value,
        "action": run.action.model_dump(mode="json"),
        "params": run.params,
        "details": run.details,
        "columns": None,
        "row_count": run.row_count,
        "error": run.error,
        "started_at": run.started_at,
        "heartbeat_at": run.started_at,
        "finished_at": run.finished_at,
        "expires_at": run.expires_at,
    }


def _run_from_row(row: Any) -> Run:
    m = row._mapping
    return Run(
        run_id=m["run_id"],
        status=RunStatus(m["status"]),
        action=RunAction.model_validate(m["action"]),
        params=m["params"],
        owner=m["owner"],
        started_at=m["started_at"],
        finished_at=m["finished_at"],
        expires_at=m["expires_at"],
        details=m["details"],
        columns=(
            [RunColumn.model_validate(c) for c in m["columns"]]
            if m["columns"] is not None
            else None
        ),
        row_count=m["row_count"],
        error=m["error"],
    )


def _preset_field_values(fields: PresetFields) -> dict[str, Any]:
    return fields.model_dump(mode="json", by_alias=False, include=set(PresetFields.model_fields))


def _preset_from_row(row: Any) -> Preset:
    return Preset.model_validate(dict(row._mapping))


def _column_view_from_row(row: Any) -> ColumnView:
    m = row._mapping
    saved_from: dict[str, Any] = {"action": m["saved_from_action"]}
    if m["saved_from_preset_id"] is not None:
        saved_from["preset_id"] = m["saved_from_preset_id"]
    return ColumnView.model_validate(
        {
            "view_id": m["view_id"],
            "name": m["name"],
            "owner": m["owner"],
            "visibility": m["visibility"],
            "saved_from": saved_from,
            "state": m["state"],
            "created_at": m["created_at"],
            "updated_at": m["updated_at"],
            "owned": m["owned"],
            "hidden": m["hidden"],
        }
    )


class _Db:
    """Shared engine access; maps connectivity failures to ``StorageUnavailableError``."""

    def __init__(self, engine: AsyncEngine) -> None:
        self.engine = engine

    @asynccontextmanager
    async def begin(self) -> AsyncIterator[AsyncConnection]:
        try:
            async with self.engine.begin() as conn:
                yield conn
        except DBAPIError as exc:
            if exc.connection_invalidated or _is_connection_error(exc):
                raise StorageUnavailableError("database unavailable") from exc
            raise
        except OSError as exc:
            raise StorageUnavailableError("database unavailable") from exc


def _is_connection_error(exc: DBAPIError) -> bool:
    # SQLSTATE class 08 = connection exception, 57P0x = shutdown, 53300 = too many connections.
    code = getattr(exc.orig, "sqlstate", None) or ""
    return code.startswith(("08", "57P0", "53300"))


class PostgresRunStore(RunStore):
    def __init__(self, db: _Db) -> None:
        self._db = db

    async def create(self, run: Run) -> Run:
        try:
            async with self._db.begin() as conn:
                await conn.execute(insert(runs).values(**_run_values(run)))
        except IntegrityError:
            raise AlreadyExistsError(str(run.run_id)) from None
        return run.model_copy(deep=True)

    async def get(self, run_id: UUID, now: datetime) -> Run | None:
        stmt = select(runs).where(runs.c.run_id == run_id, runs.c.expires_at > now)
        async with self._db.begin() as conn:
            row = (await conn.execute(stmt)).first()
        return _run_from_row(row) if row else None

    async def add_rows(self, run_id: UUID, rows: Sequence[RunRow]) -> None:
        if not rows:
            return
        values = [{"run_id": run_id, "ordinal": r.row, "id": r.id, "data": r.data} for r in rows]
        try:
            async with self._db.begin() as conn:
                await conn.execute(insert(run_rows), values)
        except IntegrityError:
            raise NotFoundError(str(run_id)) from None

    async def rows(self, run_id: UUID, start: int, end: int) -> list[RunRow]:
        stmt = (
            select(run_rows.c.ordinal, run_rows.c.id, run_rows.c.data)
            .where(
                run_rows.c.run_id == run_id,
                run_rows.c.ordinal >= start,
                run_rows.c.ordinal < end,
            )
            .order_by(run_rows.c.ordinal)
        )
        async with self._db.begin() as conn:
            found = (await conn.execute(stmt)).all()
        return [RunRow(row=r.ordinal, id=r.id, data=r.data) for r in found]

    async def has_rows(self, run_id: UUID) -> bool:
        stmt = select(exists().where(run_rows.c.run_id == run_id))
        async with self._db.begin() as conn:
            return bool((await conn.execute(stmt)).scalar())

    async def finish(
        self,
        run_id: UUID,
        *,
        status: RunStatus,
        finished_at: datetime,
        expires_at: datetime,
        details: Mapping[str, Any],
        columns: Sequence[RunColumn] | None = None,
        row_count: int | None = None,
        error: str | None = None,
    ) -> Run:
        stmt = (
            update(runs)
            .where(runs.c.run_id == run_id, runs.c.status == RunStatus.RUNNING.value)
            .values(
                status=status.value,
                finished_at=finished_at,
                expires_at=expires_at,
                details=dict(details),
                columns=(
                    [c.model_dump(mode="json") for c in columns] if columns is not None else None
                ),
                row_count=row_count,
                error=error,
                cancel_requested=False,
            )
            .returning(*runs.c)
        )
        async with self._db.begin() as conn:
            row = (await conn.execute(stmt)).first()
            if row is None:  # missing, or already ended: unchanged
                row = (await conn.execute(select(runs).where(runs.c.run_id == run_id))).first()
                if row is None:
                    raise NotFoundError(str(run_id))
            elif status is not RunStatus.SUCCEEDED:
                await conn.execute(delete(run_rows).where(run_rows.c.run_id == run_id))
        return _run_from_row(row)

    async def request_cancel(self, run_id: UUID) -> None:
        stmt = (
            update(runs)
            .where(runs.c.run_id == run_id, runs.c.status == RunStatus.RUNNING.value)
            .values(cancel_requested=True)
        )
        async with self._db.begin() as conn:
            await conn.execute(stmt)

    async def heartbeat(self, run_ids: Collection[UUID], now: datetime) -> dict[UUID, bool]:
        if not run_ids:
            return {}
        stmt = (
            update(runs)
            .where(runs.c.run_id.in_(list(run_ids)), runs.c.status == RunStatus.RUNNING.value)
            .values(heartbeat_at=now)
            .returning(runs.c.run_id, runs.c.cancel_requested)
        )
        async with self._db.begin() as conn:
            return {r.run_id: r.cancel_requested for r in await conn.execute(stmt)}

    async def delete_expired(self, now: datetime, limit: int) -> int:
        # SKIP LOCKED: replicas sweeping at once take different runs.
        expired = (
            select(runs.c.run_id)
            .where(runs.c.expires_at <= now)
            .order_by(runs.c.expires_at)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
        async with self._db.begin() as conn:
            result = await conn.execute(
                delete(runs).where(runs.c.run_id.in_(expired.scalar_subquery()))
            )
        return int(result.rowcount)

    async def mark_stale_running_as_error(
        self, before: datetime, *, message: str, finished_at: datetime, expires_at: datetime
    ) -> int:
        # SKIP LOCKED: replicas sweeping at once take different runs, and a run whose heartbeat
        # or finish is being written is left for the next sweep.
        stale_runs = (
            select(runs.c.run_id)
            .where(runs.c.status == RunStatus.RUNNING.value, runs.c.heartbeat_at < before)
            .with_for_update(skip_locked=True)
        )
        stmt = (
            update(runs)
            .where(runs.c.run_id.in_(stale_runs.scalar_subquery()))
            .values(
                status=RunStatus.ERROR.value,
                error=message,
                finished_at=finished_at,
                expires_at=expires_at,
                cancel_requested=False,
            )
            .returning(runs.c.run_id)
        )
        async with self._db.begin() as conn:
            stale = list((await conn.execute(stmt)).scalars())
            if stale:
                await conn.execute(delete(run_rows).where(run_rows.c.run_id.in_(stale)))
        return len(stale)


class PostgresPresetStore(PresetStore):
    def __init__(self, db: _Db) -> None:
        self._db = db

    @staticmethod
    def _select(viewer: str) -> Any:
        hidden = (
            exists()
            .where(
                preset_hidden.c.preset_id == presets.c.preset_id,
                preset_hidden.c.analyst == viewer,
            )
            .label("hidden")
        )
        return select(presets, (presets.c.owner == viewer).label("owned"), hidden)

    async def list(self, viewer: str) -> list[Preset]:
        stmt = (
            self._select(viewer)
            .where((presets.c.owner == viewer) | (presets.c.visibility == "shared"))
            .order_by(presets.c.created_at, presets.c.preset_id)
        )
        async with self._db.begin() as conn:
            rows = (await conn.execute(stmt)).all()
        return [_preset_from_row(r) for r in rows]

    async def get(self, preset_id: UUID, viewer: str) -> Preset | None:
        stmt = self._select(viewer).where(presets.c.preset_id == preset_id)
        async with self._db.begin() as conn:
            row = (await conn.execute(stmt)).first()
        return _preset_from_row(row) if row else None

    async def create(self, preset: StoredPreset) -> None:
        values = {
            **_preset_field_values(preset),
            "preset_id": preset.preset_id,
            "owner": preset.owner,
            "created_at": preset.created_at,
            "updated_at": preset.updated_at,
        }
        try:
            async with self._db.begin() as conn:
                await conn.execute(insert(presets).values(**values))
        except IntegrityError:
            raise AlreadyExistsError(str(preset.preset_id)) from None

    async def replace(self, preset_id: UUID, fields: PresetFields, *, updated_at: datetime) -> None:
        stmt = (
            update(presets)
            .where(presets.c.preset_id == preset_id)
            .values(**_preset_field_values(fields), updated_at=updated_at)
            .returning(presets.c.preset_id)
        )
        async with self._db.begin() as conn:
            if (await conn.execute(stmt)).first() is None:
                raise NotFoundError(str(preset_id))

    async def delete(self, preset_id: UUID) -> None:
        stmt = (
            delete(presets).where(presets.c.preset_id == preset_id).returning(presets.c.preset_id)
        )
        async with self._db.begin() as conn:
            if (await conn.execute(stmt)).first() is None:
                raise NotFoundError(str(preset_id))

    async def set_hidden(self, preset_id: UUID, analyst: str, hidden: bool) -> None:
        async with self._db.begin() as conn:
            found = await conn.execute(
                select(presets.c.preset_id)
                .where(presets.c.preset_id == preset_id)
                .with_for_update()
            )
            if found.first() is None:
                raise NotFoundError(str(preset_id))
            if hidden:
                await conn.execute(
                    pg_insert(preset_hidden)
                    .values(preset_id=preset_id, analyst=analyst)
                    .on_conflict_do_nothing()
                )
            else:
                await conn.execute(
                    delete(preset_hidden).where(
                        preset_hidden.c.preset_id == preset_id, preset_hidden.c.analyst == analyst
                    )
                )


class PostgresColumnViewStore(ColumnViewStore):
    def __init__(self, db: _Db) -> None:
        self._db = db

    @staticmethod
    def _select(viewer: str) -> Any:
        hidden = (
            exists()
            .where(
                column_view_hidden.c.view_id == column_views.c.view_id,
                column_view_hidden.c.analyst == viewer,
            )
            .label("hidden")
        )
        return select(column_views, (column_views.c.owner == viewer).label("owned"), hidden)

    async def list(self, viewer: str) -> list[ColumnView]:
        stmt = (
            self._select(viewer)
            .where((column_views.c.owner == viewer) | (column_views.c.visibility == "shared"))
            .order_by(column_views.c.created_at, column_views.c.view_id)
        )
        async with self._db.begin() as conn:
            rows = (await conn.execute(stmt)).all()
        return [_column_view_from_row(r) for r in rows]

    async def get(self, view_id: UUID, viewer: str) -> ColumnView | None:
        stmt = self._select(viewer).where(column_views.c.view_id == view_id)
        async with self._db.begin() as conn:
            row = (await conn.execute(stmt)).first()
        return _column_view_from_row(row) if row else None

    async def create(self, view: StoredColumnView) -> None:
        values = {
            "view_id": view.view_id,
            "owner": view.owner,
            "name": view.name,
            "visibility": view.visibility,
            "saved_from_action": view.saved_from.action,
            "saved_from_preset_id": view.saved_from.preset_id,
            "state": view.state,
            "created_at": view.created_at,
            "updated_at": view.updated_at,
        }
        try:
            async with self._db.begin() as conn:
                await conn.execute(insert(column_views).values(**values))
        except IntegrityError:
            raise AlreadyExistsError(str(view.view_id)) from None

    async def replace(
        self, view_id: UUID, fields: ColumnViewFields, *, updated_at: datetime
    ) -> None:
        stmt = (
            update(column_views)
            .where(column_views.c.view_id == view_id)
            .values(
                name=fields.name,
                visibility=fields.visibility,
                state=fields.state,
                updated_at=updated_at,
            )
            .returning(column_views.c.view_id)
        )
        async with self._db.begin() as conn:
            if (await conn.execute(stmt)).first() is None:
                raise NotFoundError(str(view_id))

    async def delete(self, view_id: UUID) -> None:
        stmt = (
            delete(column_views)
            .where(column_views.c.view_id == view_id)
            .returning(column_views.c.view_id)
        )
        async with self._db.begin() as conn:
            if (await conn.execute(stmt)).first() is None:
                raise NotFoundError(str(view_id))

    async def set_hidden(self, view_id: UUID, analyst: str, hidden: bool) -> None:
        async with self._db.begin() as conn:
            found = await conn.execute(
                select(column_views.c.view_id)
                .where(column_views.c.view_id == view_id)
                .with_for_update()
            )
            if found.first() is None:
                raise NotFoundError(str(view_id))
            if hidden:
                await conn.execute(
                    pg_insert(column_view_hidden)
                    .values(view_id=view_id, analyst=analyst)
                    .on_conflict_do_nothing()
                )
            else:
                await conn.execute(
                    delete(column_view_hidden).where(
                        column_view_hidden.c.view_id == view_id,
                        column_view_hidden.c.analyst == analyst,
                    )
                )


class _NothingChanged(Exception):
    """Rolls back a change that changed nothing, so it takes no version."""


def _in_code_point_order(column: Any) -> Any:
    """``column`` collated by code point, as Python sorts strings, not by the database locale."""
    return column.collate("C")


def _ids_param(ids: Collection[str]) -> Any:
    return bindparam("ids", list(ids), type_=ARRAY(Text))


async def _annotations(conn: AsyncConnection, states: Sequence[Any]) -> list[Annotations]:
    """The annotations of the ``id_state`` rows ``states``, in their order."""
    ids = _ids_param([state.id for state in states])
    found_tags: dict[str, list[str]] = {}
    for row in await conn.execute(
        select(tags.c.id, tags.c.tag)
        .where(tags.c.id == any_(ids))
        .order_by(_in_code_point_order(tags.c.tag))
    ):
        found_tags.setdefault(row.id, []).append(row.tag)
    found_comments: dict[str, list[Comment]] = {}
    for row in await conn.execute(
        select(comments).where(comments.c.id == any_(ids)).order_by(comments.c.version)
    ):
        found_comments.setdefault(row.id, []).append(
            Comment(author=row.author, at=row.created_at, text=row.text)
        )
    return [
        Annotations(
            id=state.id,
            label=None
            if state.label is None
            else LabelState(key=state.label, by=state.labelled_by, at=state.labelled_at),
            tags=found_tags.get(state.id, []),
            comments=found_comments.get(state.id, []),
            version=state.version,
        )
        for state in states
    ]


class PostgresAnnotationStore(AnnotationStore):
    def __init__(self, db: _Db) -> None:
        self._db = db

    async def change(
        self, ids: Collection[str], edit: AnnotationEdit, *, by: str, at: datetime
    ) -> AnnotationsChanged:
        wanted = sorted(set(ids))
        try:
            async with self._db.begin() as conn:
                # First, so that writers queue on the clock's row lock.
                version = (
                    await conn.execute(
                        update(annotation_clock)
                        .values(version=annotation_clock.c.version + 1)
                        .returning(annotation_clock.c.version)
                    )
                ).scalar_one()
                labels = {
                    row.id: row.label
                    for row in await conn.execute(
                        select(id_state.c.id, id_state.c.label).where(
                            id_state.c.id == any_(_ids_param(wanted))
                        )
                    )
                }
                had_tags: dict[str, set[str]] = {}
                for row in await conn.execute(
                    select(tags.c.id, tags.c.tag).where(tags.c.id == any_(_ids_param(wanted)))
                ):
                    had_tags.setdefault(row.id, set()).add(row.tag)
                relabelled = [
                    id for id in wanted if edit.set_label and labels.get(id) != edit.label
                ]
                added: list[tuple[str, str]] = []
                removed: list[tuple[str, str]] = []
                for id in wanted:
                    before = had_tags.get(id, set())
                    after = edit.tags_after(before)
                    added += [(id, tag) for tag in sorted(after - before)]
                    removed += [(id, tag) for tag in sorted(before - after)]
                commented = wanted if edit.comment is not None else []
                changed = sorted(
                    {*relabelled, *commented, *(id for id, _ in added), *(id for id, _ in removed)}
                )
                if not changed:
                    raise _NothingChanged
                upsert = pg_insert(id_state)
                await conn.execute(
                    upsert.on_conflict_do_update(
                        index_elements=[id_state.c.id], set_={"version": upsert.excluded.version}
                    ),
                    [{"id": id, "version": version} for id in changed],
                )
                if relabelled:
                    labelled_by, labelled_at = (None, None) if edit.label is None else (by, at)
                    await conn.execute(
                        update(id_state)
                        .where(id_state.c.id == any_(_ids_param(relabelled)))
                        .values(label=edit.label, labelled_by=labelled_by, labelled_at=labelled_at)
                    )
                    await conn.execute(
                        insert(label_changes),
                        [
                            {
                                "id": id,
                                "label": edit.label,
                                "changed_by": by,
                                "changed_at": at,
                                "version": version,
                            }
                            for id in relabelled
                        ],
                    )
                if added:
                    await conn.execute(
                        insert(tags),
                        [
                            {"id": id, "tag": tag, "added_by": by, "added_at": at}
                            for id, tag in added
                        ],
                    )
                if removed:
                    await conn.execute(
                        delete(tags).where(
                            tags.c.id == bindparam("tag_id"), tags.c.tag == bindparam("tag_name")
                        ),
                        [{"tag_id": id, "tag_name": tag} for id, tag in removed],
                    )
                if commented:
                    await conn.execute(
                        insert(comments),
                        [
                            {
                                "id": id,
                                "author": by,
                                "created_at": at,
                                "text": edit.comment,
                                "version": version,
                            }
                            for id in commented
                        ],
                    )
                states = (
                    await conn.execute(
                        select(id_state)
                        .where(id_state.c.id == any_(_ids_param(changed)))
                        .order_by(id_state.c.id)
                    )
                ).all()
                return AnnotationsChanged(changes=await _annotations(conn, states), version=version)
        except _NothingChanged:
            async with self._db.begin() as conn:
                current = (await conn.execute(select(annotation_clock.c.version))).scalar_one()
            return AnnotationsChanged(changes=[], version=current)

    async def of_ids(self, ids: Collection[str]) -> AnnotationsOf:
        async with self._db.begin() as conn:
            # The version before the state, so the state is never older than it.
            version = (await conn.execute(select(annotation_clock.c.version))).scalar_one()
            states = (
                await conn.execute(select(id_state).where(id_state.c.id == any_(_ids_param(ids))))
            ).all()
            found = await _annotations(conn, states)
        return AnnotationsOf(annotations={a.id: a for a in found}, version=version)

    async def changes(self, since: int, limit: int) -> AnnotationChanges:
        after = id_state.c.version > since
        async with self._db.begin() as conn:
            last = (
                await conn.execute(
                    select(id_state.c.version)
                    .where(after)
                    .order_by(id_state.c.version)
                    .offset(limit - 1)
                    .limit(1)
                )
            ).scalar()
            page = select(id_state).where(after).order_by(id_state.c.version, id_state.c.id)
            if last is not None:
                page = page.where(id_state.c.version <= last)
            states = (await conn.execute(page)).all()
            has_more = last is not None and bool(
                (await conn.execute(select(exists().where(id_state.c.version > last)))).scalar()
            )
            found = await _annotations(conn, states)
        return AnnotationChanges(changes=found, has_more=has_more)

    async def history(self, id: str) -> list[HistoryEntry]:
        async with self._db.begin() as conn:
            labelled = await conn.execute(select(label_changes).where(label_changes.c.id == id))
            commented = await conn.execute(select(comments).where(comments.c.id == id))
            # Keyed newest first, the label change before the comment of the same version.
            found: list[tuple[tuple[int, int], HistoryEntry]] = []
            for row in labelled:
                entry: HistoryEntry = LabelEntry(
                    kind="label", label=row.label, by=row.changed_by, at=row.changed_at
                )
                found.append(((-row.version, 0), entry))
            for row in commented:
                entry = CommentEntry(
                    kind="comment", author=row.author, at=row.created_at, text=row.text
                )
                found.append(((-row.version, 1), entry))
        return [entry for _, entry in sorted(found, key=lambda f: f[0])]

    async def tag_suggestions(self, prefix: str, *, by: str, limit: int) -> TagSuggestions:
        matching = func.starts_with(func.lower(tags.c.tag), func.lower(prefix))
        mine = select(tags.c.tag).where(matching, tags.c.added_by == by).group_by(tags.c.tag)
        async with self._db.begin() as conn:
            recent = list(
                (
                    await conn.execute(
                        mine.order_by(
                            func.max(tags.c.added_at).desc(), _in_code_point_order(tags.c.tag)
                        ).limit(limit)
                    )
                ).scalars()
            )
            most_used = list(
                (
                    await conn.execute(
                        select(tags.c.tag)
                        .where(matching, tags.c.tag.not_in(mine))
                        .group_by(tags.c.tag)
                        .order_by(func.count().desc(), _in_code_point_order(tags.c.tag))
                        .limit(limit)
                    )
                ).scalars()
            )
        return TagSuggestions(recent=recent, most_used=most_used)


class PostgresStorage(Storage):
    def __init__(self, url: str, *, pool_size: int = 10) -> None:
        self._engine = create_async_engine(url, pool_size=pool_size, pool_pre_ping=True)
        db = _Db(self._engine)
        self.runs = PostgresRunStore(db)
        self.presets = PostgresPresetStore(db)
        self.column_views = PostgresColumnViewStore(db)
        self.annotations = PostgresAnnotationStore(db)

    async def health(self) -> bool:
        try:
            async with self._engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
        except Exception:
            return False
        return True

    async def aclose(self) -> None:
        await self._engine.dispose()
