---
title: 'Pydantic v2 Field Mirroring'
type: 'chore'
created: '2026-08-12'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: 'e8d436eb9593341fe95ae7d84b28ac8e6e79f8d1'
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** v1.5 constrains 10 ChatCompletionRequest fields (max_tokens, n, seed, temperature, top_p, best_of, repetition_penalty, top_k, timeout, top_n) with PositiveInt/NonNegativeFloat types; the overlay keeps them plain int/float, allowing invalid values (negative, zero where positive required).

**Approach:** Mirror v1.5's type constraints by changing field types from int/float to PositiveInt/NonNegativeFloat in the overlay protocol, following the existing OVERRIDE pattern (comment + manifest entry + test).

## Boundaries & Constraints

**Always:** Follow existing OVERRIDE pattern established by k/fetch_k/lambda_mult/score_threshold. Preserve all field defaults and semantics. Add OVERRIDE comment, OVERRIDES.yaml entry, and validation test for each field.

**Block If:** None

**Never:** Don't change field defaults. Don't break existing tests. Don't alter field semantics (e.g., don't make optional fields required).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| PositiveInt accepts positive | max_tokens=100 | Accepted, value=100 | No error |
| PositiveInt rejects zero | n=0 | ValidationError raised | pydantic.ValidationError |
| PositiveInt rejects negative | seed=-5 | ValidationError raised | pydantic.ValidationError |
| NonNegativeFloat accepts zero | temperature=0 | Accepted, value=0 | No error |
| NonNegativeFloat accepts positive | top_p=0.9 | Accepted, value=0.9 | No error |
| NonNegativeFloat rejects negative | repetition_penalty=-0.1 | ValidationError raised | pydantic.ValidationError |

</intent-contract>

## Code Map

- `genie-ai-overlay/core/genieai_api_protocol.py` -- Target file. ChatCompletionRequest class (lines 50-190). Fields to change: max_tokens (line 64), n (line 65), seed (line 68), temperature (line 73), top_p (line 74), best_of (line 89), repetition_penalty (line 93), top_k (line 100), timeout (line 104), top_n (line 184). Existing OVERRIDE pattern at lines 165-178.
- `genie-ai-overlay/tests/test_core.py` -- Test file. TestChatCompletionRequest class (lines 278-446). Existing validation tests at lines 417-445 (test_k_rejects_zero_and_negative, test_fetch_k_rejects_zero_and_negative, test_lambda_mult_accepts_zero_rejects_negative, test_score_threshold_accepts_zero_rejects_negative).
- `genie-ai-overlay/OVERRIDES.yaml` -- Override manifest. Existing entries at lines 17-32 (k, fetch_k, lambda_mult, score_threshold).
- `genie-ai-overlay/build-patches/lint_overrides.py` -- Enforces OVERRIDE comment ↔ manifest sync. Must pass after changes.

## Tasks & Acceptance

**Execution:**

- `genie-ai-overlay/core/genieai_api_protocol.py` -- Change 10 field types: max_tokens, n, seed, best_of, top_k, timeout, top_n → PositiveInt | None; temperature, top_p, repetition_penalty → NonNegativeFloat | None. Add OVERRIDE comment above each field following existing pattern (lines 165-178). Preserve all defaults and descriptions.
- `genie-ai-overlay/OVERRIDES.yaml` -- Add 10 entries under `overrides:` list, one per field. Format: `- override: core.genieai_api_protocol.ChatCompletionRequest.<field>`, `disposition: re-graft-to-new-API`, `owner: genie-ai`, `ticket: DW-5`. Follow existing entry pattern (lines 17-32).
- `genie-ai-overlay/tests/test_core.py` -- Add 10 validation tests in TestChatCompletionRequest class. PositiveInt fields: test accepts positive, rejects zero, rejects negative. NonNegativeFloat fields: test accepts zero, accepts positive, rejects negative. Follow existing test pattern (lines 417-445).

**Acceptance Criteria:**

- Given PositiveInt field (max_tokens, n, seed, best_of, top_k, timeout, top_n), when value is 0, then ValidationError raised
- Given PositiveInt field, when value is negative, then ValidationError raised
- Given PositiveInt field, when value is positive, then accepted
- Given NonNegativeFloat field (temperature, top_p, repetition_penalty), when value is 0, then accepted
- Given NonNegativeFloat field, when value is negative, then ValidationError raised
- Given NonNegativeFloat field, when value is positive, then accepted
- Given OVERRIDE comments added for all 10 fields, when lint_overrides.py runs, then exit code 0
- Given all 10 OVERRIDES.yaml entries added, when lint_overrides.py runs, then manifest matches source comments
- Given all tests pass, when pytest runs on test_core.py, then all existing and new tests pass

## Spec Change Log

## Review Triage Log

### 2026-08-12 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 1, low 0)
- defer: 0
- reject: 17
- addressed_findings:
  - `[medium]` `[patch]` Updated top_p inline comment from "> 0.0 and < 1.0" to ">= 0.0 and < 1.0" to match NonNegativeFloat constraint

## Auto Run Result

**Summary of implemented change:**
Mirrored v1.5's type constraints for 10 ChatCompletionRequest fields in the overlay protocol. Changed field types from int/float to PositiveInt/NonNegativeFloat, added OVERRIDE comments, OVERRIDES.yaml entries, and validation tests.

**Files changed:**
- `genie-ai-overlay/core/genieai_api_protocol.py` -- Changed 10 field types (max_tokens, n, seed, best_of, top_k, timeout, top_n → PositiveInt | None; temperature, top_p, repetition_penalty → NonNegativeFloat | None) with OVERRIDE comments
- `genie-ai-overlay/OVERRIDES.yaml` -- Added 10 entries (one per field, ticket: DW-5)
- `genie-ai-overlay/tests/test_core.py` -- Added 10 validation tests (7 PositiveInt, 3 NonNegativeFloat)

**Review findings breakdown:**
- Patches applied: 1 (top_p comment outdated)
- Items deferred: 0
- Items rejected: 17 (style/out-of-scope/not real issues)

**Follow-up review recommendation:** false (1 medium patch, score = 3 < 5)

**Verification performed:**
- `pytest tests/test_core.py::TestChatCompletionRequest -v`: 31 passed (21 existing + 10 new)
- `pytest tests/test_core.py -v`: 78 passed (no regressions)
- `python build-patches/lint_overrides.py`: OK (18 override entries, all matched)
- All acceptance criteria met

**Residual risks:**
None. All defaults preserved. Optional fields (None) bypass constraint. No breaking changes for valid inputs.

## Design Notes

Follow established OVERRIDE pattern from story 2-1 (k, fetch_k, lambda_mult, score_threshold). The pattern is:
1. Field type change: `field: PositiveInt | None = None` or `field: NonNegativeFloat | None = None`
2. OVERRIDE comment: `# OVERRIDE core.genieai_api_protocol.ChatCompletionRequest.<field> | disposition: re-graft-to-new-API | reason: mirror v1.5 <type> type | test: tests/test_core.py::TestChatCompletionRequest::test_<field>_<behavior>`
3. OVERRIDES.yaml entry: `- override: core.genieai_api_protocol.ChatCompletionRequest.<field>`, `disposition: re-graft-to-new-API`, `owner: genie-ai`, `ticket: DW-5`
4. Test: `def test_<field>_rejects_zero_and_negative(self):` or `def test_<field>_accepts_zero_rejects_negative(self):`

## Verification

**Commands:**

- `cd genie-ai-overlay && source .venv/bin/activate && python -m pytest tests/test_core.py::TestChatCompletionRequest -v` -- expected: all tests pass (existing + 10 new validation tests)
- `cd genie-ai-overlay && source .venv/bin/activate && python build-patches/lint_overrides.py` -- expected: exit code 0, manifest matches source comments
- `cd genie-ai-overlay && source .venv/bin/activate && python -m pytest tests/test_core.py -v` -- expected: all test_core.py tests pass

**Manual checks (if no CLI):**

- Verify each of the 10 fields in genieai_api_protocol.py has correct type (PositiveInt or NonNegativeFloat)
- Verify each field has OVERRIDE comment with correct format
- Verify OVERRIDES.yaml has 10 new entries, one per field
