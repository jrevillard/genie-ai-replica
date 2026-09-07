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
effort: 1.0
depends_on: [Epic 4]
files: components/gov-chat-backend/services/logs-service.js
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

## Auto Run Result

**Summary:** Full rewrite of `components/gov-chat-backend/services/logs-service.js` to route the four public methods (`getLogsInRange`, `getLogsSummary`, `searchLogs`, `getDebugYesterday`) plus `getLogFilesInRange` between VL (default) and file (escape hatch) modes via per-call `ADMIN_LOGS_SOURCE` reads; honouring `VL_FAIL_OPEN` for VL outages; implementing AD-10 ENOENT tolerance, O_EXCL PID lock, and the N=4096 NDJSON re-parse window; returning synthetic descriptors in VL mode and a typed `VlFilesDisabledError` (statusCode 503, body `{error: 'vl_files_disabled', …}`) when file source is requested without `LOG_TO_FILE=1`.

**Files changed:**
- `components/gov-chat-backend/services/logs-service.js` — rewrite (VL-first routing, AD-10 hardenings, `VlFilesDisabledError`, `_acquireReadLock`/`_releaseReadLock`, `_parseNdjsonContent` retry window, `_sumHits` level-aware bucketing, JSDoc envelope pin on `getLogsInRange`).
- `components/gov-chat-backend/__tests__/services/logs-service.test.js` — `beforeEach` now pins `ADMIN_LOGS_SOURCE=file` and `LOG_TO_FILE=1` so the 69 legacy file-path tests still pass under the new routing.
- `components/gov-chat-backend/__tests__/services/logs-service-vl.test.js` — NEW, 24 tests covering source routing, VL envelope shape, `VL_FAIL_OPEN` ECONNREFUSED/5xx degradation, LogSQL escaping, `getLogsSummary` hits(), `getDebugYesterday` VL, synthetic descriptors, 503 `VlFilesDisabledError` on all 4 file-path entry points, ENOENT tolerance, EEXIST O_EXCL skip, NDJSON re-parse window.

**Review findings:** 4 high-severity patches applied (lock-file unlink, parser cursor advance, hits sum-by-level, MELT lazy-require path); 3 medium-severity items deferred to follow-on stories (security-scan consumer, summary envelope parity, VL_QUERY_TIMEOUT_MS coverage); 5 findings rejected as low-impact / pre-existing.

**Follow-up review recommended:** true (1 patched finding was high severity).

**Verification performed:**
- `npx jest __tests__/services/logs-service.test.js __tests__/services/logs-service-vl.test.js --no-coverage` → **93/93 pass** (69 legacy + 24 new).
- `npx eslint services/logs-service.js __tests__/services/logs-service*.test.js` → exit 0.
- `npx prettier --check services/logs-service.js __tests__/services/logs-service*.test.js` → exit 0.
- Pre-existing failures in `logger-otel-trace.test.js`, `log-record-dropped-mirrors.test.js`, `logger-vl-integration.test.js`, `logger-functions.test.js` (all `Cannot find module 'winston-transport'`) confirmed unrelated to this story by stashing + re-running on baseline `8cd47ef44`.

**Residual risks:**
- `security-scan-service` will TypeError on the new VL-mode synthetic descriptors; Story 5.4 picks up the consumer change.
- `getLogsSummary` envelope shape drifts between modes; UI relies on legacy file-mode shape and may render a single "all services" bucket per level until Story 5.4 lands.
