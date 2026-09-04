---
key: 4-6-tests-config-validator-whitelist-melt_provider-victorialogs
title: "tests/config-validator: whitelist `MELT_PROVIDER` ∈ {victorialogs}"
epic: epic-4
status: ready-for-dev
effort: 0.1
depends_on: []
files: tests/config-validator/validators/validate-features.js
---

# Story 4.6 — tests/config-validator: whitelist `MELT_PROVIDER` ∈ {victorialogs}

**Epic**: epic-4 (0.1 SP)
**Files**: `tests/config-validator/validators/validate-features.js`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#4` for the epic-level acceptance criteria; this story is one contributing step.

**Concrete acceptance (added by Epic 4 review — absorbs Story 4.7):**
- Whitelist `MELT_PROVIDER ∈ {victorialogs}` in `tests/config-validator/validators/validate-features.js`.
- **MERGED from Story 4.7:** Add `describe('empty MELT_PROVIDER', () => { ... })` block in existing `tests/config-validator/__tests__/config-validation.test.js` (NOT a new sibling file). Test asserts: empty `MELT_PROVIDER` env defaults to `victorialogs` and does not crash boot.
- Story 4.7 deleted; this story covers both.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`
