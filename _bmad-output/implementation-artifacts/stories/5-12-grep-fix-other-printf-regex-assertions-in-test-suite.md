---
key: 5-12-grep-fix-other-printf-regex-assertions-in-test-suite
title: "grep + fix other printf regex assertions: AdminDashboard.parseLogMessage + tests"
epic: epic-5
status: ready-for-dev
effort: 0.25
depends_on: [5.11]
files: components/gov-chat-frontend/src/__tests__/AdminDashboard.test.js (rewrite lines 1036, 1038, 1042, 1044, 1056 — all `[ERROR]/[INFO]/[WARNING]` printf-regex tests); components/gov-chat-frontend/src/components/AdminDashboard.vue (rewrite `parseLogMessage()` function from regex to JSON.parse)
---

# Story 5.12 — grep + fix other printf regex assertions in test suite

**Epic**: epic-5 (0.1 SP)
**Files**: `various`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#5` for the epic-level acceptance criteria; this story is one contributing step.

**Concrete acceptance (CORRECTED from "delete" — code review found 5 real grep matches):**
- Code review found 5 printf-regex matches in `AdminDashboard.test.js` lines 1036, 1038, 1042, 1044, 1056 (incl. `[WARNING]` test). All test `AdminDashboard.parseLogMessage()` against printf-format strings (`'[ERROR]: something went wrong'`, `'[INFO] status update'`, `'[WARNING]: this is a warning'`).
- Rewrite those 5 tests to assert JSON.parse shape (mirrors Story 5.11 approach for LogSearchDialog).
- Rewrite `AdminDashboard.vue` `parseLogMessage()` function from regex to `JSON.parse` (with try/catch + AD-10 invariants).
- Add unit test asserting JSON.parse is used (not regex).
- `grep -rn '\[\(ERROR\|WARN\|INFO\|DEBUG\)\]' components/gov-chat-frontend/src/` returns zero after this story.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`
