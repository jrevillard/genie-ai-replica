---
key: 7-1-logger-js-wrap-file-transports-in-log_to_file-1-guard-reconf
title: "logger.js: wrap file transports in `booleanEnv('LOG_TO_FILE')` guard (AD-14); reconfigure honors it"
epic: epic-7
status: ready-for-dev
effort: 0.25
depends_on: [Epic 2]
files: "components/shared/lib/logger.js:48-69 (initial config) AND 77-122 (reconfigureLogger)"
---

# Story 7.1 — logger.js: wrap file transports in `LOG_TO_FILE === '1'` guard; reconfigure honors it

**Epic**: epic-7 (0.25 SP)
**Files**: `components/shared/lib/logger.js:48-69, 77-122`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#7` for the epic-level acceptance criteria; this story is one contributing step.

**Concrete acceptance (added by Epic 7 review):**
- Use `booleanEnv('LOG_TO_FILE')` (AD-14, single helper added by Story 2-2 in `components/shared/lib/boolean-env.js`) — NOT strict `=== '1'`. AD-14 forbids strict equality.
- Wrap BOTH: initial `loggerConfig.transports` array (lines 48-69) AND `reconfigureLogger()` rebuild (lines 87-108). Without the second wrap, calling `POST /api/logger/configure` after P4 would re-add file transports even when `LOG_TO_FILE=0`.
- After P4, when `LOG_TO_FILE=0` (default): no DailyRotateFile transports. Winston pipeline = Console + VictoriaLogsTransport only.
- When `LOG_TO_FILE=1`: DailyRotateFile + tailable File transports active (audit retention escape hatch).

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`
