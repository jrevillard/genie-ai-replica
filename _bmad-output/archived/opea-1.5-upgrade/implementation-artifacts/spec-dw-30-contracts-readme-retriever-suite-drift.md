---
title: 'Sync contracts/README.md retriever-suite listing with CI contract:retriever-arango pattern'
type: 'chore'
created: '2026-08-14'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: 'd9fb8df81b4a92774261e9dd9613933ea0a39c8a'
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** `genie-ai-overlay/contracts/README.md` "Full retriever-capable suite" command lists `test_contract_telemetry.py` and the whole-file `test_contract_e2e_pipeline.py` / `test_contract_nfrp_budgets.py`, but CI `contract:retriever-arango` excludes telemetry (moved to `contract:unit`) and runs only selected `e2e_pipeline` + `nfrp_budgets` tests. README drift from CI — developer running the README command would execute tests CI never runs in the in-image retriever job, masking the real contract surface.

**Approach:** Update README retriever-suite command to match `.gitlab-ci.yml` `CONTRACT_TEST_PATTERN` for `contract:retriever-arango` verbatim. Annotate `test_contract_telemetry.py` row in the suite-layout table to state it runs in `contract:unit` (dev-env), not in per-module image suites.

## Boundaries & Constraints

**Always:** README invocations mirror the CI `CONTRACT_TEST_PATTERN` exactly (same files, same `::test_name` selectors). Table row for `test_contract_telemetry.py` reflects its actual CI home.

**Block If:** (none — scope is a single README sync; no product/contract decisions needed).

**Never:** Modify `.gitlab-ci.yml` or any `test_contract_*.py`. Do not restructure the suite-layout table beyond the telemetry row annotation. Do not touch other README sections (reranker, dataprep, pure-logic) — they already match their respective CI jobs.

</intent-contract>

## Code Map

- `genie-ai-overlay/contracts/README.md` -- Target. §Invocation "Full retriever-capable suite" block (lines 22-25) + suite-layout table row for `test_contract_telemetry.py` (line 57).
- `.gitlab-ci.yml` -- Source of truth. `contract:retriever-arango` `CONTRACT_TEST_PATTERN` at line 807; `contract:unit` script at line 891 confirms telemetry lives there.

## Tasks & Acceptance

**Execution:**
- `genie-ai-overlay/contracts/README.md` -- Replace the retriever-suite command block with the exact `CONTRACT_TEST_PATTERN` from `contract:retriever-arango` (drop `test_contract_telemetry.py`, expand `test_contract_e2e_pipeline.py` and `test_contract_nfrp_budgets.py` into the three `::test_*` selectors CI uses). -- Sync README with CI.
- `genie-ai-overlay/contracts/README.md` -- Append to `test_contract_telemetry.py` table row: "Runs in `contract:unit` (dev-env, scans repo dashboards), not in the per-module image suites." -- Reflect actual CI placement.

**Acceptance Criteria:**
- Given the updated README, when a developer copies the "Full retriever-capable suite" command, then the test list equals `.gitlab-ci.yml` `contract:retriever-arango` `CONTRACT_TEST_PATTERN` token-for-token (same files and `::test_*` selectors, same order).
- Given the suite-layout table, when a reader inspects the `test_contract_telemetry.py` row, then it states the test runs in `contract:unit`, not in `contract:retriever-arango` / `contract:reranker` / `contract:dataprep-arango`.

## Verification

**Manual checks:**
- Token-by-token diff between README retriever command test list and `.gitlab-ci.yml` `CONTRACT_TEST_PATTERN` for `contract:retriever-arango` — must be identical.
- Table row for `test_contract_telemetry.py` mentions `contract:unit`.

## Spec Change Log

## Review Triage Log

### 2026-08-14 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 15
- addressed_findings:
  - none

Review notes: 15 findings from blind-hunter (all scope expansion beyond the sync intent: header rename, CI link, cross-reference table, node-ID rationale, line wrapping, image-tag convention, prerequisite docs, changelog note, etc.). Edge-case-hunter instruction file unreadable — dropped. Verification-gap: no gaps. Intent-alignment: diff implements the more precise of two defensible readings (exact CI-pattern sync vs minimal telemetry removal) — no gap. All 15 blind-hunter findings rejected as out-of-scope for this chore.

## Auto Run Result

**Summary:** Synced `genie-ai-overlay/contracts/README.md` retriever-suite command and suite-layout table with the CI `contract:retriever-arango` `CONTRACT_TEST_PATTERN`.

**Files changed:**
- `genie-ai-overlay/contracts/README.md` -- retriever-suite command replaced with CI-exact `CONTRACT_TEST_PATTERN` (telemetry dropped, e2e_pipeline/nfrp_budgets expanded to function-level selectors); `test_contract_telemetry.py` table row annotated to state it runs in `contract:unit`.

**Review findings breakdown:**
- Patches applied: 0
- Items deferred: 0
- Items rejected: 15 (all blind-hunter scope-expansion findings)

**Follow-up review recommendation:** false (0 patch findings; score 0)

**Verification performed:**
- Token-for-token diff between README retriever command test list and `.gitlab-ci.yml` line 807 `CONTRACT_TEST_PATTERN` — identical.
- `test_contract_telemetry.py` table row mentions `contract:unit` — confirmed.

**Residual risks:** None. Pure README doc sync; no code or CI changes.
