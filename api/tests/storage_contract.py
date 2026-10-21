"""Reusable storage contract suite. Not collected directly (no ``test_`` prefix).

``test_storage_contract.py`` subclasses these with a parametrised ``storage`` fixture. To run the
suite against another implementation (e.g. Postgres), add it to that fixture's params; every
implementation must pass unchanged. Each test needs an empty store.
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import pytest

from tim_api.query_runs.models import KustoQueryRun, KustoQueryStats, QueryRunStatus
from tim_api.runs.models import Run, RunAction, RunColumn, RunRow, RunStatus
from tim_api.storage import AlreadyExistsError, NotFoundError, Storage
from tim_api.templates.models import QueryTemplate, QueryTemplateFields

FIXTURES = Path(__file__).parent / "fixtures"
T0 = datetime(2026, 9, 29, 12, 0, tzinfo=UTC)


def _minutes(n: int) -> datetime:
    return T0 + timedelta(minutes=n)


def make_template(
    *,
    uuid: UUID | None = None,
    updated: datetime = T0,
    deleted: bool = False,
    name: str = "Storm events by state",
    created_by: str = "alice",
) -> QueryTemplate:
    raw: dict[str, Any] = json.loads((FIXTURES / "templates.json").read_text())[0]
    raw.update(
        uuid=str(uuid or uuid4()),
        updated=updated,
        isDeleted=deleted,
        name=name,
        createdBy=created_by,
        updatedBy=created_by,
    )
    return QueryTemplate.model_validate(raw)


def make_query_run(
    *,
    run_id: UUID | None = None,
    owner: str = "alice",
    status: QueryRunStatus = QueryRunStatus.CREATED,
    executed: datetime = T0,
    expires: datetime | None = None,
) -> KustoQueryRun:
    raw: dict[str, Any] = json.loads((FIXTURES / "query_run_created.json").read_text())
    raw.update(
        queryRunId=str(run_id or uuid4()),
        status=status.value,
        executeDateTimeUtc=executed,
        expiresAt=expires or executed + timedelta(days=1),
    )
    raw["kustoQuery"]["requestedBy"] = owner
    return KustoQueryRun.model_validate(raw)


class TemplateContract:
    async def test_create_get_roundtrip(self, storage: Storage) -> None:
        t = make_template()
        assert await storage.templates.create(t) == t
        assert await storage.templates.get(t.uuid) == t

    async def test_get_missing_is_none(self, storage: Storage) -> None:
        assert await storage.templates.get(uuid4()) is None

    async def test_create_duplicate_raises_even_if_deleted(self, storage: Storage) -> None:
        t = make_template(deleted=True)
        await storage.templates.create(t)
        with pytest.raises(AlreadyExistsError):
            await storage.templates.create(make_template(uuid=t.uuid, name="other"))
        stored = await storage.templates.get(t.uuid)
        assert stored is not None
        assert stored.name == t.name

    async def test_list_orders_by_updated_then_uuid(self, storage: Storage) -> None:
        a, b, c = (UUID(int=i) for i in (1, 2, 3))
        await storage.templates.create(make_template(uuid=c, updated=_minutes(1)))
        await storage.templates.create(make_template(uuid=b, updated=_minutes(2)))
        await storage.templates.create(make_template(uuid=a, updated=_minutes(2)))
        listed = await storage.templates.list(since=None, include_deleted=False)
        assert [t.uuid for t in listed] == [c, a, b]

    async def test_list_empty(self, storage: Storage) -> None:
        assert await storage.templates.list(since=None, include_deleted=True) == []

    async def test_list_excludes_deleted_unless_requested(self, storage: Storage) -> None:
        live = make_template(updated=_minutes(1))
        gone = make_template(updated=_minutes(2), deleted=True)
        await storage.templates.create(live)
        await storage.templates.create(gone)
        default = await storage.templates.list(since=None, include_deleted=False)
        assert [t.uuid for t in default] == [live.uuid]
        both = await storage.templates.list(since=None, include_deleted=True)
        assert [t.uuid for t in both] == [live.uuid, gone.uuid]

    async def test_list_since_is_strict(self, storage: Storage) -> None:
        old = make_template(updated=_minutes(1))
        edge = make_template(updated=_minutes(2))
        new = make_template(updated=_minutes(3))
        for t in (old, edge, new):
            await storage.templates.create(t)
        listed = await storage.templates.list(since=_minutes(2), include_deleted=False)
        assert [t.uuid for t in listed] == [new.uuid]

    async def test_list_since_applies_to_deleted_when_included(self, storage: Storage) -> None:
        gone = make_template(updated=_minutes(5), deleted=True)
        await storage.templates.create(gone)
        listed = await storage.templates.list(since=_minutes(1), include_deleted=True)
        assert [t.uuid for t in listed] == [gone.uuid]

    async def test_replace_updates_fields_and_preserves_protected(self, storage: Storage) -> None:
        original = make_template(created_by="alice", deleted=True)
        await storage.templates.create(original)
        fields = QueryTemplateFields.model_validate(
            {**original.model_dump(by_alias=True), "name": "Renamed", "query": "T | take 1"}
        )
        result = await storage.templates.replace(
            original.uuid, fields, updated_by="bob", updated=_minutes(9)
        )
        assert result.name == "Renamed"
        assert result.query == "T | take 1"
        assert result.updated_by == "bob"
        assert result.updated == _minutes(9)
        assert result.created_by == "alice"
        assert result.is_deleted is True
        assert result.uuid == original.uuid
        assert await storage.templates.get(original.uuid) == result

    async def test_replace_missing_raises_and_does_not_create(self, storage: Storage) -> None:
        t = make_template()
        with pytest.raises(NotFoundError):
            await storage.templates.replace(
                t.uuid,
                QueryTemplateFields.model_validate(t.model_dump()),
                updated_by="bob",
                updated=T0,
            )
        assert await storage.templates.get(t.uuid) is None

    async def test_save_overwrites_and_keeps_created_by(self, storage: Storage) -> None:
        t = make_template(deleted=True, created_by="alice")
        await storage.templates.create(t)
        restored = t.model_copy(
            update={
                "is_deleted": False,
                "updated_by": "bob",
                "updated": _minutes(4),
                "created_by": "mallory",
            }
        )
        saved = await storage.templates.save(restored)
        assert saved.is_deleted is False
        assert saved.updated_by == "bob"
        assert saved.created_by == "alice"
        assert await storage.templates.get(t.uuid) == saved

    async def test_save_missing_raises(self, storage: Storage) -> None:
        with pytest.raises(NotFoundError):
            await storage.templates.save(make_template())

    async def test_soft_delete_sets_flag_and_audit(self, storage: Storage) -> None:
        t = make_template()
        await storage.templates.create(t)
        result = await storage.templates.soft_delete(t.uuid, updated_by="bob", updated=_minutes(3))
        assert result.is_deleted is True
        assert result.updated_by == "bob"
        assert result.updated == _minutes(3)
        listed = await storage.templates.list(since=None, include_deleted=False)
        assert listed == []
        still = await storage.templates.get(t.uuid)
        assert still == result

    async def test_soft_delete_is_idempotent_without_write(self, storage: Storage) -> None:
        t = make_template()
        await storage.templates.create(t)
        first = await storage.templates.soft_delete(t.uuid, updated_by="bob", updated=_minutes(3))
        second = await storage.templates.soft_delete(t.uuid, updated_by="eve", updated=_minutes(8))
        assert second == first

    async def test_soft_delete_missing_raises(self, storage: Storage) -> None:
        with pytest.raises(NotFoundError):
            await storage.templates.soft_delete(uuid4(), updated_by="bob", updated=T0)

    async def test_returned_objects_are_copies(self, storage: Storage) -> None:
        t = make_template()
        created = await storage.templates.create(t)
        created.path.append("mutated")
        t.path.append("mutated-input")
        fetched = await storage.templates.get(t.uuid)
        assert fetched is not None
        assert "mutated" not in fetched.path
        assert "mutated-input" not in fetched.path
        fetched.path.append("again")
        refetched = await storage.templates.get(t.uuid)
        assert refetched is not None
        assert "again" not in refetched.path

    async def test_concurrent_creates_only_one_wins(self, storage: Storage) -> None:
        uid = uuid4()
        results = await asyncio.gather(
            *(storage.templates.create(make_template(uuid=uid)) for _ in range(5)),
            return_exceptions=True,
        )
        assert sum(isinstance(r, AlreadyExistsError) for r in results) == 4


class QueryRunContract:
    async def test_create_and_get_for_owner(self, storage: Storage) -> None:
        run = make_query_run()
        assert await storage.query_runs.create(run) == run
        assert await storage.query_runs.get_for_owner(run.query_run_id, "alice", T0) == run

    async def test_create_duplicate_raises(self, storage: Storage) -> None:
        run = make_query_run()
        await storage.query_runs.create(run)
        with pytest.raises(AlreadyExistsError):
            await storage.query_runs.create(run)

    async def test_missing_run_is_none(self, storage: Storage) -> None:
        assert await storage.query_runs.get_for_owner(uuid4(), "alice", T0) is None

    async def test_other_owner_is_none(self, storage: Storage) -> None:
        run = make_query_run(owner="alice")
        await storage.query_runs.create(run)
        assert await storage.query_runs.get_for_owner(run.query_run_id, "bob", T0) is None

    async def test_expired_run_is_none_even_if_not_deleted(self, storage: Storage) -> None:
        run = make_query_run(expires=_minutes(10))
        await storage.query_runs.create(run)
        assert await storage.query_runs.get_for_owner(run.query_run_id, "alice", _minutes(9)) == run
        assert (
            await storage.query_runs.get_for_owner(run.query_run_id, "alice", _minutes(10)) is None
        )

    async def test_update_result_completed(self, storage: Storage) -> None:
        run = make_query_run()
        await storage.query_runs.create(run)
        stats = KustoQueryStats(execution_time=0.5)
        updated = await storage.query_runs.update_result(
            run.query_run_id,
            status=QueryRunStatus.COMPLETED,
            expires_at=_minutes(90),
            result_data=[{"a": 1, "b": {"c": [1, 2]}}],
            execution_metrics=stats,
        )
        assert updated.status is QueryRunStatus.COMPLETED
        assert updated.expires_at == _minutes(90)
        assert updated.result_data == [{"a": 1, "b": {"c": [1, 2]}}]
        assert updated.execution_metrics is not None
        assert updated.execution_metrics.execution_time == 0.5
        assert updated.kusto_query == run.kusto_query
        assert updated.execute_date_time_utc == run.execute_date_time_utc
        assert await storage.query_runs.get_for_owner(run.query_run_id, "alice", T0) == updated

    async def test_update_result_error(self, storage: Storage) -> None:
        run = make_query_run()
        await storage.query_runs.create(run)
        updated = await storage.query_runs.update_result(
            run.query_run_id,
            status=QueryRunStatus.ERROR,
            expires_at=_minutes(90),
            main_error="boom",
        )
        assert updated.main_error == "boom"
        assert updated.result_data is None

    async def test_update_missing_raises(self, storage: Storage) -> None:
        with pytest.raises(NotFoundError):
            await storage.query_runs.update_result(
                uuid4(), status=QueryRunStatus.ERROR, expires_at=T0, main_error="x"
            )

    async def test_delete_expired_counts_and_removes(self, storage: Storage) -> None:
        old1 = make_query_run(expires=_minutes(1))
        old2 = make_query_run(expires=_minutes(5))
        fresh = make_query_run(expires=_minutes(60))
        for r in (old1, old2, fresh):
            await storage.query_runs.create(r)
        assert await storage.query_runs.delete_expired(_minutes(5)) == 2
        assert await storage.query_runs.delete_expired(_minutes(5)) == 0
        assert await storage.query_runs.get_for_owner(fresh.query_run_id, "alice", T0) == fresh
        # the expired rows are really gone: recreating the same id succeeds
        await storage.query_runs.create(old1)

    async def test_stale_created_marked_error(self, storage: Storage) -> None:
        stale = make_query_run(executed=_minutes(-30))
        recent = make_query_run(executed=_minutes(-1))
        done = make_query_run(executed=_minutes(-30), status=QueryRunStatus.COMPLETED)
        for r in (stale, recent, done):
            await storage.query_runs.create(r)
        count = await storage.query_runs.mark_stale_created_as_error(
            _minutes(-10), message="Interrupted by restart", expires_at=_minutes(60)
        )
        assert count == 1
        got = await storage.query_runs.get_for_owner(stale.query_run_id, "alice", T0)
        assert got is not None
        assert got.status is QueryRunStatus.ERROR
        assert got.main_error == "Interrupted by restart"
        assert got.expires_at == _minutes(60)
        untouched = await storage.query_runs.get_for_owner(recent.query_run_id, "alice", T0)
        assert untouched is not None
        assert untouched.status is QueryRunStatus.CREATED
        completed = await storage.query_runs.get_for_owner(done.query_run_id, "alice", T0)
        assert completed is not None
        assert completed.status is QueryRunStatus.COMPLETED

    async def test_returned_objects_are_copies(self, storage: Storage) -> None:
        run = make_query_run()
        await storage.query_runs.create(run)
        await storage.query_runs.update_result(
            run.query_run_id,
            status=QueryRunStatus.COMPLETED,
            expires_at=_minutes(90),
            result_data=[{"a": [1]}],
        )
        got = await storage.query_runs.get_for_owner(run.query_run_id, "alice", T0)
        assert got is not None
        assert got.result_data is not None
        got.result_data[0]["a"].append(2)
        again = await storage.query_runs.get_for_owner(run.query_run_id, "alice", T0)
        assert again is not None
        assert again.result_data == [{"a": [1]}]


def make_run(
    *,
    run_id: UUID | None = None,
    owner: str = "alice",
    started: datetime = T0,
    expires: datetime | None = None,
) -> Run:
    return Run(
        run_id=run_id or uuid4(),
        status=RunStatus.RUNNING,
        action=RunAction(key="acme.sign_ins", name="Sign-ins"),
        params={"user": "alice@example.com", "since": "2026-10-01T00:00:00Z", "limit": None},
        owner=owner,
        started_at=started,
        expires_at=expires or started + timedelta(days=1),
    )


def make_rows(start: int, count: int) -> list[RunRow]:
    return [
        RunRow(row=n, id=None if n % 3 == 0 else f"evt-{n}", data={"n": n, "tags": ["a", n]})
        for n in range(start, start + count)
    ]


COLUMNS = [
    RunColumn(name="n", type="number", declared=True),
    RunColumn(name="tags", type="json", declared=False),
]


class RunContract:
    async def test_create_and_get(self, storage: Storage) -> None:
        run = make_run()
        assert await storage.runs.create(run) == run
        assert await storage.runs.get(run.run_id, T0) == run

    async def test_create_duplicate_raises(self, storage: Storage) -> None:
        run = make_run()
        await storage.runs.create(run)
        with pytest.raises(AlreadyExistsError):
            await storage.runs.create(run)

    async def test_unknown_and_expired_runs_are_none(self, storage: Storage) -> None:
        run = make_run(expires=_minutes(10))
        await storage.runs.create(run)
        assert await storage.runs.get(uuid4(), T0) is None
        assert await storage.runs.get(run.run_id, _minutes(9)) == run
        assert await storage.runs.get(run.run_id, _minutes(10)) is None

    async def test_rows_are_read_back_by_row_range(self, storage: Storage) -> None:
        run = make_run()
        await storage.runs.create(run)
        await storage.runs.add_rows(run.run_id, make_rows(0, 4))
        await storage.runs.add_rows(run.run_id, make_rows(4, 3))
        assert await storage.runs.rows(run.run_id, 2, 5) == make_rows(2, 3)
        assert await storage.runs.rows(run.run_id, 5, 100) == make_rows(5, 2)
        assert await storage.runs.rows(run.run_id, 7, 10) == []
        assert await storage.runs.has_rows(run.run_id) is True

    async def test_rows_of_another_run_are_not_read(self, storage: Storage) -> None:
        one, other = make_run(), make_run()
        await storage.runs.create(one)
        await storage.runs.create(other)
        await storage.runs.add_rows(one.run_id, make_rows(0, 2))
        assert await storage.runs.rows(other.run_id, 0, 10) == []
        assert await storage.runs.has_rows(other.run_id) is False

    async def test_rows_of_a_missing_run_raise(self, storage: Storage) -> None:
        with pytest.raises(NotFoundError):
            await storage.runs.add_rows(uuid4(), make_rows(0, 1))

    async def test_success_keeps_the_rows(self, storage: Storage) -> None:
        run = make_run()
        await storage.runs.create(run)
        await storage.runs.add_rows(run.run_id, make_rows(0, 3))
        finished = await storage.runs.finish(
            run.run_id,
            status=RunStatus.SUCCEEDED,
            finished_at=_minutes(2),
            expires_at=_minutes(90),
            details={"duration": 1.5, "rowCount": 3, "warning": "careful", "cached": False},
            columns=COLUMNS,
            row_count=3,
        )
        assert finished == run.model_copy(
            update={
                "status": RunStatus.SUCCEEDED,
                "finished_at": _minutes(2),
                "expires_at": _minutes(90),
                "details": {"duration": 1.5, "rowCount": 3, "warning": "careful", "cached": False},
                "columns": COLUMNS,
                "row_count": 3,
            }
        )
        assert await storage.runs.get(run.run_id, T0) == finished
        assert await storage.runs.rows(run.run_id, 0, 10) == make_rows(0, 3)

    async def test_details_keep_their_order(self, storage: Storage) -> None:
        run = make_run()
        await storage.runs.create(run)
        details = {"duration": 1, "rowCount": 0, "zeta": "z", "alpha": "a", "b": 2}
        await storage.runs.finish(
            run.run_id,
            status=RunStatus.SUCCEEDED,
            finished_at=T0,
            expires_at=_minutes(90),
            details=details,
            columns=[],
            row_count=0,
        )
        got = await storage.runs.get(run.run_id, T0)
        assert got is not None
        assert list(got.details) == list(details)

    @pytest.mark.parametrize("status", [RunStatus.ERROR, RunStatus.TIMED_OUT, RunStatus.CANCELLED])
    async def test_any_other_outcome_deletes_the_rows(
        self, storage: Storage, status: RunStatus
    ) -> None:
        run = make_run()
        await storage.runs.create(run)
        await storage.runs.add_rows(run.run_id, make_rows(0, 3))
        finished = await storage.runs.finish(
            run.run_id,
            status=status,
            finished_at=_minutes(2),
            expires_at=_minutes(90),
            details={"duration": 0.5},
            error="Run exceeded the time limit",
        )
        assert finished.status is status
        assert finished.error == "Run exceeded the time limit"
        assert finished.columns is None
        assert finished.row_count is None
        assert await storage.runs.has_rows(run.run_id) is False

    async def test_a_run_ends_once(self, storage: Storage) -> None:
        run = make_run()
        await storage.runs.create(run)
        await storage.runs.add_rows(run.run_id, make_rows(0, 2))
        first = await storage.runs.finish(
            run.run_id,
            status=RunStatus.SUCCEEDED,
            finished_at=_minutes(1),
            expires_at=_minutes(90),
            details={},
            columns=[],
            row_count=2,
        )
        again = await storage.runs.finish(
            run.run_id,
            status=RunStatus.ERROR,
            finished_at=_minutes(2),
            expires_at=_minutes(95),
            details={},
            error="late",
        )
        assert again == first
        assert await storage.runs.has_rows(run.run_id) is True

    async def test_finishing_a_missing_run_raises(self, storage: Storage) -> None:
        with pytest.raises(NotFoundError):
            await storage.runs.finish(
                uuid4(), status=RunStatus.ERROR, finished_at=T0, expires_at=T0, details={}
            )

    async def test_cancel_requests_are_seen_only_while_running(self, storage: Storage) -> None:
        asked, running, ended = make_run(), make_run(), make_run()
        for run in (asked, running, ended):
            await storage.runs.create(run)
        await storage.runs.request_cancel(asked.run_id)
        await storage.runs.request_cancel(uuid4())  # unknown: a no-op
        await storage.runs.finish(
            ended.run_id,
            status=RunStatus.ERROR,
            finished_at=T0,
            expires_at=_minutes(90),
            details={},
        )
        await storage.runs.request_cancel(ended.run_id)
        ids = {asked.run_id, running.run_id, ended.run_id}
        assert await storage.runs.cancel_requested(ids) == {asked.run_id}
        assert await storage.runs.cancel_requested(set()) == set()

    async def test_delete_expired_takes_a_few_at_a_time(self, storage: Storage) -> None:
        expired = [make_run(expires=_minutes(i)) for i in range(1, 4)]
        fresh = make_run(expires=_minutes(60))
        for run in (*expired, fresh):
            await storage.runs.create(run)
            await storage.runs.add_rows(run.run_id, make_rows(0, 2))
        assert await storage.runs.delete_expired(_minutes(5), 2) == 2
        assert await storage.runs.delete_expired(_minutes(5), 2) == 1
        assert await storage.runs.delete_expired(_minutes(5), 2) == 0
        assert await storage.runs.get(fresh.run_id, T0) == fresh
        for run in expired:
            assert await storage.runs.has_rows(run.run_id) is False
        await storage.runs.create(expired[0])  # really gone: the id can be used again

    async def test_stale_running_runs_become_errors_without_rows(self, storage: Storage) -> None:
        stale = make_run(started=_minutes(-30))
        recent = make_run(started=_minutes(-1))
        done = make_run(started=_minutes(-30))
        for run in (stale, recent, done):
            await storage.runs.create(run)
            await storage.runs.add_rows(run.run_id, make_rows(0, 2))
        await storage.runs.finish(
            done.run_id,
            status=RunStatus.SUCCEEDED,
            finished_at=_minutes(-29),
            expires_at=_minutes(60),
            details={},
            columns=[],
            row_count=2,
        )
        count = await storage.runs.mark_stale_running_as_error(
            _minutes(-10),
            message="Run interrupted by server restart",
            finished_at=T0,
            expires_at=_minutes(60),
        )
        assert count == 1
        got = await storage.runs.get(stale.run_id, T0)
        assert got is not None
        assert (got.status, got.error, got.finished_at, got.expires_at) == (
            RunStatus.ERROR,
            "Run interrupted by server restart",
            T0,
            _minutes(60),
        )
        assert await storage.runs.has_rows(stale.run_id) is False
        untouched = await storage.runs.get(recent.run_id, T0)
        assert untouched is not None
        assert untouched.status is RunStatus.RUNNING
        assert await storage.runs.has_rows(recent.run_id) is True
        assert await storage.runs.has_rows(done.run_id) is True

    async def test_returned_objects_are_copies(self, storage: Storage) -> None:
        run = make_run()
        await storage.runs.create(run)
        rows = make_rows(0, 1)
        await storage.runs.add_rows(run.run_id, rows)
        rows[0].data["n"] = "mutated"
        got = await storage.runs.get(run.run_id, T0)
        assert got is not None
        got.params["user"] = "mallory"
        [stored] = await storage.runs.rows(run.run_id, 0, 1)
        assert stored.data["n"] == 0
        again = await storage.runs.get(run.run_id, T0)
        assert again is not None
        assert again.params["user"] == "alice@example.com"


class HealthContract:
    async def test_health(self, storage: Storage) -> None:
        assert await storage.health() is True
