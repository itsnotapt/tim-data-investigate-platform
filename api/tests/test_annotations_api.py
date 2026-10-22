"""``/api/annotations``: labelling ids and the change feed, against every storage
implementation."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any

import httpx2 as httpx
import pytest
from app_factory import AuthKit, create_test_app
from scripted_actions import Rows
from tim_actions import Provider

from tim_api.storage import Storage

ALICE = "alice@example.com"
BOB = "bob@example.com"


class Env:
    def __init__(self, client: httpx.AsyncClient, auth: AuthKit) -> None:
        self.client = client
        self._auth = auth

    def as_user(self, name: str, oid: str) -> None:
        self.client.headers.update(self._auth.headers(name, oid))

    async def patch(self, body: dict[str, Any]) -> httpx.Response:
        return await self.client.patch("/api/annotations", json=body)

    async def label(self, ids: Sequence[str], key: str | None) -> dict[str, Any]:
        response = await self.patch({"ids": list(ids), "label": key})
        assert response.status_code == 200, response.text
        body: dict[str, Any] = response.json()
        return body

    async def changes(self, since: int) -> dict[str, Any]:
        response = await self.client.get("/api/annotations/changes", params={"since": since})
        assert response.status_code == 200, response.text
        body: dict[str, Any] = response.json()
        return body


@asynccontextmanager
async def open_env(
    storage: Storage, auth: AuthKit, actions: Sequence[Any] = ()
) -> AsyncIterator[Env]:
    app = create_test_app(storage_factory=lambda _s: storage, providers=[Provider(actions=actions)])
    auth.install(app)
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://t", headers=auth.headers(ALICE, "oid-a")
        ) as client:
            yield Env(client, auth)


def label_of(change: dict[str, Any]) -> tuple[str, str | None, str | None]:
    label = change["label"]
    return change["id"], label and label["key"], label and label["by"]


async def test_labelling_ids_sets_the_label_on_each_under_one_version(
    storage: Storage, auth: AuthKit
) -> None:
    async with open_env(storage, auth) as env:
        body = await env.label(["c-2", "c-1", "c-2"], "malicious")
    assert body["version"] == 1
    assert [label_of(change) for change in body["changes"]] == [
        ("c-1", "malicious", ALICE),
        ("c-2", "malicious", ALICE),
    ]
    first = body["changes"][0]
    assert (first["tags"], first["comments"], first["version"]) == ([], [], 1)
    datetime.fromisoformat(first["label"]["at"])


async def test_the_author_comes_from_the_token(storage: Storage, auth: AuthKit) -> None:
    async with open_env(storage, auth) as env:
        env.as_user(BOB, "oid-b")
        response = await env.patch({"ids": ["c-1"], "label": "benign", "by": ALICE})
    assert response.json()["changes"][0]["label"]["by"] == BOB


async def test_a_null_label_clears_it_and_the_feed_carries_the_removal(
    storage: Storage, auth: AuthKit
) -> None:
    async with open_env(storage, auth) as env:
        await env.label(["c-1", "c-2"], "suspicious")
        cleared = await env.label(["c-1"], None)
        feed = await env.changes(1)
    assert cleared["version"] == 2
    assert [label_of(change) for change in cleared["changes"]] == [("c-1", None, None)]
    assert [label_of(change) for change in feed["changes"]] == [("c-1", None, None)]
    assert (feed["next"], feed["hasMore"]) == (2, False)


async def test_a_change_that_changes_nothing_takes_no_version(
    storage: Storage, auth: AuthKit
) -> None:
    async with open_env(storage, auth) as env:
        await env.label(["c-1"], "benign")
        again = await env.label(["c-1"], "benign")
        nothing = await env.label(["never-labelled"], None)
    assert (again["changes"], again["version"]) == ([], 1)
    assert (nothing["changes"], nothing["version"]) == ([], 1)


@pytest.mark.parametrize(
    ("body", "errors"),
    [
        ({"ids": ["c-1"], "label": "verdict"}, {"label": ["Unknown label: verdict"]}),
        (
            {"ids": ["c-1"]},
            {"body": ["Give at least one change: label"]},
        ),
    ],
)
async def test_an_invalid_change_is_a_422(
    storage: Storage, auth: AuthKit, body: dict[str, Any], errors: dict[str, list[str]]
) -> None:
    async with open_env(storage, auth) as env:
        response = await env.patch(body)
        feed = await env.changes(0)
    assert response.status_code == 422
    assert response.json()["type"] == "urn:tim:problem:validation"
    assert response.json()["errors"] == errors
    assert feed["changes"] == []


@pytest.mark.parametrize(
    ("body", "errors"),
    [
        (
            {"ids": [], "label": "benign"},
            {"ids": ["List should have at least 1 item after validation, not 0"]},
        ),
        (
            {"ids": ["x" * 513], "label": "benign"},
            {"ids.0": ["String should have at most 512 characters"]},
        ),
    ],
)
async def test_a_malformed_change_is_a_400(
    storage: Storage, auth: AuthKit, body: dict[str, Any], errors: dict[str, list[str]]
) -> None:
    async with open_env(storage, auth) as env:
        response = await env.patch(body)
    assert response.status_code == 400
    assert response.json()["errors"] == errors


async def test_more_distinct_ids_than_max_annotation_ids_is_a_422(
    storage: Storage, auth: AuthKit, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("TIM_MAX_ANNOTATION_IDS", "3")
    async with open_env(storage, auth) as env:
        three = await env.patch({"ids": ["a", "b", "c", "a"], "label": "benign"})
        four = await env.patch({"ids": ["a", "b", "c", "d"], "label": "benign"})
    assert three.status_code == 200
    assert four.status_code == 422
    assert four.json()["errors"] == {"ids": ["At most 3 ids; 4 given"]}


async def test_the_labels_file_decides_the_keys(
    storage: Storage, auth: AuthKit, tmp_path: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    labels = tmp_path / "labels.yaml"
    labels.write_text("- key: tp\n  name: True positive\n  colour: red\n")
    monkeypatch.setenv("TIM_LABELS_FILE", str(labels))
    async with open_env(storage, auth) as env:
        configured = await env.patch({"ids": ["a"], "label": "tp"})
        default = await env.patch({"ids": ["a"], "label": "malicious"})
    assert configured.status_code == 200
    assert default.status_code == 422


async def test_the_feed_gives_each_id_changed_after_since_as_it_now_is(
    storage: Storage, auth: AuthKit
) -> None:
    async with open_env(storage, auth) as env:
        await env.label(["a", "b"], "malicious")
        await env.label(["c"], "benign")
        env.as_user(BOB, "oid-b")
        await env.label(["a"], "suspicious")
        everything = await env.changes(0)
        latest = await env.changes(2)
        none = await env.changes(3)
    assert [(label_of(c), c["version"]) for c in everything["changes"]] == [
        (("b", "malicious", ALICE), 1),
        (("c", "benign", ALICE), 2),
        (("a", "suspicious", BOB), 3),
    ]
    assert (everything["next"], everything["hasMore"]) == (3, False)
    assert [c["id"] for c in latest["changes"]] == ["a"]
    assert none == {"changes": [], "next": 3, "hasMore": False}


@pytest.mark.parametrize("params", [{}, {"since": -1}, {"since": "latest"}])
async def test_a_feed_request_without_a_version_to_start_after_is_a_400(
    storage: Storage, auth: AuthKit, params: dict[str, Any]
) -> None:
    async with open_env(storage, auth) as env:
        response = await env.client.get("/api/annotations/changes", params=params)
    assert response.status_code == 400
    assert list(response.json()["errors"]) == ["since"]


async def test_the_feed_pages_by_whole_changes(storage: Storage, auth: AuthKit) -> None:
    async with open_env(storage, auth) as env:
        for n in range(3):
            await env.label([f"v{n}-{i:03}" for i in range(600)], "benign")
        first = await env.changes(0)
        second = await env.changes(first["next"])
    assert (len(first["changes"]), first["next"], first["hasMore"]) == (1200, 2, True)
    assert (len(second["changes"]), second["next"], second["hasMore"]) == (600, 3, False)


async def test_concurrent_changes_take_gapless_versions_in_commit_order(
    storage: Storage, auth: AuthKit
) -> None:
    async with open_env(storage, auth) as env:
        bodies = await asyncio.gather(
            *(
                env.label([f"id-{n}", "shared"], "benign" if n % 2 else "malicious")
                for n in range(20)
            )
        )
        feed = await env.changes(0)
    versions = sorted(body["version"] for body in bodies)
    assert versions == list(range(1, 21))
    assert [c["version"] for c in feed["changes"]] == sorted(c["version"] for c in feed["changes"])
    # A change that gives "shared" the label it already has leaves it as it was.
    last = max(
        (body for body in bodies if any(c["id"] == "shared" for c in body["changes"])),
        key=lambda body: body["version"],
    )
    [shared] = [c for c in feed["changes"] if c["id"] == "shared"]
    assert shared == next(c for c in last["changes"] if c["id"] == "shared")


async def test_the_rows_carry_their_ids_annotations(storage: Storage, auth: AuthKit) -> None:
    sign_ins = Rows(
        key="acme.sign_ins",
        name="Sign-ins",
        pivot="none",
        id="CorrelationId",
        rows=(
            {"CorrelationId": "c-1", "User": "alice"},
            {"CorrelationId": "c-2", "User": "bob"},
            {"CorrelationId": "c-1", "User": "carol"},
            {"User": "no id"},
        ),
    )
    async with open_env(storage, auth, [sign_ins]) as env:
        await env.label(["c-1", "elsewhere"], "malicious")
        run = (
            await env.client.post("/api/runs", json={"action": "acme.sign_ins", "params": {}})
        ).json()
        async with asyncio.timeout(10):
            while run["status"] == "running":
                await asyncio.sleep(0.02)
                run = (await env.client.get(f"/api/runs/{run['runId']}")).json()
        page = (await env.client.get(f"/api/runs/{run['runId']}/rows")).json()
    assert page["annotationVersion"] == 1
    assert list(page["annotations"]) == ["c-1"]
    assert label_of(page["annotations"]["c-1"]) == ("c-1", "malicious", ALICE)


async def test_annotations_need_a_signed_in_analyst(storage: Storage, auth: AuthKit) -> None:
    async with open_env(storage, auth) as env:
        env.client.headers.pop("Authorization")
        patched = await env.patch({"ids": ["a"], "label": "benign"})
        feed = await env.client.get("/api/annotations/changes", params={"since": 0})
    assert (patched.status_code, feed.status_code) == (401, 401)
