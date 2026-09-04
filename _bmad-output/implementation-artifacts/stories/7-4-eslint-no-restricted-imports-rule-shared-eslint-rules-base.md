---
key: 7-4-tests-linter-shared-lib-re-exports-test-js-assert-logger-rou
title: "ESLint: `no-restricted-imports` rule in `components/shared/eslint-rules-base.js` (ban `**/shared/lib/**` deep imports; require shared-lib barrel)"
epic: epic-7
status: ready-for-dev
effort: 0.1
depends_on: [7.3]
files: components/shared/eslint-rules-base.js (modify — add rule to existing exports)
---

# Story 7.4 — ESLint: `no-restricted-imports` rule in `components/shared/eslint-rules-base.js` (ban `**/shared/lib/**` deep imports; require shared-lib barrel)

**Epic**: epic-7 (0.1 SP)
**Files**: `components/shared/eslint-rules-base.js` (modify — add rule to existing exports)

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#7` for the epic-level acceptance criteria; this story is one contributing step.

**Concrete acceptance (REWRITTEN by Epic 7 review — original Jest-test approach was wrong direction):**

Original story proposed a Jest test asserting `logger-routes.js` imports from `'./logger'` (not `'../shared-lib'`). **WRONG.** That test would pass on today's CORRECT code (logger-routes.js correctly uses `'../shared-lib'` Docker virtual mount) and would fail on a legitimate refactor. Maintenance trap.

**Correct fix:** Add ESLint `no-restricted-imports` rule to `components/shared/eslint-rules-base.js` (the canonical shared rules home — all 3 components spread this base config; one rule propagates to backend + frontend + shared/lib):

```js
'no-restricted-imports': ['error', {
  paths: [{
    group: ['**/shared/lib/**', '!**/shared/lib/index.js'],
    message: 'Import the shared lib via the shared-lib barrel (e.g. require(\'../shared-lib\')), not via deep paths. See Story 7-4.'
  }]
}]
```

- ESLint version: `^10.1.0` (already in backend + frontend). Fully supports `no-restricted-imports` (core rule since ESLint 7).
- **Lint-time guard**: catches drift on every save + in MR pipeline. Faster signal than a Jest test.
- Failure mode: any `require('../shared/lib/logger')`, `require('../../shared/lib/aql-to-sql')`, etc. → lint error.
- **DO NOT** write `linter-shared-lib-re-exports.test.js` (Jest file). Replaced by lint rule.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`