import json
import re
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from tim_api.auth import Principal, get_current_principal
from tim_api.main import create_app
from tim_api.tagged_events import kusto_schema as ks
from tim_api.tagged_events.cli import main
from tim_api.tagged_events.ingest import FakeTagIngestClient, get_tag_ingest_client

GOLDEN = [
    ".create-merge table SavedEvent (EventId:string, EventTime:datetime, "
    "DateTimeUtc:datetime, CreatedBy:string, EventAsJson:dynamic)",
    ".create-merge table EventTag (EventId:string, DateTimeUtc:datetime, "
    "CreatedBy:string, Tag:string, IsDeleted:bool)",
    ".create-merge table EventComment (EventId:string, DateTimeUtc:datetime, "
    "CreatedBy:string, Comment:string, Determination:string, IsDeleted:bool)",
    '.create-or-alter table SavedEvent ingestion json mapping "SavedEventMapping" '
    """'[{"column":"EventId","path":"$.eventId","datatype":"string"},"""
    """{"column":"EventTime","path":"$.eventTime","datatype":"datetime"},"""
    """{"column":"DateTimeUtc","path":"$.dateTimeUtc","datatype":"datetime"},"""
    """{"column":"CreatedBy","path":"$.createdBy","datatype":"string"},"""
    """{"column":"EventAsJson","path":"$.eventAsJson","datatype":"dynamic"}]'""",
    '.create-or-alter table EventTag ingestion json mapping "EventTagMapping" '
    """'[{"column":"EventId","path":"$.eventId","datatype":"string"},"""
    """{"column":"DateTimeUtc","path":"$.dateTimeUtc","datatype":"datetime"},"""
    """{"column":"CreatedBy","path":"$.createdBy","datatype":"string"},"""
    """{"column":"Tag","path":"$.tag","datatype":"string"},"""
    """{"column":"IsDeleted","path":"$.isDeleted","datatype":"bool"}]'""",
    '.create-or-alter table EventComment ingestion json mapping "EventCommentMapping" '
    """'[{"column":"EventId","path":"$.eventId","datatype":"string"},"""
    """{"column":"DateTimeUtc","path":"$.dateTimeUtc","datatype":"datetime"},"""
    """{"column":"CreatedBy","path":"$.createdBy","datatype":"string"},"""
    """{"column":"Comment","path":"$.comment","datatype":"string"},"""
    """{"column":"Determination","path":"$.determination","datatype":"string"},"""
    """{"column":"IsDeleted","path":"$.isDeleted","datatype":"bool"}]'""",
    ".alter table SavedEvent policy streamingingestion enable",
    ".alter table EventTag policy streamingingestion enable",
    ".alter table EventComment policy streamingingestion enable",
]


class FakeKusto:
    def __init__(self, fail_on: int | None = None) -> None:
        self.calls: list[tuple[str, str]] = []
        self.fail_on = fail_on
        self.closed = False

    def execute_mgmt(self, database: str, command: str) -> None:
        if self.fail_on is not None and len(self.calls) == self.fail_on:
            raise RuntimeError("Forbidden: not admin")
        self.calls.append((database, command))

    def close(self) -> None:
        self.closed = True


def test_golden_commands() -> None:
    assert ks.all_commands() == GOLDEN


def test_columns_match_backend_api_doc() -> None:
    doc = (Path(__file__).parents[2] / "docs/current-system/backend-api.md").read_text("utf-8")
    section = doc.split("## Kusto tables", 1)[1].split("\n---", 1)[0]
    for spec in ks.TABLES:
        row = re.search(rf"\| `{spec.name}` \| (.+?) \|", section)
        assert row is not None
        assert row.group(1) == ", ".join(f"{c.name}:{c.kusto_type}" for c in spec.columns)


def test_idempotent_verbs() -> None:
    for command in ks.all_commands():
        assert command.startswith((".create-merge table", ".create-or-alter table", ".alter table"))
        assert ".create table" not in command
        assert ".create ingestion" not in command


def test_mapping_escaping() -> None:
    quoted = ks._kql_single_quoted("a'b\\c")
    assert quoted == "'a\\'b\\\\c'"
    for spec in ks.TABLES:
        assert json.loads(ks.mapping_json(spec))


PRINCIPAL = Principal(oid="o", name="alice@example.com", tenant_id="t", token=SecretStr("x"))


def test_router_row_keys_in_mapping() -> None:
    fake = FakeTagIngestClient()
    app = create_app()
    app.dependency_overrides[get_current_principal] = lambda: PRINCIPAL
    app.dependency_overrides[get_tag_ingest_client] = lambda: fake
    bodies: dict[str, list[dict[str, Any]]] = {
        "savedEvents": [{"eventId": "e", "eventTime": "2026-01-01T00:00:00Z", "eventAsJson": {}}],
        "tags": [{"eventId": "e", "tag": "t"}],
        "comments": [{"eventId": "e", "comment": "c", "determination": "d"}],
    }
    with TestClient(app) as c:
        for path, body in bodies.items():
            assert c.post(f"/api/taggedevents/{path}", json=body).status_code == 204
    assert len(fake.calls) == 3
    for table, mapping, rows in fake.calls:
        spec = next(t for t in ks.TABLES if t.name == table)
        assert mapping == spec.mapping_name
        paths = {e["path"] for e in json.loads(ks.mapping_json(spec))}
        assert {f"$.{k}" for k in rows[0]} == paths


def test_dry_run(capsys: pytest.CaptureFixture[str]) -> None:
    def boom(_: str) -> Any:
        raise AssertionError("no client in dry run")

    assert main(["create-tables", "--dry-run"], client_factory=boom) == 0
    assert capsys.readouterr().out.splitlines() == GOLDEN


def test_runs_all_commands(capsys: pytest.CaptureFixture[str]) -> None:
    fake = FakeKusto()
    urls: list[str] = []

    def factory(url: str) -> FakeKusto:
        urls.append(url)
        return fake

    rc = main(
        ["create-tables", "--cluster-uri", "https://c.kusto.windows.net/", "--database", "D"],
        client_factory=factory,
    )
    assert rc == 0
    assert urls == ["https://c.kusto.windows.net"]
    assert fake.calls == [("D", c) for c in GOLDEN]
    assert fake.closed
    assert "done: 9" in capsys.readouterr().out


def test_failure_exits_nonzero(capsys: pytest.CaptureFixture[str]) -> None:
    fake = FakeKusto(fail_on=1)
    rc = main(
        ["create-tables", "--cluster-uri", "https://c"],
        client_factory=lambda _: fake,
    )
    assert rc == 1
    assert len(fake.calls) == 1  # stopped at first failure
    assert fake.closed
    err = capsys.readouterr().err
    assert "Forbidden: not admin" in err
    assert "EventTag" in err


def test_missing_cluster(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.delenv("TIM_TAG_CLUSTER_URI", raising=False)
    assert main(["create-tables"], client_factory=lambda _: FakeKusto()) == 2
    assert "TIM_TAG_CLUSTER_URI" in capsys.readouterr().err
