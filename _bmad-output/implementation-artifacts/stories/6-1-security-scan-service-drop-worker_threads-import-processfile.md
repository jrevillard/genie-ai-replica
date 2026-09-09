---
key: 6-1-security-scan-service-drop-worker_threads-import-processfile
title: "security-scan-service: drop `worker_threads` import + `processFile` + worker block"
epic: epic-6
status: in-progress
followup_review_recommended: false
deferred:
  - summary: >-
      security-scan-service.js:11 `TIMEOUT_PERIOD = 200000` is now dead — its only
      consumer (the deleted worker block's `processLine`) is gone. Removal
      belongs in story 6.2 cleanup.
    evidence: |-
      `grep -n TIMEOUT_PERIOD` in the service file returns only the declaration;
      no remaining usage.
    location: >-
      components/gov-chat-backend/services/security-scan-service.js:11
    severity: low
  - summary: >-
      security-scan-service.js:283 `this.processFile(...)` is now a dead call.
      Story 6.2 replaces the caller with a VictoriaLogs-backed pipeline.
    evidence: |-
      Intent explicitly assigns ownership of the call site to story 6.2.
      Leaving it untouched is the intentional scope boundary for 6.1.
    location: >-
      components/gov-chat-backend/services/security-scan-service.js:283
    severity: medium
  - summary: >-
      __tests__/services/security-scan-service.test.js:74 still mocks
      `worker_threads` even though the service no longer requires it.
    evidence: |-
      Stale `jest.mock('worker_threads', ...)` after production require removed.
      No runtime impact but misleading coverage signal.
    location: >-
      components/gov-chat-backend/__tests__/services/security-scan-service.test.js:74
    severity: low
  - summary: >-
      __tests__/services/security-scan-service.test.js:686 `jest.spyOn(securityScanService,
      'processFile')` will throw on Jest 30 (`Cannot spy the undefined property
      "processFile"`). Lines 755/766 plain-assign but do not exercise the call
      site, so the regression is invisible to CI.
    evidence: |-
      Project pins `jest ^30.5.0` in package.json:121; Jest 30 refuses spyOn on
      undefined own properties.
    location: >-
      components/gov-chat-backend/__tests__/services/security-scan-service.test.js:686
    severity: high
  - summary: >-
      Same `processFile` test mock at lines 755 and 766 silently bypasses the
      call path under test. Cleanup owned by story 6.3.
    evidence: |-
      Plain `securityScanService.processFile = jest.fn()...` assignments work
      regardless of prior definition but do not assert the aggregation pipeline
      is wired.
    location: >-
      components/gov-chat-backend/__tests__/services/security-scan-service.test.js:755
    severity: medium
effort: 0.25
depends_on: [Epic 4]
files: "components/gov-chat-backend/services/security-scan-service.js:9, 418, 1015-1125"
baseline_revision: a05c4b10c6cafb98ef3a8f493d74fa10b1cdb925
---

# Story 6.1 — security-scan-service: drop `worker_threads` import + `processFile` + worker block

**Epic**: epic-6 (0.25 SP)
**Files**: `components/gov-chat-backend/services/security-scan-service.js:9, 418, 1015-1125`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#6` for the epic-level acceptance criteria; this story is one contributing step.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`

## Review Triage Log

### 2026-09-09 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 5 (high 1, medium 2, low 2)
- reject: 15
- addressed_findings:
  - none

**Notes.** Blind-hunter raised 19 findings, edge-case 3, verification-gap 2, intent-alignment 0 actionable. After dedup: 5 real findings, all out-of-scope for 6.1 per the intent's explicit ownership boundaries. (a) `TIMEOUT_PERIOD` is now dead — spirit-aligned with the surgical removal but technically outside the three enumerated removals; defer to 6.2 cleanup. (b) Caller at line 283 is owned by 6.2. (c)–(e) Test-file mocks/spies at lines 74, 686, 755/766 are owned by 6.3. ~15 other blind-hunter items (missing-replacement, lifecycle, gzip/readline successor, performance regression, deprecation shim, console.error→winston, persistence/retrieval, patterns re-load, startTime, ADR/CHANGELOG, story reference, fs/readline/zlib requires) are all scope-out by intent design — story 6.2 rewrites the caller with a VictoriaLogs-backed pipeline; 6.4 verifies file-fallback; pre-existing `console.error`/`console.log` patterns are project-wide and outside this story. Follow-up review not recommended: 0 patches applied, score 0 < 5.

## Auto Run Result

**Status:** done

**Summary of implemented change.** Removed the `worker_threads` require statement, the `processFile` method definition, and the bottom-of-file `if (!isMainThread) { ... }` worker block from `components/gov-chat-backend/services/security-scan-service.js`. Pure deletion: −126 lines, 0 insertions. The call site at line 283 (`this.processFile(...)`) is intentionally left in place — story 6.2 owns the rewrite of `processLogsInParallel` to a VictoriaLogs-backed pipeline.

**Files changed.**

- `components/gov-chat-backend/services/security-scan-service.js` — dropped `worker_threads` import, `processFile` method, and the bottom worker block. Three hunks; `module.exports = securityScanService;` is now the last line.

**Review findings breakdown.**

- Patches applied: 0
- Items deferred: 5 — `TIMEOUT_PERIOD` dead constant (low); caller at line 283 (medium); stale `jest.mock('worker_threads', ...)` at test line 74 (low); broken `jest.spyOn` at test line 686 (high); plain `processFile` assignments at test lines 755/766 (medium)
- Items rejected: 15 — all "missing replacement" / "lifecycle unspecified" / "no documented successor" / "no ADR" / "no benchmark" findings that the intent explicitly assigns to stories 6.2/6.3/6.4

**Follow-up review recommendation.** false. Patches applied this pass: 0 (high 0, medium 0, low 0). Score = 3·0 + 1·0 = 0 < 5.

**Verification performed.**

- `grep -n "worker_threads" components/gov-chat-backend/services/security-scan-service.js` → 0 matches
- `grep -nE "Worker|isMainThread|parentPort|workerData" components/gov-chat-backend/services/security-scan-service.js` → 0 matches
- `grep -n "processFile" components/gov-chat-backend/services/security-scan-service.js` → 1 match at line 283 (the call site, owned by 6.2)
- `node -c components/gov-chat-backend/services/security-scan-service.js` → SYNTAX_OK

**Residual risks.**

- The test suite will fail at `security-scan-service.test.js:686` (`jest.spyOn` on undefined `processFile`) until story 6.3 lands. CI will surface this; it is owned by 6.3 per the intent.
- The call site at line 283 will throw `TypeError: this.processFile is not a function` in any non-VL deployment scan until story 6.2 lands. Intentional progressive-rollout intermediate state.
