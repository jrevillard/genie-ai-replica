# T-slot story — #1647: the Testing Lab opens with feedback (spinner + instrumentation)

**Status:** IMPLEMENTED (2026-11-08) — on branch `feat/testing-lab-spinner`, verification
results at the end of this file.
**Issue:** #1647.
**Branch:** `feat/testing-lab-spinner` (off merged main `525cbb9e6`).

## Intent (David, 2026-11-08)

Launching the Testing Lab on a LARGE repo shows a long pause with no user
feedback. The lab must open with feedback — a spinner — from the moment the
CTA fires.

## Investigation record (evidence, not guesswork)

- Every lab ACTION already carries busy feedback: `busy==='run'|'generate'|'rebuild'|'test'|'revert'|...`
  spinners exist for each, and the suite run adds a REAL progress bar
  (1-8g-x: live `{phase,done,total}` through the poll tap).
- The lab OPEN fires three loads (`refreshRuns`, `refreshRagasSuites`,
  `loadFrontmatterHistory`) — none gates the dialog body on a loading state
  today; the runs list has no loading affordance at all.
- Live timing on the local build (admin token, all five open-time endpoints):
  Bali (1112) and Quran Core EN (6352): runs 37–44 ms, history 7–16 ms,
  suite 404 4–6 ms, ragas suites 5–7 ms — **the open loads are NOT the pause
  locally**. The pause David saw is therefore deployment- or
  payload-specific; locally-unreproducible.
- The one measured-slow, repo-size-dependent endpoint is
  `GET /okf/repos/:id/metrics`: 0.43–0.88 s steady, **4.3 s cold** on Bali;
  224 ms on Quran. NOT called by the lab — awaited silently by the wizard's
  Validate/Publish steps and StudioDashboard. Same defect family (a slow
  read with no feedback), fixed in the same MR via the W9 lazy index.

## Design

1. **Launch overlay** — the dialog opens INSTANTLY and shows the dialog's
   BUILT-IN loading overlay (DsDialog `:loading` — the same house pattern
   ConceptBrowserDialog uses) until the three open loads settle, with a
   ~250 ms minimum-visible floor so fast loads don't flash. Whatever leg is
   slow on David's deployment becomes visible feedback. No new i18n key —
   the built-in overlay is a spinner graphic, not text.
2. **Instrumentation first (the UX-5 ruling applies verbatim)** — each open
   leg logs through the dialog's existing `legTiming` (`[okf-lab-timing]`
   console channel): `lab-open-runs`, `lab-open-ragas`, `lab-open-fm-history`,
   plus a whole-open `lab-open`. David's next repro NAMES the slow leg from
   the browser console; the optimization follows the measurement, per the
   ruling.
3. **Metrics ride-along** — `getRepoMetrics` and `countByIndexStatus` ensure
   the `okf_concepts_meta(repo_id)` persistent index (the W9 lazy-index
   helper, reused; cached per process, non-fatal), so the wizard/dashboard's
   silent 4-second read joins the millisecond club and cannot regress with
   repo size.

## Boundaries

- DS primitives only (DsDialog's own `:loading` overlay — no bespoke markup);
  NO new i18n strings; no server API changes; no new cache; the lab's action
  spinners untouched.
- Coverage floors hold; the dialog suite pins the overlay semantics.

## Tasks

- [x] Dialog: `openLoading` + DsDialog `:loading` + per-leg `legTiming` +
      whole-open timing.
- [x] okf-server: export the lazy index ensure; `countByIndexStatus` +
      `getRepoMetrics` call it.
- [x] Tests: dialog overlay semantics (visible while loads pending, cleared
      after, loads dispatched); okf-server suites green; metrics timing
      re-measured live (live gate runs at MR time).
- [x] Workplan ride-along: the stale W7/W8/#1630/#1634 rows flip to MERGED;
      the #1647 row lands in Phase T.

## Verification

- `cd components/gov-chat-frontend && npx jest` — all green incl. the new
  overlay pins; coverage ≥ floors.
- `cd components/okf-server && npx jest` — all green.
- prettier/eslint clean on every touched file (`.vue` included).
- Live: sync the local build, re-run the metrics probe (expect ms-class on
  Bali), click-through the lab open with the network/console evidence.

## Review round (2026-11-08)

Correctness + security lenses, independent agent — clean per lens:
lens; two LOW findings — (1) a stale-open race: close+reopen while the loads
are pending let the OLD invocation's tail clear the NEW open's overlay early
(cosmetic; data still arrives). **Fixed in place** — an open-sequence guard
(`_openSeq`) makes only the latest open settle `openLoading`. (2) the 250 ms
anti-flicker floor itself is not regression-pinned — accepted gap: a timing
assertion invites flake for a cosmetic floor; noted here rather than shipped.
The reviewer also corrected the overlay-anchor description: DsDialog's
loading veil is a sibling of the dialog body anchored at the modal panel —
it covers header+body+footer and escapes the body's overflow clip (stays
fixed while content scrolls) — correct behaviour, better anchor than the
body-relative one first assumed.

## Verification results (2026-11-08)

- Frontend: **145 suites / 4107 tests green**, coverage **89.38 stmt /
  76.89 branch / 68.43 func / 89.55 line** — above the post-!622 frontend
  baseline (88.60) on every metric. Three new pins in
  `testing-lab-dialog.test.js` (overlay up while pending → down after the
  250 ms floor; readOnly skips the fm-history leg; all four legs named on
  `[okf-lab-timing]`).
- okf-server: **85 suites / 2134 tests green**, coverage **87.46 stmt /
  89.05 line** — above the post-!622 baseline (86.42). Two new ensure pins
  (`concept-meta-service.test.js` cold-cache via `jest.resetModules()`;
  `conformance-service.test.js` first-position getRepoMetrics).
- Test-infrastructure find recorded during the work: jest's `testMatch`
  finds NOTHING under a `.claude` worktree (dot-segment in the path) —
  worked around with untracked per-component `jest.worktree.config.js`
  (testRegex override, never committed); and the ensure-cache is warmed by
  the embedded getRepoMetrics test, so the cold-cache pin needs
  `jest.resetModules()` (documented in the test).
- prettier + eslint clean on every touched file.
- Live local-build gate + metrics probe re-measure: see the MR description
  (runs after this story is committed, before GO).
