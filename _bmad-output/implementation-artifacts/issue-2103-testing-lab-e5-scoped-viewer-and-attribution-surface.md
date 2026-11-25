# #2103 — Testing Lab phase 4: the E-5 surfaces and the attribution surface

Part of #2061 (OKF Testing Lab: group-scoped evaluation).
Branch: `feat/okf-lab-scoping-ui` (worktree `D:\ITU-Gitlab\.claude\worktrees\okf-lab-scoping-ui`), cut from `origin/main` @ `96aa0e2bf`.

## The problem this wave answers (2026-11-24, David)

"as far as I can see... everything is missing" — the phase-1..3 engine (contexts,
bindings, pairings, boundary verdicts, attribution) was live on main and the
operator had NO way to reach any of it. The epic's own artifact had already
said so: *"The Lab UI wave is phase 4 (E-5): the context picker, the binding
badge and the boundary readout ride the scoped viewer."*

## Scope rulings (David, 2026-11-24, in-session)

1. **All of #2103 in one MR** — the UI wave + evidence-grade run records +
   the attribution metrics together.
2. **Superadmin-only picker and composer tab** — the Lab is repo-scoped; a
   context is a deployment-wide fact (the server gates the catalogue to
   superadmins). A repo-scoped admin still RUNS context-bound suites via the
   suite's own frozen context.

## What shipped

### The surfaces (frontend, `gov-chat-frontend`)

- `EvalContextPanel.vue` — the composer tab: catalogue (name, version,
  open-context tag, memberships, repo count, hash prefix, Refresh) + composer
  (group search via DsCombobox, chosen memberships with grants/member counts,
  PREVIEW before the immutable create, honest unreadable/error states).
- `EvalContextPicker.vue` — DsSelect naming what a run will measure:
  `name — vN · R repos`; empty choice = the open context.
- `TestingLabDialog.vue` — the superadmin-gated `contexts` tab
  (`canUseContexts` = `tools-admin` realm role, the RetrievalCard precedent),
  the picker above Generate, the binding badge above Run
  (`suiteBindingLabel`), the boundary readout in the summary
  (held/breached, else "not measured"), `suiteContextIdFor()` carrying the
  suite's own context on every run dispatch.
- `RagasPanel.vue` — the picker in the generate actions, `context_id` in the
  generate options, the run dispatch carrying the suite's context, and the
  EVIDENCE LINE: the binding badge + the attribution readout
  (`runAttribution` = `payload.source_attribution`: repo histogram, wrong-source
  rate; null renders "not measurable", never 0%).
- `headTestService.runSuite` — **the defect fix**: it posted NO body, so
  `bindingFromRequest` read a null binding and every context-bound suite was
  refused 409 CROSS_CONTEXT_BLOCKED from the UI. Now always posts
  `{context_id}` or `{}`.
- `store/modules/okf.js` — `headSuiteGenerate`/`headSuiteRun`/`ragasRun`
  accept and forward `contextId`.
- i18n — 39 new keys × 14 locales; the ≥25-char leaves translated in ALL
  locales (incl. man/st/sw), enforced by `localeConsistency`.

### The endpoints (backend, `okf-server`)

- `GET /okf/eval-contexts/groups` — the realm's groups, each with
  `{id, name, grants[], privileged, members[]}`; superadmin-gated;
  literal route registered BEFORE `/eval-contexts/:id`.
- `POST /okf/eval-contexts/preview` — `resolveContext` without writing;
  name-optional; unreadable memberships reported.
- `keycloak-access-service.groupMembers(groupId)` — members list (id +
  username only), max 200.

### Already on main (verified this wave — nothing to rebuild)

- Evidence-grade run records: head runs carry `payload.pairing`,
  `payload.carrier`, `summary.boundary`; RAGAS runs carry `payload.pairing`,
  `payload.carrier`, `payload.source_attribution`, `payload.coverage`.
- Both `listRuns` projections are SLIM (KEEP + summary fields) — the party
  panel's ruling 11 was already satisfied by phase 3.
- The E-4 attribution metrics (`sourceRepoHistogram`, `wrongSourceRate`) —
  per-row and run-level roll-up, persisted since phase 2.

## Proof

- RED: `headTestService.runSuite` pre-fix posted no body (watched fail:
  `Received: "/okf/repos/r-1/routing-testsuite/suite-1/run"` — no second
  argument).
- RED: the three ragas evidence tests failed against the pre-wave panel
  (no binding badge, no attribution readout) before implementation.
- Suites: okf-server **2575/2575** (105 files); frontend **4633/4633**
  (157 files).
- Coverage ABOVE the main baseline on all four frontend metrics:
  stmt 89.76 (baseline 89.72), br 77.92 (77.86), fn 69.88 (69.76),
  lines 90.04 (89.98). okf-server: 88.31% statements.
- Gates: prettier clean, eslint 0 errors (1 pre-existing `v-html` warning in
  `ConceptBrowserDialog.vue`, untouched).
- i18n contract 1048 leaves green; localeConsistency green (no raw-English
  ≥25-char leaf).

## The wave-facts ledger (for the review rounds)

- The `translate` mechanism is `translateMixin`, NOT `inject` — the first
  cut of the two new components used `inject: ['translate']` and broke 184
  dialog tests (`_ctx.translate is not a function`); fixed to the mixin.
- Design tokens are the FLAT set (`--muted`, `--border`, `--danger`); the
  first cut used non-existent `--ds-*` names and failed the designTokens
  contract; fixed.
- The i18n codemod initially nested the `contexts` block INSIDE `tab:`
  (duplicate key, object shadowing the tab label) — the localeConsistency
  duplicate-key AST scan and the i18n contract caught it; moved out.
- The run dispatch contract change (always names the context, `''` = open)
  updated the two dialog assertions that pinned the old payload.

## Still open after this wave

- Phase 5 (#2104) per the epic.
- man/st translation quality: genuine best-effort (register matched to the
  existing catalogue); a native-review pass is the honest follow-up.

## Amendment (2026-11-25, David's directive)

> "Evaluation contexts must be able to be added/modified (change name and
> add/remove groups) and removed. Removal should be restricted if they are
> currently in use for test suites. You MUST be able to see the groups in an
> existing evaluation context. I also just tried to run explain failures on a
> RAGAS benchmark in the local build and it errored."

### The mutability surface (backend + frontend)

- `POST /okf/eval-contexts/:id/update` (superadmin-gated) — rename and/or
  change `principal_refs`. A changed membership set re-resolves through the
  ONE authority (`resolveContext`) and bumps the version; an update naming
  an unreadable membership is REFUSED 422 `PRINCIPAL_UNREADABLE` with the
  stored snapshot standing (the refresh rule — never silently widen).
  Blank/non-string name → 400 `INVALID_NAME`; malformed refs → 400
  `INVALID_REFS`; audited as `eval_context.update`.
- `DELETE /okf/eval-contexts/:id` (superadmin-gated) — REFUSED 409
  `CONTEXT_IN_USE` NAMING the bound suites (any `routing_suite`, `suite` or
  `ragas_suite` whose `payload.context.id` matches, newest 50) while any
  test suite is minted for the context; otherwise removed and audited as
  `eval_context.delete`. The refusal's message renders verbatim in the
  composer.
- `EvalContextPanel.vue` — the composer doubles as the EDITOR: catalogue
  rows gain Edit/Delete; `onEdit` loads the stored name + memberships
  GRAFTED onto the loaded groups so each membership shows its GRANTS (the
  "you MUST be able to see the groups" ruling — visible, not just counted);
  an edit banner states that saving re-resolves and bumps the version;
  Cancel restores the compose mode; the primary button becomes "Save the
  changes" while editing.
- `evalContextService.updateContext/deleteContext` — both invalidate the
  catalogue memo (a write must not serve a stale picker list).
- i18n — 7 new keys × 14 locales (edit/delete/save/cancelEdit short labels
  English everywhere per convention; `editing`/`updated`/`deleted`
  translated in ALL locales — localeConsistency green).

### The explain-failures repair (David's live error, root-caused)

Three layers, each RED→GREEN:

1. **Frontend staleness** — regenerating a suite under the same key left
   `RagasPanel` rendering the PREVIOUS suite's run/explain records (the run
   doc's `suite_key` no longer matched the loaded suite; the poll then hung
   on an explain doc that would never complete). Fix: a `suite.suite_key`
   watcher clears `runDoc`/`explainDoc`/`explainProgress`/`error`.
2. **Async pairing acceptance** — `beginExplainFailures` validated the
   run/suite pairing INSIDE the async job, so an impossible pairing
   produced a forever-running placeholder. Fix: synchronous validation
   (404 `RUN_NOT_FOUND`), the placeholder saved before the job starts, and
   `failTerminal` marks the doc `{status:'failed', error}` if the job
   throws.
3. **Final write** — the doc write moved from `.save()` to `.replace()` on
   the placeholder's key (the placeholder and the final doc are one row).

### Coverage + gates (amendment diff)

- okf-server: stmt 88.36 / br 75.73 / fn 89.55 / lines 89.83 — above the
  main baseline (88.34/75.72/89.4/89.81) on all four.
- frontend: stmt 89.75 / br 77.97 / fn 69.91 / lines 90.04 — above the
  baseline (89.72/77.86/69.76/89.98) on all four.
- Suites: frontend 4646/4646 (post-prettier re-run); localeConsistency +
  okf-surface-i18n-contract green; prettier + eslint clean.
- Worktree measurement trap (recorded to memory): `jest --coverage` writes
  NOTHING to the default dir in a `.claude` worktree and `json-summary`
  is not a default reporter — the numbers above come from
  `--coverageDirectory=./covtest --coverageReporters=json-summary` with a
  verified-fresh mtime.
- The controller adapter fix the new tests caught: every handler now
  awaits the service BEFORE stamping the status (a refusal path must never
  carry a success status through `res.status(200).json(await …)`).
