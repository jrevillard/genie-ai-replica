---
key: 5-4-admin-dashboard-service-drop-fs-readfile-path-join-delegate
title: "admin-dashboard-service: drop fs.readFile path.join; delegate to logsService.getLogsInRange; F4 regex deleted; JSON.parse for file fallback (try/catch + N=4096 re-parse window + error.stack newline guard)"
epic: epic-5
status: done
effort: 0.5
depends_on: [5.3]
files: "components/gov-chat-backend/services/admin-dashboard-service.js:466-585, 525, 591"
baseline_commit: 47f08da8da22f9bdb55aaa5c9d6af013f4c6a914
---

# Story 5.4 — admin-dashboard-service: drop fs.readFile path.join; delegate to logsService.getLogsInRange; F4 regex deleted; JSON.parse for file fallback (try/catch + N=4096 re-parse window + error.stack newline guard)

**Epic**: epic-5 (0.5 SP)
**Files**: `components/gov-chat-backend/services/admin-dashboard-service.js:466-585, 525, 591`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#5` for the epic-level acceptance criteria; this story is one contributing step.

**Concrete acceptance (added by Epic 5 review):**
- F4 regex at `admin-dashboard-service.js:525` deleted (confirmed live).
- File fallback path uses `JSON.parse(line)`, NOT regex. **NEW:** Add `it('uses JSON.parse, not regex, in file fallback')` assertion to `components/gov-chat-backend/__tests__/services/logs-vl-contract.test.js`. Pinned JSON-key assertion: `info.trace_id` / `info.span_id` are JSON keys, not printf substrings. (The 5.8 contract test alone is end-to-end parity; would not fail if a future refactor reverts to regex.)

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`

## Suggested Review Order

**Entry point: delegation contract**

- `getLogs` now delegates the read+parse to `LogsService.getLogsInRange`; the F4 regex at the old line 525 is gone.
  [`admin-dashboard-service.js:465`](../../../../components/gov-chat-backend/services/admin-dashboard-service.js#L465)

- Defensive null check throws `LogsService is not configured` when wiring is missing; surfaces the misconfiguration loud.
  [`admin-dashboard-service.js:479`](../../../../components/gov-chat-backend/services/admin-dashboard-service.js#L479)

- The delegation call forwards only the fields `getLogsInRange` understands; no envelope transformation.
  [`admin-dashboard-service.js:483`](../../../../components/gov-chat-backend/services/admin-dashboard-service.js#L483)

**Implementation cleanup**

- Removed the now-unused `isValidDateStr` import — `LogsService` owns date validation.
  [`admin-dashboard-service.js:1`](../../../../components/gov-chat-backend/services/admin-dashboard-service.js#L1)

**Behaviour pinned by tests**

- Per-test `mockLogsService.getLogsInRange` injection; every scenario asserts the delegation args.
  [`admin-dashboard-service.test.js:301`](../../../../components/gov-chat-backend/__tests__/services/admin-dashboard-service.test.js#L301)

- Error-path scenarios now reject (instead of swallow) since `LogsService` surfaces partial-read failures as exceptions.
  [`admin-dashboard-service.test.js:829`](../../../../components/gov-chat-backend/__tests__/services/admin-dashboard-service.test.js#L829)

**Contract lock — JSON.parse over regex**

- The new `it('uses JSON.parse, not regex, in file fallback')` pins `_parseNdjsonContent` to JSON.parse; with the pinned `info.trace_id` / `info.span_id` assertion it fails on any future printf-regex regression.
  [`logs-vl-contract.test.js:94`](../../../../components/gov-chat-backend/__tests__/services/logs-vl-contract.test.js#L94)

- Regression guard: a JSON line that LOOKS like the legacy triple-bracket format still parses via JSON (not the bracket group).
  [`logs-vl-contract.test.js:139`](../../../../components/gov-chat-backend/__tests__/services/logs-vl-contract.test.js#L139)

- Pinned N=4096 re-parse window contract for truncated NDJSON lines.
  [`logs-vl-contract.test.js:162`](../../../../components/gov-chat-backend/__tests__/services/logs-vl-contract.test.js#L162)

## Auto Run Result

- **Patches applied:** 0 (all surfaced issues were either out-of-spec scope — deferred to DW-410 — or contract-preserving by `LogsService`).
- **Items deferred:** DW-410 — `debugYesterdayLogs` / `runSecurityScan` / `getSystemHealth` still parse logs with the same F4 regex; carry-forward for the next epic.
- **Score formula:** `followup = (high_severity_patched > 0) OR ((3 × medium_patched + 1 × low_patched) ≥ 5)` → `0 high, 0 medium, 0 low patched` → `false`.
