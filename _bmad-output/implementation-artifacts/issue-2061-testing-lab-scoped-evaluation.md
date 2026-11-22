# #2061 — OKF Testing Lab: group-scoped evaluation (Phased epic)

**Status:** IN PROGRESS (2026-11-22) — Phase 1 in flight; verification lands at the end of each phase.
**Issue:** https://opensource.unicc.org/un/itu/genie-ai/-/issues/2061
**Branch:** `feat/okf-testing-lab-scoped-eval`, off `origin/main` (`56d87e763`).
**Worktree:** `.claude/worktrees/okf-lab-scoped-eval`.
**Delivery:** MRs to `main` only. Never push to a release branch.

The epic's own phasing (issue text §Phasing) is binding — each phase lands
and is verified before the next begins.

| Phase | Scope | Status |
|---|---|---|
| 1 | E-3 pair-level reporting + F7 steal accounting + F6 knob unification + the blank-principal fix | IN FLIGHT |
| 2 | E-1 Evaluation Context object + E-2 carrier-faithful head testing + E-4 carrier substitution | pending |
| 3 | E-7 context-native generation + suite binding | pending |
| 4 | E-4 attribution metrics + E-5 evidence-grade run records | pending |
| 5 | E-6 offline harness parity + the tenant-segment decision | pending |

## Operator decisions (2026-11-22)

1. **Blank-principal fix: in Phase 1**, at the actor shape (one additive
   line) + a regression test at the real boundary. The Lab's run records
   name the acting principal from Phase 1 onward.
2. **Superadmin gate (Phase 2): both populations** — the `tools-admin`
   realm role OR a wildcard `okf:*:*:admin` scope.
3. **Restricted scenario: after Phase 1.** The per-repo `acl.restricted` +
   group scope grants are built once Phase 1's evidence exists. The global
   scope mode stays `open`; only per-repo fencing is used. The group/user
   structure for the local build is authored from the existing repository
   inventory.
4. **`xlsx` npm-audit finding: RISK-ACCEPTED** with a backlog issue for
   migrating the converter to a maintained permissive-OSS parser. Reachability
   is `POST /convert-from-documents` (`tools-admin`-gated); no registry fix
   exists.

## Corrections to the issue text (party-mode panel, 2026-11-22)

Three premises in the issue (and its attached analysis) are wrong against the
code as it stands. The phases below implement the corrected behaviour.

- **C1 — the run collection is NOT TTL-reaped.** The issue's E-5 ("the TTL reap
  stops applying to this collection") describes a control that does not exist:
  the only `REMOVE`s on `okf_head_test_runs` are the three explicit user
  deletes; `ensureCollection` creates it with no `ttlAttribute`; the boot
  sweep only flips `running` → `failed`; the sidecar's `RAGAS_JOB_TTL_S` reaps
  the sidecar's in-memory job registry, not the collection. "Keep all runs"
  therefore formalises an already-unbounded state rather than removing a
  control. Consequence for Phase 1: nothing to disable — and the retention
  question moves to Phase 4, where it must be written down rather than
  assumed.
- **C2 — the name-sorted truncation truncates DISPLAY and ATTRIBUTION, not
  the race.** `loadSiblings` returns every repo with a head; the race ranks
  all of them; `sibling_limit` (default 20) is applied at
  `head-test-service.js:515` when the per-row sibling DETAIL list is built.
  The head winner is therefore computed over the whole universe. What the
  truncation breaks is (a) which competitors the UI shows and (b) steal
  ATTRIBUTION — `head-suite-service.js:1681-1684` resolves `winner_name`
  against the truncated list, so a winner outside it lands as `winner_name:
  null` and the steal disappears from the report while the positive still
  fails. Phase 1 fixes the attribution (the report must not lose a steal);
  the universe itself is Phase 2 (E-2).
- **C3 — the run record's `created_by` is the literal string `"system"` on
  every run.** `controllers/actor-from.js:8-11` returns `{ sub, name,
  source_ip }`; 25 sites across 5 services read `opts.actor.user_id`, which
  that shape never has. The unit tests miss it because they call the
  services directly with a hand-built `{ actor: { user_id: 'u1' } }` — the
  fixture shape production never sends. Fixed in Phase 1.

## Phase 1 — diagnose first

The instance case is a flat 14-repo universe (13 siblings) where four variant
heads are effectively tied (margin 0.004) and the core repo passes ~49%. Two
explanations are consistent with that number and they need different fixes:

- **inter-group** — the rivals are outside the profile group, so scoping the
  universe fixes it;
- **intra-group** — the rivals ARE the group, so scoping makes the race
  HARDER (a profile's repos are most similar to each other).

Phase 1 must make the difference visible before any new object is created.

### 1a. Blank principal (C3)

`actorFrom` gains `user_id` alongside `sub` — the same principal id the audit
trail already records (`audit-service.js:43-83` uses `req.user.sub`), so every
one of the 25 `opts.actor.user_id` readers starts naming a real principal
instead of falling back to `'system'` / `'auto-publish'`. Additive: the
existing `sub` / `name` / `source_ip` fields are unchanged.

Regression proof at the real boundary: build the actor with `actorFrom` (the
production shape), generate a suite through the service, and assert
`created_by` is the principal — not `'system'`.

### 1b. F6 — one knob loader, read per run

Three readers capture the same knobs at module load:
`head-test-service.js:84-112`, `head-suite-service.js:81-83` (`GATE_*`
aliases), and `genie-ai-overlay/retriever/config.py:172-208`. A retune plus a
single-service restart leaves the Lab and production on different thresholds,
both green.

- ONE loader in okf-server, read **per run** (not at import), used by both
  JS readers. The `GATE_*` alias copies die.
- The loader also carries the drift guard: the effective knob values are
  recorded on the run doc (`fidelity.knobs` already exists on the
  `routingTest` result but is NOT copied into the run doc — so a stored run
  cannot say which thresholds produced it).
- The loader's values must reach okf-server. Today the okf-server compose
  block receives NONE of the `RETRIEVER_ROUTE_*` knobs (only the retriever
  does), so the Lab scores hard-coded defaults while the retriever may run
  retuned values — the drift the Lab is supposed to detect, already live.

### 1c. F7 — steal accounting

`head-suite-service.js:2059-2096` (`summarizeRun`):

- steals are keyed by repo **NAME** — two repos with the same name collide,
  and the name is resolved against the truncated sibling list, so a winner
  outside it vanishes. Key by `repo_id`; the display name is joined at
  render.
- a positive lost to a **non-claiming** winner is recorded NOWHERE — the
  answer vanished entirely, the most security-relevant outcome in a
  restricted carrier. It gets its own counter (`lost_no_winner`).
- negatives count as passed when the under-test head does not claim, even if
  a **sibling wrongly claims** them — a non-event counted as a win. The
  summary must distinguish "under-test correctly silent" from "sibling
  wrongly claims".
- `avg_margin` averages nulls as zero; `steals` is `[]` when the carrier is
  narrow. Null and zero are different claims (the Skeptic's rule).

### 1d. E-3 — pair-level reporting (the confusion matrix)

Per run, per carrier: matrix rows = intended repo, columns = actual head
winner, cells = query counts; per-pair wrong-source rate; aggregate claim
accuracy. Rendered in the Suites & analytics tab ALONGSIDE (not replacing)
the pass rate — an aggregate pass rate hides pairs, and a pair names the fix.

Phase 1 runs on the GLOBAL universe (no context object yet). That is the
point: it must show whether the near-tie is intra- or inter-group BEFORE the
universe is narrowed.

### 1e. Documentation (F8)

`site/content/en/docs/knowledge-base/testing-lab.md:33-34` claims the Lab
scores every head "exactly as the real fan-out would" — untrue today (the
Lab's universe is not the carrier). The site is English-only
(`site/content/en/`), so the correction is one file. It must stop CLAIMING
the false property, not caveat it.

## Acceptance (Phase 1)

1. The run record names the acting principal under the production actor
   shape; no run is attributed to `"system"` when a human started it.
2. One knob loader serves both JS readers, reads per run, and its effective
   values are recorded on the run doc. The `GATE_*` copies are gone.
3. The okf-server container receives the `RETRIEVER_ROUTE_*` knobs, so the
   Lab scores the deployment's thresholds rather than hard-coded defaults.
4. The run summary keys steals by `repo_id`, counts `lost_no_winner`,
   separates "under-test correctly silent" from "sibling wrongly claims",
   and distinguishes null from zero.
5. The run summary carries the pair-level matrix (rows = intended repo,
   columns = actual winner, cells = counts) + per-pair wrong-source rate +
   aggregate claim accuracy; the Suites & analytics tab renders it beside the
   pass rate.
6. The run-history table and the pass-rate display show the universe the
   score was measured over (a pass rate without its denominator is the trap
   the Skeptic named).
7. The Lab's docs no longer claim carrier-faithfulness the code lacks.
8. okf-server + frontend suites green; coverage at or above the baseline
   (83.71% statements / 84.83% lines across the seven target services);
   CHANGELOG updated; a BMAD artifact rides in the MR.

## Not in Phase 1 (deliberate)

The Evaluation Context object (E-1) and the carrier-scoped universe (E-2):
the phasing says diagnose before creating objects, and the matrix is the
diagnostic that says which of them is even needed. Also out: RAGAS
attribution preservation (E-4, Phase 4) — it is the PREREQUISITE for the
read-time disclosure gate, not a Phase 1 metric.
