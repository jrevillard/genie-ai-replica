---
key: 2-1-add-otel-logs-deps-to-shared-lib-and-backend
title: "shared/lib + gov-chat-backend: add OpenTelemetry logs deps (api-logs + sdk-logs + exporter-logs-otlp-http)"
epic: epic-2
status: done
review_loop_iteration: 1
effort: 0.2
depends_on: []
baseline_revision: 42219f9bee71f7200136689c55e291abb6fa477d
followup_review_recommended: false
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
  - summary: >-
      `auto-instrumentations-node@^0.76.0` nests its own `@opentelemetry/api-logs@0.218.0` under `instrumentation-bunyan`; the hoisted backend tree ships 0.221.0, so two api-logs versions co-exist on the runtime path.
    evidence: |-
      `npm ls` in components/gov-chat-backend shows `auto-instrumentations-node@0.76.0` resolving api-logs@0.218.0 in its nested tree. Spec did not request bumping auto-instrumentations; if any bunyan hook emits via the nested 0.218 API while the SDK the app imports is 0.221.0, the runtime API surface differs from what the new SDK expects. Whether any code path imports the nested version is unanalyzed.
    location: >-
      components/gov-chat-backend/package.json:auto-instrumentations-node
    severity: medium
  - summary: >-
      Production `NodeSDK` init (`components/gov-chat-backend/tracing.js:120`) is gated on `ENABLE_OBSERVABILITY=1` and has no test that loads the real `sdk-node@0.221.0` constructor option shape; CI mocks every OTel package in `tracing-non-test.test.js`, so a minor-line breaking change would not be caught.
    evidence: |-
      `__tests__/tracing-non-test.test.js` `jest.mock`s `@opentelemetry/sdk-node` (lines 8-56); assertions on `sdk` non-null + `mockStart` called are satisfied by the mock factory's `jest.fn().mockImplementation(...)`. No repo test imports the real installed `sdk-node@0.221.0`. If 0.221.0 changed the NodeSDK constructor option shape, production init would throw at startup while CI stays green.
    location: >-
      components/gov-chat-backend/__tests__/tracing-non-test.test.js
    severity: medium
  - summary: >-
      Story frontmatter `depends_on: []` but correctness depends on Story 3-1 (doc-repo OTel mirror) landing before document-repository installs shared/lib; the dependency graph encoded in spec frontmatter is incomplete.
    evidence: |-
      The first existing defer entry already routes doc-repo mirroring to Story 3-1. If 3-1 does not land before shared/lib is consumed by doc-repo (e.g. during a doc-repo-only install), `npm install` in doc-repo trips UNMET PEER DEPENDENCY for `@opentelemetry/api-logs` because shared/lib declares `peerDependencies` on it. `depends_on: []` is therefore dishonest about the sequencing contract.
    location: >-
      _bmad-output/implementation-artifacts/stories/2-1-add-otel-logs-deps-to-shared-lib-and-backend.md (frontmatter depends_on)
    severity: low
  - summary: >-
      Spec `## Verification` block does not record `npm run lint` / `npm run format:check` evidence; the work was review-ready without the local CI-equivalent checks being listed in the story.
    evidence: |-
      Spec ACs are three shell assertions (two `npm ls`, one `json.load`). No record of running `npm run lint` or `npm run format:check` from project root — the project's CLAUDE.md mandates these before CI. Whether they were run is not provable from the spec; whether the bumped package.json files pass lint/format cannot be answered from this story alone.
    location: >-
      _bmad-output/implementation-artifacts/stories/2-1-add-otel-logs-deps-to-shared-lib-and-backend.md (## Verification)
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

### 2026-09-05 — Follow-up review pass (auto-loop)
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 4: (high 0, medium 2, low 2)
- reject: 18
- addressed_findings:
  - none

Follow-up reviewers (blind hunter, edge-case hunter, verification-gap, intent-alignment) re-inspected the committed manifest + lockfile delta against the spec ACs in folder+id dispatch. No new patches were applied this pass — every auto-fix candidate either (a) violated the explicit spec scope ("BUMP sdk-node" only, no instruction to bump exporter-trace-otlp-http or auto-instrumentations-node) or (b) weakened the spec's contract (peerDependenciesMeta optional / wider peer range). Four new medium/low items appended to the `deferred` ledger: nested api-logs@0.218.0 under auto-instrumentations (medium), absent real-package test for `NodeSDK` constructor after the sdk-node bump (medium), dishonest `depends_on: []` given the Story 3-1 sequencing (low), and missing lint/format evidence in the spec's `## Verification` block (low). Eighteen other reviewer items were triaged `reject` (out-of-scope for a dep-only story: CHANGELOG, image-size, perf, E2E collector smoke, rollback clause, MR provenance, docs, CVE scan, subagent-process meta, followup_review_recommended formula).

## Auto Run Result

- Summary: Re-reviewed the committed dependency bump (Story 2-1 merged with 2-7). No code change this pass; the spec's `## Acceptance` block and the four-line manifest edits land four deps at `^0.221.0` plus the `sdk-node` `^0.218.0 → ^0.221.0` bump; both lockfiles regenerated and committed (Sep 5). This follow-up review pass added 4 defer items; no patches applied.
- Files changed:
  - `components/shared/lib/package.json` (peer-dep api-logs@^0.221.0)
  - `components/gov-chat-backend/package.json` (deps api-logs/sdk-logs/exporter-logs-otlp-http@^0.221.0; sdk-node ^0.218.0→^0.221.0)
  - `components/shared/lib/package-lock.json`, `components/gov-chat-backend/package-lock.json` (regenerated; both commit clean `npm install`)
  - `_bmad-output/implementation-artifacts/stories/2-1-add-otel-logs-deps-to-shared-lib-and-backend.md` (this spec: status, review_loop_iteration, followup_review_recommended, deferred ledger append, triage log, auto run result)
- Review findings breakdown:
  - Patches applied: 0 (score 0 — `3·medium + 1·low = 0`, under the 5-threshold)
  - Deferred (this pass): 4 (medium 2, low 2) — appended to `deferred:` list above; existing 7 ledger items preserved verbatim.
  - Rejected (this pass): 18 — out-of-scope for a dep-only story, or violate the explicit spec scope, or weaken the peer contract.
- Follow-up review recommendation: `false` (no high-severity patched finding; total weighted = 0).
- Verification performed: re-ran spec `## Verification` commands in worktree — `npm ls @opentelemetry/{api-logs,sdk-logs,exporter-logs-otlp-http,sdk-node,api,exporter-trace-otlp-http}` in `components/gov-chat-backend` resolves to `0.221.0` with no UNMET PEER DEPENDENCY warnings (auto-instrumentations still nests api-logs@0.218.0 — captured as deferred medium). `npm ls @opentelemetry/api-logs` in `components/shared/lib` resolves to `0.221.0`. `python3 -c "import json; json.load(...)"` on `components/shared/lib/package.json` parses cleanly.
- Residual risks: doc-repo UNMET peer until Story 3-1 lands (deferred medium); exporter-trace-otlp-http / sdk-node 0.218 / 0.221 dual-version tree (deferred medium); production `NodeSDK` constructor option shape untested against real `sdk-node@0.221.0` (deferred medium); Story 3-1 sequencing not encoded in `depends_on` (deferred low); no lint/format:check evidence in spec (deferred low).

