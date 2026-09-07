---
key: 5-3-logs-service-js-rewrite-public-methods-getlogsinrange-getlog
title: "logs-service.js: rewrite public methods (`getLogsInRange`, `getLogsSummary`, `searchLogs`, `getDebugYesterday`) using `VictoriaLogsClient`; per-call env read for `ADMIN_LOGS_SOURCE`; `VL_FAIL_OPEN` + `VL_QUERY_TIMEOUT_MS`; `getLogFilesInRange` returns synthetic descriptors"
epic: epic-5
status: done
baseline_revision: 8cd47ef44f3fba1e01a1e69055777a8c0f887cec
review_loop_iteration: 0
followup_review_recommended: true
deferred:
  - summary: >-
      getLogFilesInRange returns synthetic descriptors in VL mode but
      security-scan-service.js (and admin-dashboard consumers) still
      treat entries as path strings (`file.endsWith('.gz')`); VL default
      mode will 500 the security-scan route.
    evidence: |-
      security-scan-service.js:231-246 calls file.endsWith('.gz') on each
      entry from getLogFilesInRange. No consumer-side test mocks the
      descriptor shape. Story 5.4 is the natural follow-on.
    location: >-
      components/gov-chat-backend/services/security-scan-service.js:231-246
    severity: medium
  - summary: >-
      getLogsSummary VL path collapses to a single `service:'all'` bucket
      per level; file path retains per-type/per-service grouping via
      legacy groupLogs(). SPEC CAP-3 parity not pinned at this story.
    evidence: |-
      logs-service.js:481-506 returns `{errors:[{service:'all',count:N}]}`
      vs. groupLogs() returning one bucket per type+service pair. No
      parity test compares the two paths against the same fixture.
    location: >-
      components/gov-chat-backend/services/logs-service.js:481-506
    severity: medium
  - summary: >-
      VL_QUERY_TIMEOUT_MS is honoured inside the MELT adapter
      (shared/lib/melt/victorialogs-client.js:110) but is never read or
      asserted at this story's service-layer surface.
    evidence: |-
      Spec acceptance mentions VL_QUERY_TIMEOUT_MS in the title; no test
      exercises a hung VL query at this layer. Cover transitively via
      Epic 4 contract tests.
    location: >-
      components/gov-chat-backend/services/logs-service.js
    severity: medium
  - summary: >-
      VlFilesDisabledError carries `statusCode:503` + `body:{error: 'vl_files_disabled',…}`
      but the global error handler at `index.js:801-802` reads only
      `err.statusCode` and `err.message` — wire body is `503 {message:…}`
      with no `error` discriminator. AC specifies the body shape; the
      service-layer contract is satisfied but the route layer drops it.
    evidence: |-
      Unit test at logs-service-vl.test.js:453-457 asserts the in-memory
      body; no route-level test asserts the HTTP wire body. Out-of-scope
      for this story's `files:` manifest (index.js owned by the BFF shell).
    location: >-
      components/gov-chat-backend/index.js:801-802
    severity: medium
effort: 1.0
depends_on: [Epic 4]
files:
  - components/gov-chat-backend/services/logs-service.js
  - components/gov-chat-backend/__tests__/services/logs-service-vl.test.js
  - components/gov-chat-backend/__tests__/services/logs-service.test.js
---

# Story 5.3 — logs-service.js: rewrite public methods (`getLogsInRange`, `getLogsSummary`, `searchLogs`, `getDebugYesterday`) using `VictoriaLogsClient`; per-call env read for `ADMIN_LOGS_SOURCE`; `VL_FAIL_OPEN` + `VL_QUERY_TIMEOUT_MS`; `getLogFilesInRange` returns synthetic descriptors

**Epic**: epic-5 (1.0 SP)
**Files**: `components/gov-chat-backend/services/logs-service.js`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#5` for the epic-level acceptance criteria; this story is one contributing step.

**Concrete acceptance (added by Epic 5 review — absorbs Stories 5.5 + 5.6):**
- JSDoc on `getLogsInRange` pins the envelope shape `{logs: VictoriaLogsRow[], total: number, limit: number, offset: number}` (matches AD-3 row shape → admin response shape). Reviewers will reject future drift.
- **MERGED from Story 5.5:** When `ADMIN_LOGS_SOURCE === 'file'` but `LOG_TO_FILE !== '1'`, return 503 with body `{ error: 'vl_files_disabled', message: 'Set LOG_TO_FILE=1 to use file-based log source' }`.
- **MERGED from Story 5.6:** ENOENT tolerance on file read; `fs.open(path, 'wx')` per AD-10 for `O_EXCL` concurrent-writer lock; JSON.parse try/catch with N=4096 re-parse window. Add test mocking `fs.open` to throw `EEXIST`.
- Per-call env read for `ADMIN_LOGS_SOURCE` (no restart) per AD-6.
- Stories 5.5 + 5.6 deleted; this story covers their scope.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`

## Review Triage Log

### 2026-09-07 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 4, medium 0, low 0)
- defer: 3 (high 0, medium 3, low 0)
- reject: 5
- addressed_findings:
  - `[high]` `[patch]` `_acquireReadLock` returned a `FileHandle` but never unlinked the O_EXCL sentinel — first read by a PID permanently skipped every subsequent read for that file. Refactored to return `{handle, lockPath}` + `_releaseReadLock` helper that closes the FD and `unlink`s the sentinel; updated all 4 call sites (`getLogsInRange`, `getLogsSummary`, `searchLogs`, `debugYesterdayLogs`).
  - `[high]` `[patch]` `_parseNdjsonContent` advanced the cursor past the newline BEFORE evaluating the parse-error branch, so the retry window read from the next line instead of continuing the broken one — the AD-10 `kill -9`-truncated-line recovery path was unreachable. Now cursor advances only on successful parse; retry window is gated on the trailing newline not being consumed and reads from `newlineIdx + 1`.
  - `[high]` `[patch]` `_sumHits` summed every numeric key in the bucketed `hits()` response, so a `level:ERROR` query returning `{ERROR: 4, INFO: 100, WARN: 2}` reported 106 ERRORs. Now takes an explicit `level` argument and returns only that key's value; falls back to single-key sum for older adapter shape.
  - `[high]` `[patch]` `_getVlClient` lazy-required `'../../shared-lib/melt'` — a path that does not exist in `components/gov-chat-backend/`. Production would throw `MODULE_NOT_FOUND` on the first VL call (only ever reached via the test seam). Corrected to `'../shared-lib/melt'` (matches the singleton `require('../shared-lib')` convention at line 20 and the `Dockerfile COPY shared/lib ./shared-lib` layout).
- deferred findings (logged for follow-on stories):
  - `[medium]` `[defer]` `getLogFilesInRange` returns synthetic descriptors in VL mode; `security-scan-service.js:231-246` (and admin dashboard consumers) still treat entries as path strings (`file.endsWith('.gz')`) — VL default mode will 500 the security-scan route. Story 5.4 (admin-dashboard-service: drop fs.readFile path.join delegate) is the natural home.
  - `[medium]` `[defer]` `getLogsSummary` VL path collapses to a single `service:'all'` bucket per level; file path retains per-type/per-service grouping via legacy `groupLogs()`. SPEC CAP-3 parity not pinned; Story 5.4 / contract-test story 5-8 territory.
  - `[medium]` `[defer]` `VL_QUERY_TIMEOUT_MS` honoured inside `shared/lib/melt/victorialogs-client.js:110` (Epic 4) but never asserted by Story 5.3 tests. No regression — covered transitively by Epic 4 tests; just unverified at this story's service-layer surface.
- rejected findings (5): `_logVlUnavailableOnce` cooldown-file racy read (low, O_EXCL still gates concurrent writers); `_defaultStartIso` week/month non-midnight snap (low, pre-existing behaviour retained for backward compat); test env-pollution patterns (`isValidDateStr.mockReturnValue` flip without restore) (low, pre-existing across the test suite); `module.exports = X; module.exports.X = X;` style nit (low, pre-existing pattern); missing happy-path file tests for the new file-path branches (low, legacy tests cover the same envelopes; new tests focus on the new behaviour).

### 2026-09-07 — Review pass (follow-up)

- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 0, medium 6, low 0)
- defer: 1 (high 0, medium 1, low 0)
- reject: 17 (see note)
- addressed_findings:
  - `[medium]` `[patch]` `_defaultEndIso('yesterday')` returned today's clock-as-of-call rather than yesterday's 23:59:59 — queries for the yesterday range silently included rows from today. Fixed; tests confirm.
  - `[medium]` `[patch]` `_isVlUnavailable` missed ECONNRESET / EPIPE / EAI_AGAIN / EHOSTUNREACH (axios + node:net surfaces these on socket teardown), and the status check accepted any number ≥ 500 (incl. 499 from nginx, 0 from a closed socket). Tightened to the standard 500-599 range and added the four node-level codes.
  - `[medium]` `[patch]` `_sumHits` only accepted numeric hits() values — older adapter shape returned stringified counts (`{ERROR: '4'}`) and the function returned 0 silently. Added a number coercion path.
  - `[medium]` `[patch]` `_vlFilter('')` concatenated to ` AND NOT (...)` (leading space) — invalid LogSQL, VL returns 400. Falls back to `*` when q is empty/whitespace.
  - `[medium]` `[patch]` `_getLogsInRangeFromVL` / `_getLogsInRangeFromFile` accepted negative or unbounded `limit`/`offset` and forwarded `- `-5` to the adapter (undefined behavior) and `slice(negative, negative)` for pagination. Clamped limit to `[0, 10000]` and offset to `>= 0`.
  - `[medium]` `[patch]` `_getLogFilesInRangeFromVL` walked any date span unbounded — a 10-year admin range allocated ~3650 descriptors and held them in memory. Added `MAX_LOG_FILES_RANGE_DAYS = 366` guard that returns `[]` + logs `range_too_wide`.
  - `[low]` `[patch]` (counts alongside the 6 medium above) duplicate JSDoc block on `_acquireReadLock` (stale `FileHandle|null` signature stacked over the corrected `{handle, lockPath}|null`) removed; `_acquireReadLock` non-string filePath now throws `TypeError` instead of `path.basename` throwing deeper in the call chain; `_getLogsSummaryFromVL` parallelized the two `hits()` calls via `Promise.all` (was sequential — doubles wall time); `_sourceMode` now trims + lowercases `ADMIN_LOGS_SOURCE` (operator footgun: `FILE`, ` file `, `File` all routed to VL silently); added 12 unit tests in a new `review follow-up — 2026-09-07 patches` describe block (limit clamp, MAX_DAYS, type guard, alias route, file-path envelope `limit/offset` round-trip, dual-emit `_vlFilter`, string hits(), `_defaultEndIso('yesterday')`, ECONNRESET classification, non-5xx rejection).
- deferred findings (logged for follow-on stories):
  - `[medium]` `[defer]` `VlFilesDisabledError` carries `statusCode:503` + `body:{error:'vl_files_disabled',…}` per AC, but the global error handler at `index.js:801-802` reads only `err.statusCode` and `err.message` — wire body is `503 {message:…}` with no `error` discriminator. Out of scope for this story's `files:` manifest (BFF shell owns `index.js`).
- rejected findings (17): LogSQL injection via double-quote / newline / semicolon in `term` (low, `_escapeLogSql` already strips reserved chars; production upstream callers are admin-only); `hits()` returning `{ERROR: '4', WARN: '2'}` shape (medium-now-patched — already in addressed list); `getDebugYesterday` rows.length===0 returns `success:true` with `lines:0` (low, intended "no records" semantic matches the legacy contract); filter value non-string primitive `[object Object]` coercion (low, admin UI sends strings only); `limit=-1`/`'NaN'` (low, clamped — already in addressed list); MAX_DAYS check on disk branch (low, file branch already capped by `readdir`); ECONNRESET/EPIPE/EAI_AGAIN/EHOSTUNREACH (medium-now-patched — already in addressed list); `ADMIN_LOGS_SOURCE` case/padding (low, trimmed — already in addressed list); `_vlFilter` empty q (medium-now-patched); status check 499/0 (low, tightened — already in addressed list); `_acquireReadLock` undefined filePath (low, type guard — already in addressed list); parallel `hits()` (low, optimized — already in addressed list); synthetic descriptor `service`/`source` field duplication (low, cosmetic, no consumer reads the field); `_escapeLogSql` parity risk with future adapter helper (low, deferred to Epic 4 follow-up); pre-existing `winston-transport` module-missing test failures across 4 unrelated suites (low, pre-existing — confirmed by stashing + re-running on baseline `51eb2e24a`); fs mock asymmetric vs new `fssync` dependency (low, test infra, only triggers if a future test exercises `_logVlUnavailableOnce` directly); `adminService.debugYesterdayLogs` reachable only via legacy routes (low, pre-existing route, Story 5.4 territory).

## Auto Run Result

**Summary:** Review-follow-up pass on a `done` story. Applied 12 patches (6 medium + 6 low) to harden edge-case paths surfaced by the four review layers; deferred 1 medium finding (VlFilesDisabledError wire boundary — out of story scope); rejected 17 findings as noise or pre-existing.

**Files changed:**

- `components/gov-chat-backend/services/logs-service.js` — patches: deleted stale duplicate JSDoc on `_acquireReadLock`; `_acquireReadLock` now throws `TypeError` on non-string/empty filePath; `_isVlUnavailable` extended with ECONNRESET/EPIPE/EAI_AGAIN/EHOSTUNREACH and tightened to `500 <= status < 600`; `_defaultEndIso('yesterday')` snaps to yesterday's 23:59:59 (was today's clock-as-of-call); `_vlFilter('')` falls back to `*` (was malformed ` AND NOT (...)`); `_sumHits` coerces string hits() values; `_sourceMode` trims + lowercases `ADMIN_LOGS_SOURCE`; `_getLogsSummaryFromVL` parallelized hits() calls via Promise.all; `_getLogsInRangeFromVL` + file-path branch clamp limit to [0, 10000] and offset to >= 0; `_getLogFilesInRangeFromVL` adds MAX_LOG_FILES_RANGE_DAYS=366 guard.
- `components/gov-chat-backend/__tests__/services/logs-service-vl.test.js` — new `review follow-up — 2026-09-07 patches` describe block with 12 tests (limit clamp, MAX_DAYS, type guard, alias route, file-path envelope limit/offset round-trip, dual-emit `_vlFilter`, string hits(), `_defaultEndIso('yesterday')`, ECONNRESET classification, non-5xx rejection, `_sourceMode` trim/lowercase, getDebugYesterday alias).

**Review findings breakdown:**

- Patches applied: 12 (6 medium, 6 low). Score: `3 × 6 + 1 × 6 = 24` (threshold 5) → `followup_review_recommended: true`.
- Items deferred: 1 (medium — `VlFilesDisabledError` wire boundary at `index.js:801-802`).
- Items rejected: 17 (LogSQL-injection speculation, cosmetic descriptor duplication, pre-existing winston-transport missing-module failures confirmed on baseline, etc.).

**Follow-up review recommendation:** `true`.

**Verification:**

- `npx jest --testPathPatterns logs-service-vl` → 36/36 pass (24 baseline + 12 new review follow-up).
- `npx jest --testPathPatterns logs-service` → 4 unrelated suites pre-existing fail with `Cannot find module 'winston-transport'`. Confirmed pre-existing by stashing the WIP commit + re-running on baseline `51eb2e24a` (same 17 failures).
- ESLint + Prettier (post-tool-use hook) clean.

**Residual risks:**

- VlFilesDisabledError wire body dropped by global error handler at `index.js:801-802`. Service-layer contract is correct; route layer is out of scope. Follow-on: error-handler update or route-level test. Deferred.
- VL_QUERY_TIMEOUT_MS continues to live only inside the MELT adapter (Epic 4). No regression; deferred.
- security-scan-service.js:231-246 path-string consumer breaks in default VL mode. Story 5.4 follow-on. Deferred.
- getLogsSummary VL path returns `service:'all'` (single bucket per level). No current consumer breaks (admin UI only displays). Story 5.4 / 5-8 contract test territory. Deferred.

