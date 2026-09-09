---
key: 6-2-security-scan-service-rewrite-processlogsinparallel-using-vi
title: "security-scan-service: rewrite `processLogsInParallel` using `VictoriaLogsClient.query` with sha1 bucket key + truncation guard + retention check + cache schema validation via AJV 8.17+"
epic: epic-6
status: done
followup_review_recommended: false
effort: 1.0
baseline_revision: 39bb32ba69d736ec9a7383338a07826d3a7d2d5d
depends_on: [6.1]
files: "components/gov-chat-backend/services/security-scan-service.js:105-313"
---

# Story 6.2 — security-scan-service: rewrite `processLogsInParallel` using `VictoriaLogsClient.query` with sha1 bucket key + truncation guard + retention check + cache schema validation via AJV 8.17+

**Epic**: epic-6 (1.0 SP)
**Files**: `components/gov-chat-backend/services/security-scan-service.js:105-313`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#6` for the epic-level acceptance criteria; this story is one contributing step.

**Concrete acceptance (added by Epic 6 review):**
- **Dedupe key = sha1** per AD-19: `sha1(record._time + '|' + record._stream.service + '|' + record._msg).slice(0, 16)` — NOT the literal `${_time}|${_stream.service}|${_msg}` from `phases.md` (which was a spec drift; AD-19 wins).
- **Truncation guard sets `degraded: true`** per AD-19 — do NOT loop with cursors.
- **Retention env var** = `VICTORIALOGS_RETENTION` (singular, `30d` format) — NOT `VICTORIALOGS_RETENTION_DAYS` (which doesn't exist).
- **AJV 8.17+** added to `components/gov-chat-backend/package.json` (`dependencies`). AD-12 forbids hand-rolled schema checks.
- **CLASS REFACTOR + setter injection**: convert `securityScanService` from singleton object literal to `class SecurityScanService` with `setVictoriaLogsClient(client)` setter (matches 9 sibling services convention). Wire setter in `index.js:1167-1215` with `typeof === 'function'` guard + log debug + idempotent (mirrors existing 6 setter-injection blocks). Add 1 new test group for setter (mirror `admin-dashboard-service.test.js:119-130`).

## Review Triage Log

### 2026-09-09 — Review pass (re-anchor)
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 29 (blind-hunter 21, edge-case 8 — bookkeeping meta-noise on the build-auto workflow's own status/baseline artifacts; no defect on the code surface the intent targets; intent alignment confirmed Reading B + C: lifecycle flip + re-anchor onto prior implementation commit `a1a9f9325`)
- addressed_findings:
  - none

### 2026-09-09 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7 (high 4, medium 2, low 1)
- defer: 0
- reject: 0
- addressed_findings:
  - `[high]` `[patch]` Added normalized/raw VictoriaLogs row compatibility so actual VictoriaLogsClient.query() results are classified and bucketed.
  - `[high]` `[patch]` Restored failedLogins and suspiciousActivities output parity and added P3 bulk/degradation test coverage.
  - `[high]` `[patch]` Added AJV to the backend lockfile as a direct dependency so npm ci remains valid.
  - `[high]` `[patch]` Removed worker_threads/processFile/story-reference text from service comments to satisfy the zero-match acceptance check.
  - `[medium]` `[patch]` Routed new bulk-scan logs through the project logger.
  - `[medium]` `[patch]` Added negative cache, retention-boundary, and generic-error fail-open tests.
  - `[low]` `[patch]` Reverted unrelated recommendation-string edits.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`

## Auto Run Result

Summary: Rewrote security scanning around a single VictoriaLogs bulk query, class-based service injection, SHA-1 dedupe buckets, truncation/retention degradation signals, AJV cache validation, and preserved scan output categories. Added P3 bulk/degradation tests and updated dependency lock metadata.

Files changed:
- `components/gov-chat-backend/services/security-scan-service.js` — class service, VictoriaLogs bulk query, normalized-row compatibility, scan classification, cache validation, and degraded behavior.
- `components/gov-chat-backend/index.js` — guarded VictoriaLogs client setter injection.
- `components/gov-chat-backend/package.json` — AJV dependency declaration.
- `components/gov-chat-backend/package-lock.json` — AJV lockfile resolution and dependency tree.
- `components/gov-chat-backend/__tests__/services/security-scan-service.test.js` — updated service tests and fixtures.
- `components/gov-chat-backend/__tests__/services/security-scan-vl-bulk.test.js` — normalized-row bulk-query and output-parity coverage.
- `components/gov-chat-backend/__tests__/services/security-scan-vl-degradation.test.js` — outage, retention, and invalid-cache coverage.
- `_bmad-output/implementation-artifacts/stories/6-2-security-scan-service-rewrite-processlogsinparallel-using-vi.md` — review result and final tracking state.

Review findings (this re-anchor pass): 0 patches, 0 deferred, 29 rejected (bookkeeping meta-noise on lifecycle artifacts). Follow-up review recommendation recomputed for this pass: false (0 patches, score 0). Prior implementation review (2026-09-09 above) remains the substantive record — 7 patches, high-severity coverage, score 7.

Files changed (this pass): spec file status flip in-review → done and `followup_review_recommended` true → false; no code surface touched (intentional — implementation predates baseline_revision 39bb32ba6).

Verification:
- `npx jest __tests__/services/security-scan --runInBand` — 3 suites, 93 tests passed.
- `npx eslint` on all touched JavaScript files — passed.
- `npx prettier --check` on all touched JavaScript files — passed.
- `npm ci --dry-run --ignore-scripts --no-audit --no-fund` — passed.
- Manual checks — `worker_threads`, `processFile`, and story-reference text removed from security-scan-service comments; no network calls in new tests.

Residual risks: AJV resolves to 8.20.0 from the declared `^8.17.0` range. The broader backend test run can still report four pre-existing logger-suite failures when `winston-transport` is absent from the isolated node_modules. Root `npm run lint` cannot start frontend lint because this worktree's frontend `node_modules` lacks the `eslint` binary; touched backend JavaScript passes targeted ESLint. Security-scan `SECURITY_SCAN_BACKEND=file` rollback behavior remains owned by story 6.4.
