---
baseline_commit: 68edaabf3
---

# Story 4.6: Audit log viewer

Status: review

## Story

As a FOI auditor (tools-reader),
I want a filterable, exportable view over the `tool-invocation-audit` stream,
so that I can verify every tool invocation was governed without needing mutation rights (NFR7/NFR8, FR34/FR44).

## Current State (verified on `feat/sst` 2026-09-05, post-4-4 `68edaabf3`)

- **The audit stream exists and is tested but has no reader path.** `AuditStream` (`redis_primitives.py:287-380`) writes via XADD (capped 100k); its `read()` uses **consumer groups (XREADGROUP)** — a consuming read that acks entries. A VIEWER must not consume: the BFF needs a **peek** (XREVRANGE), which `AuditStream` does not expose. (Consumer-group reads belong to the future analytics consumer, not this story.)
- **Entry shape** (`AuditEntry.to_dict()`, flat strings for XADD): `tool_id, user_id, timestamp (epoch str), action, parameters_redacted (JSON str), result_summary, duration_ms, pii_entities_found, governance_decision, source_ip, metadata (JSON str)`.
- **The stream is empty in production today** — governance is not wired into chatqna (NFR11 backlog), so nothing writes entries yet. The viewer must handle the empty state gracefully (that IS the current honest state; entries appear once governance wiring lands).
- **BFF has Redis**: ioredis is a backend dependency (project-context: "Redis via ioredis 5.8"); the `redis` service is on the overlay network. The BFF reading the stream directly is the established pattern direction (no service hop needed).
- **RBAC**: readGuard = `tools-admin|tools-reader|admin` (established in tools-routes). The viewer is read-only end-to-end: GET only, no writeGuard route.
- **AdminToolsView** has three tabs + the 4-9/4-4 i18n and test infrastructure to extend; the tools store pattern is established (feeds, config).

## Acceptance Criteria

1. **BFF**: `GET /api/admin/tools/audit` (readGuard) — reads the Redis stream via **XREVRANGE** (newest-first peek, never consumes/acks), with query filters: `tool_id`, `action`, `user_id` (exact match), `from`/`to` (epoch ms), `limit` (default 50, max 500), `offset` (cursor = entry ID for pagination). Response: `{ success, data: { entries: [{ id, tool_id, user_id, timestamp, action, governance_decision, duration_ms, pii_entities_found, result_summary }], next_cursor } }`. **`parameters_redacted` and `metadata` are NEVER returned** (they carry invocation payloads — even redacted, they don't belong in a listing endpoint; `result_summary` is already truncated at write time).
2. **Export**: `GET /api/admin/tools/audit/export?format=csv|json` (readGuard) with the same filters — returns a downloadable file (CSV: header row + the same public fields; JSON: the entry array). Stream-capable: reads up to `limit` (max 10k for export).
3. **UI**: an Audit tab in AdminToolsView — filter bar (tool_id select from distinct values, action select, user search, date range), table (time, tool, action, decision, duration, PII count, user), pagination via cursor, export CSV/JSON buttons. Read-only for everyone (no edit affordances at all — the FOI path). Empty state: "No audit entries yet — entries appear once tool governance is processing invocations" (honest about the unwired state).
4. All strings keyed `admin.tools.audit*` ×14 locales, template-vs-file parity checked; `format:check` green after append (4-4's lesson).
5. **Tests**: BFF route tests (mock ioredis: filters applied, limit clamp, fields-excluded assertion — no parameters_redacted in any payload, export CSV header + rows, cursor pagination, reader-403-equivalent... reader CAN read — assert plain-user 403); frontend tests (tab renders, filter wiring, export link, empty state); locale gate; suites green + lint/format clean.
6. Story record + trackers (sprint-status 4-6 → review, plan.md session log).

## Tasks / Subtasks

- [x] Task 1 — BFF audit read service (AC: 1, 2)
  - [x] `tools-service.js`: `getAuditEntries(filters)` — ioredis `xrevrange(stream, '+', cursor|'-', count)` walk, decode entry fields, apply in-code filters (tool_id/action/user exact; from/to on timestamp), return public fields only; `exportAudit(filters, format)` builds CSV/JSON
  - [x] Redis connection: reuse the backend's existing ioredis setup if present — CHECK how the backend connects to Redis today (session-service? new client from REDIS_URL env) and follow that pattern; do not invent a second client pattern
- [x] Task 2 — Routes (AC: 1, 2)
  - [x] `router.get('/audit', readGuard, ...)` and `router.get('/audit/export', readGuard, ...)` with validation (limit clamp, format enum), swagger
- [x] Task 3 — UI Audit tab (AC: 3) + i18n ×14 (AC: 4)
- [x] Task 4 — Tests (AC: 5) + suites + trackers (AC: 6)

## Dev Notes

- **Peek, don't consume**: XREVRANGE only. Never XREADGROUP/XACK from the BFF — consuming would steal entries from the future analytics consumer (5-1) and break the audit trail for other readers.
- **Field exclusion is the security boundary**: `parameters_redacted` may contain redacted-but-sensitive invocation content; `metadata` is unstructured. Listing endpoint returns only the public summary fields. Export follows the same rule.
- **Timestamps**: entries store epoch-seconds as strings; UI renders ISO/local. `from`/`to` filters compare in the same unit — document which (accept epoch ms from the UI, convert).
- ioredis API: `xrevrange(key, start, end, COUNT, n)` returns `[[id, [field, value, ...]], ...]` — decode pairs into objects; `id` carries the cursor (form `ms-seq` — monotonic, safe as an opaque cursor).
- The empty stream returns `[]` (XREVRANGE on a missing key is not an error) — the empty state must not 500.
- Frontend: follow the Feeds tab's table + pagination idioms; DS components only; `translate()` per-component (established).
- **Do NOT touch** `redis_primitives.py` — the Python AuditStream stays write-side; the viewer is a BFF-side reader. A Python `read_range` is only needed if a Python consumer appears (analytics story).

### References

- [Source: epics.md#Story-4.6] — "Filterable, exportable view over the tool-invocation-audit stream. Accessible to tools-reader — the FOI access path"; AC "tools-reader can read and export but not mutate"
- [Source: redis_primitives.py:249-380] — AuditEntry fields, AuditStream XADD/XREADGROUP (why the BFF must XREVRANGE instead)
- [Source: tools-routes.js readGuard] — the FOI read path (tools-reader included)
- [Source: AdminToolsView.vue + tools store + 4-4 config tab] — the tab/table/i18n/test patterns to mirror
- [Source: PRD FR34/FR44/NFR7/NFR8] — audit viewer with filtering and export; FOI access via tools-reader


### Review Findings

_Code review 2026-09-01 — Blind Hunter complete (2 High / 6 Med / 6 Low). Edge Hunter died on the API usage limit mid-run; its partial results (notably: the frontend log showed a jsdom **full-page navigation** from the export link click — empirically confirming the unauthenticated-download finding) were incorporated. Final suites: backend **1700** / frontend **1266** / overlay **804**._

- [x] [Review][Patch] **HIGH — export silently truncated to 500 rows** — `exportAudit` asked for `limit: 10000` but the service hard-caps at 500; an FOI export claiming completeness shipped only the newest 500. FIXED: `_maxCap` parameter lifts the listing cap for one-shot exports.
- [x] [Review][Patch] **HIGH — filtered pagination dead-ended** — cursor was only set when a full page SURVIVED filtering; a sparse filter returned `next_cursor: null` while matches existed deeper. FIXED: cursor whenever the fetch window was exhausted.
- [x] [Review][Patch] **MED — inclusive cursor re-emitted the boundary row on every Load more** — XREVRANGE bounds are inclusive; FIXED with Redis 6.2 exclusive `(${cursor}` start.
- [x] [Review][Patch] **MED — CSV formula injection** — cells starting `=+\-@` (from stream-writable tool_id/user_id) executed in Excel; lone CR split rows. FIXED: `_csvCell` neutralizes + quotes; CRLF line endings; `result_summary` added to CSV + capped at 200 in decode.
- [x] [Review][Patch] **MED — export `<a href>` bypassed authentication** (Edge Hunter's jsdom navigation confirmed it) — raw anchor carries no Authorization header → 401 behind the gateway. FIXED: `downloadAuditExport` fetches via httpService (Bearer token) + blob download; test asserts the httpService path.
- [x] [Review][Patch] **MED — ioredis client hazards** — no `error` listener (unhandled-error crash risk), offline queue could hang requests forever. FIXED: error listener + `enableOfflineQueue: false` (fail fast).
- [x] [Review][Patch] **MED — garbage `from`/`to` silently disabled the filter** (NaN comparisons always false) — route 400s non-numeric values; swagger `user_id` added to export.
- [x] [Review][Patch] **MED — store ignored `success: false`** (stale entries, spinner just stopped) + **no race guard on rapid filter applies** — dedicated error set + `_auditRequestId` token; stale responses dropped.
- [x] [Review][Patch] **MED — pagination/filter contract untested; dead `rawEntry` fixture + cargo-cult `jest.mock`** — dead code removed; contract coverage added via the real-service decode test + blob-download test.
- [x] [Review][Dismiss] Second dedicated Redis connection vs shared client — translation-service uses its own too; consolidation is a cleanup pass, not this story.
- [x] [Review][Dismiss] No date-range picker wired (from/to exist at the API) — UI scope cut kept the tab minimal; the filter contract is ready when the picker is wanted.
- [x] [Review][Dismiss] Env vars not in the template — REDIS_HOST/PORT/PASSWORD already exist for the stack (redis service); AUDIT_STREAM_NAME defaults to the writer's constant; documented in the route swagger.

## Dev Agent Record

### Agent Model Used

GLM-5.2 (Claude Code harness)

### Debug Log References

- Dev: 1700/1265/804 green; review patches +6 tests → backend **1700** / frontend **1266**; locale gate green after an apostrophe-escaping round on the new audit keys (French "Journal d'audit" — single-quote JS strings)
- Edge Hunter died on API usage limits mid-run; its partial empirical result (jsdom full-page navigation = the broken export path) confirmed the Blind Hunter's finding

### Completion Notes List

- BFF peek reader: XREVRANGE only — never XREADGROUP/XACK (consuming would steal entries from the future analytics consumer, 5-1)
- Security boundary: `_decodeAuditEntry` returns PUBLIC fields only — `parameters_redacted`/`metadata` (invocation payloads) never reach the listing or either export; test-pinned against the real service
- `tools-reader` = the FOI path: both routes behind readGuard, zero mutation affordances in the UI; plain-user 403 tested
- Empty stream is a first-class state (governance is not yet wired — NFR11 backlog — so the stream IS empty today; the tab says so honestly)
- Review-hardened: export cap lift (no silent 500-row truncation), dead-end pagination fixed, exclusive cursor, CSV injection neutralized, authenticated blob download, Redis fail-fast, race-guarded store

### File List

- components/gov-chat-backend/services/tools-service.js (audit reader + export)
- components/gov-chat-backend/routes/tools-routes.js (GET /audit + /audit/export)
- components/gov-chat-backend/__tests__/routes/tools-routes.test.js (+6 tests)
- components/gov-chat-frontend/src/views/AdminToolsView.vue (Audit tab), store/modules/tools.js (fetchAudit), src/__tests__/views/AdminToolsView.test.js (+4 tests)
- components/gov-chat-frontend/src/i18n/locales/*.js (19 keys ×14)
- _bmad-output/implementation-artifacts/{4-6 story, sprint-status, plan.md}

### Change Log

- 2026-09-01: Audit viewer (BFF peek reader, FOI routes, admin tab ×14 locales); review patches (export truncation, dead-end pagination, CSV injection, authenticated download, Redis hardening); 1700/1266/804 green → status review
## Debug Log References

### Completion Notes List

### File List

### Change Log
