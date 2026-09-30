# Test-pruning campaign

Campaign mode prunes one subsystem's whole test surface in one MR: a component
such as `components/gov-chat-backend`, an OPEA microservice in
`genie-ai-overlay/`, or one core area. The value bar, retention bar, candidate
evidence, and validation in [SKILL.md](SKILL.md) apply to every lane. This
file adds the order of work and the lessons of a full campaign. Each step ends
on its completion criterion; do not start the next step early.

## 1. Baseline

Record the subsystem's test and support line counts and every test file's
pass/fail state at a pinned `main` SHA. Keep baseline failures in their own
list: in past campaigns, these surfaced real production bugs (e.g. an OPEA
retriever campaign caught a label-filter regression that the owner suite was
mocking past; a backend route campaign surfaced an auth-middleware path the
suite had been silently skipping). Baseline failures are bug reports, not
stale tests.

Done when every in-scope test file has a recorded baseline result and every
baseline failure has a ticket or follow-up assigned.

## 2. Lanes and inventory

Split the surface into **lanes** along production owner boundaries, not file
prefixes. Lane examples by subsystem:

- **Backend (`components/gov-chat-backend/`)**: routes per domain (auth,
  chat, analytics, services, users, admin), middleware, controllers,
  services, `tracing-*` helpers, `__mocks__/` cross-cutting mocks.
- **Frontend (`components/gov-chat-frontend/`)**: components, stores (Vuex
  modules), services, router, i18n, design-system primitives
  (`src/components/ds/`).
- **OPEA (`genie-ai-overlay/<service>/`)**: chatqna, retriever, dataprep,
  reranker, embedding, plus shared `tests/conftest.py` fixtures and
  per-service `test_*_tracing.py` files.
- **Document repository (`components/document-repository/`)**: upload
  routes, ClamAV integration, file metadata services.
- **Mobile (`mobile/genie_ai_mobile/test/`)**: providers, services,
  screens, routing.

Include the subsystem's cases at shared core boundaries (e.g.
`components/shared/lib/`) and its end-to-end proof (e.g. one Playwright
spec that exercises the subsystem's user flow).

Done when every test file and supporting fixture the subsystem owns belongs to
exactly one lane.

## 3. Read-only ledger per lane

Give each lane to its own read-only agent. The agent reads every assigned test
in full, including parameter tables (`it.each`, `pytest.mark.parametrize`,
`@vue/vue3-jest` table tests). It also reads the production owners and their
entry points, callers, history, and CI routing. Each test declaration goes
into a written **ledger** with one mark. A parameterized row is one
declaration unless its rows need different marks; then mark each row.

- `R`: retain, naming the contract and the bug it catches; a retained test that
  only moves to a better-named file stays `R` with the move noted;
- `F`: retain the contract but repair the assertion, such as a vacuous negative
  that passes when only one of several items is missing, or a `jest.fn()`
  mock whose return value is the assertion it was supposed to disprove;
- `C`: consolidate, naming the owner that absorbs the assertion first: a sibling
  table case, a stronger boundary suite (e.g. `createApp()`-via-supertest
  in backend route work), or the shared owner in another package;
- `D`: delete, naming the proof that remains, or why no contract exists.

Judge a test by its assertions, not its name. Past audits caught tests named
for retiring a behavior that asserted the behavior was *not* retired — the
negative-control trap (see [SKILL.md junk patterns](SKILL.md#junk-patterns)).
In backend mocks, look for `moduleNameMapper` aliases that exist solely to
support retired specs; the test "passes" while proving nothing about the
production path.

Done when every declaration in the lane has a mark and an evidence line.

## 4. Layer plan per lane

Treat the per-test ledger as input, not as the edit list. A second read-only
pass, starting from the ledger, looks for the redundant **layer**. In past
campaigns, several route suites replayed the same shared service through one
mocked DB call, around stronger real-ArangoDB-via-`createApp()` and HTTP
fixture suites. In OPEA, several `test_*.py` files re-asserted the same
`comps`-wrapped behavior through different mocks when the contract was owned
by one boundary test in `contracts/`. Name the **keeper** suite for each
contract. Prefer the real transport boundary with a fake network over a mocked
collaborator. Correct any ledger errors this pass finds.

Done when each lane plan names its retired files, its keeper per contract, the
assertions to carry into keepers, and the test-only production seams unlocked.

## 5. Cutover

Edit lane by lane. Serialize changes to shared harnesses and support files
through one owner. With each lane, remove the test-only production seams it
unlocks: injection parameters, getters, reset exports, indirection layers,
`__mocks__/` helpers, `moduleNameMapper` aliases, and `conftest.py` fixtures
that exist only for the retired tests. Register moved suites in CI routing
(`.gitlab-ci.yml` test jobs, `package.json` root scripts, `pytest.ini`
testpaths) and test inventories (`_bmad-output/project-context.md` testing
table). Update shrink-only line-cap baselines if the repo enforces them.
Put durable test-ownership rules in the subsystem's scoped agent-instruction
file — `CLAUDE.md` (or its symlink `AGENTS.md` at the repo root) — drawn from
mistakes this campaign actually found — e.g. "always run
`npm run format:check` before push", "do not mock `comps` outside
`tests/conftest.py`".

Done when every lane plan is applied and each lane's keepers pass.

## 6. Preservation review

Before claiming completion, have independent reviewers compare deleted
coverage against the keepers, one reviewer per boundary group. They look for
contracts that lost their only proof. They also look for new assertions that
cannot fail, such as a rejection row the production code never reaches.

For each restored contract, make one deliberate **mutation** of the production
owner and confirm the keeper goes red. Then restore the source byte for byte.
Per `feedback_verify_reviewer_subagent_claims.md`: parallel reviewers
over-correct; verify each proposed mutation against the actual owner before
applying — mutations on the wrong boundary prove nothing useful.

Done when every reported gap is restored or rejected with source evidence, and
every restored contract has a caught mutation.

## 7. Product defects

A baseline failure that survives into a keeper is a bug report. Fix it at
its owner as a separate commit, and prove it through the real user flow, with
a **control** run that reverts the fix and shows the old behavior. Record
unrelated product discrepancies you find as follow-ups instead of fixing them
in the campaign.

Done when each repaired defect has a failing control and a passing candidate
on the same harness.

## 8. Reconcile and hand off

Campaigns outlive many `main` commits. Merge `main` rather than rebasing a
long, many-commit campaign. When `main` modified a test file the campaign
deleted, keep the deletion. Port the new contract into the keeper instead, and
confirm every new regression `main` added still has a home. Rerun the whole
subsystem suite and repeat live proof on the merged head.

Expect review tooling to see a truncated file list on a diff this large.
Record maintainer decisions for generic compatibility flags in the MR
description rather than editing gates (this repo's policy per
`feedback_release_validate_before_promote.md`: validate-before-promote; the
gate is at the merge step, not at a release-commit step).

Hand off with the [SKILL.md](SKILL.md) report, plus:

- baseline and final test/support line counts, with production counted
  separately (from `git diff --numstat main..HEAD -- <subsystem>`);
- lanes, retired layers, and keepers;
- preservation gaps found and their mutations;
- product defects with control and candidate proof.