---
key: 2-12-prometheus-log_record_dropped_total-reason-counter
title: "Prometheus: `log_record_dropped_total{reason=...}` counter"
epic: epic-2
status: done
effort: 0.25
baseline_revision: 3f8adc95cfaa71aad218906fb5dfc3f69a3fd846
depends_on: [2.4, 2.5, 2.6]
files: components/gov-chat-backend/metrics.js (counter definition); components/shared/lib/victorialogs-transport.js (queue_full call-site); components/shared/lib/logger.js (observability_disabled call-site); components/gov-chat-backend/tracing.js (otlp_unreachable call-site)
followup_review_recommended: false
review_loop_iteration: 0
deferred:
  - summary: >-
      No Grafana dashboard panel or alert rule provisioned for `log_record_dropped_total`
      in `configs/grafana/provisioning/`; the metric ships without an operator-facing surface.
    evidence: |-
      The metric name is referenced only in code; no dashboard JSON or alert YAML in
      `configs/grafana/provisioning/dashboards/` or `configs/grafana/provisioning/alerting/`
      declares `log_record_dropped_total`. Spec did not require this; a follow-up
      dashboards/alerting story should land at least one panel and one alert
      (e.g. rate > 0 for `otlp_unreachable` for 5m).
    severity: medium
  - summary: >-
      Counter payload lacks triage context (dropped log level, queue depth, otlp endpoint);
      cardinality constraint makes adding labels safe but the metric is too thin to act on
      in Prometheus without joining other signals.
    evidence: |-
      Every `.add(1, { reason })` call passes only the bounded reason label; no
      `level`, `endpoint`, or `queue_depth` attribute is included. Spec did not
      require extra labels; reviewer flagged this as a follow-up.
    severity: low
  - summary: >-
      `observability_disabled` counter increments on every Winston log emit when
      observability is OFF, putting OTel counter overhead on the very environment
      where ops will be looking for the metric; consider sampling or a first-record latch.
    evidence: |-
      `shared/lib/logger.js` `traceFormat()` calls `_droppedCounter.add(1, ...)` on
      every no-span log emit when `process.env.ENABLE_OBSERVABILITY !== '1'`. Steady
      nonzero counter at any non-trivial log volume.
    severity: low
  - summary: >-
      `OBSERVABILITY_DISABLED` latch evaluated once at module load; if a sibling
      module requires `shared/lib/logger.js` before `process.env.ENABLE_OBSERVABILITY`
      is finalized in a test fixture, the latch captures the wrong value.
    evidence: |-
      Same pattern exists in `components/gov-chat-backend/tracing.js` for the
      `NODE_ENV`/`ENABLE_OBSERVABILITY` test-mode guard; the existing pre-existing
      pattern is being followed. Future refactor could re-read env per emit.
    severity: low
  - summary: >-
      `mobile/`, CLI scripts, or dev tooling that require `shared/lib/logger.js`
      without the OTel SDK initialized will read the OTel global at require time.
    evidence: |-
      `shared/lib/logger.js` now calls `otelMetrics.getMeter(...)` at module load
      (guarded by PATCH 2 IIFE try/catch since this run — the guard absorbs the
      throw and falls through to a no-op stub, but downstream code may still
      observe different behavior). Mobile consumers of shared/lib logger should
      be smoke-tested.
    severity: low
  - summary: >-
      No integration-style assertion that Prometheus can scrape `log_record_dropped_total`;
      unit tests prove `.add()` is called but not that the series appears in scrape output.
    evidence: |-
      No `@opentelemetry/exporter-prometheus` contract test renders the registry
      and checks for the series. A future contract-test story should add it.
    severity: low
  - summary: >-
      Runtime increment tests for the `observability_disabled` (logger.js) and
      `queue_full` (victorialogs-transport.js) call-sites fell back to static
      source-pattern checks; jest.mock does NOT intercept requires issued from
      files outside the test rootDir, so the real `@opentelemetry/api` and
      `@opentelemetry/api-logs` packages are loaded regardless of `jest.mock`,
      `moduleNameMapper`, or `roots` config.
    evidence: |-
      The same module-mocking limitation also breaks 7 PRE-EXISTING tests in
      `logger-otel-trace.test.js` (verified against base commit 3f8adc95c). The
      runtime path is therefore exercised manually against a real OTel SDK stack
      (not in this story's verification scope). A follow-up that restructures
      shared/lib tests under a backend rootDir, or moves the relevant tests
      alongside the modules they exercise, would unlock real runtime coverage.
    severity: medium
---

# Story 2.12 — Prometheus: `log_record_dropped_total{reason=...}` counter

**Epic**: epic-2 (0.25 SP)
**Files**: `components/gov-chat-backend/metrics.js`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#2` for the epic-level acceptance criteria; this story is one contributing step.

**Concrete acceptance (added by Epic 2 review):**
- Define counter NAME + REASON ENUM in this story: `log_record_dropped_total` with reasons `{ queue_full, otlp_unreachable, observability_disabled }` (per `phases.md:29`, AD-7, Q-4 RESOLVED).
- **NO shared `recordLogDropped(reason)` helper** — AD-18 forbids `shared/lib → backend` require. Each call-site file (queue_full transport, observability_disabled logger, otlp_unreachable tracing.js) creates its own counter instance at module load: `const droppedCounter = getMeter().createCounter('log_record_dropped_total', { description: 'Otel log records dropped before export' })`. Increment with `.add(1, { reason: 'queue_full' })` (or the appropriate enum).
- Reasons as enum consts prevent cardinality leaks; reject string literals outside the enum.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`

## Review Triage Log

### 2026-09-06 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4
- defer: 7
- reject: 6
- addressed_findings:
  - `[medium]` `[patch]` Strip "Story 2-12" / "Story 2-4/5/6" refs from code comments (memory rule: no story/FR/AC/D numbers in code comments). Renamed describe block, dropped story-id phrases from JSDoc and inline comments; AD-18 / AD-7 references kept (architecture-decision IDs, not story numbers).
  - `[medium]` `[patch]` Module-load counter creation in shared/lib logger.js, shared/lib victorialogs-transport.js, and backend tracing.js was unguarded. Wrapped each `getMeter().createCounter(...)` call in IIFE try/catch that falls through to a `{ add: () => {} }` no-op stub if the OTel SDK is absent or `createCounter` throws — module load now never fails because of telemetry init.
  - `[medium]` `[patch]` Call-site runtime increment tests for `otlp_unreachable` were missing. Added a test in `__tests__/tracing-non-test.test.js` that makes `mockStart.mockImplementationOnce(() => { throw ... })` and asserts the counter spy was called with `(1, { reason: 'otlp_unreachable' })` — passes.
  - `[low]` `[patch]` Parity test between canonical enum (metrics.js) and shared/lib mirrors (logger.js, victorialogs-transport.js) was missing. Added new file `__tests__/log-record-dropped-mirrors.test.js` with 5 assertions — passes.

Patches triaged but score of 10 (3 medium × 3 + 1 low × 1) ≥ 5 → `followup_review_recommended: true`.

### 2026-09-06 — Follow-up review pass (orchestrator-triggered)
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: rest
- addressed_findings:
  - `[info]` `[defer-skipped-orchestrator]` Intent-alignment audit reports structural vs. behavioral reading divergence: tests for `queue_full` and `observability_disabled` are static source-pattern checks rather than runtime assertions (jest.mock does not reach shared/lib requires; architectural boundary). The runtime-assertion gap and follow-up test-infrastructure fix are already tracked in `deferred:` entry "Runtime increment tests for the observability_disabled (logger.js) and queue_full (victorialogs-transport.js) call-sites fell back to static source-pattern checks" (medium). Orchestrator owns the ledger; not re-opened.
  - `[info]` `[defer-skipped-orchestrator]` Edge-case concerns re-raised: (a) sdk.start() may throw async — covered by code comment ("SDK init failure detector is a follow-up"); (b) `log_record_dropped_total` may collide with Prometheus exporter `_total_total` suffix or be rejected — covered by deferred entry "No integration-style assertion that Prometheus can scrape `log_record_dropped_total`" (low); (c) `observability_disabled` increments on records still written to file/console — covered by deferred entry "`observability_disabled` counter increments on every Winston log emit when observability is OFF" (low); (d) duplicate instrument creation across three call-sites — covered by deferred entry "No integration-style assertion that Prometheus can scrape `log_record_dropped_total`" (low) and AD-18 constraint; (e) module-load latch cannot be re-evaluated — covered by deferred entry "`OBSERVABILITY_DISABLED` latch evaluated once at module load" (low).
  - `[info]` `[reject]` Edge-case claims that are spec-intentional or out of scope: (a) `tracing.js` catch labels any sdk.start() throw as `otlp_unreachable` — spec acceptance text says exactly this ("increments the dropped counter when the SDK init throws"); (b) `_enabled` switch in transport silently no-ops without counter increment — pre-existing behavior unrelated to this story; (c) `tracing.js` exports no SDK when `ENABLE_OBSERVABILITY != '1'` — pre-existing pattern unchanged by this story; (d) counter unit not declared — OTel default behavior; (e) `metrics.test.js` block does not cover real call-sites — file scope is the canonical metrics module, call-site coverage lives in call-site test files.
  - `[info]` `[reject]` Intent-alignment auditor Gap 2 ("cardinality discipline is structural, not runtime-enforced; a bare string `.add(1, { reason: 'queue_full' })` would pass all tests") — the spec acceptance text states "reject string literals outside the enum" as a review-time discipline, not a runtime guard; the parity test catches mirror drift, the frozen enum prevents accidental canonical widening. Runtime wrapping of every `.add()` to validate the label was not requested.

Patches triaged: 0. Score = 0 < 5 → `followup_review_recommended: false`.

## Auto Run Result

**Summary**: Follow-up review pass on a previously-`done` spec (Story 2-12 — Prometheus `log_record_dropped_total{reason=...}` counter). The orchestrator flagged the `done` row as bookkeeping not proof of verification, so a fresh review was triggered. Four review layers (blind-hunter, edge-case-hunter, verification-gap, intent-alignment) ran in parallel against the diff from baseline `3f8adc95c` to HEAD `5d56f0c9a`. No code changes were applied.

**Files reviewed (no changes in this pass)**:
- `components/gov-chat-backend/metrics.js` — canonical `LOG_DROPPED_REASON` (frozen) + `LOG_RECORD_DROPPED_TOTAL` constant.
- `components/gov-chat-backend/tracing.js` — `otlp_unreachable` call-site via IIFE-guarded module-load counter + try/catch around `sdk.start()`.
- `components/shared/lib/logger.js` — `observability_disabled` call-site via IIFE-guarded module-load counter + no-span branch increment.
- `components/shared/lib/victorialogs-transport.js` — `queue_full` call-site via IIFE-guarded module-load counter + log() catch increment.
- Test files: `metrics.test.js`, `tracing-non-test.test.js`, `logger-otel-trace.test.js`, `victorialogs-transport-queue-full.test.js` (new), `log-record-dropped-mirrors.test.js` (new).

**Review findings breakdown**:
- Patches applied: 0 (all candidate fixes either match spec intent or are already covered by `deferred:` entries).
- Items deferred: 0 added this pass (orchestrator owns the deferred-work ledger; 5 distinct concerns raised by reviewers were already represented in the existing 7-entry `deferred:` list).
- Items rejected: remaining noise (spec-intentional behavior, pre-existing patterns outside this story's scope, orthogonal test-quality nits).

**Follow-up review recommendation**: false (0 patches this pass; score 0 < 5).

**Verification performed**:
- Read full diff (baseline `3f8adc95c` → HEAD `5d56f0c9a`): 749 insertions, 11 deletions across 11 files (4 production + 5 tests + 1 spec + 1 ledger carry-forward).
- Read existing `deferred:` frontmatter entries; confirmed reviewer concerns from this pass overlap (intentionally not re-opened per orchestrator constraint).
- Inspected test coverage matrix: tracing.js has runtime assertion (synthetic mockStart throw → counter.add with otlp_unreachable reason), queue_full and observability_disabled have static source-pattern checks due to jest.mock not reaching `components/shared/lib/*`. This asymmetry matches the documented test gap.
- Production code surface: AD-18 honored (no shared/lib → backend require); frozen canonical enum; module-load counters guarded by IIFE try/catch; increments guarded by inner try/catch on the critical log path.

**Residual risks**:
- Test asymmetry for shared/lib call-sites remains a follow-up (already deferred).
- Prometheus exporter-side contract test (`_total_total` suffix normalization) not exercised (already deferred).
- Grafana dashboard/alert surface not provisioned for the new metric (already deferred).


