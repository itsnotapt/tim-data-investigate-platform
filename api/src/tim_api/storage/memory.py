"""In-memory storage for unit tests and local development. State is lost on restart.

Records are deep-copied on the way in and out so callers can never mutate stored state.
"""

from __future__ import annotations

import asyncio
import copy
from collections.abc import Collection, Mapping, Sequence
from datetime import datetime
from typing import Any
from uuid import UUID

from tim_api.annotations.models import Annotations, LabelState
from tim_api.query_runs.models import KustoQueryRun, KustoQueryStats, QueryRunStatus
from tim_api.runs.models import Run, RunColumn, RunRow, RunStatus
from tim_api.storage.base import (
    AlreadyExistsError,
    AnnotationChanges,
    AnnotationEdit,
    AnnotationsChanged,
    AnnotationsOf,
    AnnotationStore,
    NotFoundError,
    QueryRunStore,
    RunStore,
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


class MemoryRunStore(RunStore):
    def __init__(self) -> None:
        self._runs: dict[UUID, Run] = {}
        self._rows: dict[UUID, dict[int, RunRow]] = {}
        self._cancel: set[UUID] = set()
        self._lock = asyncio.Lock()

    async def create(self, run: Run) -> Run:
        async with self._lock:
            if run.run_id in self._runs:
                raise AlreadyExistsError(str(run.run_id))
            self._runs[run.run_id] = run.model_copy(deep=True)
            self._rows[run.run_id] = {}
            return run.model_copy(deep=True)

    async def get(self, run_id: UUID, now: datetime) -> Run | None:
        async with self._lock:
            run = self._runs.get(run_id)
            if run is None or run.expires_at <= now:
                return None
            return run.model_copy(deep=True)

    async def add_rows(self, run_id: UUID, rows: Sequence[RunRow]) -> None:
        async with self._lock:
            stored = self._rows.get(run_id)
            if stored is None:
                raise NotFoundError(str(run_id))
            for row in rows:
                stored[row.row] = row.model_copy(deep=True)

    async def rows(self, run_id: UUID, start: int, end: int) -> list[RunRow]:
        async with self._lock:
            stored = self._rows.get(run_id, {})
            return [stored[n].model_copy(deep=True) for n in sorted(stored) if start <= n < end]

    async def has_rows(self, run_id: UUID) -> bool:
        async with self._lock:
            return bool(self._rows.get(run_id))

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
        async with self._lock:
            run = self._runs.get(run_id)
            if run is None:
                raise NotFoundError(str(run_id))
            if run.status is RunStatus.RUNNING:
                run = run.model_copy(
                    update={
                        "status": status,
                        "finished_at": finished_at,
                        "expires_at": expires_at,
                        "details": copy.deepcopy(dict(details)),
                        "columns": [c.model_copy() for c in columns]
                        if columns is not None
                        else None,
                        "row_count": row_count,
                        "error": error,
                    }
                )
                self._runs[run_id] = run
                self._cancel.discard(run_id)
                if status is not RunStatus.SUCCEEDED:
                    self._rows[run_id] = {}
            return run.model_copy(deep=True)

    async def request_cancel(self, run_id: UUID) -> None:
        async with self._lock:
            run = self._runs.get(run_id)
            if run is not None and run.status is RunStatus.RUNNING:
                self._cancel.add(run_id)

    async def cancel_requested(self, run_ids: Collection[UUID]) -> set[UUID]:
        async with self._lock:
            return {run_id for run_id in run_ids if run_id in self._cancel}

    async def delete_expired(self, now: datetime, limit: int) -> int:
        async with self._lock:
            expired = sorted(
                (r for r in self._runs.values() if r.expires_at <= now), key=lambda r: r.expires_at
            )[:limit]
            for run in expired:
                del self._runs[run.run_id], self._rows[run.run_id]
                self._cancel.discard(run.run_id)
            return len(expired)

    async def mark_stale_running_as_error(
        self, before: datetime, *, message: str, finished_at: datetime, expires_at: datetime
    ) -> int:
        async with self._lock:
            stale = [
                r
                for r in self._runs.values()
                if r.status is RunStatus.RUNNING and r.started_at < before
            ]
            for run in stale:
                self._runs[run.run_id] = run.model_copy(
                    update={
                        "status": RunStatus.ERROR,
                        "error": message,
                        "finished_at": finished_at,
                        "expires_at": expires_at,
                    }
                )
                self._rows[run.run_id] = {}
                self._cancel.discard(run.run_id)
            return len(stale)


class MemoryAnnotationStore(AnnotationStore):
    def __init__(self) -> None:
        self._state: dict[str, Annotations] = {}
        self._version = 0
        self._lock = asyncio.Lock()

    def _edited(
        self, id: str, edit: AnnotationEdit, *, by: str, at: datetime, version: int
    ) -> Annotations | None:
        """The id's annotations after ``edit``, or ``None`` when it changes nothing."""
        current = self._state.get(id)
        before = current.label.key if current and current.label else None
        if not edit.set_label or edit.label == before:
            return None
        label = None if edit.label is None else LabelState(key=edit.label, by=by, at=at)
        if current is None:
            return Annotations(id=id, label=label, version=version)
        return current.model_copy(update={"label": label, "version": version})

    async def change(
        self, ids: Collection[str], edit: AnnotationEdit, *, by: str, at: datetime
    ) -> AnnotationsChanged:
        async with self._lock:
            version = self._version + 1
            changed = [
                annotations
                for id in sorted(set(ids))
                if (annotations := self._edited(id, edit, by=by, at=at, version=version))
            ]
            if not changed:
                return AnnotationsChanged(changes=[], version=self._version)
            self._version = version
            for annotations in changed:
                self._state[annotations.id] = annotations
            return AnnotationsChanged(changes=copy.deepcopy(changed), version=version)

    async def of_ids(self, ids: Collection[str]) -> AnnotationsOf:
        async with self._lock:
            found = {id: self._state[id] for id in ids if id in self._state}
            return AnnotationsOf(annotations=copy.deepcopy(found), version=self._version)

    async def changes(self, since: int, limit: int) -> AnnotationChanges:
        async with self._lock:
            after = sorted(
                (a for a in self._state.values() if a.version > since),
                key=lambda a: (a.version, a.id),
            )
            if len(after) > limit:
                last = after[limit - 1].version
                page = [a for a in after if a.version <= last]
            else:
                page = after
            return AnnotationChanges(changes=copy.deepcopy(page), has_more=len(page) < len(after))


class MemoryStorage(Storage):
    def __init__(self) -> None:
        self.templates = MemoryTemplateStore()
        self.query_runs = MemoryQueryRunStore()
        self.runs = MemoryRunStore()
        self.annotations = MemoryAnnotationStore()

    async def health(self) -> bool:
        return True

    async def aclose(self) -> None:
        return None
