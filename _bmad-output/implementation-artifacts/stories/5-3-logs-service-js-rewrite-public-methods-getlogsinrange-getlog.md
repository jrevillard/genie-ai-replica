---
key: 5-3-logs-service-js-rewrite-public-methods-getlogsinrange-getlog
title: "logs-service.js: rewrite public methods (`getLogsInRange`, `getLogsSummary`, `searchLogs`, `getDebugYesterday`) using `VictoriaLogsClient`; per-call env read for `ADMIN_LOGS_SOURCE`; `VL_FAIL_OPEN` + `VL_QUERY_TIMEOUT_MS`; `getLogFilesInRange` returns synthetic descriptors"
epic: epic-5
status: ready-for-dev
effort: 1.0
depends_on: [Epic 4]
files: components/gov-chat-backend/services/logs-service.js
---

# Story 5.3 — logs-service.js: rewrite public methods (`getLogsInRange`, `getLogsSummary`, `searchLogs`, `getDebugYesterday`) using `VictoriaLogsClient`; per-call env read for `ADMIN_LOGS_SOURCE`; `VL_FAIL_OPEN` + `VL_QUERY_TIMEOUT_MS`; `getLogFilesInRange` returns synthetic descriptors

**Epic**: epic-5 (1.0 SP)
**Files**: `components/gov-chat-backend/services/logs-service.js`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#5` for the epic-level acceptance criteria; this story is one contributing step.

**Concrete acceptance (added by Epic 5 review — absorbs Stories 5.5 + 5.6):**
- JSDoc on `getLogsInRange` pins the envelope shape `{logs: VictoriaLogsRow[], total: number, limit: number, offset: number}` (matches AD-3 row shape → admin response shape). Reviewers will reject future drift.
- **MERGED from Story 5.5:** When `ADMIN_LOGS_SOURCE === 'file'` but `LOG_TO_FILE !== '1'`, return 503 with body `{ error: 'vl_files_disabled', message: 'Set LOG_TO_FILE=1 to use file-based log source' }`.
- **MERGED from Story 5.6:** ENOENT tolerance on file read; `fs.open(path, 'wx')` per AD-10 for `O_EXCL` concurrent-writer lock; JSON.parse try/catch with N=4096 re-parse window. Add test mocking `fs.open` to throw `EEXIST`.
- Per-call env read for `ADMIN_LOGS_SOURCE` (no restart) per AD-6.
- Stories 5.5 + 5.6 deleted; this story covers their scope.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`
