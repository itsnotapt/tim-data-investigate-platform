import json
import os
from types import SimpleNamespace
from typing import Any

import pytest
from azure.kusto.data.data_format import DataFormat
from fastapi import Request

from tim_api.config import Settings, get_settings
from tim_api.tagged_events import ingest as mod
from tim_api.tagged_events.ingest import (
    AzureTagIngestClient,
    FakeTagIngestClient,
    TagIngestError,
    derive_ingest_url,
    get_tag_ingest_client,
    serialize_ndjson,
)

ROWS: list[dict[str, Any]] = [
    {"eventId": "e1", "tag": "café ☃ \U0001f600"},
    {"eventId": "e2", "tag": 'quote " and \\ slash'},
]


class FakeSdk:
    def __init__(self, error: Exception | None = None) -> None:
        self.calls: list[tuple[Any, Any, bytes]] = []
        self.error = error

    def ingest_from_stream(self, descriptor: Any, props: Any) -> None:
        if self.error:
            raise self.error
        self.calls.append((descriptor, props, descriptor.stream.read()))


def client_with(sdk: FakeSdk) -> AzureTagIngestClient:
    c = AzureTagIngestClient("https://ingest-x.kusto.windows.net", "Research")
    c._client = sdk  # type: ignore[assignment]
    return c


async def test_ingest_properties_and_payload() -> None:
    sdk = FakeSdk()
    await client_with(sdk).ingest("EventTag", "EventTagMapping", ROWS)
    [(_, props, payload)] = sdk.calls
    assert props.database == "Research"
    assert props.table == "EventTag"
    assert props.ingestion_mapping_reference == "EventTagMapping"
    assert props.format == DataFormat.JSON
    assert payload == serialize_ndjson(ROWS)
    lines = payload.decode("utf-8").split("\n")
    assert lines[-1] == ""
    assert [json.loads(line) for line in lines[:-1]] == ROWS
    assert "café ☃".encode() in payload  # unicode is raw UTF-8, not escaped


async def test_sdk_error_becomes_tag_ingest_error(caplog: pytest.LogCaptureFixture) -> None:
    sdk = FakeSdk(RuntimeError("secret-row-content"))
    with pytest.raises(TagIngestError) as info:
        await client_with(sdk).ingest("EventTag", "EventTagMapping", ROWS)
    assert "secret-row-content" not in str(info.value)
    assert "café" not in caplog.text
    assert "secret-row-content" not in caplog.text


def test_sdk_client_built_once_with_token_credential(monkeypatch: pytest.MonkeyPatch) -> None:
    built: list[Any] = []

    class FakeManaged:
        def __init__(self, engine_kcsb: Any, dm_kcsb: Any) -> None:
            built.append((engine_kcsb, dm_kcsb))

    monkeypatch.setattr("azure.kusto.ingest.ManagedStreamingIngestClient", FakeManaged)
    monkeypatch.setattr("azure.identity.DefaultAzureCredential", lambda: object())
    c = AzureTagIngestClient("https://ingest-x.kusto.windows.net", "Research")
    assert c._sdk_client() is c._sdk_client()
    assert len(built) == 1
    engine, dm = built[0]
    assert engine.data_source == "https://x.kusto.windows.net"
    assert dm.data_source == "https://ingest-x.kusto.windows.net"


@pytest.mark.parametrize(
    ("cluster", "expected"),
    [
        ("https://c.westeurope.kusto.windows.net", "https://ingest-c.westeurope.kusto.windows.net"),
        ("https://c.kusto.windows.net/", "https://ingest-c.kusto.windows.net"),
        ("https://ingest-c.kusto.windows.net", "https://ingest-c.kusto.windows.net"),
    ],
)
def test_derive_ingest_url(cluster: str, expected: str) -> None:
    assert derive_ingest_url(cluster) == expected


def test_derive_ingest_url_requires_host() -> None:
    with pytest.raises(ValueError, match="host"):
        derive_ingest_url("https://")


def _request() -> Request:
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace()))  # type: ignore[return-value]


def _settings(monkeypatch: pytest.MonkeyPatch, **env: str) -> Settings:
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    get_settings.cache_clear()
    return get_settings()


def test_selects_azure_in_production_even_with_fake_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    mod._azure_client.cache_clear()
    s = _settings(monkeypatch, TIM_TAG_INGEST_FAKE="true")
    c = get_tag_ingest_client(_request(), s)
    assert isinstance(c, AzureTagIngestClient)
    assert c._ingest_url == "https://ingest-tags.westeurope.kusto.windows.net"
    assert c._engine_url == "https://tags.westeurope.kusto.windows.net"
    assert get_tag_ingest_client(_request(), s) is c  # cached per process


def test_selects_azure_in_development_without_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    mod._azure_client.cache_clear()
    s = _settings(
        monkeypatch,
        TIM_ENVIRONMENT="development",
        TIM_TAG_INGEST_URL="https://ingest-custom.kusto.windows.net",
        TIM_TAG_DATABASE="Db",
    )
    c = get_tag_ingest_client(_request(), s)
    assert isinstance(c, AzureTagIngestClient)
    assert c._ingest_url == "https://ingest-custom.kusto.windows.net"
    assert c._database == "Db"


def test_selects_fake_only_in_development_with_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    s = _settings(monkeypatch, TIM_ENVIRONMENT="development", TIM_TAG_INGEST_FAKE="true")
    req = _request()
    c = get_tag_ingest_client(req, s)
    assert isinstance(c, FakeTagIngestClient)
    assert get_tag_ingest_client(req, s) is c


@pytest.mark.kusto
@pytest.mark.skipif(
    not os.environ.get("TIM_TEST_KUSTO_INGEST_URL"),
    reason="TIM_TEST_KUSTO_INGEST_URL not set",
)
async def test_real_ingest_accepts_rows() -> None:
    """Queues one row (needs AZURE_* identity with ingestor rights and an existing table)."""
    c = AzureTagIngestClient(
        os.environ["TIM_TEST_KUSTO_INGEST_URL"],
        os.environ.get("TIM_TEST_KUSTO_DATABASE", "Research"),
    )
    table = os.environ.get("TIM_TEST_KUSTO_TABLE", "EventTag")
    await c.ingest(
        table,
        f"{table}Mapping",
        [
            {
                "eventId": "itest",
                "tag": "t",
                "createdBy": "itest",
                "dateTimeUtc": "2026-01-01T00:00:00Z",
            }
        ],
    )
