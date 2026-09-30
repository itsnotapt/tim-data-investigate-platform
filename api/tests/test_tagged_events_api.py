from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from tim_api.auth import Principal, get_current_principal
from tim_api.main import create_app
from tim_api.tagged_events.ingest import (
    FakeTagIngestClient,
    TagIngestError,
    get_tag_ingest_client,
)

PRINCIPAL = Principal(oid="oid-1", name="alice@example.com", tenant_id="t", token=SecretStr("x"))
ISO = r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{3})?Z$"


@pytest.fixture
def fake() -> FakeTagIngestClient:
    return FakeTagIngestClient()


@pytest.fixture
def client(fake: FakeTagIngestClient) -> Iterator[TestClient]:
    app = create_app()
    app.dependency_overrides[get_current_principal] = lambda: PRINCIPAL
    app.dependency_overrides[get_tag_ingest_client] = lambda: fake
    with TestClient(app) as c:
        yield c


def test_saved_events(client: TestClient, fake: FakeTagIngestClient) -> None:
    body = [
        {"eventId": "e1", "eventTime": "2026-01-02T03:04:05+01:00", "eventAsJson": {"a": 1}},
    ]
    r = client.post("/api/taggedevents/savedEvents", json=body)
    assert r.status_code == 204
    assert r.content == b""
    [(table, mapping, rows)] = fake.calls
    assert (table, mapping) == ("SavedEvent", "SavedEventMapping")
    assert list(rows[0]) == ["eventId", "eventTime", "dateTimeUtc", "createdBy", "eventAsJson"]
    assert rows[0]["eventId"] == "e1"
    assert rows[0]["eventTime"] == "2026-01-02T02:04:05Z"
    assert rows[0]["createdBy"] == "alice@example.com"
    assert rows[0]["eventAsJson"] == {"a": 1}
    assert rows[0]["dateTimeUtc"].endswith("Z")


def test_tags(client: TestClient, fake: FakeTagIngestClient) -> None:
    r = client.post(
        "/api/taggedevents/tags",
        json=[{"eventId": "e1", "tag": "t"}, {"eventId": "e2", "tag": "u", "isDeleted": True}],
    )
    assert r.status_code == 204
    [(table, mapping, rows)] = fake.calls
    assert (table, mapping) == ("EventTag", "EventTagMapping")
    assert [list(x) for x in rows] == [
        ["eventId", "dateTimeUtc", "createdBy", "tag", "isDeleted"]
    ] * 2
    assert [x["isDeleted"] for x in rows] == [False, True]
    assert rows[0]["dateTimeUtc"] == rows[1]["dateTimeUtc"]


def test_comments(client: TestClient, fake: FakeTagIngestClient) -> None:
    r = client.post(
        "/api/taggedevents/comments",
        json=[{"eventId": "e1", "determination": "malicious", "comment": "hi"}],
    )
    assert r.status_code == 204
    [(table, mapping, rows)] = fake.calls
    assert (table, mapping) == ("EventComment", "EventCommentMapping")
    assert list(rows[0]) == [
        "eventId",
        "dateTimeUtc",
        "createdBy",
        "comment",
        "determination",
        "isDeleted",
    ]
    assert rows[0]["comment"] == "hi"
    assert rows[0]["determination"] == "malicious"


def test_client_supplied_identity_ignored(client: TestClient, fake: FakeTagIngestClient) -> None:
    client.post(
        "/api/taggedevents/tags",
        json=[
            {
                "eventId": "e1",
                "tag": "t",
                "createdBy": "mallory",
                "dateTimeUtc": "1999-01-01T00:00:00Z",
            }
        ],
    )
    row: dict[str, Any] = fake.calls[0][2][0]
    assert row["createdBy"] == "alice@example.com"
    assert row["dateTimeUtc"] != "1999-01-01T00:00:00Z"


@pytest.mark.parametrize("path", ["savedEvents", "tags", "comments"])
def test_empty_array_400(client: TestClient, fake: FakeTagIngestClient, path: str) -> None:
    r = client.post(f"/api/taggedevents/{path}", json=[])
    assert r.status_code == 400
    assert r.headers["content-type"].startswith("application/problem+json")
    assert fake.calls == []


def test_too_many_items_400(client: TestClient, fake: FakeTagIngestClient) -> None:
    r = client.post("/api/taggedevents/tags", json=[{"eventId": "e", "tag": "t"}] * 1001)
    assert r.status_code == 400
    assert fake.calls == []


def test_all_or_nothing_invalid_item(client: TestClient, fake: FakeTagIngestClient) -> None:
    r = client.post("/api/taggedevents/tags", json=[{"eventId": "e", "tag": "t"}, {"eventId": "e"}])
    assert r.status_code == 400
    assert "1.tag" in r.json()["errors"]
    assert fake.calls == []


def test_unauthenticated_401(fake: FakeTagIngestClient) -> None:
    app = create_app()
    app.dependency_overrides[get_tag_ingest_client] = lambda: fake
    with TestClient(app) as c:
        r = c.post("/api/taggedevents/tags", json=[{"eventId": "e", "tag": "t"}])
    assert r.status_code == 401
    assert fake.calls == []


def test_ingest_failure_502() -> None:
    fake = FakeTagIngestClient(error=TagIngestError("boom secret"))
    app = create_app()
    app.dependency_overrides[get_current_principal] = lambda: PRINCIPAL
    app.dependency_overrides[get_tag_ingest_client] = lambda: fake
    with TestClient(app) as c:
        r = c.post("/api/taggedevents/tags", json=[{"eventId": "e", "tag": "t"}])
    assert r.status_code == 502
    assert r.headers["content-type"].startswith("application/problem+json")
    body = r.json()
    assert body["status"] == 502
    assert body["type"] == "urn:tim:problem:upstream"
    assert "secret" not in r.text


def test_default_client_fake_in_development(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TIM_ENVIRONMENT", "development")
    monkeypatch.setenv("TIM_TAG_INGEST_FAKE", "true")
    app = create_app()
    app.dependency_overrides[get_current_principal] = lambda: PRINCIPAL
    with TestClient(app) as c:
        r = c.post("/api/taggedevents/tags", json=[{"eventId": "e", "tag": "t"}])
        assert r.status_code == 204
        assert (
            c.post("/api/taggedevents/tags", json=[{"eventId": "e", "tag": "t"}]).status_code == 204
        )
    assert len(app.state.tag_ingest_client.calls) == 2
