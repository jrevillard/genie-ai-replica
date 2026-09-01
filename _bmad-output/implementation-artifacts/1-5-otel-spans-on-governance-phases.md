---
baseline_commit: fa9ce07bd
---

# Story 1.5: OTel spans on the governance phases

Status: review

## Story

As an operator debugging the SST tool pipeline,
I want one span per governance phase (pre / runtime / post) with non-PII attributes,
so that phase latencies (NFR28 < 50 ms pre, NFR29 < 200 ms post) and decisions are visible in VictoriaTraces without exposing redacted content (NFR31).

## Current State (verified on `feat/sst` 2026-09-01, post-2-4 `fa9ce07bd`)

- `workflows/tools/governance.py` (the 3-phase `GovernancePipeline`) has **no tracing import** — zero instrumentation (sprint-status evidence stands).
- `execute()` (`governance.py:336-370`) is the single funnel: pre → (early-return + post if blocked) → runtime → post. The three phase methods (`_pre_execution`, `_runtime`, `_post_execution`) are already cleanly separated — the spans wrap the calls in `execute()`, one place.
- **The tracing API is pinned by the epic**: `tracing.with_span(name, tracer_name=..., attributes=...)` (`genie-ai-overlay/tracing.py:250-268`) — a context manager returning the span; auto error-status + record_exception; no-op when tracing is disabled. **`@tracing.trace_span` does NOT exist** (epic warns explicitly).
- Test assertion pattern to follow: `tests/test_dataprep_tracing.py:101-120` — mock tracer, assert span names + `set_attribute` calls. Governance tests live in `tests/test_governance.py` (`TestGovernancePipeline` with ready fixtures: mock redis, `RegexPIIRedactor`, `pipeline`, `tool_config`, async `tool_fn`).
- `tracing.sanitize_attributes` exists but `with_span` does NOT apply it — attribute hygiene is the author's job (no raw params/redacted text in attributes).

## Acceptance Criteria

1. `execute()` emits exactly three spans via `tracing.with_span`: `sst.governance.pre`, `sst.governance.runtime`, `sst.governance.post` (epic-pinned names), each with a `tracer_name` that identifies the service (match the module's existing convention — check what other modules pass; default `__name__` if none).
2. Attributes (start + in-span sets) are non-PII identifiers and metrics only: `governance.tool_id`, `governance.decision`, `governance.allowed`, `governance.circuit_state`, `governance.pii_entities_found`, `governance.duration_ms` (runtime/post, from the existing measurements), `governance.rate_limit_remaining`, `governance.audit_entry_id`. **Never** `redacted_params`, `redacted_result`, user identifiers beyond opaque ids, or exception messages containing parameters.
3. Blocked-in-pre path still emits pre + post spans (audit runs on blocked calls); error paths keep `with_span`'s automatic error status (no swallow — exceptions still propagate).
4. Tests (extend `TestGovernancePipeline`): happy path asserts the three span names and key attributes (mock `tracing.get_tracer` → mock tracer; follow the dataprep pattern); blocked path asserts pre+post spans with the block decision; a no-raw-params assertion (no attribute value equals/contains the PII-bearing query text used in the fixture).
5. Overlay suite green; ruff clean. No changes to `tracing.py` or any other module.

## Tasks / Subtasks

- [x] Task 1 — Instrument `execute()` (AC: 1, 2, 3)
  - [x] `from tracing import with_span` at module top (tracing.py ships in every service image; no lazy-import dance needed — unlike chatqna's `workflows` guard, this is same-package)
  - [x] Wrap each phase call; set decision/allowed/circuit/duration/audit attributes inside the `with` block; spans end via the context manager on every path including the early return
- [x] Task 2 — Tests (AC: 4)
  - [x] Happy path: three spans, names exact, `governance.tool_id` + `governance.decision` + `governance.allowed` set
  - [x] Blocked path (tool disabled or role-missing): pre + post spans, decision attribute reflects the block
  - [x] PII guard: the fixture query contains an email; assert no span attribute value contains it
- [x] Task 3 — Suite + ruff; trackers (sprint-status 1-5 → review, plan.md session log)

## Dev Notes

- Span names and the mechanism are **epic-pinned** — do not rename or switch to `start_as_current_span`.
- `with_span` uses `start_span` (not current-span attachment): the governance spans will not parent to an incoming request span automatically. That matches the epic's pinned mechanism; revisit parenting when the governance pipeline is actually wired into a request path (NFR11 backlog item) — note in the story record, don't fix here.
- Keep `execute()`'s structure (early-return audit path included) — spans wrap, they must not restructure control flow.
- `_runtime` already computes `duration_ms` and `_post_execution` writes the audit id — surface existing values into attributes, do not recompute.
- Error semantics: phase exceptions already propagate; `with_span` marks ERROR + records the exception automatically — do not add try/except.

### Testing standards

- pytest, extend the existing `TestGovernancePipeline` class (its fixtures already provide everything).
- Mock at `tracing.get_tracer` (patch target `workflows.tools.governance`'s imported symbol if imported directly — i.e. patch `with_span`'s tracer source) so `start_span` calls are observable; mirror `test_dataprep_tracing.py`'s mock-tracer assertions.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-1.5] — span names, mechanism, AC (W3C traceparent; dataprep assertion pattern; no PII)
- [Source: genie-ai-overlay/tracing.py:242-288] — `get_tracer`/`with_span`/`_SpanContext` (auto error status, no-op when disabled)
- [Source: genie-ai-overlay/workflows/tools/governance.py:336-370] — `execute()`, the single funnel to instrument
- [Source: genie-ai-overlay/tests/test_governance.py `TestGovernancePipeline`] — fixtures to extend
- [Source: genie-ai-overlay/tests/test_dataprep_tracing.py:101-120] — the assertion pattern
- [Source: .claude/rules/OBSERVABILITY.md] — span conventions (use helpers, never manual tracer)


### Review Findings

_Code review 2026-09-01 — all 3 layers completed. Edge Hunter verified the Dockerfile ships `tracing.py` alongside `workflows/` (the web-search-style missing-module failure cannot recur) and that `patch("tracing.get_tracer")` intercepts despite the direct `with_span` import. Auditor verified ACs 1-3+5 fully satisfied (span names exact, allowlist verbatim, no PII)._

- [x] [Review][Patch] **PII test could pass vacuously + was blind to events/recorded exceptions** (Blind High) — anchored with a 3-span count assertion; coverage extended to `add_event` payloads and `record_exception` args.
- [x] [Review][Patch] **Shared mock span made per-span attribution untestable** (Blind High + Edge + Auditor note) — distinct per-span mocks via `side_effect`; assertions now pin pre-only keys (`pii_entities_found`) and runtime-only keys (`circuit_state`) to their spans.
- [x] [Review][Patch] **`or`-coercions fabricated telemetry** (Blind Med + Edge) — `duration_ms` set only when not None (rate-limited/circuit-open no longer read as "0.0 ms"; blocked-path post span omits it — schema asymmetry resolved); `audit_entry_id or ""` replaced by `governance.audit_written` bool + id only when present (Redis-down audit failure is now visible in the trace, not masked as empty success).
- [x] [Review][Patch] **Exception-path span lifecycle untested** (Blind Med) — new test forces `_pre_execution` to raise through the span: asserts `record_exception` + `end` (the never-swallow contract).
- [x] [Review][Patch] **Tests duplicated `TestGovernancePipeline` fixtures instead of extending it** (Auditor) — merged into the class; dead redundant assertion removed; literal-`\n` and wrong-class append artifacts from the restructure caught by collection/fixture errors and fixed.
- [x] [Review][Defer] **`with_span` never attaches OTel context** (Edge Med) — tool HTTP spans won't nest under `sst.governance.runtime`; the fix belongs in `tracing.py` (`trace.use_span` in `_SpanContext`), which AC5 forbade touching — recorded in deferred-work.md as a standalone follow-up benefiting all `with_span` callers.
- [x] [Review][Dismiss] Disabled tool reports `block_auth` — pre-existing decision taxonomy from the pipeline design (1-4); the span faithfully reports what the pipeline decided; the distinguishing detail lives in `error_message` logs.
- [x] [Review][Dismiss] `pii_entities_found` type unvalidated — int by construction (a counter).
- [x] [Review][Dismiss] Fixture hard-codes two Redis pipelines — mirrors the suite's established `_setup_redis_for_allow` convention.

## Dev Agent Record

### Agent Model Used

GLM-5.2 (Claude Code harness)

### Debug Log References

- 44 pre-existing governance tests untouched and green throughout; final overlay **759 passed** (44 + 4 span tests + restructure fixes), ruff clean
- Restructure caught its own mistakes: literal-`
` append artifact → SyntaxError at collection; tests initially landed in the wrong class (TestSourceType is the file's last) → fixture errors; mock `side_effect` list consumed to iterator → fixed by retaining the spans list
- Edge Hunter verified the Dockerfile ships tracing.py + workflows/ — no missing-module risk

### Completion Notes List

- `execute()` emits exactly three epic-pinned spans (`sst.governance.pre`/`.runtime`/`.post`) via `tracing.with_span`; blocked path emits pre+post with no runtime span; audit runs on blocked calls
- Attribute allowlist: tool_id, decision, allowed, pii_entities_found, circuit_state, duration_ms (only when measured), rate_limit_remaining, audit_written, audit_entry_id (only when written) — `user_id` excluded, redacted params/results never touched; PII test pins an email-bearing query out of every attribute/event/exception channel
- **Parenting caveat (per Dev Notes):** `with_span` uses `start_span` without context attachment — governance spans will not parent to the incoming request span, and tool HTTP spans will not nest under the runtime span. Epic-pinned mechanism; deferred-work entry filed for the tracing.py fix
- Review patches: truthful telemetry (no fabricated 0.0/empty-string), per-span attribution tests, exception-lifecycle test, vacuous-test hardening

### File List

- genie-ai-overlay/workflows/tools/governance.py (span instrumentation + truthful attributes)
- genie-ai-overlay/tests/test_governance.py (+4 span tests inside TestGovernancePipeline)
- _bmad-output/implementation-artifacts/{1-5 story, sprint-status, plan.md, deferred-work.md}

### Change Log

- 2026-09-01: 3-phase governance spans with no-PII allowlist; review patches (per-span test attribution, truthful optional attributes, exception-lifecycle pin); 759 tests green → status review
## Debug Log References

### Completion Notes List

### File List

### Change Log
