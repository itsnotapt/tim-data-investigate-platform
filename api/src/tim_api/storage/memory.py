"""In-memory storage for unit tests and local development. State is lost on restart.

Records are deep-copied on the way in and out so callers can never mutate stored state.
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any
from uuid import UUID

from tim_api.query_runs.models import KustoQueryRun, KustoQueryStats, QueryRunStatus
from tim_api.storage.base import (
    AlreadyExistsError,
    NotFoundError,
    QueryRunStore,
    Storage,
    TemplateStore,
)
from tim_api.templates.models import QueryTemplate, QueryTemplateFields


class MemoryTemplateStore(TemplateStore):
    def __init__(self) -> None:
        self._items: dict[UUID, QueryTemplate] = {}
        self._lock = asyncio.Lock()

    async def list(self, *, since: datetime | None, include_deleted: bool) -> list[QueryTemplate]:
        async with self._lock:
            items = [
                t
                for t in self._items.values()
                if (include_deleted or not t.is_deleted) and (since is None or t.updated > since)
            ]
            items.sort(key=lambda t: (t.updated, t.uuid))
            return [t.model_copy(deep=True) for t in items]

    async def get(self, uuid: UUID) -> QueryTemplate | None:
        async with self._lock:
            found = self._items.get(uuid)
            return found.model_copy(deep=True) if found else None

    async def create(self, template: QueryTemplate) -> QueryTemplate:
        async with self._lock:
            if template.uuid in self._items:
                raise AlreadyExistsError(str(template.uuid))
            self._items[template.uuid] = template.model_copy(deep=True)
            return template.model_copy(deep=True)

    async def replace(
        self, uuid: UUID, fields: QueryTemplateFields, *, updated_by: str, updated: datetime
    ) -> QueryTemplate:
        async with self._lock:
            current = self._items.get(uuid)
            if current is None:
                raise NotFoundError(str(uuid))
            new = QueryTemplate.model_validate(
                {
                    **fields.model_dump(by_alias=False),
                    "uuid": uuid,
                    "is_deleted": current.is_deleted,
                    "created_by": current.created_by,
                    "updated_by": updated_by,
                    "updated": updated,
                }
            )
            self._items[uuid] = new
            return new.model_copy(deep=True)

    async def save(self, template: QueryTemplate) -> QueryTemplate:
        async with self._lock:
            current = self._items.get(template.uuid)
            if current is None:
                raise NotFoundError(str(template.uuid))
            new = template.model_copy(deep=True, update={"created_by": current.created_by})
            self._items[template.uuid] = new
            return new.model_copy(deep=True)

    async def soft_delete(self, uuid: UUID, *, updated_by: str, updated: datetime) -> QueryTemplate:
        async with self._lock:
            current = self._items.get(uuid)
            if current is None:
                raise NotFoundError(str(uuid))
            if not current.is_deleted:
                current = current.model_copy(
                    update={"is_deleted": True, "updated_by": updated_by, "updated": updated}
                )
                self._items[uuid] = current
            return current.model_copy(deep=True)


class MemoryQueryRunStore(QueryRunStore):
    def __init__(self) -> None:
        self._items: dict[UUID, KustoQueryRun] = {}
        self._lock = asyncio.Lock()

    async def create(self, run: KustoQueryRun) -> KustoQueryRun:
        async with self._lock:
            if run.query_run_id in self._items:
                raise AlreadyExistsError(str(run.query_run_id))
            self._items[run.query_run_id] = run.model_copy(deep=True)
            return run.model_copy(deep=True)

    async def get_for_owner(self, run_id: UUID, owner: str, now: datetime) -> KustoQueryRun | None:
        async with self._lock:
            run = self._items.get(run_id)
            if run is None or run.kusto_query.requested_by != owner or run.expires_at <= now:
                return None
            return run.model_copy(deep=True)

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
        async with self._lock:
            run = self._items.get(run_id)
            if run is None:
                raise NotFoundError(str(run_id))
            new = run.model_copy(
                deep=True,
                update={
                    "status": status,
                    "expires_at": expires_at,
                    "result_data": result_data,
                    "execution_metrics": execution_metrics,
                    "main_error": main_error,
                },
            )
            new = new.model_copy(deep=True)  # detach from the caller's argument objects
            self._items[run_id] = new
            return new.model_copy(deep=True)

    async def delete_expired(self, now: datetime) -> int:
        async with self._lock:
            expired = [k for k, r in self._items.items() if r.expires_at <= now]
            for key in expired:
                del self._items[key]
            return len(expired)

    async def mark_stale_created_as_error(
        self, before: datetime, *, message: str, expires_at: datetime
    ) -> int:
        async with self._lock:
            count = 0
            for key, run in self._items.items():
                if run.status == QueryRunStatus.CREATED and run.execute_date_time_utc < before:
                    self._items[key] = run.model_copy(
                        update={
                            "status": QueryRunStatus.ERROR,
                            "main_error": message,
                            "expires_at": expires_at,
                        }
                    )
                    count += 1
            return count


class MemoryStorage(Storage):
    def __init__(self) -> None:
        self.templates = MemoryTemplateStore()
        self.runs = MemoryQueryRunStore()

    async def health(self) -> bool:
        return True

    async def aclose(self) -> None:
        return None
