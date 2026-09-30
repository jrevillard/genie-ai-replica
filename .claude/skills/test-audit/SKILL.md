---
name: test-audit
description: "Invoke whenever writing, changing, reviewing, or sweeping tests in this repo. Authoring gate for new tests plus audit workflow for low-value, implementation-coupled, or duplicative tests and the test-only production seams they demand. Adapted from openclaw/openclaw for the GENIE.AI Jest / pytest / Playwright / flutter_test stack."
---

# Test Audit

Three modes, one value bar. Authoring mode gates every new or changed test at
write time. Audit mode runs focused sweeps of tests that re-assert source,
duplicate stronger proof, couple behavior to implementation, or keep test-only
production seams alive. Continue broad audits as separate coherent follow-up
MRs; optimize for confidence, not deletion count. Campaign mode prunes one
whole subsystem's test surface (every test file a component or core area owns);
before starting one, read [CAMPAIGN.md](CAMPAIGN.md).

## Authoring gate

Before adding any test, answer four questions; a missing answer means do not
add it yet:

1. What observable behavior, invariant, or independent contract does it protect?
2. What credible regression makes it fail?
3. Why does existing coverage not already catch that failure? Each contract has
   one primary test owner at the strongest boundary; another layer needs its
   own distinct risk, such as a transport or lifecycle failure the owner cannot
   reach. Prefer extending a table-driven case or shared fixture over a
   near-duplicate test; consolidate duplicated setup in the same change.
4. Does it need a production seam (export, flag, wrapper, injection hook) that no
   production caller needs? If yes, move the test to the real boundary instead.

Then check the test against every [junk pattern](#junk-patterns); a match fails
the gate unless the [retention bar](#retention-bar) names the contract it
independently guards. A test that would break under behavior-preserving
refactoring is asserting implementation, not behavior; rewrite it at the
owning boundary before landing it.

Bug regression tests must fail on the pre-fix code for the intended reason and
pass after the owner-boundary repair. A regression test that never demonstrably
failed proves the mock, not the fix. One regression at the owner boundary
covers the bug; do not replay the same scenario at every layer it crosses.

## Junk patterns

The shared checklist for both modes: the authoring gate rejects a new test that
matches one, and audits hunt for existing tests that do.

- assertion-free coverage probes;
- self-comparisons and identity copiers;
- copied fixtures, inventories, manifests, or export lists;
- exact source, import, or string greps;
- private predicate or call-shape tests duplicated at real boundaries;
- duplicate invocations of the same contract;
- provider-local replays of shared helpers;
- tests whose only purpose is preserving test-only exports, globals, or wrappers;
- dead production code whose only callers are tests;
- expected values produced by the helper or renderer under test;
- mocks that implement the asserted behavior, or one identical mock standing in
  for different APIs;
- fixtures that supply the receipt, admission, or callback ordering the owner
  should produce, or persistence asserted against a store the path never writes;
- capability tests that restate declared flags instead of exercising the
  delivery or acknowledgement the flag promises;
- negative controls that pass for an unrelated reason, such as a denial from a
  different guard or a rejection the production path never reaches;
- names or fixtures that promise more than the input exercises, such as a
  "retires the window" test asserting the window was not cleared.

## Value bar

Tests justify their maintenance cost by protecting behavior, a credible
regression, or an independently meaningful contract. In an audit, an existing
test that must change for behavior-preserving source reorganization is suspect,
not automatically deletable; the authoring gate still rejects new ones.

Before judging a candidate, read the complete test and production owner, its
entry point, callers, callees, sibling implementations, overlapping tests, CI
routing, and relevant history. Read root and scoped agent-instruction files
first — `CLAUDE.md` (or its symlink `AGENTS.md` at the repo root) and any
scoped `.claude/rules/*.md` — plus the relevant entry in
`_bmad-output/project-context.md`. When the test claims dependency-backed
behavior, inspect the dependency source or types directly.

## Discovery

Keep discovery read-only and report evidence before editing. Run parallel
discovery lanes by test framework owner boundary:

- **Jest (Node.js, CommonJS)**: `components/gov-chat-backend/__tests__/`,
  `components/document-repository/__tests__/`,
  `components/shared/lib/__tests__/` (or co-located `*.test.js`)
- **Jest (Vue 3, ES modules via `@vue/vue3-jest`)**:
  `components/gov-chat-frontend/src/__tests__/`
- **pytest (Python, OPEA overlay)**: `genie-ai-overlay/tests/` (fixtures mock
  `comps`, ArangoDB, model endpoints) and `genie-ai-overlay/contracts/`
  (real vendored `comps`, runs in-image only — sibling of `tests/`, see
  `.claude/rules/TESTING.md`)
- **Playwright (E2E)**: `tests/e2e/` (single worker, `fullyParallel: false`,
  baseURL env-driven — small surface, audit in one pass)
- **flutter_test (Dart)**: `mobile/genie_ai_mobile/test/`
- **Config validator (Jest)**: `tests/config-validator/`
- **Cross-cutting sweep**: search for test-only exports, fixtures under
  `__tests__/mocks/` and `__tests__/fixtures/` that only serve tests, and
  `moduleNameMapper` entries that exist solely to support deleted specs.

Outside campaign mode, prefer a few high-confidence candidates over a large
speculative inventory. Hunt for the [junk patterns](#junk-patterns).

## Retention bar

Keep a test when it independently enforces a public API, plugin SDK, protocol,
config, migration, storage, security, platform, default, prompt-byte, generated
cross-language, package, release, or architecture contract. Also keep:

- call ordering when order is observable behavior;
- regressions with a credible failure mode;
- source inspection when it is the cheapest independent guard: it fails when
  the contract changes (the user-facing key, byte, or path) and survives an
  identifier-only refactor;
- a retained test that fails on the baseline: treat it as a possible product
  bug, reproduce it, and repair the owner rather than deleting it.

For this repo specifically, the following contracts are independently enforced
at dedicated boundaries and should not be merged away:

- Keycloak auth claims (`iss_sub`, `sub`, `iss`, not ArangoDB `_key`) — backend
  auth-middleware tests under `components/gov-chat-backend/__tests__/middleware/`.
- OTel span emission per service (`test_*_tracing.py`,
  `tracing-with-span.test.js`) — proves tracing instrumentation survives
  refactor.
- PII redaction in observability — `./tests/otel-collector/run-pii-smoke.sh`
  is the only CI-less guard for the collector config; any test that asserts
  PII behavior on the collector must run that smoke (see
  `.claude/rules/TESTING.md`).
- The `createApp()` pattern boundary in backend tests — `supertest` against
  `createApp()` is the strongest owner boundary for route handlers; do not
  collapse it into a service-layer test that mocks the routing.

Static or slow is not a deletion reason. A test that resembles implementation
may still be the independent contract; prove otherwise before removing it.

## Candidate evidence

Record every field below before editing. A missing field means the candidate is
not ready for deletion:

- exact test name and location;
- what failure it can actually detect;
- non-test callers of the covered production or support seam;
- stronger remaining owner-boundary proof, or why no proof is needed;
- relevant history and the reason the test or seam exists;
- production or test-support deletion unlocked;
- risk and the focused validation command.

## Edit shape

Choose one coherent owner-boundary batch. Delete obsolete test-only exports,
globals, wrappers, and dead production paths instead of preserving aliases.
Watch for these in-repo support seams specifically:

- `__mocks__/` and `__tests__/mocks/` exports used only by removed specs
  (the `moduleNameMapper` pattern in `jest.config.js` makes these subtle —
  verify the alias target still has a consumer before deleting the export).
- `__tests__/fixtures/` data only consumed by retired tests.
- `genie-ai-overlay/tests/conftest.py` fixtures mocking `comps` / ArangoDB /
  model endpoints — the mock-the-asserted-behavior junk pattern is the most
  common failure mode here (see `.claude/rules/TESTING.md`).
- pytest `--junitxml=reports/pytest-report.xml` paths referenced by
  `.gitlab-ci.yml` — when moving or consolidating, update the CI artifact
  path or the test job breaks silently.

Move retained regressions to their canonical owners. Consolidate repeated
package or dependency assertions into one generic contract.

Prefer net-negative production LOC. Do not add replacement tests that restate
the same implementation, and do not convert uncertain candidates into cleanup
to increase deletion counts.

## Validation

Never edit source or tests while a test runner is active in the checkout.

1. Run the smallest owner and sibling tests. By framework:
   - **Jest (Node)**: `cd components/<dir> && npx jest <path>` (or
     `npm test -- <path>` to use the package's `npm test` script).
   - **Jest (Vue)**: `cd components/gov-chat-frontend && npm test -- <path>`.
   - **pytest (OPEA)**: `cd genie-ai-overlay && pytest tests/<file>.py -x`.
     For the real-`comps` contract suite: `pytest contracts/`.
   - **Playwright (E2E)**: `npm run test:e2e:list` first to confirm scope,
     then `npx playwright test tests/e2e/<file>.spec.js`. Single-worker
     config means no parallelism speedup; budget wall-clock accordingly.
   - **flutter_test**: `cd mobile/genie_ai_mobile && flutter test test/<file>`.
2. For removed source greps or plan assertions, run the executable script
   that owns the real contract. Examples:
   `cd tests/config-validator && npm test` for env coverage;
   `python genie-ai-overlay/scripts/<name>.py` for OPEA runtime scripts.
3. Run targeted formatting: `npm run format:check` (Node, covers all four
   JS components via root script), `ruff format --check genie-ai-overlay/`
   (Python), `cd mobile/genie_ai_mobile && dart format --set-exit-if-changed .`
   (Dart). Then `git diff --check`.
4. Classify with `npm run lint` (Node, root script covers all four JS
   components), `ruff check genie-ai-overlay/` (Python), and
   `cd mobile/genie_ai_mobile && flutter analyze` (Dart). Then run the
   actual changed gate required by repository policy (`.gitlab-ci.yml`
   lint → test → config → build stages).
5. Inspect `git diff --numstat`; report production/tooling separately from
   tests and test support. Exclude `.md` doc-only diffs from line-count
   claims.
6. Touched `configs/otel/otel-collector-config.yaml` or
   `configs/otel/pii-key-list.md`? Run
   `./tests/otel-collector/run-pii-smoke.sh` — no CI job covers it
   (see `.claude/rules/TESTING.md`).
7. After final audit edits, run `pr-review-toolkit:code-reviewer` (or
   `bmad-code-review`) on the MR branch. Per
   `feedback_verify_reviewer_subagent_claims.md`: parallel reviewers
   over-correct, verify findings against code before applying.

## Landing and continuation

Commit, push, open an MR, or land only when CI passes. Per
`.claude/rules/EL-SALVADOR-WORKFLOW.md` and
`feedback_never_merge_without_ci.md`:

- Never commit directly to `main` or `release/*` — use a dedicated worktree
  per branch (`feedback_worktree_branch_isolation.md`).
- Path 1 (local validation, merge to `main`): validate via local
  `docker compose` or the affected unit tests, then `glab mr merge`.
- Path 2 / Path 3 (el-salvador-specific): validate on `.102` first, then
  cherry-pick to a fresh branch off the appropriate target
  (`release/el-salvador` for el-salvador work, `main` for generic work).
- Land one coherent MR at a time. After landing, refresh from current
  `main` and rerun read-only discovery for the next high-confidence batch.
- Launch `/tmp/ci-monitor.sh <pipeline_id>` in the background right after
  pushing the MR (`feedback_always_monitor_mr_ci.md`).

## Handoff

Report:

- root cause and removed low-value categories;
- production owner simplifications (e.g. dropped `__mocks__/` exports,
  consolidated fixtures);
- retained false positives and why they remain valuable;
- focused and full proof actually run (per-framework commands above);
- production versus test LOC, from `git diff --numstat`;
- MR and merge state;
- named follow-ups (e.g. campaign-mode candidates surfaced but not in this MR).