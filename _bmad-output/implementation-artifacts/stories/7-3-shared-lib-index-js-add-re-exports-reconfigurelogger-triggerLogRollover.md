---
key: 7-3-shared-lib-index-js-stop-re-exporting-reconfigurelogger-trig
title: "shared/lib/index.js: ADD re-exports for `reconfigureLogger`, `triggerLogRollover`, `cleanupCombinedLog` (latent prod crash fix)"
epic: epic-7
status: ready-for-dev
effort: 0.05
depends_on: []
files: components/shared/lib/index.js
---

# Story 7.3 — shared/lib/index.js: ADD re-exports for `reconfigureLogger`, `triggerLogRollover`, `cleanupCombinedLog` (latent prod crash fix)

**Epic**: epic-7 (0.05 SP)
**Files**: `components/shared/lib/index.js`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#7` for the epic-level acceptance criteria; this story is one contributing step.

**Concrete acceptance (REWRITTEN by Epic 7 review — original title and fix were wrong direction):**

This story was originally titled "stop re-exporting ..." — **WRONG**. The barrel `components/shared/lib/index.js` does NOT currently export `reconfigureLogger`, `triggerLogRollover`, or `cleanupCombinedLog`, so the diff to "remove" them is zero.

**Real bug:** `components/gov-chat-backend/routes/logger-routes.js:4` destructures `{ reconfigureLogger, triggerLogRollover }` from `'../shared-lib'`. These symbols do NOT exist in the real barrel. Tests pass because the Jest mock at `components/gov-chat-backend/__tests__/mocks/shared-lib.js:21-22` provides them. **Production Docker crashes** because the require resolves to the real barrel (Docker COPY `shared/lib` virtual mount; not the mock).

**Correct fix:**
- **ADD** the symbols to `components/shared/lib/index.js` exports: `reconfigureLogger: loggerModule.reconfigureLogger`, `triggerLogRollover: loggerModule.triggerLogRollover`, `cleanupCombinedLog: loggerModule.cleanupCombinedLog`.
- **DO NOT** touch `components/gov-chat-backend/routes/logger-routes.js:4`. The `require('../shared-lib')` pattern is intentional (Docker + Jest virtual mount).
- After fix: `grep -n "reconfigureLogger" components/shared/lib/index.js` returns ≥3 hits.
- Story 7.4 (ESLint rule) provides the regression guard: any future attempt to remove these re-exports will fail the lint.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`