---
title: 'Add assert guards to build patches'
type: 'feature'
created: '2026-08-14'
status: ready-for-dev
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
baseline_revision: '4dca367eae624b1e9c1a6c87146a43925c935824'
---

<intent-contract>

## Intent

**Problem:** Build-time patches (sed/mv in Dockerfiles, fix_dependencies.sh) silently succeed even when target lines don't exist — a stale patch ships as a no-op, breaking the build without error.

**Approach:** Add assert-on-patch guards (`grep -q <marker> || exit 1`) to every build patch so stale patches fail the build immediately.

## Boundaries & Constraints

**Always:**
- Every build patch (sed, mv, copy) ends with an assertion that the expected change occurred
- All assert guards use `grep -q <specific-marker> || exit 1` pattern (not just `set -e`)
- The grep pattern matches the **result** of the patch, not the input

**Never:**
- Do not refactor existing Dockerfile structure — only add guards
- Do not change OPEA version values — only add assertions
- Do not add new build patches — only guard existing ones
- Never skip assert guards for "simple" patches — all patches get guards

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Stale sed target | Dockerfile sed targets line that doesn't exist | Build fails with `exit 1` from assert guard | Guard: `grep -q <expected-result> || exit 1` |
| Stale shell patch | fix_dependencies.sh sed targets missing line | Script exits 1 with error | Same assert pattern |
| All patches valid | All guards pass | Build/script succeeds | No error |

</intent-contract>

## Code Map

- `genie-ai-overlay/build-patches/fix_dependencies.sh` -- Main build patch script. Performs 3 sed operations (removes pathway, removes graspologic, swaps psycopg2→psycopg2-binary). Currently has NO assert guards.
- `genie-ai-overlay/dataprep/Dockerfile-dataprep_genie-ai` -- Lines 107-110: sed rewrites for requirements. Lines 129-130: comment-out operations. NO assert guards.
- `genie-ai-overlay/reranker/Dockerfile-reranker_genie-ai` -- Lines 39-40: fix_dependencies.sh invocation. Line 50: additional patch. NO assert guards.
- `genie-ai-overlay/retriever/Dockerfile-retriever_genie-ai` -- Lines 31-33: fix_dependencies.sh invocation. Line 63: additional patch. NO assert guards.

## Tasks & Acceptance

**Execution:**

- `genie-ai-overlay/build-patches/fix_dependencies.sh` -- Add assert guards after each sed operation. After each sed, add `grep -q <expected-pattern> <target-file> || exit 1` to verify the change occurred. Example: after `sed -i 's/psycopg2$/psycopg2-binary/' requirements.txt`, add `grep -q psycopg2-binary requirements.txt || exit 1`. -- Rationale: stale sed silently succeeds; assert guard fails build if target doesn't exist.

- `genie-ai-overlay/dataprep/Dockerfile-dataprep_genie-ai` -- Add assert guards after sed operations at lines 107-110 and 129-130. After each sed, add RUN command with grep assertion. Example: after `RUN sed -i 's/old/new/' file.txt`, add `RUN grep -q "new" file.txt || exit 1`. -- Rationale: Dockerfile patches must fail build if target lines don't exist.

- `genie-ai-overlay/reranker/Dockerfile-reranker_genie-ai` -- Add assert guards after fix_dependencies.sh invocation (line 39-40) and patch at line 50. Add RUN commands with grep assertions. -- Rationale: same as dataprep.

- `genie-ai-overlay/retriever/Dockerfile-retriever_genie-ai` -- Add assert guards after fix_dependencies.sh invocation (lines 31-33) and patch at line 63. -- Rationale: same as dataprep.

**Acceptance Criteria:**

- Given a Dockerfile with a sed patch, when the sed target line doesn't exist, then the build fails with exit code 1 from the assert guard (not silent success).
- Given fix_dependencies.sh with assert guards, when a sed target line doesn't exist, then the script exits with code 1.
- Given all patches have assert guards and all targets exist, when CI runs, then all builds succeed normally.

## Spec Change Log

- 2026-08-16: Simplified scope — removed versions.env, coherence lint, mutation probe, verify:evidence CI stage. Story now focused solely on assert guards for build patches (KISS).

## Review Triage Log

### 2026-08-15 — Review pass (original)
- intent_gap: 1 (spec existed but implementation missing — dev session never executed)
- Resolution: simplified scope, re-drive with clear KISS intent

### 2026-08-16 — Resolution
- Scope simplified per human decision
- Dropped: versions.env, coherence lint, mutation probe, verify:evidence stage
- Kept: assert guards on all 4 build patch surfaces

## Design Notes

**Assert guard pattern:** Use `grep -q <specific-expected-output> <file> || exit 1` after each patch operation. The grep pattern should match the **result** of the patch, not the input. Example:
```bash
# Patch
sed -i 's/psycopg2$/psycopg2-binary/' requirements.txt
# Assert
grep -q "psycopg2-binary" requirements.txt || exit 1
```

**Dockerfile guard pattern:** Each RUN with a sed/mv needs a follow-up RUN with the assertion:
```dockerfile
RUN sed -i 's/old/new/' file.txt
RUN grep -q "new" file.txt || exit 1
```

## Verification

**Commands:**
- `cd genie-ai-overlay && bash build-patches/fix_dependencies.sh` -- expected: script completes with all assert guards passing (exit 0)
- `git diff genie-ai-overlay/build-patches/fix_dependencies.sh` -- expected: shows added `grep -q ... || exit 1` lines after each sed
- `git diff genie-ai-overlay/dataprep/Dockerfile-dataprep_genie-ai` -- expected: shows added assert RUN lines
- `git diff genie-ai-overlay/reranker/Dockerfile-reranker_genie-ai` -- expected: shows added assert RUN lines
- `git diff genie-ai-overlay/retriever/Dockerfile-retriever_genie-ai` -- expected: shows added assert RUN lines

**Manual checks:**
- Inspect each Dockerfile to verify assert guards are present after every sed/mv/copy operation
- Verify fix_dependencies.sh has assert guards after each sed operation
