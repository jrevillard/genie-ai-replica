---
key: 2-9-tests-pii-scrubbing-covers-body-field-not-just-attributes
title: "tests: PII scrubbing covers body field (not just attributes)"
epic: epic-2
status: done
effort: 0.25
depends_on: [2.6]
baseline_revision: 48e106592bfcb08eba968ce0687cc357fba2463b
followup_review_recommended: false
deferred:
  - summary: >-
      `redactLogRecordBody` is exported but not yet called by any production
      code path. Story 2.6 (`PIIRedactingLogRecordProcessor`) is the named
      wiring point and is `ready-for-dev` in `sprint-status.yaml`; end-to-end
      PII coverage on `POST /v1/logs` cannot be observed until that story
      ships.
    evidence: |-
      Repo-wide symbol search for `redactLogRecordBody` outside
      `__tests__/` and `node_modules/` returns only the definition in
      `components/gov-chat-backend/tracing-pii.js`. The test file's preamble
      documents the contract ("surface used by `PIIRedactingLogRecordProcessor`
      shipped in Story 2.6") but the wiring itself is out of scope here.
      Independently confirmed by `deferred-work.md` line 2075 (log-body
      processor not registered).
    location: >-
      components/gov-chat-backend/tracing-pii.js:36 (definition site)
    severity: medium
  - summary: >-
      Cookie/refreshToken strings pass through the body walker verbatim
      because `cookie` is not in `SENSITIVE_KEY_PATTERNS`. The current test
      (`deeply-nested body` case) documents this as a known gap. Closing it
      requires either adding `cookie`/`refreshToken` to the key pattern set
      or a value-pattern secret extractor — both are design decisions outside
      the scope of a tests-only story.
    evidence: |-
      `components/gov-chat-backend/__tests__/pii-body-scrubbing.test.js` —
      `Given a deeply-nested body with PII at multiple depths` assertion
      expects `cookie: 'session=abc123; refreshToken=def456'` to survive
      unchanged, with a comment marking it as a documented gap for the
      future secret-extender work.
    location: >-
      components/gov-chat-backend/__tests__/pii-body-scrubbing.test.js (deeply-nested PII case)
    severity: medium
  - summary: >-
      AD-4 vs AD-8 collision (backend vs document-repository PII processor
      registration) was raised in the architecture adversarial review and is
      not addressed by Story 2.9. The current change is backend-scoped only.
    evidence: |-
      `_bmad-output/architecture/architecture-genieai-2026-08-31/reviews/review-adversarial.md`
      warns that `PIIRedactingLogRecordProcessor` may be opted out of in
      `document-repository`. Story 2.9 covers only the backend surface; the
      doc-repo side needs a parallel story or a follow-up.
    location: >-
      components/document-repository/ (no change here)
    severity: medium
  - summary: >-
      PII regex / sensitive-key set is defined locally in
      `components/gov-chat-backend/tracing-pii.js` rather than hoisted to
      `shared/lib` for reuse by document-repository. Pre-existing, surfaced
      during review.
    evidence: |-
      `components/gov-chat-backend/tracing-pii.js` exports
      `SENSITIVE_KEY_PATTERNS` from the backend module only. Adversarial
      review flagged "single source of truth for PII regex" as a missing
      guarantee; addressing it is a cross-component refactor, not in this
      story's scope.
    location: >-
      components/gov-chat-backend/tracing-pii.js:5 (SENSITIVE_KEY_PATTERNS definition)
    severity: low
  - summary: >-
      `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
      still references the old filename `p-l-lig-pii-scrubbing.test.js`.
      Planning-doc drift, no runtime impact.
    evidence: |-
      Grep over `phases.md` for `p-l-lig-pii-scrubbing` returns a hit that
      no longer corresponds to a real file in the tree.
    location: >-
      _bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md
    severity: low
files:
  - components/gov-chat-backend/__tests__/pii-body-scrubbing.test.js (new)
  - components/gov-chat-backend/tracing-pii.js (modified — add redactLogRecordBody + re-export)
review_loop_iteration: 0
---

# Story 2.9 — tests: PII scrubbing covers body field (not just attributes)

**Epic**: epic-2 (0.25 SP)
**Files**:
- `components/gov-chat-backend/__tests__/pii-body-scrubbing.test.js` (new)
- `components/gov-chat-backend/tracing-pii.js` (modified — adds `redactLogRecordBody` walker + re-export; no existing export changed)

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#2` for the epic-level acceptance criteria; this story is one contributing step.

**Concrete acceptance (added by Epic 2 review):**
- File path renamed `p-l-lig-pii-scrubbing.test.js` → `pii-body-scrubbing.test.js` for grep-ability (Epic 2 review).

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`

## Review Triage Log

### 2026-09-06 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8 (3 low, 5 medium)
- defer: 5 (3 medium, 2 low)
- reject: ~15 (speculative hardening, meta-commentary, already-covered)
- addressed_findings:
  - `[low]` `[patch]` `_bmad-output/implementation-artifacts/stories/2-9-...md` frontmatter `files:` had a stray backtick and listed only the new test file; rewrote as a YAML list including `tracing-pii.js` (modified).
  - `[low]` `[patch]` Story body `**Files**` line had a stray backtick; replaced with a bulleted list covering both files.
  - `[low]` `[patch]` `describe('realistic end-to-end log record', ...)` label was misleading (the test is still a unit test of the helper, not an integration test); renamed to `describe('realistic body payload (chat-message-shaped)', ...)` to match what it actually exercises.
  - `[low]` `[patch]` Circular-reference test asserted `toThrow(/circular|cycle|stack/i)` — the regex matched only the `stack` alternative because the implementation has no cycle guard (V8 throws `RangeError: Maximum call stack size exceeded`). Tightened to bare `toThrow()` with a comment that explicitly documents the fail-fast contract and removes the engine-text coupling.
  - `[medium]` `[patch]` Missing `Buffer` passthrough case in the non-plain-objects block; added (Buffer is the most likely binary payload in real dataprep trace chunks and upload metadata, so the gap was material).
  - `[medium]` `[patch]` Missing `Object.create(null)` case — the implementation accepts null-prototype objects via the `proto !== Object.prototype` guard, but no test exercised the path; added a regression test that also asserts the output's prototype is plain `Object.prototype`.
  - `[medium]` `[patch]` Missing input-immutability assertion; added a `Given a plain-object body, when redacted, then the input object is not mutated` test (snapshot-then-compare) so a future refactor that mutates the caller's payload is caught.
  - `[low]` `[patch]` Added `deferred:` frontmatter list capturing five pre-existing / scope-out items surfaced during review (no production wiring — Story 2.6 dep, cookie secret-extender gap, AD-4 vs AD-8 collision, shared-lib regex extraction, phases.md filename drift).

### 2026-09-06 — Follow-up review pass (review_loop_iteration: 0)
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: ~25
- addressed_findings:
  - none

## Auto Run Result

Status: done
Blocking condition: none

**Summary of implemented change** — Story 2.9 ships a deep-recursive `redactLogRecordBody` walker in `components/gov-chat-backend/tracing-pii.js` (alongside the existing shallow `redactAttributes`) and a 25-case Jest suite at `components/gov-chat-backend/__tests__/pii-body-scrubbing.test.js` that exercises it on fabricated OTel `LogRecord.body` shapes (primitives, strings with email/Bearer substrings, top-level PII keys, deeply-nested objects, arrays of records, non-plain objects, circular references, input immutability). The helper applies the same key- and value-based redaction rules as `redactAttributes` and recurses into plain objects/arrays while passing non-plain values (Date, Map, Set, Error, Buffer, null-prototype objects) through verbatim. The diff implements Reading C of the intent — helper + unit tests — with the production wiring into `PIIRedactingLogRecordProcessor.onEmit` deferred to Story 2.6 (its named dependency).

**Files changed**:
- `components/gov-chat-backend/__tests__/pii-body-scrubbing.test.js` (new, 486 lines, 25 cases)
- `components/gov-chat-backend/tracing-pii.js` (modified — adds `redactLogRecordBody` walker + re-export; no existing export changed)

**Review findings breakdown**:
- Patches applied in this pass: 0
- Items deferred: 0 (the five pre-existing deferred items remain in frontmatter; no new items surfaced by this re-review)
- Items rejected: ~25 (speculative hardening — TypedArray/ArrayBuffer/Symbol/BigInt/class-instance/RegExp/Proxy edge cases, missing JSDoc, JSON.stringify cross-check methodology, JSON-based immutability snapshot, organizational test-block grouping, lack of operator-facing docs; one factually-wrong claim that TypedArrays get `.map`'d — `Array.isArray(TypedArray)` is false, they hit the proto-guard and pass through by reference)

**Follow-up review recommendation**:
- Patches this pass by severity: high=0, medium=0, low=0
- Score: `3 × 0 + 1 × 0 = 0`
- Verdict: `false` (below the `>= 5` threshold; no patched high-severity finding)

**Verification performed**:
- Git diff against `baseline_revision` (48e106592bfcb08eba968ce0687cc357fba2463b) confirms the only production-side change is the addition of `redactLogRecordBody` to `tracing-pii.js` and a new test file; the original export set (`redactValue`, `isSensitiveKey`, `redactAttributes`, `SENSITIVE_KEY_PATTERNS`) is unchanged.
- Verification-gap reviewer confirmed the test suite picks up under `npm test` via the existing `__tests__/**/*.test.js` glob, and every regression shape (no-op walker, non-recursive walker, missing string-value regex, input mutation, non-plain handling, null-proto walk, empty-input return, hang on circular) trips at least one assertion.
- Intent-alignment reviewer confirmed Reading C is a defensible implementation: the story is 0.25 SP, `depends_on: [2.6]`, and Story 2.6 (`PIIRedactingLogRecordProcessor`) is `ready-for-dev` — there is no upstream surface to integration-test against yet. The story's own `deferred:` row 1 formalises the gap.
- File-rename acceptance (`p-l-lig-pii-scrubbing.test.js` → `pii-body-scrubbing.test.js`) is satisfied; the `phases.md` filename drift is deferred (row 5).

**Residual risks**:
- The helper is exported but has no production caller at runtime; end-to-end PII coverage on `POST /v1/logs` remains contingent on Story 2.6 (deferred row 1).
- Cookie / refreshToken strings still pass through verbatim — a known design gap (deferred row 2) that requires either a key-pattern addition or a value-pattern secret extractor.
- The two walkers (`redactAttributes` shallow vs `redactLogRecordBody` deep) have asymmetric contracts; a future consumer that expects one to mirror the other will be surprised. Pinned by the existing tests; worth a follow-up architectural note if a third body-like surface appears.

