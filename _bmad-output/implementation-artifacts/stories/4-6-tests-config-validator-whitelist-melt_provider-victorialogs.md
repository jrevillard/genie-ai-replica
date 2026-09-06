---
key: 4-6-tests-config-validator-whitelist-melt_provider-victorialogs
title: "tests/config-validator: whitelist `MELT_PROVIDER` ∈ {victorialogs}"
epic: epic-4
status: done
effort: 0.1
depends_on: []
files: tests/config-validator/validators/validate-features.js
baseline_revision: 9d3a3ab31fb541caea920c318c1b59d669ba57d6
review_loop_iteration: 0
followup_review_recommended: true
deferred: []
---

# Story 4.6 — tests/config-validator: whitelist `MELT_PROVIDER` ∈ {victorialogs}

**Epic**: epic-4 (0.1 SP)
**Files**: `tests/config-validator/validators/validate-features.js`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#4` for the epic-level acceptance criteria; this story is one contributing step.

**Concrete acceptance (added by Epic 4 review — absorbs Story 4.7):**
- Whitelist `MELT_PROVIDER ∈ {victorialogs}` in `tests/config-validator/validators/validate-features.js`.
- **MERGED from Story 4.7:** Add `describe('empty MELT_PROVIDER', () => { ... })` block in existing `tests/config-validator/__tests__/config-validation.test.js` (NOT a new sibling file). Test asserts: empty `MELT_PROVIDER` env defaults to `victorialogs` and does not crash boot.
- Story 4.7 deleted; this story covers both.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`

## Review Triage Log

### 2026-09-07 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 6 (6: (high 0, medium 3, low 3))
- defer: 7 (7: (high 0, medium 0, low 7))
- reject: 15
- addressed_findings:
  - `[medium]` `[patch]` Added compose-override branch test (`MELT_PROVIDER` resolved from a compose `default` value, no error). The original test block only exercised the env-source and default-fallback paths, leaving the compose branch untested.
  - `[medium]` `[patch]` Added explicit happy-path test (`MELT_PROVIDER=victorialogs` produces no error, value resolves to `victorialogs`). The original block tested only the negative paths.
  - `[medium]` `[patch]` Reverted unrelated reformat noise in both touched files: `dataprep:` array single-line, `parse-compose` require single-line, `gpuSharedVars` Set constructor single-line. Diff scope now matches the spec.
  - `[low]` `[patch]` Hoisted `FEATURE_VAR_WHITELIST` / `FEATURE_VAR_DEFAULTS` import to the top of the test file. Removed the inline `require('../validators/validate-features')` from Test #4.
  - `[low]` `[patch]` Strengthened Test #1 result-shape assertions: `errors` and `warnings` are arrays, `resolvedFeatureVars` is an object.
  - `[low]` `[patch]` Reworded the validator doc-comment from "rejected at boot of the validator pipeline … never crashes boot" to "rejected by the validator … never produces an error" (the validator is a CI config-check, not a boot-time component).

## Auto Run Result

Status: done

Summary: Closed-enum whitelist for `MELT_PROVIDER ∈ {victorialogs}` added to the validator; empty/unset var defaults to `victorialogs` without throwing; explicit unknown values surface as whitelist errors. Exported `FEATURE_VAR_WHITELIST` / `FEATURE_VAR_DEFAULTS` as a declarative seam for future provider additions. Test coverage in the existing `config-validation.test.js` was extended with a 6-test `describe('empty MELT_PROVIDER')` block (per Story 4.7 merge).

Files changed:

- `tests/config-validator/validators/validate-features.js` — Added `FEATURE_VAR_WHITELIST` (closed set of allowed values) and `FEATURE_VAR_DEFAULTS` (built-in fallback) constants. `validateFeatureFlags()` now resolves each whitelisted var through env → compose → default and pushes a whitelist error for non-empty non-allowed values. JSDoc and module exports updated.
- `tests/config-validator/__tests__/config-validation.test.js` — New `describe('empty MELT_PROVIDER')` block with 6 tests (empty inputs, real-env absence, explicit unknown rejection, export-surface contract, happy-path whitelisted value, compose-override). Test #1 result-shape tightened. Top-level import now destructures `FEATURE_VAR_WHITELIST` / `FEATURE_VAR_DEFAULTS`.

Review findings breakdown:

- Patches applied: 6 (3 medium, 3 low).
- Deferred: 7 (all low) — empty-explicit-value silence, whitespace trimming, `commentedOut` guard, parallel-object key-drift hardening, case-insensitive whitelist match, `warnings` channel coverage, compose `O(n)` scan. Captured for later focused attention, not addressed in this story.
- Rejected: 15 — stylistic test-name wording, redundant shape assertion (already implicit), loose error-message regex, seam-extension documentation (already in code), 9 defensive-input guards (caller is the well-typed parser pipeline), and the intent-alignment export-surface "divergence" (defensible reading per spec's "whitelist" wording).

Follow-up review recommended: true. Patched counts: 3 medium, 3 low. Score = 3 × 3 + 1 × 3 = 12 ≥ 5. Triggers because three medium-severity patches each represented a meaningful scope-creep or test-coverage gap that a follow-up review should re-validate end-to-end against the rest of the validator suite.

Verification:

- `cd tests/config-validator && npm test -- --testPathPattern=config-validation` → `Test Suites: 1 passed, 1 total / Tests: 39 passed, 39 total`. The `empty MELT_PROVIDER` block runs all 6 tests green.
- `npx eslint validators/validate-features.js __tests__/config-validation.test.js` → exit 0.
- `npx prettier --check validators/validate-features.js __tests__/config-validation.test.js` → exit 1, warnings scoped exactly to the three reverted single-line spans. Pre-existing baseline also fails prettier on these lines; the project's `format:check` CI gate (`npm run format:check` at root) does not include `tests/config-validator/`, so this is informational only.

Residual risks:

- The validator trusts well-formed `envParsed` (with `.variables`) and `composeVars` (array of `{name, default, hasDefault}`) inputs. Defensive guards for null / missing / wrong-type inputs were deferred (see Review Triage Log).
- `FEATURE_VAR_WHITELIST` and `FEATURE_VAR_DEFAULTS` are now public exports of the validator module. A future refactor that moves the whitelist into a `Map` or a separate file will require Test #4 to be updated; downstream modules (none yet, but feasible in epic-5 / epic-6) will couple to this shape.
- `tests/config-validator/` is not covered by the root `format:check` script, so prettier drift in this directory is invisible to CI. Out of scope for this story; flagged for the maintainers' attention.
