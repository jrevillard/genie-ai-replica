---
key: 4-2-shared-lib-melt-index-js-export-logqueryrepository-port-vict
title: "shared/lib/melt/index.js: export `LogQueryRepository` (port), `VictoriaLogsAdapter` (impl), `VictoriaLogsClient` (application)"
epic: epic-4
status: ready-for-dev
effort: 0.25
depends_on: [4.1, 4.3]
files: components/shared/lib/melt/index.js` (new)
---

# Story 4.2 — shared/lib/melt/index.js: export `LogQueryRepository` (port), `VictoriaLogsAdapter` (impl), `VictoriaLogsClient` (application)

**Epic**: epic-4 (0.25 SP)
**Files**: `components/shared/lib/melt/index.js` (new)`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#4` for the epic-level acceptance criteria; this story is one contributing step.

**Concrete acceptance (added by Epic 4 review):**
- `depends_on: [4.1, 4.3]` (not just `[4.1]`) — without 4.3 exporting the client, `index.js` re-exports `undefined` and Epic 5 imports crash at module load.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`
