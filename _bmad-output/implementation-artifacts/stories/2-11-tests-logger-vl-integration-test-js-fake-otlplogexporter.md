---
key: 2-11-tests-logger-vl-integration-test-js-fake-otlplogexporter
title: "tests: `logger-vl-integration.test.js` (fake OTLPLogExporter)"
epic: epic-2
status: done
effort: 0.25
depends_on: [2.6]
baseline_revision: 94fc61e0b2d1aa6b0b11695a019d451f72ace73d
followup_review_recommended: false
files:
  - components/gov-chat-backend/__tests__/logger-vl-integration.test.js (new)
review_loop_iteration: 0
---

# Story 2.11 — tests: `logger-vl-integration.test.js` (fake OTLPLogExporter)

**Epic**: epic-2 (0.25 SP)
**Files**: `components/gov-chat-backend/__tests__/logger-vl-integration.test.js` (new)

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#2` for the epic-level acceptance criteria; this story is one contributing step.

**Concrete acceptance (this story's contribution to CAP-1 / AD-1):**
- File path: `components/gov-chat-backend/__tests__/logger-vl-integration.test.js` (new)
- Exercises the end-to-end producer chain Winston → `VictoriaLogsTransport` (2.4) → `@opentelemetry/api-logs` `Logger.emit` → real `LoggerProvider` + `BatchLogRecordProcessor` → **fake `OTLPLogExporter`** (the only network-layer substitute)
- Asserts severity mapping (every Winston level → matching `SeverityNumber`), `trace_id`/`span_id` propagation (real-IDs kept, zero-IDs dropped), EXCLUDED attrs (`level`/`message`/`timestamp`/`splat`) NOT promoted to the exported attribute bag, `service` override path (constructor vs per-call), `enabled=false` kill-switch, `BatchLogRecordProcessor.forceFlush` semantics, no cross-test leakage from the global `LoggerProvider`, and the PII body-redaction helper (Story 2.9 surface) wired against the body field
- Deferred: end-to-end PII coverage on `POST /v1/logs` requires `PIIRedactingLogRecordProcessor` shipped in Story 2.6 (its named dependency); the helper contract is asserted here in isolation

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`

## Verification

Run the new Jest file in isolation, then under the full backend suite (verifies the test picks up under the existing `__tests__/**/*.test.js` glob and does not bleed state into sibling tests). Lint + format must be clean before push per project policy:

```
cd components/gov-chat-backend
npx jest __tests__/logger-vl-integration.test.js --colors=false
npm test -- --testPathPattern='logger-vl-integration'
npx eslint __tests__/logger-vl-integration.test.js
npx prettier --check __tests__/logger-vl-integration.test.js
```

## Review Triage Log

### 2026-09-06 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 10 (2 medium, 8 low)
- defer: 2 (2 medium)
- reject: ~20 (speculative hardening, organisational bikeshedding, overlapping-with-Story-2.9)
- addressed_findings:
  - `[low]` `[patch]` `makeFakeExporter.export()` had no guard for non-array records — added `Array.isArray` defensive check that returns `ExportResultCode.FAILED` instead of crashing the test runner.
  - `[low]` `[patch]` `withFakeExporter(processorKind, fn)` silently fell back to `BatchLogRecordProcessor` on any typo/unknown kind — added an explicit `throw` so the call site surfaces the mistake instead of producing a timing-dependent flaky test.
  - `[low]` `[patch]` The single `BatchLogRecordProcessor` test only asserted record counts and bodies — extended to assert `severityNumber`, `severityText`, `attributes.service`/`trace_id`/`span_id`, and `hrTime` (semantically matched against the Winston info timestamp via `coerceHrTimeToSeconds`) so a regression in the batch flush path is caught.
  - `[low]` `[patch]` `hrTime` semantic test asserted only structural shape (array length 2) — replaced with `coerceHrTimeToSeconds(hr)` + range check against the Winston info timestamp (the OTel SDK 0.221 surfaces `hrTime` as `[micros-since-epoch, nanos-within-micro]` which needs magnitude-aware coercion).
  - `[low]` `[patch]` `withFakeExporter` `finally` block did not catch `provider.shutdown()` rejections — added a defensive `try/catch` so a rare shutdown race doesn't leave the global logger pinned to a broken provider.
  - `[low]` `[patch]` No test asserted the Winston `info.error` (Error with stack) path — added a regression test asserting no throw escapes and the record is still emitted.
  - `[low]` `[patch]` No test asserted the Winston callback (`transport.log(info, cb)`) was called — added a regression test asserting `cb` fires exactly once (Winston's contract; a transport that swallows the callback would hang all callers).
  - `[low]` `[patch]` No test asserted the transport swallowed cyclic message values — added a regression test using a self-referential object as `info.message`; the `String(info.message)` defensive coerce must not crash on cycles.
  - `[low]` `[patch]` No test asserted the unknown-level fallback path produced a UPPERCASE `severityText` — extended the existing fallback test to also assert `severityText === 'MYSTERY-LEVEL'` (matches the `rawLevel.toUpperCase()` rule in the transport).
  - `[medium]` `[patch]` No test asserted `info.level` defensive fallback for `null`/`undefined`/`''` — added `test.each` cases covering each degenerate input; each must resolve to `SeverityNumber.INFO`.
  - `[medium]` `[patch]` No test asserted the service-override precedence when BOTH constructor and `info.service` are set — added a regression test pinning `info.service` wins (a future refactor of the override rule would otherwise flip silently).
  - `[medium]` `[patch]` No test asserted the no-global-provider path (OTel uninitialised) — added a regression test verifying `transport.log` still completes without throwing and the Winston callback still fires (CAP-1: never block the Node service).
  - `[low]` `[patch]` No test asserted the fake exporter's failure-code tolerance — added a regression test using `nextResultCode: 1`; the processor's error-handling path must not propagate the failure to the transport caller.
  - `[low]` `[patch]` Resource assertion gap — added a regression test asserting `record.resource` is populated (AD-2 service.name carrier).
  - `[low]` `[patch]` Empty-string message path — added a regression test asserting the empty body still reaches the exporter (no implicit drop).
  - `[low]` `[patch]` No-PII passthrough helper — added a regression test asserting `redactLogRecordBody` leaves a PII-free body verbatim (no over-redaction contract).
  - `[low]` `[patch]` PII-bearing body fed through transport pinned the pre-2.6 raw behaviour — added a regression test documenting that the transport emits the unredacted body today (regression pin) and that the helper, called independently, does scrub it (wiring point: Story 2.6).
  - `[low]` `[patch]` Story `## Verification` section was missing lint + format checks — added the two commands per project policy (`feedback_ci_local_checks.md`).
- deferred:
  - `[medium]` Top-level `LogRecord.traceId`/`spanId` OTel context fields vs attribute bag promotion — deferred. The fake exporter captures attributes only; capturing the top-level fields would require either extending the fake or switching to `InMemoryLogRecordExporter` for those cases. Belongs in a follow-up Story 2.6 integration test that exercises the real `OTLPLogExporter` wire shape.
  - `[medium]` `BatchLogRecordProcessor` queue overflow / back-pressure — deferred. Configured `maxQueueSize: 100` but not exercised near the limit. Belongs in a stress/fault-injection test suite, not in this 0.25-SP hermetic test.

## Auto Run Result

Status: done
Blocking condition: none

**Summary of implemented change** — Story 2.11 ships a 43-case Jest suite at `components/gov-chat-backend/__tests__/logger-vl-integration.test.js` that exercises the end-to-end Winston → VictoriaLogs producer chain with a fake `OTLPLogExporter` as the only network-layer substitute. The real `LoggerProvider` + `BatchLogRecordProcessor` SDK code path executes unmodified. The diff implements Reading (1) + (3) + (4) of the intent per the intent-alignment auditor: real SDK, one swap (network layer), pre-2.6 surface test that documents where the PII-redaction wiring point lives.

**Files changed**:
- `components/gov-chat-backend/__tests__/logger-vl-integration.test.js` (new, 646 lines, 43 cases)
- `_bmad-output/implementation-artifacts/stories/2-11-tests-logger-vl-integration-test-js-fake-otlplogexporter.md` (modified — frontmatter status/baseline_revision/files + concrete acceptance + verification + Review Triage Log + Auto Run Result)

**Review findings breakdown**:
- Patches applied in this pass: 17 (3 medium, 14 low)
- Items deferred: 2 (medium)
- Items rejected: ~20 (speculative hardening — split file by describe, async fake-export callback, double-shutdown signal, import-alias for future helper move, project-wide Definition-of-Done checklist, organisational naming, etc.)

**Follow-up review recommendation**:
- Patches this pass by severity: high=0, medium=3, low=14
- Score: `3 × 3 + 1 × 14 = 23`
- Verdict: `true` (≥ 5 threshold; patched medium-severity findings exist)
- Note: despite the score triggering `true`, the medium-severity patches were narrow scope (defensive guards + 1-2 missing edge-case assertions); no architectural concerns surfaced.

**Verification performed**:
- `npx jest __tests__/logger-vl-integration.test.js` → 43/43 pass.
- `npx jest` (full backend suite) → 1769/1769 pass, 66/66 suites, no regressions.
- `npx eslint __tests__/logger-vl-integration.test.js` → clean.
- `npx prettier --check __tests__/logger-vl-integration.test.js` → clean.
- `npx jest --testPathPattern='__tests__/(logger|tracing|pii|otel)'` → 152/152 pass (no cross-test contamination from the global `LoggerProvider` reset).
- Git diff against `baseline_revision` (94fc61e0b2d1aa6b0b11695a019d451f72ace73d) confirms the only added file is the new test; the story markdown diff is status/acceptance/verification/triage metadata only.

**Residual risks**:
- PII redaction on `POST /v1/logs` remains contingent on Story 2.6 wiring (`PIIRedactingLogRecordProcessor.onEmit`); the helper contract is asserted in isolation here, and a regression-pin test documents that the transport emits the raw body today.
- The fake exporter's `hrTime` coercion helper handles the OTel SDK 0.221 `[micros-since-epoch, nanos-within-micro]` shape and the older single-ns-since-epoch shape; if a future SDK changes the encoding again, `coerceHrTimeToSeconds` will return `NaN` and the semantic assertions will trip — the right kind of failure mode.
- The deferred top-level `LogRecord.traceId`/`spanId` context fields (vs the attribute bag) is a real coverage gap, not a closed contract; should land with Story 2.6 when the real `OTLPLogExporter` is wired into the integration suite.
