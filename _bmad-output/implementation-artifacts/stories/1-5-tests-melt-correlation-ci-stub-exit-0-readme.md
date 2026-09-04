---
key: 1-5-tests-melt-correlation-ci-stub-exit-0-readme
title: "tests/melt-correlation/: CI stub (exit 0) + README"
epic: epic-1
status: done
followup_review_recommended: false
deferred:
  - summary: >-
      No MR-pipeline automated test covers the melt-correlation stub contract (exit 0,
      two valid JUnit XML files, unknown-flag tolerance).
    evidence: |-
      The only in-repo invokers are the `scheduled:melt-correlation` and `scheduled:melt-chaos`
      jobs, gated on `$CI_PIPELINE_SOURCE == "schedule" && $ENABLE_OBSERVABILITY == "1"`, so a
      regression in the stub is invisible on MR pipelines until a scheduled run weeks later.
      A real test belongs with the DW-325 suite that replaces the stub.
    location: >-
      tests/melt-correlation/run-melt-test.sh
    severity: low
  - summary: >-
      `.gitlab-ci.yml` comments attribute the melt jobs to a non-existent "Story 7-10".
    evidence: |-
      `.gitlab-ci.yml:2942` and `:2970` reference "Story 7-10"; no such story exists in this
      initiative. Pre-existing comment drift, not caused by this change.
    location: >-
      .gitlab-ci.yml:2942
    severity: low
  - summary: >-
      `scheduled:melt-chaos` cannot pass even with the stub: it runs `npm ci` in a directory
      with no package.json and then `node chaos-resilience.test.js`, which does not exist.
    evidence: |-
      `.gitlab-ci.yml:2981-2986`. Only the `run-melt-test.sh` line carries `|| true`. Both the
      missing chaos driver and its `reports/melt-chaos-report.xml` artifact belong to DW-325.
    location: >-
      .gitlab-ci.yml:2981
    severity: medium
effort: 0.1
depends_on: []
files: tests/melt-correlation/{run-melt-test.sh,README.md}` (new)
baseline_revision: 95c6c751c8fee04a304e68b6be54228d76bde566
context:
  - _bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/architecture/architecture-genie-ai-2026-08-31/ARCHITECTURE-SPINE.md
---

# Story 1.5 — tests/melt-correlation/: CI stub (exit 0) + README

**Epic**: epic-1 (0.1 SP)
**Files**: `tests/melt-correlation/{run-melt-test.sh,README.md}` (new)`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#1` for the epic-level acceptance criteria; this story is one contributing step.

Story-level acceptance (CAP-8, NG-4 deferred to DW-325):

- **AC1** — Given the repo checked out, When `tests/melt-correlation/run-melt-test.sh` is invoked with no arguments, Then it exits `0`.
- **AC2** — Given the CI invocations in `.gitlab-ci.yml` (`scheduled:melt-correlation` runs `bash run-melt-test.sh --skip-chaos --skip-playwright`; `scheduled:melt-chaos` runs `bash run-melt-test.sh --skip-playwright --correlation-only`), When either flag set is passed, Then the script exits `0` and does not error on unknown flags.
- **AC3** — Given the script has run, Then the JUnit report files declared in the CI `artifacts:reports:junit` block exist and are valid JUnit XML with zero failures: repo-root `reports/melt-correlation-report.xml` and `reports/melt-grafana-report.xml` (the stub creates `reports/` if absent). The stub must not fabricate passing assertions about the observability pipeline — it emits skipped test cases marked as a deferred stub.
- **AC4** — Given `tests/melt-correlation/README.md`, Then it states the directory is a P0 exit-0 stub, that the full OTel trace↔log↔metric correlation + chaos suite is deferred as `DW-325`, points at the CI jobs that consume it, and describes what a real implementation must cover.
- **AC5** — Given the script runs under `node:20-alpine` with only `bash curl` added (per the CI job), Then it uses no dependency outside POSIX-ish bash/coreutils available there.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`
- `.gitlab-ci.yml:2946-2999` — `scheduled:melt-correlation` and `scheduled:melt-chaos` job definitions (the consumers of this stub)
- `_bmad-output/implementation-artifacts/deferred-work.md` — DW-325

## Tasks

1. Create `tests/melt-correlation/run-melt-test.sh` (executable, `#!/usr/bin/env bash`, `set -euo pipefail`): parses and ignores `--skip-chaos`, `--skip-playwright`, `--correlation-only` (and tolerates any other flag), prints a clear "stub — DW-325" notice, writes the two JUnit XML files with skipped test cases, exits `0`.
2. Create `tests/melt-correlation/README.md` per AC4.
3. Do not modify `.gitlab-ci.yml` (Story 7-5 owns the `allow_failure` verification).

## Verification

```bash
bash tests/melt-correlation/run-melt-test.sh
bash tests/melt-correlation/run-melt-test.sh --skip-chaos --skip-playwright
bash tests/melt-correlation/run-melt-test.sh --skip-playwright --correlation-only
test -s reports/melt-correlation-report.xml && test -s reports/melt-grafana-report.xml
python3 -c "import xml.etree.ElementTree as E;[E.parse(f) for f in ('reports/melt-correlation-report.xml','reports/melt-grafana-report.xml')]"
test -x tests/melt-correlation/run-melt-test.sh
```

Generated `reports/` output must not be committed (confirm it is gitignored or remove it before commit).

## Review Triage Log

### 2026-09-04 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 3: (high 0, medium 1, low 2)
- reject: 19
- addressed_findings:
  - `[low]` `[patch]` `tests/melt-correlation/README.md` claimed the scheduled CI jobs are already `allow_failure: true`; the YAML (`.gitlab-ci.yml:2946-2997`) carries no such key. Reworded to state the flag is absent and is owned by Story 7.5.
  - `[low]` `[patch]` README claimed the chaos job's `|| true` "guards against the missing `chaos-resilience.test.js`"; it only guards the stub invocation line. Reworded: the stub unblocks `scheduled:melt-correlation`, not `scheduled:melt-chaos`.

Reviewers (blind-hunter, edge-case-hunter, verification-gap, intent-alignment) returned 24 candidate findings. Edge-case-hunter returned an empty list. Rejected as noise/out of scope on the authority of the intent (a 0.1 SP exit-0 stub, full suite deferred as DW-325): JUnit `<testsuites>` aggregate attributes, exit-code documentation for the stub's internal sanity checks, `head`/`grep` availability caveats, unknown-flag value-consumption documentation, `out_of_scope` section, README DW-325 handoff-plan detail, `context:` vs `References` list asymmetry, and the `architecture-genieai-…` path typo in the story References block (boilerplate shared by all 51 story files, pre-existing).

## Auto Run Result

Status: done
Follow-up review recommended: false (patched: high 0, medium 0, low 2 → score = 3×0 + 1×2 = 2 < 5)

### Summary of implemented change

Added the `tests/melt-correlation/` directory with the P0 exit-0 CI stub and its README. `run-melt-test.sh` parses and ignores the three flags the CI jobs pass (`--skip-chaos`, `--skip-playwright`, `--correlation-only`), tolerates unknown flags and positional args, resolves the repo-root `reports/` directory independently of CWD, writes `melt-correlation-report.xml` and `melt-grafana-report.xml` as valid JUnit XML containing only `<skipped/>` cases (no fabricated passes), self-checks both artifacts with pure bash/coreutils, and exits `0`. No `.gitlab-ci.yml` change — Story 7.5 owns the `allow_failure` verification.

### Files changed

- `tests/melt-correlation/run-melt-test.sh` — new, executable (755); exit-0 stub emitting skipped-case JUnit XML.
- `tests/melt-correlation/README.md` — new; states the stub status, DW-325 deferral, the two consuming CI jobs, and what a real implementation must cover.
- `_bmad-output/implementation-artifacts/stories/1-5-tests-melt-correlation-ci-stub-exit-0-readme.md` — story bookkeeping: frontmatter (`status`, `baseline_revision`, `context`, `deferred`, `followup_review_recommended`), story-level AC1–AC5, Tasks, Verification, this log.

### Review findings breakdown

- Patches applied: 2
- Items deferred: 3
- Items rejected: 19

### Verification performed

- `bash tests/melt-correlation/run-melt-test.sh` → exit 0.
- `bash tests/melt-correlation/run-melt-test.sh --skip-chaos --skip-playwright` → exit 0 (matches `scheduled:melt-correlation`).
- `bash tests/melt-correlation/run-melt-test.sh --skip-playwright --correlation-only` → exit 0 (matches `scheduled:melt-chaos`).
- `test -s reports/melt-correlation-report.xml && test -s reports/melt-grafana-report.xml` → pass.
- `python3 -c "import xml.etree.ElementTree as E;[E.parse(f) for f in (...)]"` → both parse as well-formed XML.
- `test -x tests/melt-correlation/run-melt-test.sh` → pass.
- `grep -n 'reports' .gitignore` → `67:reports/`, `68:**/reports/`; generated `reports/` removed before commit and confirmed absent from `git status`.

### Residual risks

- The stub unblocks `scheduled:melt-correlation` only. `scheduled:melt-chaos` still fails on `npm ci` (no `package.json` in the directory) and on the missing `node chaos-resilience.test.js`; both belong to DW-325 (deferred, medium).
- The stub's contract has no automated witness on MR pipelines (deferred, low) — the consuming jobs run only on scheduled pipelines with `ENABLE_OBSERVABILITY=1`.
