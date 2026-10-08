# 0013. Tag ingestion runs as the app identity

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** the user
- **Related:** [0005](0005-auth-entra-popup-obo.md), [0011](0011-development-only-modes.md), [configuration](../configuration.md), [api](../api.md)

## Context
Saved events, tags and comments are written to tables on a separate Kusto cluster (`TIM_TAG_CLUSTER_URI`, database `TIM_TAG_DATABASE`). Users can read many clusters, but should not need write rights on the tag tables. Code: `api/src/tim_api/tagged_events/`.

## Decision
- **Writes use the app identity, not the user.** The ingest client authenticates with `DefaultAzureCredential` (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_CLIENT_SECRET`, or workload identity). These variables are deliberately not part of `Settings`. No OBO exchange is involved.
- **`createdBy` comes from the validated token** (`principal.name`), never from the request body.
- **Managed streaming ingestion.** The client is `ManagedStreamingIngestClient`, which streams and falls back to queued ingestion for larger payloads. Rows are sent as newline-delimited JSON with a named mapping reference. The ingest URL defaults to the cluster URL with an `ingest-` host prefix, or is set with `TIM_TAG_INGEST_URL`. The tag tables need the streaming ingestion policy so rows are queryable straight away.
- **Failures** become `TagIngestError`, returned as 502 "Tag ingestion failed". Only the exception type is logged, never row contents.
- The SDK client is created once and reused. Ingestion runs in a worker thread.
- A fake client (`TIM_TAG_INGEST_FAKE`) exists for development only ([0011](0011-development-only-modes.md)).

## Alternatives considered
| Option | Pros | Cons |
|---|---|---|
| Ingest as the user (OBO) | Kusto audit shows the real user | Every user needs ingest rights, and a second token exchange per write |
| Queued ingestion only | Simple, cheap | Rows appear after a delay, so a saved tag is not visible straight away |
| Streaming only | Immediate | Fails on large batches |

## Consequences
- Only the app identity needs ingest rights on the tag tables.
- The audit trail of who tagged what is the `createdBy` column, not Kusto's own ingestion log.
- Streaming ingestion must be enabled on the tag cluster.
