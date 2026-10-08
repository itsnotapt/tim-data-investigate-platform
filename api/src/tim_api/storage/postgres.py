"""PostgreSQL storage (ADR-0004): SQLAlchemy 2.0 async + asyncpg.

Each method is one statement (or one short transaction), so it is safe to call concurrently.
Timestamps and identities are supplied by callers; the database never reads the clock.
Schema changes go through Alembic (``migrations/``); the app does not create tables itself.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Index,
    MetaData,
    String,
    Table,
    Text,
    Uuid,
    delete,
    insert,
    select,
    text,
    update,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, create_async_engine

from tim_api.query_runs.models import (
    KustoQueryEcho,
    KustoQueryRun,
    KustoQueryStats,
    QueryRunStatus,
)
from tim_api.storage.base import (
    AlreadyExistsError,
    NotFoundError,
    QueryRunStore,
    Storage,
    StorageUnavailableError,
    TemplateStore,
)
from tim_api.templates.models import QueryTemplate, QueryTemplateFields

metadata = MetaData()

# none_as_null: Python ``None`` is stored as SQL NULL, never as the JSON literal ``null``.
_JSON = JSONB(none_as_null=True)
_TS = DateTime(timezone=True)

query_templates = Table(
    "query_templates",
    metadata,
    Column("uuid", Uuid, primary_key=True),
    Column("name", Text, nullable=False),
    Column("is_managed", Boolean, nullable=False),
    Column("query_type", String(16), nullable=False),
    Column("menu", Text, nullable=False),
    Column("summary", Text, nullable=False),
    Column("path", _JSON, nullable=False),
    Column("cluster", Text, nullable=False),
    Column("database", Text, nullable=False),
    Column("column_id", Text),
    Column("params", _JSON),
    Column("fields", _JSON),
    Column("columns", _JSON),
    Column("query", Text, nullable=False),
    Column("is_deleted", Boolean, nullable=False, server_default=text("false")),
    Column("updated", _TS, nullable=False),
    Column("created_by", Text, nullable=False),
    Column("updated_by", Text, nullable=False),
    # list(since=...) filters on ``updated`` and orders by (updated, uuid).
    Index("ix_query_templates_updated_uuid", "updated", "uuid"),
)

query_runs = Table(
    "query_runs",
    metadata,
    Column("query_run_id", Uuid, primary_key=True),
    Column("requested_by", Text, nullable=False),
    Column("status", String(16), nullable=False),
    Column("execute_date_time_utc", _TS, nullable=False),
    Column("expires_at", _TS, nullable=False),
    Column("kusto_query", _JSON, nullable=False),
    Column("execution_metrics", _JSON),
    Column("result_data", _JSON),
    Column("main_error", Text),
    Index("ix_query_runs_requested_by", "requested_by"),
    Index("ix_query_runs_expires_at", "expires_at"),
    # Startup sweep only ever looks at runs still in ``created``.
    Index(
        "ix_query_runs_created_executed",
        "execute_date_time_utc",
        postgresql_where=text("status = 'created'"),
    ),
)

_TEMPLATE_JSON_COLUMNS = ("path", "params", "fields", "columns")
_TEMPLATE_EDITABLE = (
    "name",
    "is_managed",
    "query_type",
    "menu",
    "summary",
    "path",
    "cluster",
    "database",
    "column_id",
    "params",
    "fields",
    "columns",
    "query",
)


def _editable_values(f: QueryTemplateFields) -> dict[str, Any]:
    """Client-editable columns. JSON columns use the wire form (aliases, e.g. ``from``)."""
    values = f.model_dump(mode="json", by_alias=False, include=set(_TEMPLATE_EDITABLE))
    for col in ("params", "fields"):
        items = getattr(f, col)
        values[col] = (
            None if items is None else {k: v.model_dump(mode="json") for k, v in items.items()}
        )
    return values


def _template_values(t: QueryTemplate) -> dict[str, Any]:
    return {
        **_editable_values(t),
        "uuid": t.uuid,
        "is_deleted": t.is_deleted,
        "updated": t.updated,
        "created_by": t.created_by,
        "updated_by": t.updated_by,
    }


def _template_from_row(row: Any) -> QueryTemplate:
    return QueryTemplate.model_validate(dict(row._mapping))


def _run_values(run: KustoQueryRun) -> dict[str, Any]:
    return {
        "query_run_id": run.query_run_id,
        "requested_by": run.kusto_query.requested_by,
        "status": run.status.value,
        "execute_date_time_utc": run.execute_date_time_utc,
        "expires_at": run.expires_at,
        "kusto_query": run.kusto_query.model_dump(mode="json"),
        "execution_metrics": (
            run.execution_metrics.model_dump(mode="json") if run.execution_metrics else None
        ),
        "result_data": run.result_data,
        "main_error": run.main_error,
    }


def _run_from_row(row: Any) -> KustoQueryRun:
    m = row._mapping
    return KustoQueryRun(
        query_run_id=m["query_run_id"],
        status=QueryRunStatus(m["status"]),
        kusto_query=KustoQueryEcho.model_validate(m["kusto_query"]),
        execute_date_time_utc=m["execute_date_time_utc"],
        expires_at=m["expires_at"],
        result_data=m["result_data"],
        execution_metrics=(
            KustoQueryStats.model_validate(m["execution_metrics"])
            if m["execution_metrics"] is not None
            else None
        ),
        main_error=m["main_error"],
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


class PostgresTemplateStore(TemplateStore):
    def __init__(self, db: _Db) -> None:
        self._db = db

    async def list(self, *, since: datetime | None, include_deleted: bool) -> list[QueryTemplate]:
        stmt = select(query_templates).order_by(query_templates.c.updated, query_templates.c.uuid)
        if since is not None:
            stmt = stmt.where(query_templates.c.updated > since)
        if not include_deleted:
            stmt = stmt.where(query_templates.c.is_deleted.is_(False))
        async with self._db.begin() as conn:
            rows = (await conn.execute(stmt)).all()
        return [_template_from_row(r) for r in rows]

    async def get(self, uuid: UUID) -> QueryTemplate | None:
        async with self._db.begin() as conn:
            row = (
                await conn.execute(select(query_templates).where(query_templates.c.uuid == uuid))
            ).first()
        return _template_from_row(row) if row else None

    async def create(self, template: QueryTemplate) -> QueryTemplate:
        try:
            async with self._db.begin() as conn:
                await conn.execute(insert(query_templates).values(**_template_values(template)))
        except IntegrityError:
            raise AlreadyExistsError(str(template.uuid)) from None
        return template.model_copy(deep=True)

    async def replace(
        self, uuid: UUID, fields: QueryTemplateFields, *, updated_by: str, updated: datetime
    ) -> QueryTemplate:
        # Protected columns (uuid, created_by, is_deleted) are never written by replace.
        set_values = {**_editable_values(fields), "updated_by": updated_by, "updated": updated}
        return await self._update_returning(uuid, set_values)

    async def save(self, template: QueryTemplate) -> QueryTemplate:
        values = _template_values(template)
        del values["uuid"], values["created_by"]  # created_by is preserved from storage
        return await self._update_returning(template.uuid, values)

    async def soft_delete(self, uuid: UUID, *, updated_by: str, updated: datetime) -> QueryTemplate:
        stmt = (
            update(query_templates)
            .where(query_templates.c.uuid == uuid, query_templates.c.is_deleted.is_(False))
            .values(is_deleted=True, updated_by=updated_by, updated=updated)
            .returning(*query_templates.c)
        )
        async with self._db.begin() as conn:
            row = (await conn.execute(stmt)).first()
            if row is None:  # missing, or already deleted (idempotent: no write)
                row = (
                    await conn.execute(
                        select(query_templates).where(query_templates.c.uuid == uuid)
                    )
                ).first()
        if row is None:
            raise NotFoundError(str(uuid))
        return _template_from_row(row)

    async def _update_returning(self, uuid: UUID, values: dict[str, Any]) -> QueryTemplate:
        stmt = (
            update(query_templates)
            .where(query_templates.c.uuid == uuid)
            .values(**values)
            .returning(*query_templates.c)
        )
        async with self._db.begin() as conn:
            row = (await conn.execute(stmt)).first()
        if row is None:
            raise NotFoundError(str(uuid))
        return _template_from_row(row)


class PostgresQueryRunStore(QueryRunStore):
    def __init__(self, db: _Db) -> None:
        self._db = db

    async def create(self, run: KustoQueryRun) -> KustoQueryRun:
        try:
            async with self._db.begin() as conn:
                await conn.execute(insert(query_runs).values(**_run_values(run)))
        except IntegrityError:
            raise AlreadyExistsError(str(run.query_run_id)) from None
        return run.model_copy(deep=True)

    async def get_for_owner(self, run_id: UUID, owner: str, now: datetime) -> KustoQueryRun | None:
        stmt = select(query_runs).where(
            query_runs.c.query_run_id == run_id,
            query_runs.c.requested_by == owner,
            query_runs.c.expires_at > now,
        )
        async with self._db.begin() as conn:
            row = (await conn.execute(stmt)).first()
        return _run_from_row(row) if row else None

    async def update_result(
        self,
        run_id: UUID,
        *,
        status: QueryRunStatus,
        expires_at: datetime,
        result_data: list[dict[str, Any]] | None = None,
        execution_metrics: KustoQueryStats | None = None,
        main_error: str | None = None,
    ) -> KustoQueryRun:
        stmt = (
            update(query_runs)
            .where(query_runs.c.query_run_id == run_id)
            .values(
                status=status.value,
                expires_at=expires_at,
                result_data=result_data,
                execution_metrics=(
                    execution_metrics.model_dump(mode="json") if execution_metrics else None
                ),
                main_error=main_error,
            )
            .returning(*query_runs.c)
        )
        async with self._db.begin() as conn:
            row = (await conn.execute(stmt)).first()
        if row is None:
            raise NotFoundError(str(run_id))
        return _run_from_row(row)

    async def delete_expired(self, now: datetime) -> int:
        async with self._db.begin() as conn:
            result = await conn.execute(delete(query_runs).where(query_runs.c.expires_at <= now))
        return int(result.rowcount)

    async def mark_stale_created_as_error(
        self, before: datetime, *, message: str, expires_at: datetime
    ) -> int:
        stmt = (
            update(query_runs)
            .where(
                query_runs.c.status == QueryRunStatus.CREATED.value,
                query_runs.c.execute_date_time_utc < before,
            )
            .values(status=QueryRunStatus.ERROR.value, main_error=message, expires_at=expires_at)
        )
        async with self._db.begin() as conn:
            result = await conn.execute(stmt)
        return int(result.rowcount)


class PostgresStorage(Storage):
    def __init__(self, url: str, *, pool_size: int = 10) -> None:
        self._engine = create_async_engine(url, pool_size=pool_size, pool_pre_ping=True)
        db = _Db(self._engine)
        self.templates = PostgresTemplateStore(db)
        self.runs = PostgresQueryRunStore(db)

    async def health(self) -> bool:
        try:
            async with self._engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
        except Exception:
            return False
        return True

    async def aclose(self) -> None:
        await self._engine.dispose()
