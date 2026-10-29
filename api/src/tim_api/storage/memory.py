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
from tim_api.runs.models import Run, RunColumn, RunRow, RunStatus
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
)


class MemoryRunStore(RunStore):
    def __init__(self) -> None:
        self._runs: dict[UUID, Run] = {}
        self._rows: dict[UUID, dict[int, RunRow]] = {}
        self._cancel: set[UUID] = set()
        self._heartbeats: dict[UUID, datetime] = {}
        self._lock = asyncio.Lock()

    async def create(self, run: Run) -> Run:
        async with self._lock:
            if run.run_id in self._runs:
                raise AlreadyExistsError(str(run.run_id))
            self._runs[run.run_id] = run.model_copy(deep=True)
            self._rows[run.run_id] = {}
            self._heartbeats[run.run_id] = run.started_at
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

    async def heartbeat(self, run_ids: Collection[UUID], now: datetime) -> dict[UUID, bool]:
        async with self._lock:
            alive: dict[UUID, bool] = {}
            for run_id in run_ids:
                run = self._runs.get(run_id)
                if run is not None and run.status is RunStatus.RUNNING:
                    self._heartbeats[run_id] = now
                    alive[run_id] = run_id in self._cancel
            return alive

    async def delete_expired(self, now: datetime, limit: int) -> int:
        async with self._lock:
            expired = sorted(
                (r for r in self._runs.values() if r.expires_at <= now), key=lambda r: r.expires_at
            )[:limit]
            for run in expired:
                del self._runs[run.run_id], self._rows[run.run_id]
                del self._heartbeats[run.run_id]
                self._cancel.discard(run.run_id)
            return len(expired)

    async def mark_stale_running_as_error(
        self, before: datetime, *, message: str, finished_at: datetime, expires_at: datetime
    ) -> int:
        async with self._lock:
            stale = [
                r
                for r in self._runs.values()
                if r.status is RunStatus.RUNNING and self._heartbeats[r.run_id] < before
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


class MemoryPresetStore(PresetStore):
    def __init__(self) -> None:
        self._items: dict[UUID, StoredPreset] = {}
        self._hidden: set[tuple[UUID, str]] = set()
        self._lock = asyncio.Lock()

    def _view(self, preset: StoredPreset, viewer: str) -> Preset:
        return Preset.model_validate(
            {
                **preset.model_dump(by_alias=False),
                "owned": preset.owner == viewer,
                "hidden": (preset.preset_id, viewer) in self._hidden,
            }
        )

    async def list(self, viewer: str) -> list[Preset]:
        async with self._lock:
            items = [
                p for p in self._items.values() if p.owner == viewer or p.visibility == "shared"
            ]
            items.sort(key=lambda p: (p.created_at, p.preset_id))
            return [self._view(p, viewer) for p in items]

    async def get(self, preset_id: UUID, viewer: str) -> Preset | None:
        async with self._lock:
            found = self._items.get(preset_id)
            return self._view(found, viewer) if found else None

    async def create(self, preset: StoredPreset) -> None:
        async with self._lock:
            if preset.preset_id in self._items:
                raise AlreadyExistsError(str(preset.preset_id))
            self._items[preset.preset_id] = preset.model_copy(deep=True)

    async def replace(self, preset_id: UUID, fields: PresetFields, *, updated_at: datetime) -> None:
        async with self._lock:
            current = self._items.get(preset_id)
            if current is None:
                raise NotFoundError(str(preset_id))
            self._items[preset_id] = StoredPreset.model_validate(
                {
                    **fields.model_dump(by_alias=False),
                    "preset_id": preset_id,
                    "owner": current.owner,
                    "created_at": current.created_at,
                    "updated_at": updated_at,
                }
            )

    async def delete(self, preset_id: UUID) -> None:
        async with self._lock:
            if self._items.pop(preset_id, None) is None:
                raise NotFoundError(str(preset_id))
            self._hidden = {h for h in self._hidden if h[0] != preset_id}

    async def set_hidden(self, preset_id: UUID, analyst: str, hidden: bool) -> None:
        async with self._lock:
            if preset_id not in self._items:
                raise NotFoundError(str(preset_id))
            if hidden:
                self._hidden.add((preset_id, analyst))
            else:
                self._hidden.discard((preset_id, analyst))


class MemoryColumnViewStore(ColumnViewStore):
    def __init__(self) -> None:
        self._items: dict[UUID, StoredColumnView] = {}
        self._hidden: set[tuple[UUID, str]] = set()
        self._lock = asyncio.Lock()

    def _view(self, view: StoredColumnView, viewer: str) -> ColumnView:
        return ColumnView.model_validate(
            {
                **view.model_dump(by_alias=False),
                "owned": view.owner == viewer,
                "hidden": (view.view_id, viewer) in self._hidden,
            }
        )

    async def list(self, viewer: str) -> list[ColumnView]:
        async with self._lock:
            items = [
                v for v in self._items.values() if v.owner == viewer or v.visibility == "shared"
            ]
            items.sort(key=lambda v: (v.created_at, v.view_id))
            return [self._view(v, viewer) for v in items]

    async def get(self, view_id: UUID, viewer: str) -> ColumnView | None:
        async with self._lock:
            found = self._items.get(view_id)
            return self._view(found, viewer) if found else None

    async def create(self, view: StoredColumnView) -> None:
        async with self._lock:
            if view.view_id in self._items:
                raise AlreadyExistsError(str(view.view_id))
            self._items[view.view_id] = view.model_copy(deep=True)

    async def replace(
        self, view_id: UUID, fields: ColumnViewFields, *, updated_at: datetime
    ) -> None:
        async with self._lock:
            current = self._items.get(view_id)
            if current is None:
                raise NotFoundError(str(view_id))
            self._items[view_id] = current.model_copy(
                update={
                    **fields.model_copy(deep=True).model_dump(
                        by_alias=False, include=set(ColumnViewFields.model_fields)
                    ),
                    "updated_at": updated_at,
                }
            )

    async def delete(self, view_id: UUID) -> None:
        async with self._lock:
            if self._items.pop(view_id, None) is None:
                raise NotFoundError(str(view_id))
            self._hidden = {h for h in self._hidden if h[0] != view_id}

    async def set_hidden(self, view_id: UUID, analyst: str, hidden: bool) -> None:
        async with self._lock:
            if view_id not in self._items:
                raise NotFoundError(str(view_id))
            if hidden:
                self._hidden.add((view_id, analyst))
            else:
                self._hidden.discard((view_id, analyst))


class MemoryAnnotationStore(AnnotationStore):
    def __init__(self) -> None:
        self._state: dict[str, Annotations] = {}
        # Who added each id's tags, and when: (id, tag) -> (by, at).
        self._tags_added: dict[tuple[str, str], tuple[str, datetime]] = {}
        # Each id's label changes and each author's comment, oldest first.
        self._history: dict[str, list[HistoryEntry]] = {}
        self._version = 0
        self._lock = asyncio.Lock()

    def _edited(
        self, id: str, edit: AnnotationEdit, *, by: str, at: datetime, version: int
    ) -> Annotations | None:
        """The id's annotations after ``edit``, or ``None`` when it changes nothing."""
        current = self._state.get(id) or Annotations(id=id, label=None, version=version)
        update: dict[str, Any] = {}
        before = current.label.key if current.label else None
        if edit.set_label and edit.label != before:
            update["label"] = (
                None if edit.label is None else LabelState(key=edit.label, by=by, at=at)
            )
        tags = edit.tags_after(current.tags)
        if tags != set(current.tags):
            update["tags"] = sorted(tags)
        if edit.set_comment:
            own = next((c.text for c in current.comments if c.author == by), None)
            if edit.comment != own:
                others = [c for c in current.comments if c.author != by]
                update["comments"] = (
                    others
                    if edit.comment is None
                    else [*others, Comment(author=by, at=at, text=edit.comment)]
                )
        if not update:
            return None
        return current.model_copy(update={**update, "version": version})

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
                before = self._state.get(annotations.id)
                for tag in set(before.tags if before else []) - set(annotations.tags):
                    del self._tags_added[annotations.id, tag]
                for tag in annotations.tags:
                    self._tags_added.setdefault((annotations.id, tag), (by, at))
                # The comment first, so that newest first the label change comes first.
                history = self._history.setdefault(annotations.id, [])
                if annotations.comments != (before.comments if before else []):
                    history[:] = [
                        e for e in history if not (e.kind == "comment" and e.author == by)
                    ]
                    if edit.comment is not None:
                        history.append(
                            CommentEntry(kind="comment", author=by, at=at, text=edit.comment)
                        )
                if annotations.label != (before.label if before else None):
                    history.append(LabelEntry(kind="label", label=edit.label, by=by, at=at))
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

    async def history(self, id: str) -> list[HistoryEntry]:
        async with self._lock:
            return copy.deepcopy(self._history.get(id, [])[::-1])

    async def tag_suggestions(self, prefix: str, *, by: str, limit: int) -> TagSuggestions:
        async with self._lock:
            matching = {
                key: added
                for key, added in self._tags_added.items()
                if key[1].lower().startswith(prefix.lower())
            }
        newest: dict[str, datetime] = {}
        uses: dict[str, int] = {}
        for (_, tag), (added_by, added_at) in matching.items():
            uses[tag] = uses.get(tag, 0) + 1
            if added_by == by:
                newest[tag] = max(added_at, newest.get(tag, added_at))
        recent = sorted(newest, key=lambda tag: (-newest[tag].timestamp(), tag))[:limit]
        others = sorted((tag for tag in uses if tag not in newest), key=lambda t: (-uses[t], t))
        return TagSuggestions(recent=recent, most_used=others[:limit])


class MemoryStorage(Storage):
    def __init__(self) -> None:
        self.runs = MemoryRunStore()
        self.presets = MemoryPresetStore()
        self.column_views = MemoryColumnViewStore()
        self.annotations = MemoryAnnotationStore()

    async def health(self) -> bool:
        return True

    async def aclose(self) -> None:
        return None
