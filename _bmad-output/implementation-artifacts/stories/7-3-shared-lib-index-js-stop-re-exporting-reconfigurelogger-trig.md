---
key: 7-3-shared-lib-index-js-stop-re-exporting-reconfigurelogger-trig
title: "shared/lib/index.js: stop re-exporting `reconfigureLogger`, `triggerLogRollover`, `cleanupCombinedLog`; logger-routes.js imports internal `./logger` not via shared/lib"
epic: epic-7
status: ready-for-dev
effort: 0.25
depends_on: [7.2]
files: "components/shared/lib/index.js` + `components/gov-chat-backend/routes/logger-routes.js:4"
---

# Story 7.3 — shared/lib/index.js: stop re-exporting `reconfigureLogger`, `triggerLogRollover`, `cleanupCombinedLog`; logger-routes.js imports internal `./logger` not via shared/lib

**Epic**: epic-7 (0.25 SP)
**Files**: `components/shared/lib/index.js` + `components/gov-chat-backend/routes/logger-routes.js:4`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#7` for the epic-level acceptance criteria; this story is one contributing step.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`
