# Story: perf(okf-editor) — windowed parallel concept-list crawl with a real abort (#2188)

**Issue:** #2188 · **Queue position:** 1 (after !1094 lands) · **Depends on:** !1094 (#2195 op-wait system)
**Surface:** `components/gov-chat-frontend` only — `store/modules/okf.js` + `services/conceptService.js` (+ their tests)
**Fence:** admin-UX fence holds. httpService.js is VERIFIED UNTOUCHABLE-AND-UNNEEDED (see §Abort). Any discovery that pulls in httpService.js or the session/re-auth layer → STOP AND ASK David.

## Initiative context

Item 1 of the large-repositories work plan (#2188–#2197 + #2198 + #2200–#2202).
!1094 (#2195) built the operation-wait registry + overlay: `fetchConcepts` already
registers a wait op with live `{done}/{total}` progress via `setProgress`. But the
registry documents the honest rule: operations without a real abort path are
registered NON-cancellable — a Cancel that doesn't cancel is the fake affordance the
system exists to kill. #2188 is the item that makes the concept-list crawl BOTH fast
enough to not need a cancel AND honestly cancellable.

## Evidence (issue #2188, measured 2026-11-26, local stack, 10,001-concept repo)

- Opening a repo fires ~50 sequential `GET /okf/repos/:id/concepts?limit=200&offset=N`
  at 400–700 ms apiece (~18 s). Every response was a 304 (0-byte body, browser HTTP
  cache) — the wait is client round-trips + re-renders, not server work.
- `fetchConcepts` commits the WHOLE accumulator into Vue reactivity per page
  (~50 full 10k-row array replacements) → O(n²) render work → main-thread saturation
  (native busy cursor, no app affordance).
- The in-code justification for sequencing — "Pages are SEQUENTIAL by design — each
  offset needs the previous count" — is a FALSE PREMISE: `offset = acc.length` is
  deterministic before dispatch; only `total` from page 1 is needed.

## Ground truth in code (verified on origin/main post-wave, 2026-11-26)

- `fetchConcepts(repoId)` — `okf.js` (~line 909 pre-!1094): page-1 serial fetch via
  `conceptService.listForRepo(repoId, { limit: 200, offset: 0 })`, then a
  `while (acc.length < total)` sequential loop committing `acc` fully per page.
- Guards that MUST survive unchanged (semantics, not line numbers):
  - **Round-20 pre-first-commit guard** — stale check before the first `setConcepts`
    commit (repo switched while page 1 in flight).
  - **Round-11 in-loop guard** — per page boundary; a superseded fetch cleans up
    EXCEPT when a newer fetch owns the flags (generation moved → do not clear
    loading/progress).
  - **Round-20b tail guard** — same predicate at natural completion.
  - **Keep-last-known-list on error** (round 20, #80803) — a failed page must not
    blank the rail; empty only when nothing ever loaded.
  - `finally` clears `setConceptsLoading` only when `!stale()`.
- `conceptService.listForRepo(repoId, opts)` builds the query string manually and
  calls `httpService.get(url)` — single-arg today.
- `httpService.get(endpoint, params, options)` spreads `options` into the axios
  config (`{ ...options, params }`) → **`signal` threads natively with NO
  httpService.js change** (verified `httpService.js` get() body, origin/main).

## The change

1. `PAGE` stays 200. Page 1 stays serial and commits alone (rail shows rows in
   ~0.5 s — existing behavior, keep).
2. After page 1 yields `total`, precompute the remaining offsets
   `[200, 400, … < total)` from `total` — the sequencing comment is deleted and
   replaced with the truth.
3. Fetch remaining pages in windows of **5 concurrent** requests
   (`CONCEPT_FETCH_CONCURRENCY = 5`; issue allows 4–6).
4. Per window: `Promise.all`, then **sort the window's rows by offset** (arrival
   order is nondeterministic; server order is the contract), then ONE
   `setConcepts` commit + ONE progress commit per wave (~10 commits for 10k rows
   instead of ~50).
5. Yield to the renderer between waves (`yieldToRenderer()`: `requestAnimationFrame`
   when present, `setTimeout 0` fallback for jsdom) so the progress bar paints live.
6. Stale guards: pre-first-commit guard unchanged; the in-loop guard moves from
   per-page to per-wave (checked between wave dispatch and wave commit, and at the
   same cleanup semantics — generation-aware flag ownership); tail guard unchanged.
7. **Real abort**: one `AbortController` per `fetchConcepts` call.
   `conceptService.listForRepo` gains `opts.signal` → third arg to
   `httpService.get(url, {}, { signal })`. The op-wait registration for
   fetchConcepts (from !1094) flips to `cancellable: true` with
   `onCancel: () => controller.abort()`. On AbortError: keep-last-known-list
   (already-committed rows stay — known-good), clear loading per the guard rules,
   settle the op per the op-wait contract, return `{ ok: false, code: 'ABORTED' }`.
8. Generation counter semantics unchanged (a newer fetch still supersedes by
   generation, independent of abort).

## Acceptance (issue, measured live on the local build before merge — RULED)

- 10k-repo open: no browser busy cursor at any point; wall clock ≤ 5 s.
- Rail shows page-1 rows within ~0.5 s.
- Cancel in the op-wait overlay actually stops the crawl (no orphan in-flight pages
  committing after the click).
- Stale-guard + generation semantics preserved (round-11 / round-20 guards,
  keep-last-known-list on error).

## Test plan (TDD — each test watched red first, store boundary)

- Windowing: total 2000 → 9 extra pages → 2 waves → exactly 2 paging-phase
  `setConcepts` commits (+1 initial), progress committed per wave.
- Order safety: window pages resolve out of order → final array ordered by offset.
- Stale mid-wave: generation bump during wave 1 → no later wave commits; flags
  owned by the newer fetch (round-11 rule).
- Abort: op cancel → in-flight pages reject, no commits beyond the last wave,
  `{ code: 'ABORTED' }`, loading cleared per guard, partial list kept.
- Keep-last-known-list: wave-2 failure → acc-so-far stays, error surfaced.
- Legacy single-page + legacy array paths unchanged (existing pins).
- Coverage must not decrease (baselines post-!622: 88.21% overall — jest
  --coverage before review).

## Security workflow (standing)

/security-review focused on `okf.js` + `conceptService.js` BEFORE changes; full-diff
review after implementation and after each bug-fix round, paired with /code-review
(high). No new deps. No new inputs (ids already `encodeURIComponent`-ed; query
params numeric-coerced as today). npm audit in the frontend is tracked separately
(#2199 — vue-i18n advisories, David's call) and is not this MR's scope.

## Ship checklist

- i18n: NO new strings (op-wait overlay keys shipped with !1094).
- CHANGELOG bullet under Unreleased → Changed (perf, okf-editor).
- BMAD: this story file rides the MR at `_bmad-output/implementation-artifacts/`.
- GitLab: #2188 `ready-for-dev` → `in-progress` at branch cut; MR body carries
  `Closes #2188`; `squash=true` set before David's click (hard rule: all merges to
  main squash).
- Deploy to the local build + replay the acceptance measurements BEFORE merge.
