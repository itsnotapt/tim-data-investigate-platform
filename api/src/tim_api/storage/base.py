"""Storage interfaces (ADR-0004). Implementations: ``memory.py`` and ``postgres.py``.

The stores are deliberately thin persistence ports. Business rules (validation, JSON Patch,
owner identity, retention length) live in the endpoints/services. Timestamps and identities are
passed in by the caller, so an implementation never reads the clock except where stated, and
both implementations behave identically. Every method must be safe to call concurrently.

Postgres mapping: each method is one statement or one short transaction;
``create`` maps unique violation to ``AlreadyExistsError``; ``replace``/``soft_delete``/
``update_result`` map ``UPDATE ... RETURNING`` with zero rows to ``NotFoundError``.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from tim_api.annotations.models import Annotations, HistoryEntry, TagSuggestions
from tim_api.presets.models import Preset, PresetFields, StoredPreset
from tim_api.query_runs.models import KustoQueryRun, KustoQueryStats, QueryRunStatus
from tim_api.runs.models import Run, RunColumn, RunRow, RunStatus
from tim_api.templates.models import QueryTemplate, QueryTemplateFields


class StorageError(Exception):
    """Base class for storage failures."""


class NotFoundError(StorageError):
    """The addressed record does not exist."""


class AlreadyExistsError(StorageError):
    """A record with the same key already exists."""


class StorageUnavailableError(StorageError):
    """The backing store cannot be reached."""


class TemplateStore(ABC):
    @abstractmethod
    async def list(self, *, since: datetime | None, include_deleted: bool) -> list[QueryTemplate]:
        """Templates with ``updated > since`` (strict, when given), ordered by ``updated`` then
        ``uuid`` ascending. Soft-deleted templates are included only when ``include_deleted``."""

    @abstractmethod
    async def get(self, uuid: UUID) -> QueryTemplate | None:
        """The template (soft-deleted included), or ``None`` when unknown."""

    @abstractmethod
    async def create(self, template: QueryTemplate) -> QueryTemplate:
        """Insert. Raises ``AlreadyExistsError`` if the uuid exists (deleted or not)."""

    @abstractmethod
    async def replace(
        self, uuid: UUID, fields: QueryTemplateFields, *, updated_by: str, updated: datetime
    ) -> QueryTemplate:
        """Overwrite the client-editable fields. ``uuid``, ``created_by`` and ``is_deleted``
        are preserved. Raises ``NotFoundError`` when missing (never creates)."""

    @abstractmethod
    async def save(self, template: QueryTemplate) -> QueryTemplate:
        """Overwrite the whole record (used for the PATCH result, incl. restore).
        ``created_by`` is preserved from storage. Raises ``NotFoundError`` when missing."""

    @abstractmethod
    async def soft_delete(self, uuid: UUID, *, updated_by: str, updated: datetime) -> QueryTemplate:
        """Set ``is_deleted``, ``updated_by``, ``updated``. Idempotent: an already deleted
        template is returned unchanged without a write. Raises ``NotFoundError`` when missing."""


class QueryRunStore(ABC):
    @abstractmethod
    async def create(self, run: KustoQueryRun) -> KustoQueryRun:
        """Insert a run. The owner is ``run.kusto_query.requested_by``.
        Raises ``AlreadyExistsError`` on a duplicate ``query_run_id``."""

    @abstractmethod
    async def get_for_owner(self, run_id: UUID, owner: str, now: datetime) -> KustoQueryRun | None:
        """The run, or ``None`` when unknown, owned by someone else, or expired
        (``expires_at <= now``; expired is 404 even before cleanup)."""

    @abstractmethod
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
        """Persist a state change (normally created -> terminal) and refresh ``expires_at``.
        The three result fields are replaced, not merged. Raises ``NotFoundError`` when missing."""

    @abstractmethod
    async def delete_expired(self, now: datetime) -> int:
        """Delete runs with ``expires_at <= now``; returns how many."""

    @abstractmethod
    async def mark_stale_created_as_error(
        self, before: datetime, *, message: str, expires_at: datetime
    ) -> int:
        """Startup sweep: runs still ``created`` with ``execute_date_time_utc < before``
        become ``error`` with ``main_error=message`` and the given ``expires_at``."""


class RunStore(ABC):
    """Runs and their rows. Rows are kept only for ``succeeded`` runs: every transition to
    another outcome deletes them in the same transaction."""

    @abstractmethod
    async def create(self, run: Run) -> Run:
        """Insert a ``running`` run. Raises ``AlreadyExistsError`` on a duplicate ``run_id``."""

    @abstractmethod
    async def get(self, run_id: UUID, now: datetime) -> Run | None:
        """The run, or ``None`` when unknown or expired (``expires_at <= now``)."""

    @abstractmethod
    async def add_rows(self, run_id: UUID, rows: Sequence[RunRow]) -> None:
        """Store a batch of rows of a run. Raises ``NotFoundError`` when the run is missing."""

    @abstractmethod
    async def rows(self, run_id: UUID, start: int, end: int) -> list[RunRow]:
        """The stored rows with ``start <= row < end``, in row order."""

    @abstractmethod
    async def has_rows(self, run_id: UUID) -> bool:
        """Whether any row of the run is stored."""

    @abstractmethod
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
        """End a ``running`` run; any status but ``succeeded`` also deletes its rows. A run that
        has already ended is returned unchanged. Raises ``NotFoundError`` when missing."""

    @abstractmethod
    async def request_cancel(self, run_id: UUID) -> None:
        """Ask the process executing a ``running`` run to cancel it; a no-op otherwise."""

    @abstractmethod
    async def cancel_requested(self, run_ids: Collection[UUID]) -> set[UUID]:
        """Those of ``run_ids`` still ``running`` whose cancel has been requested."""

    @abstractmethod
    async def delete_expired(self, now: datetime, limit: int) -> int:
        """Delete at most ``limit`` runs with ``expires_at <= now``, with their rows; returns
        how many."""

    @abstractmethod
    async def mark_stale_running_as_error(
        self, before: datetime, *, message: str, finished_at: datetime, expires_at: datetime
    ) -> int:
        """Startup sweep: runs still ``running`` with ``started_at < before`` become ``error``
        with ``message``, and their partial rows are deleted; returns how many."""


class PresetStore(ABC):
    @abstractmethod
    async def list(self, viewer: str) -> list[Preset]:
        """The presets ``viewer`` owns and those shared, ordered by ``created_at`` then
        ``preset_id``, each with whether ``viewer`` owns and hid it."""

    @abstractmethod
    async def get(self, preset_id: UUID, viewer: str) -> Preset | None:
        """The preset, whoever owns it, with whether ``viewer`` owns and hid it; ``None`` when
        unknown."""

    @abstractmethod
    async def create(self, preset: StoredPreset) -> None:
        """Insert. Raises ``AlreadyExistsError`` if the ``preset_id`` exists."""

    @abstractmethod
    async def replace(self, preset_id: UUID, fields: PresetFields, *, updated_at: datetime) -> None:
        """Overwrite the owner's fields; ``owner`` and ``created_at`` are kept. Raises
        ``NotFoundError`` when missing."""

    @abstractmethod
    async def delete(self, preset_id: UUID) -> None:
        """Delete the preset and every analyst's hidden mark on it. Raises ``NotFoundError``
        when missing."""

    @abstractmethod
    async def set_hidden(self, preset_id: UUID, analyst: str, hidden: bool) -> None:
        """Hide or unhide the preset for ``analyst``; idempotent. Raises ``NotFoundError``
        when the preset is missing."""


@dataclass(frozen=True)
class AnnotationEdit:
    """What one change does to every id it names.

    - With ``set_label``, set the label to ``label``, or clear it when that is ``None``.
    - Add ``add_tags``, then remove ``remove_tags``; or, when ``set_tags`` isn't ``None``, make
      the tags exactly ``set_tags``.
    - Append ``comment`` when it isn't ``None``.
    """

    set_label: bool = False
    label: str | None = None
    add_tags: frozenset[str] = frozenset()
    remove_tags: frozenset[str] = frozenset()
    set_tags: frozenset[str] | None = None
    comment: str | None = None

    def tags_after(self, tags: Collection[str]) -> set[str]:
        """The tags an id with ``tags`` has after this edit."""
        if self.set_tags is not None:
            return set(self.set_tags)
        return (set(tags) | self.add_tags) - self.remove_tags


@dataclass(frozen=True)
class AnnotationsChanged:
    """The ids a change changed, as they now are, and the version: the change's own, or the
    current one when nothing changed."""

    changes: list[Annotations]
    version: int


@dataclass(frozen=True)
class AnnotationsOf:
    """The annotations of those ids that have any, and the version they are current as of."""

    annotations: dict[str, Annotations]
    version: int


@dataclass(frozen=True)
class AnnotationChanges:
    """A page of the change feed: the ids changed after ``since``, as they now are, in version
    order. ``has_more`` when later changes are left for the next page."""

    changes: list[Annotations]
    has_more: bool


class AnnotationStore(ABC):
    """The annotations of ids, with one version counter (ADR-0020). Every change is one
    transaction that takes the next version, so versions are gapless and in commit order."""

    @abstractmethod
    async def change(
        self, ids: Collection[str], edit: AnnotationEdit, *, by: str, at: datetime
    ) -> AnnotationsChanged:
        """Apply ``edit`` to every one of ``ids`` under one new version. An id the edit leaves as
        it was isn't changed, and a change that changes nothing takes no version and writes no
        history."""

    @abstractmethod
    async def of_ids(self, ids: Collection[str]) -> AnnotationsOf:
        """The annotations of those of ``ids`` that have any, including ids whose annotations
        have all been removed."""

    @abstractmethod
    async def changes(self, since: int, limit: int) -> AnnotationChanges:
        """The ids changed after version ``since``: the first ``limit``, and the others of the
        last one's version, so a page always ends after a whole version."""

    @abstractmethod
    async def history(self, id: str) -> list[HistoryEntry]:
        """The label changes and comments of ``id``, newest first, the label change before the
        comment of the same change; none for an id never changed."""

    @abstractmethod
    async def tag_suggestions(self, prefix: str, *, by: str, limit: int) -> TagSuggestions:
        """Up to ``limit`` of the tags ``by`` added that are still on an id, newest first, then
        up to ``limit`` of the other tags, on the most ids first. A tag matches when it starts
        with ``prefix``, ignoring case. Ties go in tag order."""


class Storage(ABC):
    """Bundle wired into the app: the stores plus lifecycle and health."""

    templates: TemplateStore
    query_runs: QueryRunStore
    runs: RunStore
    presets: PresetStore
    annotations: AnnotationStore

    @abstractmethod
    async def health(self) -> bool:
        """``True`` when the store is reachable. Must not raise."""

    @abstractmethod
    async def aclose(self) -> None:
        """Release resources."""
