---
key: 3-4-document-repository-clamav-observability-events-clamav-scan
title: "document-repository: ClamAV observability events (`clamav.scan.*`) per AD-20"
epic: epic-3
status: ready-for-dev
effort: 0.5
depends_on: [3.2]
files: components/document-repository/src/services/clamav-node.js (or `components/document-repository/clamav-node.sh` if shim — verify path); emit `clamav.scan.start` / `clamav.scan.complete` / `clamav.scan.failed` / `clamav.scan.timeout` Winston events from `scanFile(fileId)` function with `_msg` prefix + `clamav_duration_ms` integer + `clamav_result` + `file_size_bytes` + `file_id` + `clamav_signature_version` fields per ARCHITECTURE-SPINE.md AD-20
---

# Story 3.4 — document-repository: ClamAV observability events (`clamav.scan.*`) per AD-20

**Epic**: epic-3 (0.5 SP)
**Files**: `ClamAV scan call site + structured Winston events`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#3` for the epic-level acceptance criteria; this story is one contributing step.

**Concrete acceptance (added by Epic 3 review):**
- Emit 4 event types per scan: `clamav.scan.start`, `clamav.scan.complete`, `clamav.scan.failed`, `clamav.scan.timeout`. All carry `_msg` field prefixed with `clamav.scan.`.
- `clamav_duration_ms` is integer ms.
- `clamav_result` ∈ `{clean, infected, error}`.
- `file_size_bytes` and `file_id` from request context.
- `clamav_signature_version` from daemon /etc/clamav/version output.
- **NEW**: Add unit test asserting the `_msg` prefix matches `clamav.scan.*` and `clamav_duration_ms` is integer (AD-20 queryable contract test). Test file: `components/document-repository/__tests__/services/clamav-observability.test.js` (new).

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`
