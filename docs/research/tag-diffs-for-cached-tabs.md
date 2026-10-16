# Tag diffs for cached tabs: keeping 1M-row IndexedDB tabs in sync with PostgreSQL tags

Research for [#76](https://github.com/itsnotapt/tim-data-investigate-platform/issues/76) (map [#65](https://github.com/itsnotapt/tim-data-investigate-platform/issues/65), generic actions), feeding [Postgres tag model (#73)](https://github.com/itsnotapt/tim-data-investigate-platform/issues/73).
Versions checked: PostgreSQL 18 docs (experiments ran on PostgreSQL 16.2 from the repo's `pgserver` dev dependency), FastAPI 0.142.2 and asyncpg 0.32.0 (`api/uv.lock`), `pyfusefilter` 1.3.0, `@expo/binary-fuse-filter` 1.0.0, `binary-fuse-filter` 1.0.0, `bloom-filters` 3.0.4, Node 24.21.
Date: 2026-10-16.

## Question

Analyst A tags `id=1` in result set 1. Analyst B has an unrelated result set 2 that also contains `id=1`, cached in their browser's IndexedDB. How does B see the tag (and comments and determinations) within a few minutes, or faster, without re-running? Tabs hold up to ~1M rows, an analyst may have many tabs, `id` is global across actions, tags live in PostgreSQL with full history, and the API runs as several FastAPI replicas behind a load balancer.

## Sources

- [PGSEQ] PostgreSQL docs, Sequence Manipulation Functions: https://www.postgresql.org/docs/current/functions-sequence.html
- [PGINFO] PostgreSQL docs, System Information Functions (§9.27, transaction ID and snapshot functions, Tables 9.84 and 9.85): https://www.postgresql.org/docs/current/functions-info.html
- [PGOID] PostgreSQL docs, Object Identifier Types (`xid8`): https://www.postgresql.org/docs/current/datatype-oid.html
- [PGTIME] PostgreSQL docs, Date/Time Functions (current date/time): https://www.postgresql.org/docs/current/functions-datetime.html
- [PGLOCK] PostgreSQL docs, Explicit Locking (row-level locks): https://www.postgresql.org/docs/current/explicit-locking.html
- [PGNOTIFY] PostgreSQL docs, NOTIFY: https://www.postgresql.org/docs/current/sql-notify.html
- [PGB] PgBouncer features (SQL feature map for pooling modes): https://www.pgbouncer.org/features.html
- [APG] asyncpg API reference (`Connection.add_listener`, pool release): https://magicstack.github.io/asyncpg/current/api/index.html
- [BF] Graf and Lemire, "Binary Fuse Filters: Fast and Smaller Than Xor Filters", ACM JEA 27 (2022), arXiv:2201.01174: https://arxiv.org/abs/2201.01174
- [XSH] FastFilter/xor_singleheader (C reference, README and `include/binaryfusefilter.h`): https://github.com/FastFilter/xor_singleheader
- [PYFF] FastFilter/pyfusefilter (README and `pyfusefilter/pyfusefilter.py`): https://github.com/FastFilter/pyfusefilter
- [EXPO] `@expo/binary-fuse-filter` 1.0.0 npm tarball (`build/hash.js`, `build/serialize.js`, README)
- [BFFJS] `binary-fuse-filter` 1.0.0 npm README: https://www.npmjs.com/package/binary-fuse-filter
- [BLOOMJS] `bloom-filters` 3.0.4 npm README: https://www.npmjs.com/package/bloom-filters
- [SSE] WHATWG HTML Living Standard, Server-sent events (§9.2): https://html.spec.whatwg.org/multipage/server-sent-events.html
- [MDNES] MDN, EventSource: https://developer.mozilla.org/en-US/docs/Web/API/EventSource
- [FASSE] FastAPI docs, Server-Sent Events: https://fastapi.tiangolo.com/tutorial/server-sent-events/
- [NGX] nginx, `ngx_http_proxy_module` (`proxy_buffering`, `proxy_read_timeout`): https://nginx.org/en/docs/http/ngx_http_proxy_module.html
- [LOCKS] MDN, Web Locks API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API
- [THR] Chrome for Developers, "Heavy throttling of chained JS timers beginning in Chrome 88": https://developer.chrome.com/blog/timer-throttling-in-chrome-88
- [QUOTA] MDN, Storage quotas and eviction criteria: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- [IDBPUT] MDN, `IDBObjectStore.put()`: https://developer.mozilla.org/en-US/docs/Web/API/IDBObjectStore/put
- [AGTX] AG Grid docs, Transaction Updates: https://www.ag-grid.com/react-data-grid/data-update-transactions/
- [TIM] This repo at `main` (611d331): `web/src/lib/storage/db.ts`, `web/src/lib/api/client.ts`, `web/src/features/grid/gridOptions.ts`, `web/docker/nginx.conf.template`, `docs/deployment.md`, `api/pyproject.toml`
- [EXP] Experiments run for this note (scripts not committed): a Postgres cursor demo with asyncpg against `pgserver` (PostgreSQL 16.2), payload-size arithmetic in Python, and JS memory and filter timings in Node 24 with `@expo/binary-fuse-filter`

## Answer in brief

- **The diff should be a global change feed, not a per-tab question.** Tag activity is human-generated and small (hundreds of changes per few minutes at most); tabs are large (1M `id`s). So the cheap direction is "server sends every change since my cursor, browser keeps the ones it cares about", not "browser tells server which 1M `id`s it has". At 1M GUID `id`s a tab's id list is 39 MB of JSON (22 MB gzipped) per tab per poll [EXP], above TIM's 16 MiB request cap [TIM `docs/architecture.md`]. A typical poll of the feed returns zero to a few hundred entries of ~190 bytes each [EXP].
- **The cursor must be commit-ordered.** A sequence or identity column is not: a transaction can take a lower value and commit after a reader has passed a higher one, and that change is skipped for good (reproduced in [EXP]; sequences are non-transactional per [PGSEQ]). `now()` is the transaction *start* time [PGTIME], so timestamps have the same hole. Two safe cursors work: (a) **a single-row version counter** updated inside each tagging transaction, whose row lock serialises tag writers so version order equals commit order (gapless, verified in [EXP]); (b) an **`xid8` + snapshot-`xmin`** cursor [PGINFO] (verified in [EXP]), which is lock-free but stalls behind any long write transaction in the cluster, such as a 1M-row `run_rows` insert. **Recommend (a).**
- **Server-kept xor / binary fuse / Bloom filters of tagged `id`s don't fit.** They are static (a rebuild on every tag change), say only "maybe tagged", not "changed since T", give ~3,900 false positives per 1M-row tab at 8 bits [XSH; EXP], and the Python and JS libraries don't share a key hash or a serialized format [PYFF; EXPO; BFFJS; BLOOMJS]. Filters belong in the browser, if anywhere: a filter of a cached tab's immutable `id` set (1.13 MB per 1M `id`s, ~0.7 s to build in JS [EXP]) is a cheap membership test for closed tabs.
- **Poll first; push later as an optional "poke".** One poll per browser (not per tab), elected with Web Locks [LOCKS], every ~30 s is an indexed range scan that usually returns nothing. That gives ≤30 s latency (≤~60 s in a long-hidden tab [THR]), well inside "a few minutes". Push over SSE with `LISTEN/NOTIFY` fan-out works across replicas without sticky sessions, but `EventSource` cannot send TIM's bearer token [SSE §9.2.2; MDNES; TIM `client.ts`]. It also needs a dedicated LISTEN connection per replica [APG; PGB], proxy timeouts and keep-alives [NGX; FASSE], and stream restarts when tokens expire. It only cuts latency from ~30 s to ~1 s; correctness still comes from the cursor feed.
- **IndexedDB:** keep tags out of `row_results` (that store holds one array value per tab, so a tag edit would rewrite the whole 1M-row value [TIM `db.ts`; IDBPUT]). Add a `tag_state` store keyed by `id` (current tags, determination, comment, `version`, deletions kept as tombstones) and a `tag_sync` record holding the global cursor. Optionally add a per-tab fuse filter for pruning. Details in §6.

## 1. Sizes the comparison rests on

Measured or computed in [EXP] for 1,000,000 `id`s:

| What | Size / cost |
|---|---|
| `id` list as JSON, GUID strings | 39.0 MB, 21.9 MB gzip (level 5, as nginx `gzip_comp_level 5` [TIM nginx]) |
| `id` list as JSON, 64-bit integers | 19.9 MB, 9.6 MB gzip |
| `id` list as JSON, SHA-256 hex (the hash-every-value fallback) | 67.0 MB, 38.0 MB gzip |
| Binary fuse8 filter | 1.13 MB (9.04 bits/key [XSH]; 1,130,536 bytes [PYFF]); FP 1/256, ~3,900 per 1M probes (measured 3,896) |
| Binary fuse16 filter | ~2.25 MB; FP ~1/65,536, ~15 per 1M probes [XSH; PYFF] |
| Xor8 filter | 1.23 MB (1,230,054 bytes [PYFF]); xor is within 23% of the space lower bound, binary fuse within 13% [BF] |
| Bloom filter, optimal | 1.20 MB at 1% FP (k=7); 1.80 MB at 0.1% |
| Sorted array of 32-bit hashes (no library) | 4.0 MB, FP ≈ 2.3×10⁻⁴ per probe |
| JS: 1M GUID strings in memory | ~66 MB, plus ~21 MB for a `Set` over them (Node 24, V8) |
| JS: build `@expo/binary-fuse-filter` fuse8 over 1M strings | ~0.7 s; 1M probes ~0.4 s |
| C: build binary fuse over 10M keys | ~0.36 s, ~24 bytes temporary memory per key [XSH] |
| One change-feed entry (id, tags, determination, comment, who, when, version) | ~190 bytes of JSON; 100 changes ≈ 19 kB; 150k changes (a month at 5k/day) ≈ 28 MB |

Assumed tag-table sizes: 10k to 1M distinct tagged `id`s and 1k to 10k tag changes a day for one TIM instance. Analysts produce tags by hand, so the change rate is small compared with result sizes.

## 2. Server-kept filters of tagged `id`s (xor / binary fuse / Bloom / ribbon)

**Idea.** The server keeps a filter of all tagged `id`s (or of `id`s changed per time bucket). The browser downloads it, tests its 1M `id`s locally, and fetches tag state only for hits.

**Properties of the filters.**

- Xor and binary fuse filters are *static*: built once from a complete key set; adding a key means rebuilding [XSH; BF]. A Bloom filter accepts inserts but not deletions. Untagging is a change B must see, so a Bloom filter of "tagged" ids still needs rebuilding. Ribbon filters are static too (`@pacote/ribbon-filter` describes itself as a "static approximate membership filter").
- Keys must first be hashed to 64-bit integers with an agreed function, and "collisions should be unlikely (~1/2^64)" [XSH; BFFJS].
- Rebuild cost: building is cheap in C (~0.36 s for 10M keys [XSH]). The real costs are reading every tagged `id` from PostgreSQL on each change, Python-side hashing (`pyfusefilter` hashes each key in Python with `xxhash.xxh64_intdigest(str(item))` [PYFF `pyfusefilter.py` line 6-7]), and keeping each replica's copy current.

**Why it doesn't fit the question.**

1. *It answers the wrong question.* A filter of tagged `id`s says "this `id` may have tags", not "this `id`'s tags changed since you last looked". To get diffs the server must keep filters per time bucket ("ids changed in bucket k") and the browser must download every bucket since its cursor. That is a lossy copy of the change feed in §3, and the feed itself is already small (19 kB per 100 changes).
2. *False positives cost a request per poll per tab.* At 8 bits, ~3,900 of a tab's 1M `id`s test positive by chance [EXP]; those must be confirmed against the server, about 150 kB of `id`s uploaded per tab per refresh. Fuse16 cuts this to ~15 but doubles the filter to ~2.25 MB, re-downloaded whenever it changes.
3. *Every refresh re-tests the whole tab.* 1M probes is ~0.4 s of JS per tab per refresh [EXP]. That is tolerable for one tab, wasteful across many tabs every 30 s, when the feed lets the browser test only the changed `id`s.
4. *Python and JS don't interoperate out of the box.*
   - `pyfusefilter` (Python, C via CFFI) hashes keys as xxHash64 of `str(key)`. It serializes with the C library's `binary_fuse8_serialize`: a 28-byte header (`Seed` u64, `Size`, `SegmentLength`, `SegmentCount`, `SegmentCountLength`, `ArrayLength` as u32) then the fingerprints, in **native byte order only** [PYFF `pyfusefilter.py`; XSH `binaryfusefilter.h` 773-816].
   - `@expo/binary-fuse-filter` (pure JS, a port of the C library) hashes strings with **FNV-1a over UTF-16 code units** then a murmur finaliser. It serializes to its own versioned little-endian header (version, fingerprint bits, padding, seed as two u32, size, segment length, segment count, array length), with no `SegmentCountLength` [EXPO `hash.js`, `serialize.js`]. It has ~375 downloads a month.
   - `binary-fuse-filter` (JS, port of the Go library) takes `bigint`/number keys only and serializes to JSON [BFFJS]. It has ~45 downloads a month.
   - `bloom-filters` (JS, ~2.3M downloads a month) has `BloomFilter` and `XorFilter`, hashing with seeded `xxhashjs` h64 and exporting to its own JSON [BLOOMJS].
   - The C README lists no JavaScript port [XSH].
   - Using a server-built filter in the browser therefore means fixing a 64-bit key hash in both languages, passing pre-hashed integers (not possible with `pyfusefilter`, which re-hashes `str(key)`), and writing a format adapter, with golden-vector tests on both sides.

**Where a filter does help: in the browser, over a tab's own `id`s.** A cached tab's `id` set never changes once the run succeeded, which suits a static filter. The browser builds and reads it, so cross-language compatibility does not matter. At 1.13 MB per 1M `id`s (fuse8) or 4 MB (sorted 32-bit hashes, no dependency), it lets the browser ask "could closed tab X contain `id` 1?" without loading X's 1M-row array (87 MB of strings and a `Set` [EXP]). A false positive only keeps an unneeded `tag_state` entry. See §6.

## 3. A `since` cursor: "tag changes after version V"

**Shape.** `GET /api/tags/changes?since=V&limit=N` returns, for each `id` whose tags, determination or comment changed after `V`, its **current** state (not the delta), plus `next` (the new cursor) and `hasMore`. Returning current state makes applying the feed idempotent and independent of order: re-delivery is harmless and the newest poll always wins. Tag history is kept in full, so the feed can answer from any old cursor.

**Intersection: browser, not server.** The feed is global: every browser receives every change. With the assumed rates a poll is usually empty, a busy poll is tens of kB, and a browser offline for a month catches up with ~28 MB in pages. The browser decides which entries matter (§6). Intersecting on the server would need the tab's `id`s (§4). The server could join against `run_rows` instead, but those rows exist only for 24 h and are lost on a crash (`UNLOGGED`) ([Large results](https://github.com/itsnotapt/tim-data-investigate-platform/issues/72)), and cached tabs outlive both.

**The cursor must follow commit order, not assignment order.**

- *Sequence / identity column: unsafe.* `nextval` is never rolled back, to avoid blocking concurrent transactions [PGSEQ]. So values are handed out in call order while rows become visible in commit order. Reproduced in [EXP]: T1 inserts and gets `seq 1` without committing; T2 inserts `seq 2` and commits; a poll returns `seq 2` and advances the cursor to 2; T1 commits; the next poll (`seq > 2`) never returns `seq 1`.
- *Timestamps: unsafe for the same reason.* `now()` / `CURRENT_TIMESTAMP` are the transaction's start time and "do not change during the transaction" [PGTIME]. A transaction that started earlier can commit after a reader has passed its timestamp. An overlap window ("re-read the last 30 s") only narrows the hole to transactions longer than the window.
- *Safe option A: a single-row version counter (recommended).* Each tagging transaction starts with `UPDATE tag_clock SET version = version + 1 RETURNING version` and stamps its history rows with that version. The `UPDATE` takes a row lock held until the transaction ends [PGLOCK]. A second tagging transaction blocks on it and gets the next number only after the first commits, so version order equals commit order. Verified in [EXP]: T2's update blocked while T1 held v=1 and returned v=2 right after T1's commit. Because the counter update is transactional, an aborted transaction's number is reused, so versions are gapless. Readers use a plain `bigint` index (`WHERE version > $since`). The cost is that tag writers are serialised for the duration of each tagging transaction: one batch of ≤1000 items, milliseconds. That is far above human tagging rates, and unrelated transactions (runs, retention sweeps) are not affected.
- *Safe option B: `xid8` and the snapshot `xmin`.* Stamp each history row with `pg_current_xact_id()` (`xid8`: 64-bit, strictly increasing, never reused [PGOID; PGINFO]). A poll reads rows with `xid >= $since AND xid < pg_snapshot_xmin(pg_current_snapshot())` and returns that `xmin` as the next cursor. Every transaction ID below `xmin` "is either committed and visible, or rolled back and dead" [PGINFO Table 9.85], so each row falls in exactly one poll window. Verified in [EXP]: with T1 open, a poll returned nothing (T2's committed row was held back); after T1 committed, the next poll returned both rows. A btree index on `xid8` works and is used (bitmap index scan in [EXP]). The drawback is that `xmin` is cluster-wide: any long *write* transaction holds the feed back. A run writing 1M `run_rows` in one transaction, a long migration or a stuck session would delay all tag updates until it finishes. Nothing is lost, but updates are late.
- *Commit timestamps* (`pg_xact_commit_timestamp` [PGINFO]) need `track_commit_timestamp` and still race with visibility; not considered further.

**Initial state of a tab.** When the browser loads a run's rows, the rows endpoint attaches each row's current tags (decided in the map) and the version the attachment was read at. The browser stores them in `tag_state` if newer than what it has (§6). Pages read at different moments are fine, because each `id` carries its own version and the feed re-delivers anything newer.

## 4. Sending the tab's `id`s (or a filter of them) each poll

- *Plain `id` list:* 39 MB JSON per 1M GUIDs (22 MB gzipped; 10 to 38 MB for other `id` forms) per tab per poll [EXP]. That is above TIM's `TIM_MAX_REQUEST_BYTES` default of 16 MiB [TIM]. Each poll would also join 1M `id`s against the tag tables. With 10 tabs polled every 30 s it is hundreds of MB a minute per analyst. Rejected.
- *A filter of the tab's `id`s:* a fuse8 filter is 1.13 MB per 1M `id`s per poll, and the server tests changed `id`s against it. It works, but requires the cross-language hash and format agreement from §2. Every poll still uploads 1.13 MB per tab to get an answer that is usually empty. The global feed (§3) gives the same result with no upload, so this is rejected too.
- *One upload per tab, then server-side subscription state:* the server keeps each tab's filter or `id` set and pushes matches. That makes the API stateful per browser tab, which conflicts with several replicas behind a load balancer and with tabs living for weeks. Rejected.

## 5. Push (SSE / WebSocket) versus polling, with several replicas

**Polling (recommended first).**

- One poll per browser, not per tab or per grid. Tabs coordinate with the Web Locks API: one tab or worker holds a `tag-sync` lock and polls, the others wait on the lock and take over if the leader closes [LOCKS]. Results reach other tabs through IndexedDB and a `BroadcastChannel`.
- Cost: one indexed range scan per browser per interval, usually returning no rows. 200 analysts polling every 30 s is ~7 requests per second.
- Latency: the interval (≤30 s), plus an immediate poll on tab focus and right after the analyst's own tagging. Chrome throttles chained timers in a page hidden for more than 5 minutes to "once per minute" [THR], so a hidden leader polls at most once a minute. That is still inside "a few minutes"; the leader can also poll on `visibilitychange`.
- Works through nginx and any ingress unchanged, with any replica, and with the existing bearer-token client [TIM `client.ts`].

**Push (optional later, as a "poke").**

- *Fan-out across replicas:* each API replica holds one dedicated connection with `LISTEN tag_changes`. A tagging transaction runs `NOTIFY tag_changes, '<version>'`. Notifications are delivered only on commit, "in the order in which the transactions committed", and the payload must be under 8000 bytes [PGNOTIFY]. Every replica receives every notification, so no sticky sessions are needed. The listening connection must stay out of the pool: asyncpg removes listeners when a connection is released to a pool [APG], and PgBouncer transaction pooling never supports `LISTEN` [PGB]. Notifications sent while a replica's listener is down are lost, so a reconnecting client must poll with its cursor anyway.
- *To the browser:* SSE is enough, since only the server talks. FastAPI ≥0.135 has `fastapi.sse.EventSourceResponse`, with a 15 s keep-alive comment and `X-Accel-Buffering: no` to stop nginx buffering [FASSE; NGX]. TIM's nginx `proxy_read_timeout` is 620 s [TIM `docs/deployment.md`], and nginx counts it between reads only [NGX], so the 15 s pings keep the stream open. Ingress-nginx's default is 60 s [TIM `docs/deployment.md`].
- *Auth:* `EventSource` takes only a URL and `withCredentials` (`EventSourceInit` has no other member [SSE §9.2.2; MDNES]). It cannot send `Authorization: Bearer`, and TIM authenticates every call that way [TIM `client.ts`]. The options are `fetch()` with a streamed body, parsing `text/event-stream` by hand, or a token in the URL, which leaks into logs. The stream also outlives the access token, so the server should end it at token expiry and the client reconnect with a fresh one.
- *Connection limit:* without HTTP/2, a browser allows 6 SSE connections per domain across all its tabs [MDNES]. Use one stream per browser (the same Web Locks leader).
- *WebSocket* adds nothing here: the browser has nothing to send, and it has the same auth and proxy concerns.
- *Gain:* latency drops from ≤30 s to about 1 s. The poke only says "version V exists"; the browser then polls the feed, so the cursor feed stays the only source of truth and push can be added without changing it.

## 6. What the IndexedDB tag cache must hold

Today `row_results` stores one value per tab: the whole row array [TIM `db.ts`]. `put()` stores a structured clone of the value given [IDBPUT], so writing a tag into a row in place would rewrite the tab's whole 1M-row value. Tags therefore go in their own stores, joined to rows by `id` when a tab is shown.

| Store | Key | Value | Purpose |
|---|---|---|---|
| `tag_state` | `id` | `{ tags, determination, comment(s), version }`; untagging leaves a tombstone (empty state with its version) | Current tag state per `id` for every `id` the browser has seen tagged |
| `tag_sync` | single record | `{ cursor: version, lastPolledAt }` | The global feed cursor |
| `tab_id_filter` (optional) | tab uuid | serialized fuse8 filter of the tab's `id`s (~1.13 MB per 1M) | Lets the browser drop feed entries no cached tab could contain, and prune `tag_state` when tabs are deleted |

Rules:

- **On loading a run's rows:** upsert each attached tag state into `tag_state` when its version is newer than the stored one. Rows in `row_results` carry no tags.
- **On each poll:** apply every feed entry to `tag_state` (newest version wins), advance `tag_sync.cursor`, and for open grids update the affected rows with AG Grid transactions. Updates are matched by row id [AGTX]. TIM's grid row id is the ordinal `_row` [TIM `gridOptions.ts`] and `id` can repeat, so each open grid keeps an `id` → `_row[]` map, built when the tab is shown (~21 MB for a `Set` of 1M strings already in memory [EXP]).
- **Closed tabs** need nothing beyond `tag_state`: they read it when opened.
- **What to keep:** v1 can keep every feed entry. `tag_state` then grows with tag activity (~190 bytes per changed `id`, e.g. ~20 MB for 100k ids), not with result sizes. If it grows too large, test feed entries against each cached tab's `tab_id_filter` and keep only possible matches. The same filters let the browser prune entries when tabs are deleted.
- **Quota:** Chromium allows an origin up to 60% of the disk; Firefox best-effort storage allows min(10% of disk, 10 GiB) [QUOTA]. The tag stores are small next to `row_results`. Best-effort data can be evicted under storage pressure unless `navigator.storage.persist()` is granted [QUOTA]. Losing `tag_state` together with `row_results` is harmless; losing only `tag_state` must be detected (e.g. a missing `tag_sync` record), and the browser recovers by re-reading the tags of cached tabs through the tags-for-`id`s endpoint.

## 7. Comparison

| Approach | Per-poll traffic (1M-row tab) | Server cost | Correctness risk | Verdict |
|---|---|---|---|---|
| Server filter of tagged `id`s (+ time buckets) | 0.1-2.3 MB filter download on change, ~150 kB FP confirmations per tab | Rebuild on each change, all tagged ids read | FPs, rebuild races, no Python/JS format compatibility | No |
| `since` feed, intersect in browser | Usually ~0 bytes; ~19 kB per 100 changes | One index range scan | Needs a commit-ordered cursor (counter row or `xid8`) | **Yes** |
| `since` feed, intersect on server | Needs the tab's ids (below) | Join per tab | `run_rows` gone after 24 h / crash | No |
| Upload tab `id` list | 39 MB JSON / 22 MB gzip | Join 1M ids | Exceeds the 16 MiB request cap | No |
| Upload tab `id` filter | 1.13 MB | Probe changed ids | Cross-language hash and format | No |
| Push (SSE poke + LISTEN/NOTIFY) | Tiny | One LISTEN connection per replica, long-lived streams | Lost notifications while disconnected, so the cursor is still needed | Later, optional |

## Recommendation

1. **PostgreSQL:** stamp every tag, comment and determination history row with a `version` from a single-row counter (`UPDATE tag_clock SET version = version + 1 RETURNING version`) taken at the start of each tagging transaction. Index `version`. Do not use a sequence, identity column or timestamp as the cursor. Keep `xid8` + snapshot `xmin` as the lock-free fallback if tag write contention ever matters; it requires that no long write transactions run in the cluster, so `run_rows` must be written in short batches.
2. **API:** `GET /api/tags/changes?since=V&limit=N` returns the current state of each `id` changed after `V`, plus `next` and `hasMore`. The rows endpoint returns attached tags with the version they were read at. The existing plan for a tags-for-`id`s endpoint stays, for recovery and for the analyst's own dialog.
3. **Browser:** one poller per browser, elected with Web Locks, polling every 30 s (instance configuration). It also polls on focus and right after the analyst's own tagging. It writes `tag_state` and `tag_sync` and updates open grids through transactions. Tags never live in `row_results`.
4. **Later, only if 30 s is too slow:** add an SSE "poke" fed by `LISTEN/NOTIFY` on one dedicated connection per replica, streamed with `fetch()` (bearer header), one stream per browser, ended at token expiry. The feed and cursor stay the same.
5. **Filters:** none on the server. Optionally, a fuse8 filter per cached tab, built and read only in the browser, to keep `tag_state` limited to `id`s that cached tabs can contain.
