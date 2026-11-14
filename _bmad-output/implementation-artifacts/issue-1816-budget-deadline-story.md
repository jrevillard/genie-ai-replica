# #1816 — the retry loop re-grants the full LLM budget per attempt: ONE absolute deadline per phase

**Status:** IN PROGRESS (2026-11-14) — story written before code; verification lands at the end.
**Order:** David's work-plan item 3 (2026-11-14 queue). Found by the !866 review round (#1725's deferred half).
**Branch:** `fix/issue-1816-budget-deadline`, off `origin/main` (`4c855c6ad`).

## The defect (verified against the code today)

`withUpstreamRetry` (`services/frontmatter-service.js:182-213`) runs 4
attempts with 1–8 s exponential backoff. Its closure invokes
`adaptiveChatCompletion` with a FIXED `budgetMs` — so every retry re-grants
the FULL budget: a flaky shared-GPU endpoint can hold the phase ~4× the
granted budget plus backoff (a 5-minute grant can hold ~20 minutes).

**Scope correction found at story time:** the issue said "the four
budget-aware callers wrap it in withVllmRetry" — the DW-437 consolidation
waves since then migrated THREE of them (llm-curation :126,
topic-link-authoring :248, concept-meta :1009) to DIRECT
`adaptiveChatCompletion` calls with NO retry wrapper. Today exactly ONE
budgeted call rides the retry loop: frontmatter's chat leg
(`frontmatter-service.js:430`, whose own comment names the deferred
mechanism). The fix is therefore narrow: the deadline lives in
`withUpstreamRetry`, and the one wrapped caller threads it.

## The design (narrowest layer, additive)

1. `withUpstreamRetry(label, fn, ctx, opts)` gains an OPTIONAL
   `opts.phaseBudgetMs`. When present, the ABSOLUTE deadline is fixed ONCE
   at entry (`entry + phaseBudgetMs`); each attempt invokes
   `fn(remainingMs)` — the closure passes that remaining time down as the
   per-call budget. No deadline (TEI, legacy callers): `fn(null)` and the
   loop behaves exactly as before.
2. The loop never spends a doomed attempt: a retry only fires when the
   remaining time can still fund a usable attempt (`>= MIN_ATTEMPT_BUDGET_MS`
   = 500 ms), and the backoff sleep is checked against the deadline — a
   sleep that would eat the phase's last usable time ends the loop instead.
3. `withVllmRetry`/`withTeiRetry` forward the opts (one-line signatures).
4. Frontmatter's chat site passes `{ phaseBudgetMs: chatTimeoutMs }` and its
   closure maps `remainingMs → budgetMs` (first attempt: the full grant;
   retries: what the phase has left).

Out of scope (deliberately): the three unwrapped callers (no retry = no
re-grant; wrapping them is a behavior change, not a bug fix), the
vllm-model-cache probe path (already deadline-managed internally at
`vllm-model-cache.js:221-222`), AbortSignal wiring (the issue's larger
alternative — the timestamp achieves the bound without new plumbing).

## Acceptance

1. A retrying budgeted call's LATER attempts receive a SMALLER budget than
   the first (the remaining phase time, not the full grant).
2. The phase cannot outlive its grant: attempts whose work eats the budget
   stop the loop before the 4th attempt; total wall time stays bounded by
   the grant plus the last attempt's own cap.
3. A backoff delay that would consume the phase's last usable time ends the
   loop instead of sleeping through it.
4. No-deadline callers are unchanged: `fn(null)`, four attempts, same
   backoff (the TEI suites already pin this — they must stay green).
5. Suites: okf-server green; the new pins ride `frontmatter-service.test.js`.

## Riders on the same MR (work-plan items 4–5)

- **Item 4 — TZ-offset deferred-work item: RESOLVED AS REFUTED — no code
  change.** Reading the issue before writing the line found Jerome's
  orchestrator disposition on #1710 (note 94860): the premise was refuted
  during !835's review — doc-repo stores `new Date().toISOString()` (UTC,
  timezone-independent), a container `TZ` cannot move a stored stamp, the
  7 h offset was the HOST CLOCK (containers share it; dataprep carried the
  same skew), and the honest remedy is host NTP — an operations action.
  The `TZ=UTC` line was REMOVED from !835 as inert; the compose edit this
  story originally planned was reverted before commit. The durable
  correction — the stale deferred-work entry prescribing the inert line —
  is fixed in THIS MR, closing **#1739**. #1710 stays
  `status::awaiting-operator` (the human's NTP action + close).
- **Item 5 — #1819:** the test mock's conditional-close replace branch
  stores `structuredClone(bind.patch)` instead of the producer's patch by
  reference (mirrors the RETURN OLD deep copy fixed in !850). One line +
  comment; `producer-documents` 76/76 green.
