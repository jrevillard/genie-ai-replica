---
key: 4-3-shared-lib-melt-victorialogs-client-js-axios-wire-_normalize
title: "shared/lib/melt/victorialogs-client.js: axios wire + `_normalizeRows` (AD-3 sub-shapes) + AccountID/ProjectID headers + lazy health probe + `VL_QUERY_TIMEOUT_MS`"
epic: epic-4
status: ready-for-dev
effort: 0.5
depends_on: [4.1]
files: components/shared/lib/melt/victorialogs-client.js` (new); components/shared/lib/package.json (ADD `axios@^1.7.0` to dependencies — without this edit `require('axios')` fails in shared/lib; aligned with backend `^1.10.0` per architecture spine line 230)
---

# Story 4.3 — shared/lib/melt/victorialogs-client.js: axios wire + `_normalizeRows` (AD-3 sub-shapes) + AccountID/ProjectID headers + lazy health probe + `VL_QUERY_TIMEOUT_MS`

**Epic**: epic-4 (0.5 SP)
**Files**: `components/shared/lib/melt/victorialogs-client.js` (new)`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#4` for the epic-level acceptance criteria; this story is one contributing step.

**Concrete acceptance (added by Epic 4 review):**
- `files:` includes `components/shared/lib/package.json` for axios dep addition.
- HTTP headers `AccountID` + `ProjectID` (NOT `AcctID` / `ProjID`) per AD-15.
- `VL_QUERY_TIMEOUT_MS` env var read with default `30000`.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`
