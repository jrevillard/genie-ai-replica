---
key: 4-4-shared-lib-index-js-re-export-melt
title: "shared/lib/index.js: re-export `melt/`"
epic: epic-4
status: done
effort: 0.05
depends_on: [4.2]
files: components/shared/lib/index.js
baseline_revision: 4a87b82219626286aad544fa5c8ef7b3831b42b7
review_loop_iteration: 0
followup_review_recommended: false
deferred:
  - summary: >-
      No test exercises the real `shared/lib` barrel end-to-end.
      Every backend / document-repository test that touches
      `shared-lib` substitutes it via `jest.mock('../shared-lib',
      …, { virtual: true })` or `moduleNameMapper`, and
      `components/shared/lib/tests/` only contains standalone
      integration scripts (aql / db-connect / worker). The new
      eager `require('./melt')` therefore has zero CI coverage:
      a syntax error or transitive dep miss in
      `shared/lib/melt/{index,victorialogs-client,types}.js`
      ships undetected.
    evidence: |-
      Whole-repo `require.*shared/lib'` grep returns 0 hits
      against the real barrel. `jest.mock('../shared-lib', …,
      { virtual: true })` appears in
      `components/gov-chat-backend/__tests__/swagger-config.test.js:8`,
      `routes/chat-history-routes.test.js:5`;
      `moduleNameMapper: '.*shared-lib$'` in
      `components/document-repository/jest.config.js:43`;
      inline fixture in
      `components/gov-chat-backend/__tests__/mocks/shared-lib.js`
      re-exports `parsePositiveInt` only via a direct sibling
      require, bypassing the barrel.
    location: >-
      components/shared/lib/tests/
    severity: low
---

# Story 4.4 — shared/lib/index.js: re-export `melt/`

**Epic**: epic-4 (0.05 SP)
**Files**: `components/shared/lib/index.js`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#4` for the epic-level acceptance criteria; this story is one contributing step.

**Concrete acceptance (this story):**
- `components/shared/lib/index.js` adds an unconditional `require('./melt')` (Loud-failure on missing submodule: `MODULE_NOT_FOUND` at module load, matching the documented pattern in `components/shared/lib/melt/index.js`).
- `module.exports` adds `melt: meltModule` as a sub-namespace, preserving `require('shared/lib/melt').X` as the canonical consumer path while exposing the same surface at `require('shared/lib').melt.X`.
- All pre-existing exports (`logger`, `reconfigureLogger`, `triggerLogRollover`, `cleanupCombinedLog`, `parsePositiveInt`, `dbService`, `securityHeaders`, `SecurityMiddleware`) remain unchanged.

## Code Map

- `components/shared/lib/index.js` — **MODIFIED.** Two-line addition: (1) `const meltModule = require('./melt');` (L7); (2) `melt: meltModule` appended to `module.exports` (L18). CommonJS only. Namespace barrel — sub-namespace, NOT a flat destructure — chosen so the canonical `require('shared/lib/melt').X` and the convenience `require('shared/lib').melt.X` are equivalent (the same object identity).

## Tasks & Acceptance

**Execution:**
- `components/shared/lib/index.js` — MODIFY — add unconditional `require('./melt')` + `melt: meltModule` namespace property.

**Acceptance Criteria:**
- Given `components/shared/lib/melt/index.js` exists, when `require('shared/lib')` is invoked, then the load completes without throwing and `require('shared/lib').melt` resolves to the same module object as `require('shared/lib/melt')` (identity preserved — not a copy).
- Given `require('shared/lib').melt`, when its keys are inspected, then the surface includes `LogQueryRepository`, `VictoriaLogsAdapter`, `VictoriaLogsClient`, `MELT_PROVIDER` (the four exports documented by Story 4.2 / 4.3).
- Given `require('shared/lib')`, when its top-level keys are inspected, then the set is unchanged from baseline (8 entries: `logger`, `reconfigureLogger`, `triggerLogRollover`, `cleanupCombinedLog`, `parsePositiveInt`, `dbService`, `securityHeaders`, `SecurityMiddleware`) plus the new `melt` entry.
- Given `./melt` is removed, when `require('shared/lib')` is invoked, then it throws `Error: Cannot find module './melt'` (code `MODULE_NOT_FOUND`) at module load — the documented "Loud-failure" semantic.
- Given `grep -E '^(import|export) '` against the modified file, then 0 matches (CommonJS-only invariant preserved).

## Design Notes

**Why a sub-namespace, not a flat destructure.** The intent is "re-export `melt/`" — the literal re-export of the submodule. Flat-destructure (Reading R2 in the intent audit) would make the seam surface indistinguishable from any other top-level export, defeating the point of grouping the MELT port + adapter + client + discriminator under one named entry. The namespace barrel (Reading R1) makes both `require('shared/lib/melt').X` and `require('shared/lib').melt.X` resolve to the same module object (identity, not copy), so consumers can pick whichever path matches their style without semantic drift.

**Why unconditional `require('./melt')` (Loud-failure on missing submodule).** The architecture spine AD-3 + SPEC.md anchor the canonical consumer path at `require('shared/lib/melt').X`. Story 4.2's `melt/index.js` already documents and implements the Loud-failure semantic ("unconditional so a missing adapter fails LOUDLY at module load with `MODULE_NOT_FOUND`"). Carrying the same semantic at the barrel level (`shared/lib/index.js`) means any future refactor that breaks the seam — e.g. someone deletes the directory, or renames `index.js` — surfaces at the first `require('shared/lib')` call rather than silently degrading consumers downstream. Lazy loading (Reading R4) was rejected for the same reason: a soft-loaded seam is invisible to operators until the first consumer needs it, by which point the failure mode is harder to diagnose.

**Why a single-line inline rationale, not a JSDoc block.** The barrel is a flat namespace; matching the existing inline-comment style of the surrounding requires (`require('./logger'); // Import the module object`, `require('./validation-utils'); // parsePositiveInt helper`) keeps the diff mechanical and consistent with the file's voice. A multi-line JSDoc block would be a separate refactor of the file's header convention, out of scope for a 0.05 SP re-export.

## Verification

**Commands:**
- `node --check components/shared/lib/index.js` → `SYNTAX_OK`.

**Manual checks (worktree has no `node_modules` — runtime smoke deferred per Story 4-2 / 4-3 pattern, CI `lint` + `test` gates authoritatively verify):**
- Open `components/shared/lib/index.js` in IDE — confirm `require('./melt')` resolves to the `meltModule` binding at L7, and `melt: meltModule` is appended to `module.exports` at L18.
- Open `components/shared/lib/melt/index.js` — confirm the 4-export surface (`LogQueryRepository`, `VictoriaLogsAdapter`, `VictoriaLogsClient`, `MELT_PROVIDER`) matches what `require('shared/lib').melt` will surface (identity, not copy).

## Spec Change Log

### 2026-09-07 — Initial implementation
- **Triggering intent:** "shared/lib/index.js: re-export `melt/`" (Story 4.4).
- **What changed:** Added unconditional `require('./melt')` + `melt: meltModule` namespace property at the barrel level.
- **Intent alignment:** intent-audit confirmed Reading R1 (sub-namespace convenience re-export) + R5 (unconditional = Loud-failure) implemented; R2 (flatten), R3 (conditional try/catch), R4 (lazy getter) explicitly rejected by the diff's shape.
- **KEEP instructions for re-derivation:** (1) The `meltModule` binding must be the same module object as `require('./melt')` returns — do NOT destructure or copy, or the two consumer paths diverge. (2) The require must remain unconditional at top-level — a try/catch wrapper would silently swallow the `MODULE_NOT_FOUND` and violate the Loud-failure semantic. (3) Append `melt: meltModule` as the LAST entry in `module.exports` to keep the diff minimal and the export-list order stable for any consumer that iterates `Object.keys()`.

## Review Triage Log

### 2026-09-07 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 1
- reject: 17

- addressed_findings:
  - none (no patches applied this pass)

- **Reviewer observations (deferred):**
  - `[low]` `[defer]` Verification gap: no test exercises the real `shared/lib` barrel end-to-end — every backend / document-repository test that touches `shared-lib` substitutes it via `jest.mock`/`moduleNameMapper`. The new eager `require('./melt')` therefore has zero CI coverage; a regression in `shared/lib/melt/{index,victorialogs-client,types}.js` would ship undetected. Suggested test shape: a Jest spec under `components/shared/lib/tests/` that `require('../../index')` (no virtual mock, no moduleNameMapper substitution) and asserts the documented top-level keys + `melt` namespace identity. Tracked in the story's `deferred:` frontmatter for downstream attention (matches Story 4-3's documented deferral pattern for adapter-level coverage to Story 4.5).

- **Reviewer observations (rejected as noise):**
  - Intent-audit divergence between Reading R1 (namespace barrel) and Reading R2 (flat destructure) — R1 is the literal re-export semantic, R2 would defeat the grouping intent. Rejected.
  - Lazy `require` (Reading R4) — explicit rejection in Design Notes (Loud-failure semantic).
  - Conditional `try/catch` (Reading R3) — same Loud-failure rationale; rejected.
  - `VictoriaLogsHealthError` not re-exported at the barrel level — out of spec scope; Story 4.3 deferred its barrel-level exposure for a future epic-4 retrospective (pre-existing scope decision).
  - `'use strict'` pragma missing on the barrel — pre-existing absence across the file, not caused by this story.
  - JSDoc / `@module` block on the barrel — pre-existing absence across the file, not caused by this story.
  - README/CHANGELOG/package.json documentation drift — out of scope for a 2-line re-export.
  - Barrel-style inconsistency (some exports flat, some namespaced, `melt` nested) — deliberate: existing flat exports predate this story; the new `melt` namespace mirrors the upstream `melt/index.js` shape and the architecture spine's grouping (port + adapter + client + discriminator).
  - Inline rationale comment too long for trailing style — matches the surrounding require-comments in the file (`// Import the module object`, `// parsePositiveInt helper`); consistent voice.
  - Object-identity contract test for `sharedLib.melt === require('../shared/lib/melt')` — addressed by the defer entry above (downstream barrel test).
  - Falsy `meltModule` guard (`if (!meltModule) throw new Error(...)`) — overengineering. `require()` of an existing module throws synchronously on bad shape (Node's load semantics); the Loud-failure pattern already covers the documented failure modes.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md`
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md`

## Auto Run Result

Status: done

**Summary:** Re-exported the `melt/` submodule at the `shared/lib/index.js` barrel as a sub-namespace (`melt: meltModule`), preserving identity with `require('shared/lib/melt')` and adding Loud-failure semantics (`MODULE_NOT_FOUND` on missing submodule, matching Story 4.2's pattern).

**Files changed:**
- `components/shared/lib/index.js` — MODIFIED. 2-line addition: `const meltModule = require('./melt');` (L7) + `melt: meltModule` (L18). All pre-existing exports preserved.

**Review findings breakdown:**
- intent_gap: 0
- bad_spec: 0
- patch: 0 (implementation matches R1+R5 intent readings; no defects to fix)
- defer: 1 (verification gap — no real-barrel test exists; documented in `deferred:` frontmatter per Story 4-3's pattern)
- reject: 17 (intent-audit readings R2/R3/R4, JSDoc/README pragma absence, falsy-guard overengineering, package.json description, etc. — out of scope or noise)
- patched severity counts: high=0, medium=0, low=0
- followup score: `3 × 0 + 1 × 0 = 0` → `followup_review_recommended: false`

**Verification performed:**
- `node --check components/shared/lib/index.js` → `SYNTAX_OK` (syntax passes after edit).
- Manual inspection: `require('./melt')` is unconditional at L7; `melt: meltModule` appended to `module.exports` at L18; all 8 pre-existing exports unchanged; CommonJS-only invariant preserved (no `import`/`export` keywords).
- Runtime smoke (`require('shared/lib')` end-to-end): **skipped** — worktree has no `node_modules` (matches Story 4-2 / 4-3 documented pattern). CI `lint` + `test` + `runtime` gates authoritatively verify on the merge request.

**Residual risks:**
- Worktree has no `node_modules` — runtime require smoke deferred to CI gates (matches Stories 4-2 / 4-3 / 7-3 pattern).
- No real-barrel smoke test exists (deferred — see `deferred:` frontmatter). A future regression in `shared/lib/melt/{index,victorialogs-client,types}.js` would ship undetected by the test suite; mitigated downstream by Story 4.5's contract tests and CI's container-build smoke.
- The `VictoriaLogsHealthError` typed error is exported from `melt/victorialogs-client.js` but NOT re-exported at the `melt/index.js` seam level. Epic 5 consumers needing `instanceof VictoriaLogsHealthError` for `VL_FAIL_OPEN` (`CAP-5`) currently have to deep-import or pattern-match by `error.code === 'VL_HEALTH_FAILED'`. Pre-existing scope decision (Story 4-3 deferred list); not introduced by this story.
