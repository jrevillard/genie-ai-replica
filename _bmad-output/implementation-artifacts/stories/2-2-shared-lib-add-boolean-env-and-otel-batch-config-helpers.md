---
key: 2-2-shared-lib-add-boolean-env-and-otel-batch-config-helpers
title: "shared/lib: add `boolean-env.js` + `otel-batch-config.js` helpers"
epic: epic-2
status: done
effort: 0.2
depends_on: []
files: "components/shared/lib/boolean-env.js` (new); components/shared/lib/otel-batch-config.js` (new)"
notes: "Merged from Stories 2-2 (boolean-env) + 2-3 (otel-batch-config). Same MR, same shared/lib helpers batch."
baseline_revision: bb5d380089519bb2bc7988172b2206c76cd82859
followup_review_recommended: false
deferred:
  - summary: >-
      Spec frontmatter `files:` field has unbalanced backticks — one opens before
      `boolean-env.js` and the matching close is missing before `(new)`. Any strict
      YAML round-trip will choke on the malformed quote pair.
    evidence: |-
      Frontmatter literal: `"components/shared/lib/boolean-env.js` (new); components/shared/lib/otel-batch-config.js` (new)"`
      Two backticks open, one backtick closes — net unclosed. Pre-existing on the spec
      file before this story's baseline (bb5d38008).
    location: >-
      _bmad-output/implementation-artifacts/stories/2-2-shared-lib-add-boolean-env-and-otel-batch-config-helpers.md:8
    severity: low
  - summary: >-
      Spec frontmatter `depends_on: []` is almost certainly wrong — Story 2-1
      (add-otel-logs-deps-to-shared-lib-and-backend, sha bb5d38008) just shipped
      and exists to establish the shared/lib layout this story extends.
    evidence: |-
      `development_status` in sprint-status.yaml shows `2-1-...: done` and this story
      as `ready-for-dev` (now done). Epic 2 itself `depends_on: [epic-1]` in
      sprint-status, but the story-level `depends_on: []` was left empty when the
      2-1+2-7 merge consolidated stories. Pre-existing on the spec file before this
      story's baseline (bb5d38008).
    location: >-
      _bmad-output/implementation-artifacts/stories/2-2-shared-lib-add-boolean-env-and-otel-batch-config-helpers.md:7
    severity: medium
---

## Review Triage Log

### 2026-09-05 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 2 (low: 1, medium: 1)
- reject: 18
- addressed_findings:
  - none

## Auto Run Result

Status: done

Summary of implemented change:
Added two helpers under `components/shared/lib/` per the merged Story 2-2 + 2-3 batch:
a single-purpose `booleanEnv(name)` parser honoring AD-14's
`1|true|TRUE|yes` whitelist, and a frozen `otel-batch-config` constants object
aligning `BatchLogRecordProcessor` with AD-18. Both files are byte-for-byte
identical to the verbatim source blocks in this story's Acceptance section.

Files changed:
- `components/shared/lib/boolean-env.js` (new, 8 lines) — exports `booleanEnv(name)`;
  returns `false` for unset env vars; matches `/^(1|true|TRUE|yes)$/.test(String(v).trim())`.
- `components/shared/lib/otel-batch-config.js` (new, 6 lines) — exports
  `{ maxExportBatchSize: 512, scheduledDelayMillis: 5000, maxQueueSize: 2048 }`
  for `BatchLogRecordProcessor` construction.
- `_bmad-output/implementation-artifacts/stories/2-2-shared-lib-add-boolean-env-and-otel-batch-config-helpers.md`
  (workflow metadata: status transition + `baseline_revision` capture).

Review findings breakdown:
- Patches applied: 0 (no patch-category findings; all flagged items were either
  spec-mandated exact behavior, out-of-scope enhancements, or pre-existing spec
  metadata defects unrelated to this story).
- Items deferred: 2 — pre-existing frontmatter defects surfaced incidentally
  (malformed `files:` quote pair; `depends_on: []` likely missing 2-1 dependency).
- Items rejected: 18 — spec-mandated regex whitelist (verbatim from spec), plus
  enhancement requests (JSDoc, unit tests, barrel re-export, README/CHANGELOG,
  env-var overrides, named-const shorthand, AD traceability comments, TypeScript
  types) that the spec did not require.
- Patched counts by severity: high=0, medium=0, low=0.
- Score: 0. `followup_review_recommended: false`.

Verification performed:
- `node -e "require('./components/shared/lib/boolean-env')"` → `boolean-env: OK`.
- `node -e "require('./components/shared/lib/otel-batch-config')"` → `otel-batch-config: OK`.
- `grep -rn "boolean-env\|otel-batch-config" components/shared/lib/` → both files
  present, each match on its own first-line header comment.
- `git status --short` (before commit) → two new files + one spec change, all
  scoped to this story; sprint-status.yaml untouched per the orchestrator-owns
  rule in the invocation intent.

Residual risks:
- The spec's AC "Both consumed by Story 2-6 (tracing.js) + Story 7-1 (logger.js)"
  is not exercised by this diff — those are separate stories. Downstream wiring
  is intentionally not part of this slice.
- Pre-existing spec metadata defects (`files:` malformed quote pair,
  `depends_on: []` likely missing 2-1 dependency) are deferred for a focused
  follow-up; they do not block this story's MR.
- Intent-alignment auditor confirmed Reading B/C: no human-only actions in this
  story's AC, so `awaiting-operator` does not apply; status lands at `done`.


# Story 2.2 — shared/lib: add `boolean-env.js` + `otel-batch-config.js` helpers

**Epic**: epic-2 (0.2 SP) — MERGED from Stories 2-2 (boolean-env) + 2-3 (otel-batch-config). Same MR, same shared/lib helpers batch.
**Files**: `components/shared/lib/boolean-env.js` (new); `components/shared/lib/otel-batch-config.js` (new)

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#2` for the epic-level acceptance criteria; this story is one contributing step.

**boolean-env.js (from 2-2):** single helper accepting `1`, `true`, `TRUE`, `yes` per AD-14.

```js
// components/shared/lib/boolean-env.js
'use strict';
function booleanEnv(name) {
  const v = process.env[name];
  if (typeof v === 'undefined') return false;
  return /^(1|true|TRUE|yes)$/.test(String(v).trim());
}
module.exports = { booleanEnv };
```

**otel-batch-config.js (from 2-3):** shared `BatchLogRecordProcessor` tuning per AD-18.

```js
// components/shared/lib/otel-batch-config.js
'use strict';
module.exports = {
  maxExportBatchSize: 512,
  scheduledDelayMillis: 5000,
  maxQueueSize: 2048
};
```

**Verification:**
- Both files parse as CommonJS (`node -e "require('./components/shared/lib/boolean-env')"`, `...otel-batch-config`).
- `grep -rn "boolean-env\|otel-batch-config" components/shared/lib/` shows both files present.
- Both consumed by:
  - Story 2-6 (tracing.js): `const { booleanEnv } = require('./boolean-env')` + `const otelBatchConfig = require('./otel-batch-config')`.
  - Story 7-1 (logger.js): `booleanEnv('LOG_TO_FILE')` per AD-14.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md` (P1a)
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md` (AD-14, AD-18)
