"""Tag ingestion client (api-contract 3.11-3.13).

:class:`AzureTagIngestClient` does managed streaming ingestion (streaming, falling back to
queued) with ``azure-kusto-ingest`` under the app identity (Q-020, ``DefaultAzureCredential``
via ``AZURE_*``). Like legacy direct ingest (backend/Tim.Backend/Startup/ServiceExtensions.cs:350,
Providers/Kusto/KustoIngestClient.cs:49-64) it sends NDJSON with a JSON mapping reference, so rows
are queryable right away; the tag tables need the streaming ingestion policy (P2-14).
:class:`FakeTagIngestClient` is for tests and explicit local development
(``TIM_TAG_INGEST_FAKE=true``).
"""

from __future__ import annotations

import asyncio
import json
import logging
from functools import lru_cache
from io import BytesIO
from typing import TYPE_CHECKING, Annotated, Any, Protocol
from urllib.parse import urlparse

from fastapi import Depends, Request

from tim_api.config import Settings, get_settings

if TYPE_CHECKING:
    from azure.kusto.ingest import ManagedStreamingIngestClient

logger = logging.getLogger(__name__)


class TagIngestError(Exception):
    """Ingestion into the tag cluster failed (mapped to 502)."""


class TagIngestClient(Protocol):
    async def ingest(self, table: str, mapping: str, rows: list[dict[str, Any]]) -> None:
        """Append ``rows`` (JSON objects keyed by mapping path) to ``table``.

        Raises :class:`TagIngestError` on failure.
        """
        ...


class FakeTagIngestClient:
    """Records calls instead of ingesting; for tests and local development."""

    def __init__(self, error: Exception | None = None) -> None:
        self.calls: list[tuple[str, str, list[dict[str, Any]]]] = []
        self.error = error

    async def ingest(self, table: str, mapping: str, rows: list[dict[str, Any]]) -> None:
        if self.error is not None:
            raise self.error
        self.calls.append((table, mapping, rows))


def derive_ingest_url(cluster_uri: str) -> str:
    """``https://<host>`` -> ``https://ingest-<host>`` (the Kusto ingestion endpoint convention)."""
    parsed = urlparse(cluster_uri)
    host = parsed.netloc
    if not host:
        raise ValueError("cluster URI has no host")
    if host.lower().startswith("ingest-"):
        return f"{parsed.scheme}://{host}"
    return f"{parsed.scheme}://ingest-{host}"


def serialize_ndjson(rows: list[dict[str, Any]]) -> bytes:
    """One UTF-8 JSON object per line (unicode kept as-is, not \\u-escaped)."""
    return "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows).encode("utf-8")


class AzureTagIngestClient:
    """Queued ingestion into the tag cluster. The SDK client is created lazily, once."""

    def __init__(self, ingest_url: str, database: str, engine_url: str | None = None) -> None:
        self._ingest_url = ingest_url
        self._engine_url = engine_url or ingest_url.replace("//ingest-", "//", 1)
        self._database = database
        self._client: ManagedStreamingIngestClient | None = None

    def _sdk_client(self) -> ManagedStreamingIngestClient:
        if self._client is None:
            from azure.identity import DefaultAzureCredential
            from azure.kusto.data import KustoConnectionStringBuilder
            from azure.kusto.ingest import ManagedStreamingIngestClient

            credential = DefaultAzureCredential()
            engine_kcsb = KustoConnectionStringBuilder.with_azure_token_credential(
                self._engine_url, credential
            )
            dm_kcsb = KustoConnectionStringBuilder.with_azure_token_credential(
                self._ingest_url, credential
            )
            self._client = ManagedStreamingIngestClient(engine_kcsb, dm_kcsb)
        return self._client

    def _ingest_sync(self, table: str, mapping: str, payload: bytes) -> None:
        from azure.kusto.data.data_format import DataFormat
        from azure.kusto.ingest import IngestionProperties, StreamDescriptor

        props = IngestionProperties(
            database=self._database,
            table=table,
            data_format=DataFormat.JSON,  # newline-delimited JSON
            ingestion_mapping_reference=mapping,
        )
        self._sdk_client().ingest_from_stream(StreamDescriptor(BytesIO(payload)), props)

    async def ingest(self, table: str, mapping: str, rows: list[dict[str, Any]]) -> None:
        payload = serialize_ndjson(rows)
        try:
            await asyncio.to_thread(self._ingest_sync, table, mapping, payload)
        except Exception as exc:
            # Never log or chain row contents; the SDK message may echo request details.
            logger.error(
                "tag ingestion failed table=%s rows=%d error=%s",
                table,
                len(rows),
                type(exc).__name__,
            )
            raise TagIngestError(f"Ingestion into {table} failed ({type(exc).__name__})") from None


@lru_cache
def _azure_client(engine_url: str, ingest_url: str, database: str) -> AzureTagIngestClient:
    return AzureTagIngestClient(ingest_url, database, engine_url)


def get_tag_ingest_client(
    request: Request, settings: Annotated[Settings, Depends(get_settings)]
) -> TagIngestClient:
    """Azure client whenever a tag cluster is configured; fake only with the explicit dev flag."""
    if settings.environment == "development" and settings.tag_ingest_fake:
        client: TagIngestClient | None = getattr(request.app.state, "tag_ingest_client", None)
        if client is None:
            client = FakeTagIngestClient()
            request.app.state.tag_ingest_client = client
        return client
    url = settings.tag_ingest_url or derive_ingest_url(settings.tag_cluster_uri)
    return _azure_client(settings.tag_cluster_uri.rstrip("/"), url, settings.tag_database)
