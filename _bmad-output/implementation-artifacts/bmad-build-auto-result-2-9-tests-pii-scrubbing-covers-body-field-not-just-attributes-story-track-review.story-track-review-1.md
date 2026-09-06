---
status: done
---

## Story 2.9 — PII scrubbing covers OTel LogRecord body field

### Outcome
- MR !344 pushed to `bmad-loop/20260906-013034-a107/2-9-tests-pii-scrubbing-covers-body-field-not-just-attributes`
- Pipeline #7030 reached terminal state: **failed** (see ci-status.json)
- Issue mirror: skipped — no GitLab issue found for `2-9-tests-pii-scrubbing-covers-body-field-not-just-attributes` with label `prd::admin-logs-victorialogs`; the post-run `/bmad-bmm-issue-sync` will create it

### CI result (red, but infra-only)
- 8 jobs failed: test:backend, test:frontend, test:doc-repo, test:python, test:flutter, kics-iac-sast, gemnasium-dependency_scanning, semgrep-sast
- **Root cause:** every failing job hit `HTTP 403 Forbidden` on the GitLab artifact-upload step (`cobertura`, `junit`, or `archive`). The actual test/scan work finished cleanly before the upload step. This is a runner-side CI token permission issue, not a regression in Story 2.9.
- **Backend story verification:** `test:backend` ran all 65 suites / 1726 tests green, including the new PII-scrubbing LogRecord `body` field test. Failure is purely the cobertura artifact 403.
- 4 jobs passed (lint:backend, test:sitecustomize, gemnasium-python-dependency_scanning, secret_detection), 3 skipped (build/scan/promote gates that depend on test:backend).
- Prior pipeline #7029 on the parent commit `faa27e9e7` was already failing with the same artifact-403 pattern — confirms infra, not Story 2.9.

### Recommended next action for orchestrator
- Re-run pipeline after restoring the runner token's artifact-upload permission (or after an admin grants the `api` scope).
- Local backend Jest run already validates Story 2.9 (1726/1726 green); story is functionally complete.
- Repair session can ignore the 403s and focus on whether the Story 2.9 implementation needs any further local-only verification before re-running CI.
