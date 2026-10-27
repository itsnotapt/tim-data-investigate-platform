"""Reusable storage contract suite. Not collected directly (no ``test_`` prefix).

``test_storage_contract.py`` subclasses these with a parametrised ``storage`` fixture. To run the
suite against another implementation (e.g. Postgres), add it to that fixture's params; every
implementation must pass unchanged. Each test needs an empty store.
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import pytest

from tim_api.annotations.models import (
    Annotations,
    Comment,
    CommentEntry,
    LabelEntry,
    LabelState,
)
from tim_api.column_views.models import ColumnViewFields, StoredColumnView
from tim_api.presets.models import PresetFields, StoredPreset
from tim_api.runs.models import Run, RunAction, RunColumn, RunRow, RunStatus
from tim_api.storage import AlreadyExistsError, AnnotationEdit, NotFoundError, Storage

T0 = datetime(2026, 9, 29, 12, 0, tzinfo=UTC)


def _minutes(n: int) -> datetime:
    return T0 + timedelta(minutes=n)


def make_preset(
    *,
    preset_id: UUID | None = None,
    owner: str = "alice",
    visibility: str = "private",
    created: datetime = T0,
    name: str = "Alice's sign-ins",
) -> StoredPreset:
    return StoredPreset.model_validate(
        {
            "presetId": str(preset_id or uuid4()),
            "name": name,
            "menuPath": ["Identity", "Daily"],
            "visibility": visibility,
            "action": "sign-ins",
            "params": {"limit": 5, "where": {"nested": [1, "two"]}},
            "inputs": [
                {"name": "users", "source": "param", "fixed": True, "value": ["alice"]},
                {"name": "hosts", "source": "param", "fixed": False, "fromColumns": ["Host"]},
            ],
            "owner": owner,
            "createdAt": created,
            "updatedAt": created,
        }
    )


def make_column_view(
    *,
    view_id: UUID | None = None,
    owner: str = "alice",
    visibility: str = "private",
    created: datetime = T0,
    name: str = "Triage",
    preset_id: UUID | None = None,
) -> StoredColumnView:
    saved_from: dict[str, Any] = {"action": "sign-ins"}
    if preset_id:
        saved_from["presetId"] = str(preset_id)
    return StoredColumnView.model_validate(
        {
            "viewId": str(view_id or uuid4()),
            "name": name,
            "visibility": visibility,
            "savedFrom": saved_from,
            "state": {
                "partialColumnState": True,
                "columnOrder": {"orderedColIds": ["User", "tim:label"]},
                "filter": {"filterModel": {"User": {"filterType": "text", "filter": "a"}}},
            },
            "owner": owner,
            "createdAt": created,
            "updatedAt": created,
        }
    )


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

    async def test_rows_keep_their_key_order(self, storage: Storage) -> None:
        run = make_run()
        await storage.runs.create(run)
        alert = {"alertId": "a-1", "severity": "high", "device": "pc-7", "files": [], "mitre": []}
        data: dict[str, Any] = {
            "EventId": 4624,
            "SHA256": "e3b0",
            "Score": 0.5,
            "MD5": "d41d",
            "SHA1": "da39",
            "Alert": alert,
        }
        await storage.runs.add_rows(run.run_id, [RunRow(row=0, id=None, data=data)])
        (got,) = await storage.runs.rows(run.run_id, 0, 1)
        assert json.dumps(got.data) == json.dumps(data)

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


class PresetContract:
    async def test_create_get_roundtrip(self, storage: Storage) -> None:
        preset = make_preset()
        await storage.presets.create(preset)
        got = await storage.presets.get(preset.preset_id, "alice")
        assert got is not None
        assert got.model_dump() == {**preset.model_dump(), "owned": True, "hidden": False}

    async def test_get_missing_is_none(self, storage: Storage) -> None:
        assert await storage.presets.get(uuid4(), "alice") is None

    async def test_get_returns_someone_elses_private_preset(self, storage: Storage) -> None:
        preset = make_preset(owner="alice")
        await storage.presets.create(preset)
        got = await storage.presets.get(preset.preset_id, "bob")
        assert got is not None
        assert got.owner == "alice"

    async def test_create_duplicate_raises(self, storage: Storage) -> None:
        preset = make_preset()
        await storage.presets.create(preset)
        with pytest.raises(AlreadyExistsError):
            await storage.presets.create(make_preset(preset_id=preset.preset_id, name="other"))

    async def test_list_has_own_and_shared_in_creation_order(self, storage: Storage) -> None:
        a, b, c, d = (UUID(int=i) for i in (1, 2, 3, 4))
        await storage.presets.create(make_preset(preset_id=d, owner="bob", created=_minutes(1)))
        await storage.presets.create(
            make_preset(preset_id=c, owner="bob", visibility="shared", created=_minutes(2))
        )
        await storage.presets.create(make_preset(preset_id=b, owner="alice", created=_minutes(2)))
        await storage.presets.create(make_preset(preset_id=a, owner="alice", created=_minutes(3)))
        listed = await storage.presets.list("alice")
        assert [p.preset_id for p in listed] == [b, c, a]

    async def test_list_empty(self, storage: Storage) -> None:
        assert await storage.presets.list("alice") == []

    async def test_replace_keeps_owner_and_created_at(self, storage: Storage) -> None:
        preset = make_preset(owner="alice")
        await storage.presets.create(preset)
        fields = PresetFields.model_validate(
            {
                "name": "Renamed",
                "menuPath": [],
                "visibility": "shared",
                "action": "other",
                "params": {},
                "inputs": [],
            }
        )
        await storage.presets.replace(preset.preset_id, fields, updated_at=_minutes(5))
        got = await storage.presets.get(preset.preset_id, "alice")
        assert got is not None
        assert got.model_dump(by_alias=False) == {
            **fields.model_dump(by_alias=False),
            "preset_id": preset.preset_id,
            "owner": "alice",
            "created_at": T0,
            "updated_at": _minutes(5),
            "owned": True,
            "hidden": False,
        }

    async def test_replace_missing_raises(self, storage: Storage) -> None:
        with pytest.raises(NotFoundError):
            await storage.presets.replace(uuid4(), make_preset(), updated_at=T0)

    async def test_owned_is_whether_the_viewer_is_the_owner(self, storage: Storage) -> None:
        preset = make_preset(visibility="shared")
        await storage.presets.create(preset)
        assert [p.owned for p in await storage.presets.list("alice")] == [True]
        assert [p.owned for p in await storage.presets.list("bob")] == [False]
        bobs = await storage.presets.get(preset.preset_id, "bob")
        assert bobs is not None
        assert bobs.owned is False

    async def test_hidden_is_per_analyst(self, storage: Storage) -> None:
        preset = make_preset(visibility="shared")
        await storage.presets.create(preset)
        await storage.presets.set_hidden(preset.preset_id, "bob", True)
        await storage.presets.set_hidden(preset.preset_id, "bob", True)
        assert [p.hidden for p in await storage.presets.list("bob")] == [True]
        assert [p.hidden for p in await storage.presets.list("alice")] == [False]
        bobs = await storage.presets.get(preset.preset_id, "bob")
        assert bobs is not None
        assert bobs.hidden is True
        await storage.presets.set_hidden(preset.preset_id, "bob", False)
        await storage.presets.set_hidden(preset.preset_id, "bob", False)
        assert [p.hidden for p in await storage.presets.list("bob")] == [False]

    async def test_set_hidden_on_missing_raises(self, storage: Storage) -> None:
        with pytest.raises(NotFoundError):
            await storage.presets.set_hidden(uuid4(), "bob", True)

    async def test_delete_removes_the_preset_and_its_hidden_marks(self, storage: Storage) -> None:
        preset = make_preset(visibility="shared")
        await storage.presets.create(preset)
        await storage.presets.set_hidden(preset.preset_id, "bob", True)
        await storage.presets.delete(preset.preset_id)
        assert await storage.presets.get(preset.preset_id, "bob") is None
        assert await storage.presets.list("bob") == []
        # The same id again starts with no hidden marks.
        await storage.presets.create(preset)
        assert [p.hidden for p in await storage.presets.list("bob")] == [False]

    async def test_delete_missing_raises(self, storage: Storage) -> None:
        with pytest.raises(NotFoundError):
            await storage.presets.delete(uuid4())


def label(key: str | None) -> AnnotationEdit:
    return AnnotationEdit(set_label=True, label=key)


def labelled(id: str, key: str, by: str, at: datetime, version: int) -> Annotations:
    return Annotations(id=id, label=LabelState(key=key, by=by, at=at), version=version)


def unlabelled(id: str, version: int) -> Annotations:
    return Annotations(id=id, label=None, version=version)


class AnnotationContract:
    async def test_a_label_is_set_on_every_id_under_one_version(self, storage: Storage) -> None:
        store = storage.annotations
        changed = await store.change(["b", "a"], label("malicious"), by="alice", at=T0)
        assert changed.version == 1
        assert changed.changes == [
            labelled("a", "malicious", "alice", T0, 1),
            labelled("b", "malicious", "alice", T0, 1),
        ]
        got = await store.of_ids(["a", "b", "c"])
        assert got.version == 1
        assert got.annotations == {
            "a": labelled("a", "malicious", "alice", T0, 1),
            "b": labelled("b", "malicious", "alice", T0, 1),
        }

    async def test_each_change_takes_the_next_version(self, storage: Storage) -> None:
        store = storage.annotations
        await store.change(["a"], label("malicious"), by="alice", at=T0)
        changed = await store.change(["a"], label("benign"), by="bob", at=_minutes(1))
        assert changed == type(changed)(
            changes=[labelled("a", "benign", "bob", _minutes(1), 2)], version=2
        )

    async def test_a_change_that_changes_nothing_takes_no_version(self, storage: Storage) -> None:
        store = storage.annotations
        await store.change(["a"], label("malicious"), by="alice", at=T0)
        unchanged = await store.change(["a"], label("malicious"), by="bob", at=_minutes(1))
        assert (unchanged.changes, unchanged.version) == ([], 1)
        cleared = await store.change(["never-labelled"], label(None), by="bob", at=_minutes(1))
        assert (cleared.changes, cleared.version) == ([], 1)
        nothing = await store.change(["a"], AnnotationEdit(), by="bob", at=_minutes(1))
        assert (nothing.changes, nothing.version) == ([], 1)
        got = await store.of_ids(["a", "never-labelled"])
        assert got.annotations == {"a": labelled("a", "malicious", "alice", T0, 1)}
        assert (await store.changes(0, 100)).changes == [labelled("a", "malicious", "alice", T0, 1)]

    async def test_only_the_ids_the_change_changes_take_its_version(self, storage: Storage) -> None:
        store = storage.annotations
        await store.change(["a"], label("benign"), by="alice", at=T0)
        changed = await store.change(["a", "b"], label("benign"), by="bob", at=_minutes(1))
        assert changed.changes == [labelled("b", "benign", "bob", _minutes(1), 2)]
        got = await store.of_ids(["a", "b"])
        assert got.annotations["a"] == labelled("a", "benign", "alice", T0, 1)

    async def test_a_cleared_label_keeps_the_id_with_the_clearing_version(
        self, storage: Storage
    ) -> None:
        store = storage.annotations
        await store.change(["a", "b"], label("malicious"), by="alice", at=T0)
        cleared = await store.change(["a"], label(None), by="bob", at=_minutes(1))
        assert cleared.changes == [unlabelled("a", 2)]
        assert (await store.of_ids(["a"])).annotations == {"a": unlabelled("a", 2)}
        assert (await store.changes(1, 100)).changes == [unlabelled("a", 2)]

    async def test_the_feed_gives_the_current_state_of_each_id_changed_after_since(
        self, storage: Storage
    ) -> None:
        store = storage.annotations
        await store.change(["a", "b"], label("malicious"), by="alice", at=T0)
        await store.change(["c"], label("benign"), by="alice", at=_minutes(1))
        await store.change(["a"], label("suspicious"), by="bob", at=_minutes(2))
        page = await store.changes(0, 100)
        assert page.has_more is False
        assert page.changes == [
            labelled("b", "malicious", "alice", T0, 1),
            labelled("c", "benign", "alice", _minutes(1), 2),
            labelled("a", "suspicious", "bob", _minutes(2), 3),
        ]
        assert (await store.changes(2, 100)).changes == [
            labelled("a", "suspicious", "bob", _minutes(2), 3)
        ]
        assert await store.changes(3, 100) == type(page)(changes=[], has_more=False)

    async def test_a_feed_page_ends_after_a_whole_version(self, storage: Storage) -> None:
        store = storage.annotations
        await store.change(["a", "b", "c"], label("malicious"), by="alice", at=T0)
        await store.change(["d"], label("benign"), by="alice", at=T0)
        await store.change(["e"], label("benign"), by="alice", at=T0)
        first = await store.changes(0, 2)
        assert ([a.id for a in first.changes], first.has_more) == (["a", "b", "c"], True)
        second = await store.changes(1, 2)
        assert ([a.id for a in second.changes], second.has_more) == (["d", "e"], False)
        assert (await store.changes(1, 1)).has_more is True

    async def test_annotations_start_at_version_zero(self, storage: Storage) -> None:
        assert await storage.annotations.of_ids(["a"]) == type(
            await storage.annotations.of_ids([])
        )(annotations={}, version=0)

    async def test_concurrent_changes_take_gapless_versions(self, storage: Storage) -> None:
        store = storage.annotations
        results = await asyncio.gather(
            *(store.change([f"id-{n}"], label("benign"), by="alice", at=T0) for n in range(20))
        )
        assert sorted(r.version for r in results) == list(range(1, 21))
        page = await store.changes(0, 100)
        assert [a.version for a in page.changes] == list(range(1, 21))

    async def test_added_tags_join_each_id_s_tags_under_one_version(self, storage: Storage) -> None:
        store = storage.annotations
        await store.change(["a"], AnnotationEdit(add_tags=frozenset({"c2"})), by="alice", at=T0)
        changed = await store.change(
            ["a", "b"],
            AnnotationEdit(add_tags=frozenset({"c2", "beacon", "Beacon"})),
            by="bob",
            at=T0,
        )
        assert changed.version == 2
        assert changed.changes == [
            Annotations(id="a", label=None, tags=["Beacon", "beacon", "c2"], version=2),
            Annotations(id="b", label=None, tags=["Beacon", "beacon", "c2"], version=2),
        ]
        assert (await store.of_ids(["a"])).annotations["a"].tags == ["Beacon", "beacon", "c2"]

    async def test_a_removed_tag_is_purged_and_a_tagless_id_is_kept(self, storage: Storage) -> None:
        store = storage.annotations
        await store.change(
            ["a", "b"], AnnotationEdit(add_tags=frozenset({"c2", "beacon"})), by="alice", at=T0
        )
        changed = await store.change(
            ["a", "b", "c"],
            AnnotationEdit(remove_tags=frozenset({"c2", "beacon", "never-added"})),
            by="bob",
            at=_minutes(1),
        )
        assert changed.changes == [
            Annotations(id="a", label=None, tags=[], version=2),
            Annotations(id="b", label=None, tags=[], version=2),
        ]
        assert (await store.changes(1, 100)).changes == changed.changes
        readded = await store.change(
            ["a"], AnnotationEdit(add_tags=frozenset({"c2"})), by="carol", at=_minutes(2)
        )
        assert readded.changes == [Annotations(id="a", label=None, tags=["c2"], version=3)]
        suggestions = await store.tag_suggestions("", by="alice", limit=10)
        assert suggestions.recent == []

    async def test_set_tags_replaces_each_id_s_tags(self, storage: Storage) -> None:
        store = storage.annotations
        await store.change(
            ["a"], AnnotationEdit(add_tags=frozenset({"c2", "beacon"})), by="alice", at=T0
        )
        await store.change(["b"], AnnotationEdit(add_tags=frozenset({"beacon"})), by="alice", at=T0)
        changed = await store.change(
            ["a", "b", "c"],
            AnnotationEdit(set_tags=frozenset({"beacon"})),
            by="bob",
            at=_minutes(1),
        )
        assert changed.changes == [
            Annotations(id="a", label=None, tags=["beacon"], version=3),
            Annotations(id="c", label=None, tags=["beacon"], version=3),
        ]
        cleared = await store.change(
            ["a", "c"], AnnotationEdit(set_tags=frozenset()), by="bob", at=T0
        )
        assert [(a.id, a.tags) for a in cleared.changes] == [("a", []), ("c", [])]

    async def test_tag_changes_that_change_nothing_take_no_version(self, storage: Storage) -> None:
        store = storage.annotations
        await store.change(["a"], AnnotationEdit(add_tags=frozenset({"c2"})), by="alice", at=T0)
        for edit in (
            AnnotationEdit(add_tags=frozenset({"c2"})),
            AnnotationEdit(remove_tags=frozenset({"beacon"})),
            AnnotationEdit(set_tags=frozenset({"c2"})),
        ):
            unchanged = await store.change(["a"], edit, by="bob", at=_minutes(1))
            assert (unchanged.changes, unchanged.version) == ([], 1)

    async def test_a_comment_is_appended_to_every_id_with_the_label_and_tags(
        self, storage: Storage
    ) -> None:
        store = storage.annotations
        await store.change(["a"], AnnotationEdit(comment="first look"), by="alice", at=T0)
        changed = await store.change(
            ["a", "b"],
            AnnotationEdit(
                set_label=True, label="malicious", add_tags=frozenset({"c2"}), comment="beacons"
            ),
            by="bob",
            at=_minutes(1),
        )
        bobs = Comment(author="bob", at=_minutes(1), text="beacons")
        assert changed.changes == [
            Annotations(
                id="a",
                label=LabelState(key="malicious", by="bob", at=_minutes(1)),
                tags=["c2"],
                comments=[Comment(author="alice", at=T0, text="first look"), bobs],
                version=2,
            ),
            Annotations(
                id="b",
                label=LabelState(key="malicious", by="bob", at=_minutes(1)),
                tags=["c2"],
                comments=[bobs],
                version=2,
            ),
        ]
        again = await store.change(
            ["b"], AnnotationEdit(comment="beacons"), by="bob", at=_minutes(1)
        )
        assert [len(a.comments) for a in again.changes] == [2]
        assert again.version == 3

    async def test_the_history_is_the_label_changes_and_comments_newest_first(
        self, storage: Storage
    ) -> None:
        store = storage.annotations
        await store.change(["a"], AnnotationEdit(comment="first look"), by="alice", at=T0)
        await store.change(
            ["a", "b"],
            AnnotationEdit(set_label=True, label="malicious", comment="beacons"),
            by="bob",
            at=_minutes(1),
        )
        await store.change(["a"], AnnotationEdit(add_tags=frozenset({"c2"})), by="bob", at=T0)
        await store.change(["a"], label("malicious"), by="carol", at=_minutes(2))
        await store.change(["a"], label(None), by="alice", at=_minutes(3))
        assert await store.history("a") == [
            LabelEntry(kind="label", label=None, by="alice", at=_minutes(3)),
            LabelEntry(kind="label", label="malicious", by="bob", at=_minutes(1)),
            CommentEntry(kind="comment", author="bob", at=_minutes(1), text="beacons"),
            CommentEntry(kind="comment", author="alice", at=T0, text="first look"),
        ]
        assert [e.kind for e in await store.history("b")] == ["label", "comment"]
        assert await store.history("never-changed") == []

    async def test_tag_suggestions_are_the_analyst_s_recent_tags_then_the_most_used(
        self, storage: Storage
    ) -> None:
        store = storage.annotations

        async def tag(ids: list[str], tags: set[str], by: str, at: datetime) -> None:
            await store.change(ids, AnnotationEdit(add_tags=frozenset(tags)), by=by, at=at)

        await tag(["a", "b", "c"], {"Beacon"}, "bob", T0)
        await tag(["a", "b"], {"botnet"}, "bob", T0)
        await tag(["a"], {"c2", "beta"}, "bob", T0)
        await tag(["x"], {"bad"}, "alice", _minutes(1))
        await tag(["y"], {"Benign-ish"}, "alice", _minutes(2))
        await tag(["z"], {"bad"}, "alice", _minutes(3))
        got = await store.tag_suggestions("b", by="alice", limit=10)
        assert (got.recent, got.most_used) == (
            ["bad", "Benign-ish"],
            ["Beacon", "botnet", "beta"],
        )
        limited = await store.tag_suggestions("B", by="alice", limit=1)
        assert (limited.recent, limited.most_used) == (["bad"], ["Beacon"])
        assert (await store.tag_suggestions("c", by="carol", limit=10)).recent == []


class HealthContract:
    async def test_health(self, storage: Storage) -> None:
        assert await storage.health() is True


class ColumnViewContract:
    async def test_create_get_roundtrip(self, storage: Storage) -> None:
        view = make_column_view(preset_id=UUID(int=7))
        await storage.column_views.create(view)
        got = await storage.column_views.get(view.view_id, "alice")
        assert got is not None
        assert got.model_dump() == {**view.model_dump(), "owned": True, "hidden": False}

    async def test_a_view_without_a_preset_has_none(self, storage: Storage) -> None:
        view = make_column_view()
        await storage.column_views.create(view)
        got = await storage.column_views.get(view.view_id, "alice")
        assert got is not None
        assert got.saved_from.preset_id is None

    async def test_get_missing_is_none(self, storage: Storage) -> None:
        assert await storage.column_views.get(uuid4(), "alice") is None

    async def test_get_returns_someone_elses_private_view(self, storage: Storage) -> None:
        view = make_column_view(owner="alice")
        await storage.column_views.create(view)
        got = await storage.column_views.get(view.view_id, "bob")
        assert got is not None
        assert got.owner == "alice"
        assert got.owned is False

    async def test_create_duplicate_raises(self, storage: Storage) -> None:
        view = make_column_view()
        await storage.column_views.create(view)
        with pytest.raises(AlreadyExistsError):
            await storage.column_views.create(make_column_view(view_id=view.view_id))

    async def test_list_has_own_and_shared_in_creation_order(self, storage: Storage) -> None:
        a, b, c, d = (UUID(int=i) for i in (1, 2, 3, 4))
        await storage.column_views.create(
            make_column_view(view_id=d, owner="bob", created=_minutes(1))
        )
        await storage.column_views.create(
            make_column_view(view_id=c, owner="bob", visibility="shared", created=_minutes(2))
        )
        await storage.column_views.create(
            make_column_view(view_id=b, owner="alice", created=_minutes(2))
        )
        await storage.column_views.create(
            make_column_view(view_id=a, owner="alice", created=_minutes(3))
        )
        listed = await storage.column_views.list("alice")
        assert [v.view_id for v in listed] == [b, c, a]

    async def test_list_empty(self, storage: Storage) -> None:
        assert await storage.column_views.list("alice") == []

    async def test_replace_keeps_owner_saved_from_and_created_at(self, storage: Storage) -> None:
        view = make_column_view(preset_id=UUID(int=7))
        await storage.column_views.create(view)
        fields = ColumnViewFields.model_validate(
            {"name": "Renamed", "visibility": "shared", "state": {"sort": {"sortModel": []}}}
        )
        await storage.column_views.replace(view.view_id, fields, updated_at=_minutes(5))
        got = await storage.column_views.get(view.view_id, "alice")
        assert got is not None
        assert got.model_dump(by_alias=False) == {
            **fields.model_dump(by_alias=False),
            "view_id": view.view_id,
            "saved_from": view.saved_from.model_dump(by_alias=False),
            "owner": "alice",
            "created_at": T0,
            "updated_at": _minutes(5),
            "owned": True,
            "hidden": False,
        }

    async def test_replace_missing_raises(self, storage: Storage) -> None:
        with pytest.raises(NotFoundError):
            await storage.column_views.replace(uuid4(), make_column_view(), updated_at=T0)

    async def test_hidden_is_per_analyst(self, storage: Storage) -> None:
        view = make_column_view(visibility="shared")
        await storage.column_views.create(view)
        await storage.column_views.set_hidden(view.view_id, "bob", True)
        await storage.column_views.set_hidden(view.view_id, "bob", True)
        assert [v.hidden for v in await storage.column_views.list("bob")] == [True]
        assert [v.hidden for v in await storage.column_views.list("alice")] == [False]
        await storage.column_views.set_hidden(view.view_id, "bob", False)
        await storage.column_views.set_hidden(view.view_id, "bob", False)
        assert [v.hidden for v in await storage.column_views.list("bob")] == [False]

    async def test_set_hidden_on_missing_raises(self, storage: Storage) -> None:
        with pytest.raises(NotFoundError):
            await storage.column_views.set_hidden(uuid4(), "bob", True)

    async def test_delete_removes_the_view_and_its_hidden_marks(self, storage: Storage) -> None:
        view = make_column_view(visibility="shared")
        await storage.column_views.create(view)
        await storage.column_views.set_hidden(view.view_id, "bob", True)
        await storage.column_views.delete(view.view_id)
        assert await storage.column_views.get(view.view_id, "bob") is None
        with pytest.raises(NotFoundError):
            await storage.column_views.delete(view.view_id)

    async def test_the_stored_state_is_a_copy(self, storage: Storage) -> None:
        view = make_column_view()
        await storage.column_views.create(view)
        view.state["columnOrder"] = "changed"
        got = await storage.column_views.get(view.view_id, "alice")
        assert got is not None
        got.state["filter"] = "changed"
        again = await storage.column_views.get(view.view_id, "alice")
        assert again is not None
        assert again.state["columnOrder"] == {"orderedColIds": ["User", "tim:label"]}
        assert again.state["filter"] != "changed"
