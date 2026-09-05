---
key: 2-1-add-otel-logs-deps-to-shared-lib-and-backend
title: "shared/lib + gov-chat-backend: add OpenTelemetry logs deps (api-logs + sdk-logs + exporter-logs-otlp-http)"
epic: epic-2
status: done
effort: 0.2
depends_on: []
baseline_revision: 42219f9bee71f7200136689c55e291abb6fa477d
followup_review_recommended: true
deferred:
  - summary: >-
      document-repository component must mirror these OTel deps at the same versions to avoid shared/lib peer-dep UNMET failures.
    evidence: |-
      Spec notes §"Coordinate with Epic 3 Story 3-1" explicitly defers this to Story 3-1 (ready-for-dev). Until 3-1 lands, any consumer of shared/lib that doesn't ship its own @opentelemetry/api-logs will fail npm install with an unmet peer.
    location: >-
      components/document-repository/package.json
    severity: medium
  - summary: >-
      The thin Winston→VL transport wrapper in shared/lib that consumes @opentelemetry/api-logs does not exist yet in this branch; later epic-2 stories (2-4, 2-5) wire it.
    evidence: |-
      spec §files / Acceptance cites "shared/lib/victorialogs-transport.js needs only this" but no such file exists. Adding the dep ahead of the wrapper is correct (so peer-dep consumers land coherently), but the wrapper itself is deferred.
    location: >-
      components/shared/lib/victorialogs-transport.js
    severity: medium
  - summary: >-
      @opentelemetry/exporter-trace-otlp-http remains at ^0.218.0 in backend while sdk-node was bumped to ^0.221.0; this duplicates the OTel core tree.
    evidence: |-
      Backend package.json deps: `@opentelemetry/exporter-trace-otlp-http@^0.218.0` and `@opentelemetry/sdk-node@^0.221.0`. Spec instruction is explicit ("BUMP sdk-node"), no instruction to bump exporter-trace-otlp-http. After npm install both versions resolved cleanly (no UNMET PEER DEPENDENCY warnings), so the duplication is tolerable. Whether to align remains a separate decision.
    location: >-
      components/gov-chat-backend/package.json:71
    severity: low
  - summary: >-
      Jest moduleNameMapper in gov-chat-backend does not add @opentelemetry/api-logs / sdk-logs / exporter-logs-otlp-http entries that will be needed once victorialogs-transport.js lands and tests import it.
    evidence: |-
      `moduleNameMapper` maps only `@opentelemetry/api` today. Future stories that import the new packages in __tests__ will need mapping entries; not required for this dep-only story.
    location: >-
      components/gov-chat-backend/package.json:jest.moduleNameMapper
    severity: low
  - summary: >-
      components/shared/lib/package.json has no `name` or `version` field; peerDependencies on an unnamed package is a weaker signal in npm 7+.
    evidence: |-
      Pre-existing issue, not introduced by this diff. Independent of this story.
    location: >-
      components/shared/lib/package.json
    severity: low
  - summary: >-
      logger.js (shared/lib) currently only imports @opentelemetry/api (trace API); the migration to import @opentelemetry/api-logs via logs.getLogger(...) is deferred to later stories.
    evidence: |-
      Spec explicitly leaves consumer wiring to follow-up stories (2-4, 2-5, 2-6). logger.js unchanged in this diff.
    location: >-
      components/shared/lib/logger.js
    severity: low
  - summary: >-
      CHANGELOG.md entry under [Unreleased] for the OTel minor-line bump + 3 new deps is missing; per `.claude/rules/RELEASE.md` this belongs in the release-process bookkeeping, not on this story.
    evidence: |-
      Story scope is dep wiring only. Changelog update is conventionally done at the release-cut step, not the story step.
    location: >-
      CHANGELOG.md
    severity: low
files: "components/shared/lib/package.json (ADD `@opentelemetry/api-logs@^0.221.0` peer-dep; backend `api-logs`/`sdk-logs`/`exporter-logs-otlp-http` are regular deps in shared/lib — see Q-1 RESOLVED option C); components/gov-chat-backend/package.json (ADD `@opentelemetry/api-logs@^0.221.0` + `@opentelemetry/sdk-logs@^0.221.0` + `@opentelemetry/exporter-logs-otlp-http@^0.221.0`; BUMP `@opentelemetry/sdk-node` from `^0.218.0` to `^0.221.0`)"
notes: "Merged from Stories 2-1 (shared/lib api-logs peer-dep) + 2-7 (backend sdk-logs + exporter-logs-otlp-http). One MR + one npm install avoids peer-dep mismatches across components."
---

# Story 2.1 — shared/lib + gov-chat-backend: add OpenTelemetry logs deps (api-logs + sdk-logs + exporter-logs-otlp-http)

**Epic**: epic-2 (0.2 SP) — MERGED from Stories 2-1 (shared/lib api-logs peer-dep) + 2-7 (backend sdk-logs + exporter-logs-otlp-http). One MR + one `npm install` keeps peer-dep versions aligned across components.
**Files**: `components/shared/lib/package.json`; `components/gov-chat-backend/package.json`

## Acceptance

See `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md` and `_bmad-output/planning-artifacts/epics.md#2` for the epic-level acceptance criteria; this story is one contributing step.

**Combined scope (2-1 + 2-7):**

**`components/shared/lib/package.json`:**
- ADD `@opentelemetry/api-logs@^0.221.0` to `peerDependencies` (peer of `sdk-logs` + `exporter-logs-otlp-http`; the thin wrapper in shared/lib/victorialogs-transport.js needs only this). Per architecture spine Stack table line 229.

**`components/gov-chat-backend/package.json`:**
- ADD `@opentelemetry/api-logs@^0.221.0` to `dependencies`.
- ADD `@opentelemetry/sdk-logs@^0.221.0` to `dependencies`.
- ADD `@opentelemetry/exporter-logs-otlp-http@^0.221.0` to `dependencies`.
- **BUMP `@opentelemetry/sdk-node` from `^0.218.0` to `^0.221.0`** to avoid peer-dep warnings (sdk-logs + sdk-node must align).

**Coordinate with Epic 3 Story 3-1 (doc-repo mirror):** doc-repo gets the same OTel deps at the same version. Land in same MR or fast-follow.

**Verification:**
- `cd components/gov-chat-backend && npm ls @opentelemetry/*` → no UNMET PEER DEPENDENCY warnings.
- `cd components/shared/lib && npm ls @opentelemetry/api-logs` → resolves to `^0.221.0`.
- `python3 -c "import json; json.load(open('components/shared/lib/package.json'))"` → parse OK.

## References

- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/SPEC.md`
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/phases.md` (P1a deps)
- `_bmad-output/specs/spec-admin-logs-victorialogs-migration/env-vars.md` (npm dependency split, Q-1 RESOLVED option C)
- `_bmad-output/architecture/architecture-genieai-2026-08-31/ARCHITECTURE-SPINE.md` (Stack table line 229, AD-18)

## Review Triage Log

### 2026-09-05 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 1, medium 0, low 0)
- defer: 7
- reject: 9
- addressed_findings:
  - `[high]` `[patch]` Verification gap: spec ACs require `npm ls @opentelemetry/*` to report no UNMET PEER DEPENDENCY warnings, but the implementation subagent intentionally skipped `npm install` because the worktree had stale/missing node_modules. Ran `npm install` in `components/gov-chat-backend` (added 70 / removed 31 / changed 18) and `components/shared/lib` (added 114). Re-ran spec ACs: backend npm ls resolves all 4 OTel deps to 0.221.0 with no UNMET warnings; shared/lib npm ls resolves `@opentelemetry/api-logs` to 0.221.0. Both lockfiles now committed alongside the manifest edits.

## Auto Run Result

Status: done

Summary of implemented change: declared the OpenTelemetry logs dependency tree per the spec's Q-1 RESOLVED option C split — `shared/lib/package.json` gains `@opentelemetry/api-logs@^0.221.0` as a `peerDependency` (consumers that pull shared/lib must supply it), and `components/gov-chat-backend/package.json` gains `@opentelemetry/api-logs`, `@opentelemetry/sdk-logs`, `@opentelemetry/exporter-logs-otlp-http` (all `^0.221.0`) as regular `dependencies` and bumps `@opentelemetry/sdk-node` from `^0.218.0` to `^0.221.0` to keep the sdk-node/sdk-logs peer pair aligned. Both component lockfiles regenerated via `npm install` and committed to keep peer-dep resolution reproducible.

Files changed:
- `components/shared/lib/package.json` — added `peerDependencies.@opentelemetry/api-logs@^0.221.0`.
- `components/shared/lib/package-lock.json` — regenerated by `npm install` (114 packages added).
- `components/gov-chat-backend/package.json` — added three deps + bumped `sdk-node` to `^0.221.0`.
- `components/gov-chat-backend/package-lock.json` — regenerated by `npm install` (added 70 / removed 31 / changed 18).
- `_bmad-output/implementation-artifacts/stories/2-1-add-otel-logs-deps-to-shared-lib-and-backend.md` — workflow bookkeeping (status, baseline_revision, deferred list, Review Triage Log, Auto Run Result).

Review findings breakdown:
- 1 patch applied (high severity): the verification gap that the implementation subagent had skipped (`npm install` + lockfile commit). All spec ACs now confirmed.
- 7 items deferred (see frontmatter `deferred:` list): document-repository mirror, victorialogs-transport.js wrapper, exporter-trace-otlp-http version alignment, Jest moduleNameMapper, shared/lib name+version, logger.js migration, CHANGELOG entry.
- 9 items rejected: caret-version convention for OTel 0.x packages, `peerDependenciesMeta` optional flag, auto-instrumentations-node peer risk (unverifiable without resolution), alphabetical-ordering nit, baseline_revision as workflow bookkeeping field, `overrides` extension (depends on resolution outcome), effort 0.2 SP estimate, in-spec rollback step, MR/commit reference field, sdk-node@0.221 experimental-line concern.

Follow-up review recommendation: true (patched count: high 1, medium 0, low 0 → score 1×3+0×0+0×0 = 3; any patched high-severity finding → true per the formula).

Verification performed:
- `python3 -c "import json; json.load(open('components/shared/lib/package.json'))"` → parse OK.
- `python3 -c "import json; json.load(open('components/gov-chat-backend/package.json'))"` → parse OK.
- `cd components/shared/lib && npm install --no-audit --no-fund` → added 114 packages in 929ms, no errors.
- `cd components/gov-chat-backend && npm install --no-audit --no-fund` → added 70, removed 31, changed 18 in 9s, no errors.
- `cd components/gov-chat-backend && npm ls @opentelemetry/api-logs @opentelemetry/sdk-logs @opentelemetry/exporter-logs-otlp-http @opentelemetry/sdk-node --depth=0` → all four resolve to `0.221.0`, no UNMET PEER DEPENDENCY warnings (spec AC #1 satisfied).
- `cd components/shared/lib && npm ls @opentelemetry/api-logs --depth=0` → resolves to `0.221.0` (spec AC #2 satisfied).

Residual risks:
- document-repository consumer still on OTel 0.218.x → until Story 3-1 lands, any doc-repo install that consumes shared/lib will hit UNMET PEER DEPENDENCY for `@opentelemetry/api-logs`. Out of this story's scope; flagged in `deferred`.
- `components/gov-chat-backend/package.json` carries both `@opentelemetry/sdk-node@^0.221.0` and `@opentelemetry/exporter-trace-otlp-http@^0.218.0`; the npm dedup currently hides any conflict, but a future bump of exporter-trace-otlp-http may surface a duplicate OTel core tree. Out of this story's scope; flagged in `deferred`.
- No source-code consumer of the new packages exists yet on this branch — dep declaration is ahead of code wiring, which is intentional (later stories 2-4 / 2-5 / 2-6 wire victorialogs-transport.js / logger.js). If the team decides this story must ship with consumer code, that is a scope change against the merged 2-1+2-7 spec.
