---
key: 2-2-shared-lib-add-boolean-env-and-otel-batch-config-helpers
title: "shared/lib: add `boolean-env.js` + `otel-batch-config.js` helpers"
epic: epic-2
status: ready-for-dev
effort: 0.2
depends_on: []
files: "components/shared/lib/boolean-env.js` (new); components/shared/lib/otel-batch-config.js` (new)"
notes: "Merged from Stories 2-2 (boolean-env) + 2-3 (otel-batch-config). Same MR, same shared/lib helpers batch."
---

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
