# Story — The RAGAS e2e specs seed their own venue data (#1890)

**Status:** COMPLETE (2026-11-18)
**Issue:** [#1890](https://opensource.unicc.org/un/itu/genie-ai/-/issues/1890) —
the three RAGAS e2e specs assert against pre-existing venue data (`El Salvador`
hardcoded as `OKF_SMOKE_REPO_NAME` fallback); on venues without it they skip
honestly, but where it exists their verdicts couple to content no test
controls, and every cancelled re-score leaves one more lineage row on the
venue's real repository.
**Branch:** `feat/ragas-venue-seed` (off origin/main `912741872`).
**Ruling (David, 2026-11-17):** "make the tests generic through a test-only
back door inside the server container and clean it up."

## The defect, in one paragraph

The three RAGAS specs walk the real UI: Studio card → Testing Lab → RAGAS
Benchmarks tab. Their REPO anchor was a hardcoded venue fallback, so the specs
were only meaningful on a venue that happened to carry a finished RAGAS run —
and on such a venue the "re-score is tracked and cancellable" test re-scored
the venue's REAL last run, cancelling it and leaving a cancelled row in the
venue's history forever (the #1876 guard existed precisely because previous
executions left lineage rows behind).

## The fix (what the ruling picked)

1. **Seed fixture, one shape** — `data/okf/smoke-test/ragas-venue-seed-docs.js`:
   a pure-data module (zero requires) exporting the seed's fixed names
   (`ragas-venue-seed` / `e2e-seed` domain, suite `e2e-seed-ragas-suite`, run
   `e2e-seed-ragas-run-done`) and `suiteDoc(repoId)` / `runDoc(repoId)` — a
   suite with one in-scope entry and a done run with one ANSWERED row whose
   metrics are `{}` (a judge never scored the fixture — the UI shows the means
   unmeasured; the fidelity block names itself as a test-only fixture).
2. **The back door** — `data/okf/smoke-test/seed-ragas-venue-docs.js`: the
   in-container writer (docker cp + docker exec, the run-smoke* procedure)
   with four subcommands: `seed <repo_id>` (marks PII scanned — the submit
   gate — and writes both docs, remove-then-save for deterministic re-seeds,
   read back to assert its own write), `verify-clean` (FAILS naming any
   surviving seed repo/doc row), `purge-docs` (orphan sweep by suite_key),
   `unstamp` (the purge ladder's serving-stamp last resort).
3. **The host-side seed helper** — `tests/e2e/helpers/ragas-venue-seed.js`:
   `probeOrSkip(test)` FIRST (skip the whole group WITH A REASON before any
   fixture exists when no docker-reachable okf-server container — #1742
   protocol; a skip halts the remaining hooks, so nothing leaks),
   `seedRagasVenue(user)` (purge stale + orphans → repo via API → import →
   back door → submit/approve/publish → drain-settle poll → readiness read of
   listRuns), `purgeRagasVenue(user)` (suite cascade FIRST — a repo delete
   does NOT cascade okf_head_test_runs docs, found live — then the repo, then
   `verify-clean` in-container; any survivor FAILS the run).
4. **The three specs rewired** — the `|| 'El Salvador'` fallbacks deleted;
   beforeAll = probe → mint tools-admin user → seed; afterAll = purge →
   deleteUser. The #1876 knownKeys guard stays (belt and braces; a fresh seed
   makes the history start at exactly one row).
5. **The unit pin** — `components/okf-server/__tests__/ragas-venue-seed-docs.test.js`
   runs `rescoreRun`'s ACTUAL validation against the template (mock-DB
   harness, sidecar mocked) plus the negative control (a foreign repo_id
   404s — the gates were reached, not skipped) and the cascade-shape pin
   (the suite doc carries its own `suite_key` — the field deleteSuite's
   cascade removes by; found live when the first purge left exactly that
   orphan).

## Evidence (live, local build `main-okf-server-1`)

- Pin test: 3/3 GREEN (`jest ragas-venue-seed-docs.test.js`).
- Ragas family: 6 suites, 165/165 GREEN.
- All three specs against the live build: PASS (guide 8.4s / judge 2 tests /
  rescore full walk incl. tracked + cancelled re-score), each purge ending
  `verify-clean: no seed repos, no seed docs`; DB sweep afterwards: zero seed
  repos, zero seed rows.
- Full okf-server suite in the borrowed-env worktree: 2108/2153 — the 45
  failures are 4 pre-existing DB-integration suites (validation/auth/
  repos-routes/llm-curation) that open REAL arangojs connections from the
  host (ENOTFOUND/wrong-credentials against the docker-network hostname);
  zero production code changed in this MR, and none of the four shares a
  line with the diff. CI owns the real verdict.

## Boundary notes

- CI excludes `tests/e2e/okf` entirely — nothing new runs there; the pin
  test runs in the okf-server jest suite (inside CI's coverage gate).
- Benchmark runs stay DAVID's clicks: the seed never fires a judge leg (the
  re-score the rescore spec triggers is cancelled within seconds, exactly as
  before — the footprint is unchanged; the only difference is whose run it
  burns, and the answer is now: the fixture's, never the venue's).
