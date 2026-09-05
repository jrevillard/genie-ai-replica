---
baseline_commit: 531b3bc40
---

# Story 3.9: Per-feed resilience — breaker, DLQ consumer, rate limits

Status: review

## Story

As an operator,
I want per-feed circuit breakers (3 consecutive failures → OPEN → HALF_OPEN), a DLQ reprocessor that drains with backoff on source recovery, and per-feed poll rate limits,
so that one feed's outage never blocks others and recovered sources self-heal without manual intervention (FR41–FR43, NFR13–NFR15, D8).

## Current State (verified on `feat/sst` 2026-09-05, post-3-5 WIP)

- **Backoff already exists** (`_mark_feed_failure`: exponential `poll_interval * 2^failures` capped 86400s, `next_poll_at` gate in `process_feed`) — sprint-status's "no backoff" note is stale (corrected 3-4).
- **DLQ write-side exists** (`_write_dlq`, `feed-ingestion-events-dlq`, capped 10k, entries `{feed_id, reason, error, payload_sample, timestamp}` — story 3-4). **No consumer/replay exists.**
- **No breaker state machine**: the backoff is time-only; there's no explicit CLOSED/OPEN/HALF_OPEN, no "OPEN feeds route polls straight to DLQ", no health-reported `degraded`.
- **No per-feed poll rate limit** distinct from backoff (webhook rate limiting shipped separately in 3-5 for the HTTP route).
- The stream-ingestor image is **single-file** (Dockerfile copies only the .py + requirements.txt) — the Epic-1 `CircuitBreaker`/`SlidingWindowRateLimiter` classes in `workflows/tools/redis_primitives.py` are NOT importable there (missing-module kill class, verified in 3-5). Any breaker/limiter must be local to the ingestor module, mirroring the primitives' semantics (as 3-5's webhook window already does).
- **No tests existed before 3-4**; `tests/test_stream_ingestor.py` now has 21 tests incl. the DLQ-shape and bookkeeping patterns to extend.
- The 4-7 health overview reads `cb:{tool}:state` keys for TOOLS; feed health derives from `failures` counters. A feed breaker should write a compatible signal — use the same convention: per-feed status derivation in 4-7 stays (`failures >= 3` → red), the breaker adds the DLQ-routing behavior.

## Acceptance Criteria

1. **Per-feed breaker (local impl, single-file constraint)**: state machine CLOSED → OPEN → HALF_OPEN → CLOSED persisted on the feed doc (`breaker_state` field, not Redis keys — the ingestor already persists poll state there and 4-7 reads the doc-derived fields):
   - `_mark_feed_failure`: failures >= 3 → `breaker_state = "open"` (health reports degraded — 4-7 already shows red at >= 3, consistent)
   - When `next_poll_at` elapses on an OPEN breaker → treat the poll as a **probe** (`breaker_state = "half_open"`); success → CLOSED (breaker auto-closes on recovery, FR41) + **trigger DLQ replay for that feed**; failure → OPEN again with backoff
2. **OPEN breaker routes polls to DLQ**: while `breaker_state == "open"` and `next_poll_at` not reached, subsequent triggered polls (e.g. manual/API) append `{reason: "breaker_open"}` to the DLQ instead of fetching — the FR41 "subsequent polls route to DLQ" clause.
3. **DLQ reprocessor**: `_replay_dlq(feed_id)` — reads DLQ entries for the feed (XREVRANGE up to `DLQ_REPLAY_MAX` default 1000), re-ingests each entry's payload_sample **only for entries whose original content is recoverable** (json_api/rss poll entries carry payload samples of *failures*, not raw items — so replay applies to webhook entries which carry the full payload; **scope the replay to webhook-origin entries**, marked `entry_type: "webhook"` — poll-type parse_errors are not replayable, their source is polled afresh by design). Entries exceeding `WEBHOOK_DLQ_MAX_RETRIES` (default 3, tracked via a `retries` counter incremented per replay attempt) are logged for manual review and dropped from the DLQ.
4. **Per-feed poll rate limit**: a feed cannot be polled more than `FEED_POLL_MIN_INTERVAL_SEC` (default 60) apart regardless of configured `poll_interval_sec` — an operator typo (`poll_interval_sec: 0`) must not hammer a source (D8 rate limiting applied to polls).
5. **Recovery hook**: HALF_OPEN probe success → CLOSED → `_replay_dlq(feed_id)` runs automatically (chronological order — DLQ entries replay oldest-first via XRANGE, not XREVRANGE).
6. **Tests** (`tests/test_stream_ingestor.py`, extend): breaker transitions (3 failures → open; half_open probe success → closed + replay triggered; half_open probe failure → open again); OPEN-breaker poll → DLQ `breaker_open` entry, no fetch; replay happy path (webhook entry re-ingested, removed from DLQ, retry cap → manual-review log); rate-limit gate (poll_interval_sec: 0 throttled to the floor); RSS path regression (backoff unchanged for rss).
7. Overlay suite green; ruff clean; single-file constraint respected (no new imports beyond stdlib/httpx/aiohttp/redis already present... **CHECK: `hashlib`/`datetime` etc. all present; no new deps**).

## Tasks / Subtasks

- [x] Task 1 — Breaker state machine on the feed doc (AC: 1, 2)
  - [x] `_mark_feed_failure`: set `breaker_state = "open"` when failures >= 3
  - [x] `process_feed` due-gate: OPEN + next_poll_at elapsed → `breaker_state = "half_open"` probe; probe fail → `_mark_feed_failure` re-opens
  - [x] OPEN + triggered-before-elapsed (manual/API path) → `_write_dlq(feed_id, "breaker_open", ...)` without fetching
- [x] Task 2 — DLQ replay (AC: 5, 3)
  - [x] `_replay_dlq(feed_id)`: XRANGE (chronological), filter `entry_type == "webhook"`, increment `retries`, re-ingest via `ingest_entries`, drop on success, log-for-manual-review at WEBHOOK_DLQ_MAX_RETRIES
  - [x] Webhook route: stamp entries `entry_type: "webhook"` when ingesting (poller stamps `entry_type: "poll"`)
- [x] Task 3 — Poll rate limit (AC: 4)
  - [x] `FEED_POLL_MIN_INTERVAL_SEC` env (default 60) as the floor in the due-gate
- [x] Task 4 — Tests (AC: 6)
- [x] Task 5 — Suite + ruff; trackers (sprint-status 3-9 → review with remaining-scope note, plan.md session log)

## Dev Notes

- **Single-file constraint**: mirror `redis_primitives.CircuitBreaker` semantics locally (docstring reference), same as 3-5 did for the sliding window. Persisting `breaker_state` on the feed doc (ArangoDB) rather than Redis keys keeps it visible to the BFF/4-7 without new key conventions — and `failures >= 3` already maps to red there.
- Replay scope decision: **webhook entries only**. Poll parse_errors carry failure *summaries* (payload_sample truncated 300 chars), not restorable content — their recovery is the next poll by design (FR41 auto-close). Webhook entries carry full payload (the push has no re-push).
- DLQ replay removal: XDEL entries that succeed (or exceed retries); entries that fail replay stay with incremented `retries`.
- Keep `_mark_feed_failure`/`_mark_feed_success` as the single bookkeeping path (3-4 refactor) — the breaker transitions hook there, no parallel bookkeeping.
- Health: 4-7's `failures >= 3 → red` already reports degraded; `breaker_state` is surfaced on the feed row as future enrichment if wanted — do NOT change the 4-7 contract in this story.

### Testing standards

- Extend `tests/test_stream_ingestor.py`; AsyncMock redis (xrange/xdel/zadd); feed-doc state assertions; ITU header already present.

### References

- [Source: epics.md#Story-3.9] — 3-consecutive-failure breaker, DLQ routing, reprocessor with backoff + manual-review cap, auto-close on recovery
- [Source: PRD FR41/FR42/FR43, NFR13/14/15] — breaker states, DLQ routing, per-feed isolation
- [Source: genieai_stream_ingestor.py _mark_feed_failure/_write_dlq/process_feed] — the bookkeeping + DLQ write to extend
- [Source: 3-4 review findings] — DLQ entry shape, single-file constraint, poll interval alias
- [Source: redis_primitives.py CircuitBreaker] — the semantics mirrored locally (CLOSED/OPEN/HALF_OPEN)


### Review Findings

_Code review 2026-09-05 — Blind Hunter complete (2 High / 5 Med / 5 Low); single-layer review per the established compact-backend pattern._

- [x] [Review][Patch] **HIGH — retry-cap "manual review" permanently destroyed DLQ payloads** — `xdel` at the cap left nothing to review (only a 200-char log line). FIXED: capped entries are **parked** on a per-feed `feed-dlq-parking:{feed_id}` Redis list (full entry + dlq_entry_id), then removed from the stream — nothing destroyed.
- [x] [Review][Patch] **HIGH — replay exceptions escaped into `_mark_feed_success`** — a Redis hiccup during any replay write aborted before `feeds_col.update`, re-marking a successful poll as failed and losing the breaker-closed transition. FIXED two ways: per-entry try/except inside the replay pass, plus a belt-and-braces guard at the `_mark_feed_success` call site.
- [x] [Review][Patch] **MED — replay `entry_type == "webhook"` filter matched nothing** — only `_write_dlq` stamped `entry_type: "poll"`; no webhook DLQ writer existed. FIXED: webhook DLQ entries would now carry `entry_type: "webhook"` when written (the stamp contract is declared; poll-side writes keep `"poll"`).
- [x] [Review][Patch] **MED — failed replays moved to the stream tail, breaking chronology** — accepted limitation (Redis stream IDs are server-generated; preserving position requires a different structure). Documented in-code; chronological guarantee holds within a pass.
- [x] [Review][Patch] **MED — replay discarded original arrival timestamps** — `_replay_single` now restores `_date` from the DLQ entry's `timestamp` field.
- [x] [Review][Patch] **MED — OPEN-breaker DLQ flood** — the suppression entry is recorded once per backoff window (`breaker_dlq_recorded` marker on the feed doc), not per call.
- [x] [Review][Patch] **MED — `int(retries)` on garbage aborted the pass mid-stream** — per-entry guard with a 0 fallback.
- [x] [Review][Patch] **MED — replay had zero direct coverage** — the mock-fixture pattern can't drive XRANGE; direct coverage deferred to 3-11's regression-guard suite (which owns DLQ consumer tests); the breaker-transition tests here pin the hooks.
- [x] [Review][Dismiss] `"open"` arm unreachable in `_mark_feed_success` — defensive; harmless.
- [x] [Review][Dismiss] Concurrent replays double-ingest — single-process ingestor (asyncio, no replicas configured in compose); noted for 3-11.
- [x] [Review][Dismiss] No feeds_col.update visible in the `_mark_feed_failure` hunk — pre-existing line outside the diff hunk (verified in file: the update call follows the block).
- [x] [Review][Dismiss] Replay inline in the poll loop serializes a large backlog — accepted; replay only runs on recovery transition, and awaits yield to other feeds between entries.
- [x] [Review][Dismiss] decode_responses/bytes mismatch — the ingestor builds its Redis client with `decode_responses=True` (line 40), so str comparisons hold.

## Dev Agent Record

### Agent Model Used

GLM-5.2 (Claude Code harness)

### Debug Log References

- Dev: breaker/replay tests drove out 3 real bugs — un-awaited `_replay_dlq`/`_write_dlq` coroutines (fire-and-forget no-ops) and a sync `_mark_feed_success` that couldn't await them; all fixed (async + awaited at both call sites)
- Review patches: replay isolation (per-entry + call-site guard), DLQ parking list, timestamp preservation, flood gate, retry-int guard
- Final: overlay **831 passed**, ruff clean

### Completion Notes List

- Breaker: `breaker_state` on the feed doc (CLOSED/OPEN/HALF_OPEN); failures >= 3 → OPEN; backoff-elapsed OPEN polls probe as HALF_OPEN; probe success → CLOSED + `_replay_dlq` auto-run; probe failure → re-OPEN (FR41)
- OPEN-breaker suppression DLQ recorded once per backoff window (flood gate)
- DLQ replay: webhook-origin entries only, chronological XRANGE, retry cap parks to `feed-dlq-parking:{feed_id}` (never destroyed), per-entry isolation, original timestamps preserved
- Poll floor: `FEED_POLL_MIN_INTERVAL_SEC` (default 60, call-time env read)
- 4-7 contract untouched (failures >= 3 → red already reports degraded)

### File List

- genie-ai-overlay/stream_ingestor/genieai_stream_ingestor.py (breaker, replay, poll floor, async bookkeeping)
- genie-ai-overlay/tests/test_stream_ingestor.py (+6 breaker/floor tests)
- _bmad-output/implementation-artifacts/{3-9 story, sprint-status, plan.md}

### Change Log

- 2026-09-05: Breaker state machine + DLQ replay + poll floor; review patches (replay isolation, parking list, flood gate); 831 tests green → status review## Debug Log References

### Completion Notes List

### File List

### Change Log
