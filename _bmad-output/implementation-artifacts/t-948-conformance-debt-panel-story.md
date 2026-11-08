# T-slot story — #948: cross-repo conformance-debt aggregation + Studio panel

**Status:** IMPLEMENTED (2026-11-08) — verification results + review round at the end of
this file.
**Issue:** #948 (Story 10.4's read half, narrowed by David's 2026-11-05 disposition:
"one read-only conformance-debt aggregation endpoint (no bulk mutations) + one Studio panel
per the existing dashboard paradigms and DS primitives; i18n x14; tests"). The gate the
original story waited on (Authz Resolver 6-1b/6-1c) is SHIPPED. Unblocked: CSR W4–W6 + the
batch (MR !807) landed 2026-11-08.
**Branch:** `feat/okf-conformance-debt-panel` (off merged main `32882f1a5` — carries !810's
exported index helper).

## Design (grounded in live code)

**Backend — `GET /api/okf/repos/conformance-debt`** (read-only, no mutations):

- Route registered in `repos-routes.js` **BEFORE** `/:repo_id` (route-order: the param
  route shadows any literal sibling declared after it). Inherits the router-wide
  `requireScope('okf:read')` gate (line 4) — no extra scope wiring.
- Controller `listConformanceDebt` reuses the ACL composition `listRepos` already uses:
  `repoService.list({ authz: authzForService(req), cursor, limit })` — default-deny
  (empty Set → items []), scopeless-when-open filters to open repos via the shipped
  readAuthzForService. Pages via `next_cursor` with a hard 100-page cap.
- Service: ONE aggregation AQL over `okf_concepts_meta` (the `repo_id` persistent index
  from W9/!809 serves `FILTER d.repo_id IN @ids`), `COLLECT repo = d.repo_id INTO g`,
  projecting only what the five aggregates need — **field names mirror the per-repo
  `getRepoMetrics` exactly** (concept_count, conformance_issue_count, stale_concept_count,
  has_reserved_index, pii_hit_count) so the panel's numbers agree with the wizard's.
  The #1648 projection lesson applies here FIRST: never materialize full docs to compute
  aggregates. Rows joined server-side with the repo list (name, domain, lifecycle_state).
- Response: `{ items: [{repo_id, name, domain, lifecycle_state, concept_count,
  conformance_issue_count, stale_concept_count, has_reserved_index, pii_hit_count}],
  generated_at }`. Repos with ZERO meta rows are omitted (nothing to owe); zero-debt
  repos with rows are included so the panel can show clean vs debt.

**Frontend — `ConformanceDebtPanel.vue`** in `StudioTab`'s dashboard view (beside
`OkfRetrievalCard`, `v-if="view === 'dashboard'"`):

- Existing paradigms only: Options API, DS primitives, httpService (silent pass for the
  auto-load), screen enter/exit like the dashboard cards. Worst-first sort (issues,
  then stale, then pii). Lifecycle pill per repo (DsPill). Click-through reuses the
  StudioDashboard resume/open path. Test handles per E2E-TESTING.md (read the
  component's existing spelling first — admin surface uses `data-test-id`, chat
  surfaces `data-testid`).
- Empty state: "no outstanding debt" (the #80805 lesson — distinguish "ran and found
  nothing" from "not loaded"). Failure: compact inline error, no toast storm.

**Smoke**: extend `run-smoke-chat-sources.mjs` with a **[2.6] conformance-debt leg** —
the aggregation endpoint lists the seeded repos (scopeless admin), a RESTRICTED repo is
excluded from the caller's row set (the 6-1c fence lives in the authz-filtered list),
and a zero-debt repo still reports (concept_count > 0, issue counts 0).

## Boundaries

- NO bulk mutations (the disposition's explicit cap — no accept-all, no bulk fixes;
  the per-repo popups remain the mutation surface).
- No new collections, no new env vars; the panel is read-only.
- i18n ×14 deep-key-identical for the new strings (localeConsistency placeholder guard
  is derived — register nothing).
- Coverage never decreases; both suites green.

## Tasks

- [ ] okf-server: `getDebtByRepos(repoIds)` in conformance-service (projection AQL,
      text-pinned in tests); controller + route (before `/:repo_id`); page-loop cap.
- [ ] Frontend: ConformanceDebtPanel.vue + StudioTab mount + i18n ×14.
- [ ] Tests: controller (empty authz → [], enrichment, page loop), AQL text pins,
      component tests; smoke [2.6] leg.
- [ ] Verification: both jest suites green, coverage above baseline, prettier/eslint,
      live local-build gate (markers, probe, smoke incl. [2.6]).

## Reference

- Design: `okf-studio-ux-design-2026-08-13.md` §1.4/§3 (10.4/10.5 graft).
- ACL composition: `repository-controller.js:367` (listRepos), `repository-service.js:393`
  (list, default-deny G3).
- Per-repo metric semantics: `repository-controller.js:1923` (getRepoMetrics) +
  `conformance-service.js:171`.
- Index: `concept-meta-service.js:534` (ensureTreeIndex, per-process cached).

## Verification results (2026-11-08)

- okf-server: **85 suites / 2139 tests green**; frontend: **146 suites / 4111 green**
  (before the review-round fixes; re-run after them, see below). Coverage above the
  post-!622 baselines on every metric. prettier/eslint clean on every touched file.
  localeConsistency green (the okf.debt block, 12+1 keys ×14, key-identical).

## Review round (2026-11-08 — empirical reviewer: probe AQL + EXPLAIN + real-corpus measurement)

**Finding 1 (HIGH, fixed): `pii_hit_count` counted scanned-CLEAN concepts as debt.**
`LENGTH(d.pii_findings || [])` measures the pii_findings OBJECT (ArangoDB LENGTH of an
object = key count: content_sig, occurrences, ... → ≥2 for every scan), and pii-service
persists a findings object for EVERY scan, clean ones included. Measured on the real
corpus: five repos reported 3–161 PII hits where the true count is 0. The discriminator
now reads `pii_findings.occurrences` — applied to BOTH the new aggregation AND the
pre-existing `getRepoMetrics` (same expression shipped there; the panel's numbers must
agree with the wizard's — one vocabulary). The metrics test's text pin (which pinned the
WRONG expression as contract) re-anchored; the smoke [2.6] leg owns the numeric proof
(a clean seeded repo must report pii_hit_count 0 live).

**Finding 2 (HIGH, contract decided + fixed): the scopeless smoke assertion described an
authz the code deliberately does not have.** The endpoint uses `authzForService`
(deriveScopeAuthz, default-deny — the GET /okf/repos composition), NOT the serving-read
open-mode verdict. That is the correct choice: the panel lives in the Studio dashboard
(an admin surface), and it mirrors the repo list byte-for-byte. Fixed the artifacts that
claimed otherwise (panel header comment, controller comment) and re-wrote the smoke
sub-assertions to the real contract: wildcard admin sees open + restricted rows (the
admin scope satisfies the fence); a no-grant caller sees 200 with ZERO rows (the repo-list
mirror); the seeded open repo's row present with its concept_count.

**Finding 3 (MEDIUM, fixed): the AQL text pins could not catch a semantics bug.** The
unit pins now carry the CORRECT occurrences expression (text is the semantics here), the
row pass-through is pinned deep-equal, and the numeric semantics owner is the LIVE smoke
leg (a clean repo must report zero debt — the object-key trap would read 2).

**Findings 4–6 (LOW, fixed):** the worst-first sort is a lexicographic (issues, stale,
pii) comparator (a positional key let 100+ stale outrank 1 issue — pinned by a new test
at 140-vs-1); the 100-page catalog cap now REPORTS `truncated: true` in the envelope and
the panel names it in a warning row (a silent absence would read as a clean ledger, i18n
`okf.debt.truncated` ×14); the route-order contract got a BEHAVIORAL pin (GET
/conformance-debt reaches the debt handler — pages the list, aggregates — and getRepo
never sees the literal as a repo id).

**Finding 7 (scratch configs):** the two `jest.worktree.config.js` files stay uncommitted
(committed by explicit path list, never `-A`).

## Reference

- Design: `okf-studio-ux-design-2026-08-13.md` §1.4/§3 (10.4/10.5 graft).
- ACL composition: `repository-controller.js:367` (listRepos), `repository-service.js:393`
  (list, default-deny G3).
- Per-repo metric semantics: `repository-controller.js:1923` (getRepoMetrics) +
  `conformance-service.js:171`.
- Index: `concept-meta-service.js:534` (ensureTreeIndex, per-process cached).
