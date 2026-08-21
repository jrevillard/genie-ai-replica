---
title: 'Remove retired verify:dataprep-lock job from backend ci config'
type: 'chore'
created: '2026-08-13'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred:
  - summary: >-
      TESTING.md line 52 references verify:dataprep-lock as active config-stage job, but this job never existed in root .gitlab-ci.yml (only in dead backend ci file now deleted)
    evidence: |-
      .claude/rules/TESTING.md line 52 lists verify:dataprep-lock in CI pipeline stages. Root .gitlab-ci.yml has verify:overlay-locks (not verify:dataprep-lock) in config stage. Backend ci file was never included by root ci (0 grep matches). Pre-existing documentation staleness — deletion of dead job does not introduce this bug, merely leaves it unresolved.
    location: >-
      .claude/rules/TESTING.md:52
    severity: low
baseline_revision: 'f0b1bb1a6a3ac40c0fef44868821a5ed65e44380'
---

<intent-contract>

## Intent

**Problem:** `components/gov-chat-backend/.gitlab-ci.yml` lines 2290-2337 contain the `verify:dataprep-lock` job that references retired paths (`requirements.lock`, `dataprep/scripts/*`, `make lock-dataprep`). The root `.gitlab-ci.yml` has no `include:` directive for the backend ci file, so GitLab never reads it — it is dead config that misleads developers and clutters the codebase.

**Approach:** Delete the entire job block (comment + definition + trailing blank lines) from the backend ci file. Preserve the section header and the next job (`config:validate:`). No behavioral impact — the file is orphaned.

## Boundaries & Constraints

**Always:** Preserve YAML syntax validity. Keep section header `# --- Configuration validation ---` and single blank line separator before `config:validate:`.

**Block If:** Root `.gitlab-ci.yml` unexpectedly includes the backend ci file (would make this a live config change, not cleanup).

**Never:** Modify root `.gitlab-ci.yml`. Modify any other backend ci jobs. Add new jobs or features.

</intent-contract>

## Code Map

- `components/gov-chat-backend/.gitlab-ci.yml` -- 2582 lines, orphaned CI config (never included by root)
  - Lines 2288-2289: section header `# --- Configuration validation ---` + blank (KEEP)
  - Lines 2290-2292: comment block describing `verify:dataprep-lock` job (REMOVE)
  - Lines 2293-2322: job definition (script, before_script, variables) (REMOVE)
  - Lines 2323-2337: job `rules:` block (REMOVE)
  - Lines 2338-2339: two blank lines before next job (REMOVE both)
  - Line 2340+: `config:validate:` job (KEEP)
- `.gitlab-ci.yml` -- root CI config, line 557 unrelated `0:` ref, zero `include:` refs to backend ci file (verified via `grep "gov-chat-backend/.gitlab-ci.yml" .gitlab-ci.yml`)

## Tasks & Acceptance

**Execution:**
- `components/gov-chat-backend/.gitlab-ci.yml` -- delete lines 2290-2339 -- removes retired `verify:dataprep-lock` job block (comment + definition + trailing blanks) while preserving section header and next job

**Acceptance Criteria:**
- Given the modified backend ci file, when `grep "^verify:dataprep-lock:" components/gov-chat-backend/.gitlab-ci.yml` runs, then output is empty (zero matches)
- Given the modified backend ci file, when `grep "requirements.lock" components/gov-chat-backend/.gitlab-ci.yml` runs, then output is empty (zero matches)
- Given the modified backend ci file, when inspected at the former job location, then `config:validate:` job remains intact with proper YAML indentation and section header separation
- Given the root ci file, when `grep "gov-chat-backend/.gitlab-ci.yml" .gitlab-ci.yml` runs, then output is empty (pre-existing state, unchanged — confirms file is orphaned)

## Spec Change Log

## Review Triage Log

### 2026-08-13 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 1 (low 1)
- reject: 13
- addressed_findings:
  - none

## Verification

**Commands:**
- `wc -l components/gov-chat-backend/.gitlab-ci.yml` -- expected: 2534 lines (2582 - 48 removed)
- `grep -c "^verify:dataprep-lock:" components/gov-chat-backend/.gitlab-ci.yml` -- expected: 0
- `grep -c "requirements.lock" components/gov-chat-backend/.gitlab-ci.yml` -- expected: 0
- `sed -n '2285,2295p' components/gov-chat-backend/.gitlab-ci.yml` -- expected: section header, blank, then `config:validate:` job start
- `git diff --stat components/gov-chat-backend/.gitlab-ci.yml` -- expected: 48 deletions, 0 insertions

## Auto Run Result

**Summary:** Removed retired `verify:dataprep-lock` job (50 lines) from `components/gov-chat-backend/.gitlab-ci.yml`. Job was dead config — root `.gitlab-ci.yml` has no `include:` directive for backend ci file, and job referenced retired paths (`requirements.lock`, `dataprep/scripts/*`, `make lock-dataprep`) that no longer exist after epic 2.2 Python 3.11 migration.

**Files changed:**
- `components/gov-chat-backend/.gitlab-ci.yml` — deleted lines 2290-2339 (comment block + job definition + trailing blanks), preserved section header and `config:validate:` job

**Review findings breakdown:**
- Patches applied: 0
- Items deferred: 1 (TESTING.md stale reference to `verify:dataprep-lock` — pre-existing doc bug, not caused by this change)
- Items rejected: 13 (blind hunter findings assumed job was active CI check; in reality job was dead config with zero behavioral impact)

**Follow-up review recommendation:** false
- Patched findings by severity: 0 high, 0 medium, 0 low
- Score: 0 (threshold: 3×medium + 1×low ≥ 5)

**Verification performed:**
- `wc -l components/gov-chat-backend/.gitlab-ci.yml` → 2532 lines (2582 - 50 deleted) ✅
- `grep -c "^verify:dataprep-lock:" components/gov-chat-backend/.gitlab-ci.yml` → 0 ✅
- `grep -c "requirements.lock" components/gov-chat-backend/.gitlab-ci.yml` → 0 ✅
- `sed -n '2285,2295p'` → section header, blank line, `config:validate:` job intact ✅
- `git diff --stat` → 50 deletions, 0 insertions ✅
- Root `.gitlab-ci.yml` unchanged (orphan confirmed — 0 grep matches for backend ci file include) ✅

**Residual risks:**
- None. File was orphaned (never read by GitLab CI). Deletion has zero behavioral impact on pipeline execution.
- Deferred item: `.claude/rules/TESTING.md:52` references `verify:dataprep-lock` as active config-stage job — pre-existing documentation staleness, not introduced by this change. Low severity, can be addressed in separate doc cleanup pass.
