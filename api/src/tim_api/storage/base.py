"""Storage interfaces (ADR-0004). Implementations: ``memory.py`` now, ``postgres.py`` in P2-08.

The stores are deliberately thin persistence ports. Business rules (validation, JSON Patch,
owner identity, retention length) live in the endpoints/services. Timestamps and identities are
passed in by the caller, so an implementation never reads the clock except where stated, and
both implementations behave identically. Every method must be safe to call concurrently.

Postgres mapping notes (P2-08): each method is one statement or one short transaction;
``create`` maps unique violation to ``AlreadyExistsError``; ``replace``/``soft_delete``/
``update_result`` map ``UPDATE ... RETURNING`` with zero rows to ``NotFoundError``.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any
from uuid import UUID

from tim_api.query_runs.models import KustoQueryRun, KustoQueryStats, QueryRunStatus
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
        (``expires_at <= now``; expired is 404 even before cleanup, SEC-02/BUG-01)."""

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
        """Startup sweep (BUG-02): runs still ``created`` with ``execute_date_time_utc < before``
        become ``error`` with ``main_error=message`` and the given ``expires_at``."""


class Storage(ABC):
    """Bundle wired into the app: both stores plus lifecycle and health."""

    templates: TemplateStore
    runs: QueryRunStore

    @abstractmethod
    async def health(self) -> bool:
        """``True`` when the store is reachable. Must not raise."""

    @abstractmethod
    async def aclose(self) -> None:
        """Release resources."""
