---
key: 7-2-routes-post-api-admin-logs-rollover-post-api-logger-configur
title: routes: `POST /api/admin/logs/rollover` + `POST /api/logger/{configure,rollover}` return `{ deprecated: true, ... }`; `rolloverLogs` → 410 Gone for cron callers
epic: epic-7
status: ready-for-dev
effort: 0.25
depends_on: [Epic 5]
files: components/gov-chat-backend/routes/{admin,logger}-routes.js:170, 97, 198
---

# Story 7.2 — routes: `POST /api/admin/logs/rollover` + `POST /api/logger/{configure,rollover}` return `{ deprecated: true, ... }`; `rolloverLogs` → 410 Gone for cron callers

**Epic**: epic-7 (0.25 SP)
**Files**: `components/gov-chat-backend/routes/{admin,logger}-routes.js:170, 97, 198`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#7` for the epic-level acceptance criteria; this story is one contributing step.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`
