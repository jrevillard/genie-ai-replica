---
key: 6-2-security-scan-service-rewrite-processlogsinparallel-using-vi
title: "security-scan-service: rewrite `processLogsInParallel` using `VictoriaLogsClient.query` with sha1 bucket key + truncation guard + retention check + cache schema validation via AJV 8.17+"
epic: epic-6
status: ready-for-dev
effort: 1.0
depends_on: [6.1]
files: "components/gov-chat-backend/services/security-scan-service.js:105-313"
---

# Story 6.2 — security-scan-service: rewrite `processLogsInParallel` using `VictoriaLogsClient.query` with sha1 bucket key + truncation guard + retention check + cache schema validation via AJV 8.17+

**Epic**: epic-6 (1.0 SP)
**Files**: `components/gov-chat-backend/services/security-scan-service.js:105-313`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#6` for the epic-level acceptance criteria; this story is one contributing step.

**Concrete acceptance (added by Epic 6 review):**
- **Dedupe key = sha1** per AD-19: `sha1(record._time + '|' + record._stream.service + '|' + record._msg).slice(0, 16)` — NOT the literal `${_time}|${_stream.service}|${_msg}` from `phases.md` (which was a spec drift; AD-19 wins).
- **Truncation guard sets `degraded: true`** per AD-19 — do NOT loop with cursors.
- **Retention env var** = `VICTORIALOGS_RETENTION` (singular, `30d` format) — NOT `VICTORIALOGS_RETENTION_DAYS` (which doesn't exist).
- **AJV 8.17+** added to `components/gov-chat-backend/package.json` (`dependencies`). AD-12 forbids hand-rolled schema checks.
- **CLASS REFACTOR + setter injection**: convert `securityScanService` from singleton object literal to `class SecurityScanService` with `setVictoriaLogsClient(client)` setter (matches 9 sibling services convention). Wire setter in `index.js:1167-1215` with `typeof === 'function'` guard + log debug + idempotent (mirrors existing 6 setter-injection blocks). Add 1 new test group for setter (mirror `admin-dashboard-service.test.js:119-130`).

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`
