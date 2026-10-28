---
status: accepted
date: 2026-10-20
---

# Annotations in Postgres keyed by `id`, with a change feed

Tags lived in Kusto, written by an ingestion client as the app identity and read back by a KQL partial in every template, so a tag showed only after a rerun and only on actions that joined it in. An `id`'s annotations (one label, a set of tags and a comment thread) now live in Postgres, attached to rows when a result is read, and reach every open tab through a global change feed.

- **`id`.** A global, action-defined text key, so rows from different actions with the same `id` share annotations. TIM never makes up an `id`: no hashing of row values, which would make every row annotatable under an `id` that matches nothing else and changes whenever any value does. Rows without one can't be annotated.
- **What's kept.** Labels come from instance configuration (a labels file) and keep their history, and each analyst's comment keeps every version ([0023](0023-one-comment-per-analyst.md)). Tags are free text and are purged when removed: tags keep no history.
- **Tables.** `id_state`, `label_changes`, `tags`, `comments`, and `annotation_clock`, a single-row version counter.
- **The change feed.** `GET /api/annotations/changes?since=V` returns the current state of each `id` changed after `V`. The version comes from `UPDATE annotation_clock SET version = version + 1 RETURNING version`, taken first in every annotation transaction. Its row lock serialises writers, so versions are gapless and in commit order. Browsers poll every 30 s, with one poller per browser elected through Web Locks, and keep annotations in their own IndexedDB store, never in the cached rows.
- **Saved events are sinks**: actions that take the selected rows and write them somewhere. The annotation model has no snapshot of a row, and TIM ships no sinks.

Decided by the user. Related: [0004](0004-postgresql-persistence.md), [0017](0017-actions-from-providers.md), [architecture](../architecture.md), [api](../api.md).

## Considered Options

| Option | Pros | Cons |
|---|---|---|
| Tags in Kusto via ingestion | Joinable in KQL | Ingestion latency; app identity; only actions that join tags show them; no Snowflake |
| A sequence or `now()` as the feed cursor | No lock | A lower value can commit after a reader has passed a higher one, and that change is skipped for good |
| `xid8` with `pg_snapshot_xmin` | Lock-free and correct | Any long write in the cluster (a big `run_rows` insert) stalls the feed |
| Server-kept xor / binary fuse / Bloom filters of tagged `id`s | Small downloads | Static (rebuilt on every change); "maybe tagged", not "changed since"; ~3,900 false positives per 1M-row tab; no Python/JS format that interoperates |
| Sending each tab's `id`s on every poll | Exact | 39 MB of JSON per 1M-row tab per poll, over the request cap |
| Push (SSE) as the source of truth | ~1 s latency | Needs a `LISTEN` connection per replica and a `fetch` stream per browser; kept as an optional later poke over the feed |
| Hashing row values as a fallback `id` | Every row annotatable | Matches nothing else; changes when any value changes |

## Consequences

- Annotation writes are serialised instance-wide, which is fine for human-generated changes.
- An `id` whose annotations are all removed keeps its `id_state` row, so the removal reaches other browsers.
- Annotations are instance-wide: restricting a connection later wouldn't hide comments on its `id`s.
