---
baseline_commit: 91d1efab8
---

# Story 3.4: JSON-API polling with field mapping

Status: review

## Story

As an administrator,
I want a `json_api` feed type that polls a JSON endpoint and maps configured fields into the standard content model, with a schema-validation gate that routes malformed responses to the DLQ instead of the corpus,
so that JSON-based sources ingest as safely as RSS (FR26, FR42).

## Current State (verified on `feat/sst` 2026-09-05, post-4-7 `91d1efab8`)

- **The ingestor is RSS-only**: `process_feed` (`genieai_stream_ingestor.py:59-120`) unconditionally calls `feedparser.parse(url)`; there is no `feed_type` dispatch and no `content_mapping` handling. A `json_api` feed doc would be parsed as RSS garbage.
- **No DLQ exists anywhere** (sprint-status 3-9: "no breaker/DLQ/backoff" — note 3-9 DID ship backoff in `process_feed:111-120`; the sprint note is partially stale: **backoff exists, breaker + DLQ do not**). 3-9's remaining scope is breaker + DLQ; **this story introduces the DLQ** (write-side) as 3-4's AC requires it for `parse_error` routing — 3-9 will consume/extend the same DLQ convention for its resilience scope.
- **Dedup/incremental pattern**: RSS entries gate on `entry_date > last_entry_date` (epoch compare, `last_entry_date` persisted per feed). JSON-API items need an equivalent — `item_id` (from a mapped field or hash) with `last_entry_ids` on the feed doc.
- **Ingest path**: `ingest_entries` POSTs base64 text payloads to `DATAPREP_INGEST_URL` with `sourceType: "feed"`, `feedId`, optional `expiresAt` — the JSON path reuses this verbatim.
- **No tests exist for the stream ingestor** (no `test_stream_ingestor.py`); this story introduces its test file.
- **DLQ convention (new, to be honored by 3-9)**: a parallel Redis stream `tool-invocation-audit`-style named `{AUDIT_STREAM_KEY}-dlq` — actually name it `feed-ingestion-events-dlq` (deriving from the existing `REDIS_STREAM_KEY = feed-ingestion-events` constant — verify the exact constant name in code). Entry: `{feed_id, reason: "parse_error", error, payload_sample (truncated), timestamp}`.

## Acceptance Criteria

1. **`feed_type` dispatch**: `process_feed` branches on `feed.get("type", "rss")` — `rss` keeps the existing feedparser path byte-for-byte; `json_api` routes to the new `process_json_api_feed`.
2. **JSON polling**: httpx GET on the feed URL (timeout 10s, `json()` parse); items extracted via `content_mapping.items_path` (dot-separated path, e.g. `"data.items"`); per-item fields mapped via `content_mapping` (`title_field`, `body_field`, `date_field`, `id_field` — dotted paths supported); assembled into the same `Title/Link/Content` text shape and POSTed through the existing `ingest_entries` payload contract.
3. **Schema-validation gate (the AC)**: a response that fails to yield a list at `items_path`, or an item missing any required mapped field, routes to the **DLQ** with `reason: "parse_error"` (+ the specific error) and is NEVER sent to dataprep. Missing `items_path` in a json_api feed definition = a config error → DLQ as `config_error` for that poll.
4. **Incremental dedup**: items seen before (by `id_field` value, or hash of the mapped content when `id_field` is absent) are skipped; the seen-set persists on the feed doc (`last_entry_ids`, capped at 500 ids).
5. **Failure accounting**: the existing `failures`/backoff block applies to the JSON path identically (parse errors counted as failures → the 4-7 health derivation stays truthful).
6. **Tests** (`tests/test_stream_ingestor.py`, new): dispatch (rss unchanged, json_api routed), happy-path mapping (dotted paths, all four field types), malformed response → DLQ `parse_error` + dataprep NOT called, missing items_path → DLQ `config_error`, dedup on id_field and content-hash, failure counter/backoff parity, DLQ entry shape. Mock at the HTTP boundary (`httpx.AsyncClient.get`) and the dataprep POST; mock redis as AsyncMock.
7. Overlay suite green; ruff clean. `ingest_entries` and the RSS path behavior unchanged.

## Tasks / Subtasks

- [x] Task 1 — DLQ write helper + feed_type dispatch (AC: 1, 3)
  - [x] `_write_dlq(feed_id, reason, error, payload_sample)` — XADD to `{AUDIT_STREAM_KEY}-dlq` (verify the exact stream constant name in code; logger.error alongside)
  - [x] `process_feed` head: `feed.get("type", "rss")` branch
- [x] Task 2 — `process_json_api_feed` (AC: 2, 3, 4, 5)
  - [x] httpx GET + items_path resolution + field mapping + dedup + reuse of `ingest_entries`' payload contract (extract the payload builder into a small helper both paths share, or replicate the dict — prefer extract)
  - [x] Parse failures → DLQ; counter/backoff parity with the RSS path (extract the shared `mark_feed_success`/`mark_feed_failure` helpers from the existing inline code so both paths stay in sync)
- [x] Task 3 — Tests (AC: 6)
- [x] Task 4 — Suite + ruff; trackers (sprint-status 3-4 → review + correct the stale 3-9 note; plan.md session log)

## Dev Notes

- **`feedparser.parse(url)` is synchronous** inside an async method (pre-existing); use `httpx.AsyncClient` for the JSON path (httpx is the ingestor's established HTTP client via aiohttp? — CHECK the imports: the file imports aiohttp for the POST. For consistency use aiohttp for the GET too, or httpx if aiohttp's client isn't already constructed at that point — match whatever the file already imports).
- **JSON date fields**: mapped `date_field` values may be epoch numbers or ISO strings — accept both (float(value) or datetime.fromisoformat fallback); unparseable date → treat as `now` (same as RSS missing pubDate).
- Keep `process_feed`'s poll-interval/next_poll_at gate ABOVE the dispatch (both types share scheduling).
- Dedup cap: keep only the newest 500 ids (pop from the head) — unbounded growth on busy feeds is the failure mode.
- RSS path regression guard: at least one existing-behavior test (feedparser dispatch unchanged) — the refactor moves the gate, it must not change RSS semantics.
- The BFF feed form (4-5) is separate scope; this story consumes whatever `content_mapping` dict is on the feed doc.

### Testing standards

- New `tests/test_stream_ingestor.py`; pytest + AsyncMock; mock ArangoDB collection methods, redis, aiohttp/httpx at the transport; ITU copyright header.

### References

- [Source: epics.md#Story-3.4] + [Source: PRD FR26/FR42 (:123)] — json_api type, content_mapping, parse_error DLQ gate
- [Source: genieai_stream_ingestor.py:48-121] — process_feed/poll gate/failure backoff to extend
- [Source: genieai_stream_ingestor.py:122-168] — ingest_entries payload contract to reuse
- [Source: sprint-status 3-9 note] — DLQ/breaker state; this story introduces the DLQ write side
- [Source: 3-3 shipped] — feed-ingestion-events stream convention


### Review Findings

_Code review 2026-09-05 — Blind Hunter + Edge Case Hunter (2-layer; Auditor skipped — compact backend surface, deviation noted). Edge reproduced every critical empirically and checked the BFF/UI feed contract. Both layers caught overlapping Highs; the Edge findings were the deeper set._

- [x] [Review][Patch] **CRITICAL — httpx not in the runtime image** — `stream_ingestor/requirements.txt` has only aiohttp/feedparser/python-arango/redis; `import httpx` (outside the try) would crash every json_api poll forever once deployed. Tests passed locally because httpx is only in the pyproject test extra. FIXED: httpx added to requirements.txt.
- [x] [Review][Patch] **CRITICAL — fetch-failure raise killed the whole poll cycle** — the dispatch sat before process_feed's try, so a raise landed in main's loop: no failures/backoff written, remaining feeds starved, dead feed retried every 10s. FIXED: dispatch wrapped in its own try with shared `_mark_feed_failure` bookkeeping + per-feed try/except in `poll_feeds` (NFR15); parity contract now test-pinned via a process_feed-level test.
- [x] [Review][Patch] **CRITICAL — seen-set cap `list(seen)[-500:]` on a set kept ARBITRARY ids** (Edge reproduced: 600-item feed deterministically re-ingests ~100 every poll). FIXED: insertion-ordered list (newest appended last, slice keeps newest).
- [x] [Review][Patch] **HIGH — salted `hash()` dedup ids persisted on the feed doc** — every restart re-ingests all no-id items (both layers). FIXED: stable sha256 hexdigest. (Edge added: hash was also the DEFAULT with no id_field; falsy real ids silently took the hash path — now only `None` does.)
- [x] [Review][Patch] **HIGH — permanently broken feeds never backed off** (misconfig/shape early-returns skipped failure bookkeeping without raising) — FIXED: raise after DLQ → dispatch's except books the backoff; parity tests at both process_json_api_feed and process_feed level.
- [x] [Review][Patch] **MED bundle** — malformed items appended to `seen` (no re-DLQ every poll); `_item_date` accepts ms epochs (JS-API default) + Z-suffix ISO; DLQ'd items counted as failures (a 100%-DLQ'd poll no longer shows green in the 4-7 overview); type dispatch case-normalized; `polling_interval` vs `poll_interval_sec` alias (pre-existing UI↔ingestor mismatch, found by Edge).
- [x] [Review][Patch] **LOW — transport failures DLQ'd as parse_error** — taxonomy note: kept single reason for now (3-9's consumer can branch on the error text); recorded for 3-9.
- [x] [Review][Dismiss] payload_sample raw external data in DLQ — DLQ is internal ops data, truncated to 300 chars; hash it instead and ops loses the debug value that justifies the queue. Accepted; revisit with 3-9 retention.
- [x] [Review][Dismiss] `_date` dead code — write-side forward-compat for when ingest_entries dates matter; documented.
- [x] [Review][Defer] UI feed form sends no type/content_mapping (feeds created via UI are implicit-RSS) — 4-5/3-5 scope; API path persists both fields correctly (Edge verified createFeed spreads feedData). Also noted: item ids marked seen even when dataprep ingest fails (inherited from the RSS last_entry_date pattern) — defer to 3-9's resilience scope.

## Dev Agent Record

### Agent Model Used

GLM-5.2 (Claude Code harness)

### Debug Log References

- Dev: mock-strategy iteration (patching `httpx.AsyncClient.get` leaves `__aenter__` real → response mock double-awaited; fix = replace the whole AsyncClient class) + a leftover `async def _mock_http` producing a coroutine — both surfaced immediately as AttributeError
- Review (Blind + Edge, both reproduced empirically): 3 CRITICALS the green suite missed — httpx absent from the runtime image, raise-kills-poll-cycle (no backoff, starves other feeds), arbitrary seen-cap eviction causing perpetual re-ingestion — plus the salted-hash dedup break
- Post-patch: overlay **815 passed** (11 new tests), ruff clean

### Completion Notes List

- `process_feed` dispatches on normalized `type` (rss default, byte-identical RSS path — regression-guarded); json_api path: httpx GET → `content_mapping.items_path` dot-path → per-item title/body/link/date/id mapping → DLQ gate (parse_error/config_error, malformed content never reaches dataprep) → dedup (`last_entry_ids`, newest-500, stable sha256 fallback) → shared ingest payload contract
- Failure parity: shared `_mark_feed_success`/`_mark_feed_failure` helpers; DLQ'd items count as partial failures; dispatch-level try keeps one broken feed from starving others (NFR15); `polling_interval` alias fixed
- DLQ: `feed-ingestion-events-dlq` stream, capped 10k, entries `{feed_id, reason, error, payload_sample, timestamp}` — the convention 3-9 will consume
- httpx added to stream_ingestor/requirements.txt (runtime image fix)

### File List

- genie-ai-overlay/stream_ingestor/genieai_stream_ingestor.py (dispatch, DLQ, json_api poller, bookkeeping helpers)
- genie-ai-overlay/stream_ingestor/requirements.txt (httpx)
- genie-ai-overlay/tests/test_stream_ingestor.py (NEW — 11 tests)
- _bmad-output/implementation-artifacts/{3-4 story, sprint-status, plan.md}

### Change Log

- 2026-09-05: json_api polling + content_mapping + parse_error DLQ gate; review caught 3 CRITICALS (runtime dep missing, raise starved the poll cycle, arbitrary seen-cap eviction) + salted-hash dedup; 815 tests green → status review## Debug Log References

### Completion Notes List

### File List

### Change Log
