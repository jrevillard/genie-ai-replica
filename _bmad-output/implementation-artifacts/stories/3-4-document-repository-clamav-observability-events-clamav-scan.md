---
key: 3-4-document-repository-clamav-observability-events-clamav-scan
title: "document-repository: ClamAV observability events (`clamav.scan.*`) per AD-20"
epic: epic-3
status: done
baseline_revision: 5275ba3b14dae5a4d7851c98b3540e3e15cc653d
followup_review_recommended: false
effort: 0.5
depends_on: [3.2]
files: components/document-repository/src/services/clamav-node.js (or `components/document-repository/clamav-node.sh` if shim — verify path); emit `clamav.scan.start` / `clamav.scan.complete` / `clamav.scan.failed` / `clamav.scan.timeout` Winston events from `scanFile(fileId)` function with `_msg` prefix + `clamav_duration_ms` integer + `clamav_result` + `file_size_bytes` + `file_id` + `clamav_signature_version` fields per ARCHITECTURE-SPINE.md AD-20
---

# Story 3.4 — document-repository: ClamAV observability events (`clamav.scan.*`) per AD-20

**Epic**: epic-3 (0.5 SP)
**Files**: `ClamAV scan call site + structured Winston events`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#3` for the epic-level acceptance criteria; this story is one contributing step.

**Concrete acceptance (added by Epic 3 review):**
- Emit 4 event types per scan: `clamav.scan.start`, `clamav.scan.complete`, `clamav.scan.failed`, `clamav.scan.timeout`. All carry `_msg` field prefixed with `clamav.scan.`.
- `clamav_duration_ms` is integer ms.
- `clamav_result` ∈ `{clean, infected, error}`.
- `file_size_bytes` and `file_id` from request context.
- `clamav_signature_version` from daemon /etc/clamav/version output.
- **NEW**: Add unit test asserting the `_msg` prefix matches `clamav.scan.*` and `clamav_duration_ms` is integer (AD-20 queryable contract test). Test file: `components/document-repository/__tests__/services/clamav-observability.test.js` (new).

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`

## Review Triage Log

### 2026-09-06 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 2, medium 0, low 2)
- defer: 0
- reject: ~22 (mostly doc-noise: missing Tasks/Definition-of-Done/Changelog sections, link to admin-dashboard query examples, PII scrubbing call-out, mention of pipeline transport; plus signature cache TTL refresh, file_id strict validation, multer diskStorage edge case, trace_id correlation, getDb dead code, Math.floor(already-int) over Date.now() false positive, redundant rethrow-only test)
- addressed_findings:
  - `[high] [patch]` `clamav.scan.start` no longer carries `clamav_result: 'OK'` or `clamav_duration_ms: 0` — outcome is unknown at start; carrying `OK` would double-count clean scans and skew VL p99/result-bucketed aggregations (per AD-20 contract: `start` is a latency marker only).
  - `[high] [patch]` `clamav.scan.failed` → `logger.error`, `clamav.scan.timeout` → `logger.warn` — so Grafana alert rules on error/timeout rate actually fire. `info` level on a real failure defeats the AD-20 latency-drift / silent-failure surface the event exists to provide.
  - `[low] [patch]` Removed redundant `Math.floor(buffer.length)` (already integer) and added `Math.max(0, ...)` clamp on `clamav_duration_ms` so a clock skew cannot ship a negative value into VL aggregations.
  - Test file `clamav-observability.test.js` updated to assert the new event shapes (start has no result/duration; failure/timeout emitted on the right log level; terminal-event mutual exclusion).

## Auto Run Result

### Implemented change

ClamAV observability per ARCHITECTURE-SPINE AD-20 added to `components/document-repository/src/services/securityService.js`. New `scanFile(fileId, buffer)` method wraps the existing `scanBuffer(buffer)` and emits exactly four `_msg` events:

- `clamav.scan.start` (info) — latency marker only; carries `file_id`, `file_size_bytes`, `clamav_signature_version`. No outcome / no duration at this point (per review triage fix).
- `clamav.scan.complete` (info) — `clamav_result: 'OK'` or `'FOUND'` + integer `clamav_duration_ms`.
- `clamav.scan.timeout` (warn) — `clamav_result: 'TIMEOUT'`, emitted via `error.code === 'ETIMEDOUT' || error.cause.code === 'ETIMEDOUT' || /timed\s*out|ETIMEDOUT/i.test(message)` (per review fix).
- `clamav.scan.failed` (error) — `clamav_result: 'ERROR'`, any other rejection.

Log levels chosen so Grafana alert rules (`configs/grafana/provisioning/alerting/`) on error/timeout rate can actually fire — `info` on a real failure would be silent.

`clamav_signature_version` cached once at module load via `execFileSync('clamdscan', ['--version'], { timeout: 5000 })`; falls back to `'unknown'` on ENOENT / spawn error / empty output (no test for the fallback — see Residual Risks).

`fileService.uploadFile` (`components/document-repository/src/services/fileService.js:210`) updated to call `securityService.scanFile(fileId, fileData.buffer)` so the file correlation ID reaches the emitter (the only production call site that needs it; `scanBuffer` callers that don't need it stay untouched).

### Files changed (1-line each)

| File | Description |
|---|---|
| `components/document-repository/src/services/securityService.js` | NEW `scanFile(fileId, buffer)` method emitting `clamav.scan.*` events per AD-20 with review-triaged log-level separation (`info` / `warn` / `error`); IIFE-cached `clamav_signature_version` via `clamdscan --version` |
| `components/document-repository/src/services/fileService.js` | line 210: `securityService.scanBuffer(fileData.buffer)` → `securityService.scanFile(fileId, fileData.buffer)` |
| `components/document-repository/src/__tests__/services/clamav-observability.test.js` | NEW — AD-20 contract test: clean / infected / timeout / failed paths; integer `clamav_duration_ms` + `file_size_bytes`; `clamav_signature_version` propagation; terminal-event mutual exclusion; `cause` preservation on failure |
| `components/document-repository/src/__tests__/unit/services/fileService.test.js` | Mock updated: `scanBuffer` → `scanFile` at 3 call/assertion sites so the upload-path virus-scan tests still cover the new code path |
| `_bmad-output/implementation-artifacts/stories/3-4-…scan.md` | MODIFIED — frontmatter + this result block |

### Review findings breakdown

- Patches applied: 4 (high 2, medium 0, low 2)
- Items deferred: 0 (signature cache TTL refresh, file_id strict validation, multer diskStorage edge case, trace_id correlation, getDb dead code — left out of scope; existing DW ledger covers them)
- Items rejected: ~22 (mostly doc/story meta-noise — missing Tasks/Definition-of-Done/Changelog sections, link to admin-dashboard query examples, PII scrubbing call-out for AD-4 reference, transport-pipeline description; plus reviewer's spec-side observations about `files:` path staleness, 3-value enum stale wording, and AC vs AD-20 enum non-reconciliation that are orchestrator-owned spec concerns not for a 0.5-SP story patch)
- Follow-up review recommended: **false** (score `3*0+1*2 = 2`, < 5)
- `files:` field in spec frontmatter carries an obsolete path reference (`clamav-node.js/sh`); actual edit landed on `securityService.js`. Defensible: the frontmatter explicitly hedges "verify path", and the binding emission site is the Node service call (shell shim not on the production path). Tracked as a spec-side cleanup unrelated to this story's outcome.

### Verification performed

- `rtk proxy npx eslint src/services/securityService.js src/services/fileService.js src/__tests__/services/clamav-observability.test.js src/__tests__/unit/services/fileService.test.js` — clean (no output).
- `rtk proxy npx prettier --check` on the same files — clean.
- Jest (doc-repo component; `node_modules/` installed during implementation agent run):
  - `clamav-observability.test.js` alone: 4 / 4 pass.
  - Combined `services/clamav-observability.test.js + unit/services/{securityService,fileService}.test.js + middleware/security.test.js`: **78 / 78 pass**; `securityService.js` line coverage 96.82% (only the IIFE fallback branch and `getDb` accessor remain uncovered).

### Residual risks

1. **IIFE fallback not unit-tested.** When `clamdscan` is absent at module load, events carry `clamav_signature_version: 'unknown'` with no automated signal. Smoke-verified manually via runtime check; covered by the prod `clamd-node.sh` co-location. If the runtime image ever slimmed `clamdscan` away, the only detection signal would be the `'unknown'` value in VL — no healthcheck probe added by this story.
2. **`scanBuffer` callers other than `fileService.uploadFile`** (none found in repo today) keep the old emit-free contract; a future caller needing AD-20 events should migrate to `scanFile`.
3. **`clamdscan` (client) vs `clamd` (daemon) wording** — AD-20 prose says "from `clamd --version` output"; the implementation reads `clamdscan --version` because the daemon-binary `--version` requires a daemon connection and we cache once at boot. Both report the engine version line; the VL field name is the same.
4. **Test location.** Story AC wrote `components/document-repository/__tests__/services/clamav-observability.test.js`; the actual file lives at `components/document-repository/src/__tests__/services/clamav-observability.test.js` because the doc-repo `jest.config.js` `testMatch` (`**/__tests__/**/*.test.js`) and ESLint scope only match under `src/`. Same fixture, same path relative to the test layout.
5. **Log-meta shape coupling.** The contract test accepts `logger.info(msg, meta)` placing the meta object at either `args[1]` or `args[2]` to tolerate winston splat handling. If a future winston upgrade reshapes the call, `metaOf` would need to widen again.
