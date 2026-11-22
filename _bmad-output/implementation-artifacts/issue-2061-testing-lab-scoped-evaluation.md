# #2061 — OKF Testing Lab: group-scoped evaluation (Phased epic)

**Status:** IN PROGRESS (2026-11-22) — Phase 1 code complete and green; the phase lands as one MR, verified on the local build before merge. Phase 2 next.
**Issue:** https://opensource.unicc.org/un/itu/genie-ai/-/issues/2061
**Branch:** `feat/okf-testing-lab-scoped-eval`, off `origin/main` (`56d87e763`).
**Worktree:** `.claude/worktrees/okf-lab-scoped-eval`.
**Delivery:** MRs to `main` only. Never push to a release branch.

The epic's own phasing (issue text §Phasing) is binding — each phase lands
and is verified before the next begins.

| Phase | Scope | Status |
|---|---|---|
| 1 | E-3 pair-level reporting + F7 steal accounting + F6 knob unification + the blank-principal fix | CODE COMPLETE — verification green |
| 2 | E-1 Evaluation Context object + E-2 carrier-faithful head testing + E-4 carrier substitution | pending — gated on the carrier-trust findings (F1/F2 below) |
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

## Phase 1 — delivery record (2026-11-22)

**Status: CODE COMPLETE, verification green.** The MR carries the phase; the
phase's own evidence is the local build (deployed before merge) plus the
suite runs below.

| Acceptance | Where it landed | Proof |
|---|---|---|
| 1 — the run record names the acting principal | `components/okf-server/controllers/actor-from.js` (one additive `user_id` on the shared actor shape; 25 readers repaired at once) | `head-suite-service.test.js` — "the suite record names the acting principal" |
| 2 — one loader, per run, recorded | `services/route-knobs.js` (new) + `head-test-service.js` + `head-suite-service.js` (`GATE_*` gone) + `payload.knobs` on the run doc | `route-knobs.test.js` (4) + the advisor/loader wiring |
| 3 — the knobs reach the container | `docker-compose.yaml` (okf-server block) + `charts/.../opea/okf-server.yaml` (`$routeGateEnv`, read from the retriever's values block) | `tests/config-validator/__tests__/route-knob-parity.test.js` — delivery + drift legs |
| 4 — the accounting says what happened | `head-suite-service.js` `summarizeRun`: steals keyed by `repo_id` (+`by_name`), `lost_no_winner`, `negative_wrongly_claimed`, `avg_margin_n`, `steals: null` when unmeasured | 5 new tests in `head-suite-service.test.js` — **verified RED against the pre-change code** (all 5 failed), then GREEN |
| 5 — the pair-level matrix | `head-suite-service.js` `buildConfusion` + the Suites & analytics tab (matrix beside the pass rate, with the universe) | 3 new backend tests + 1 new frontend test |
| 6 — the universe is visible | the summary block, the run-history table's new *Universe* column | the frontend test asserts the rendered universe |
| 7 — the docs stop claiming what the code lacks | `site/content/en/docs/knowledge-base/testing-lab.md`, `access-control.md`, `okf-studio.md`, `docs/configure/okf-variables.md` (the route thresholds are now documented), and the Test tab's own string in **all 14 locales** | — |
| 8 — suites green, coverage up, CHANGELOG | okf-server **95 suites / 2456 tests green**; frontend **156 suites / 4580 tests green**; config-validator green except 5 PRE-EXISTING e2e failures (`tests/e2e` deps missing in this checkout + a class-selector violation in `tests/e2e/auth/g1-swagger-authorize.spec.js` — neither file is touched by this change) | coverage vs the base commit, measured the same way: component total **87.85% → 88.12%** statements, **89.35% → 89.59%** lines, **75.35% → 75.76%** branches; `head-suite-service.js` 82.78% → 83.78% statements; `head-test-service.js` 85.95% → 91.59% (the retry/timeout probe path is now covered by two new tests); `route-knobs.js` 100% |

### Phase 1 — the live build (2026-11-22)

The phase was deployed to the local build BEFORE the merge, because a deploy is
part of MR readiness. The tree was synced to the branch, `frontend` and
`okf-server` were rebuilt and recreated, and `verify-local-build.sh` reported
**47 pass / 0 fail** with both containers healthy.

**The delivery leg (F6) — proven on the running containers.** The knobs now
reach BOTH containers with identical values, where the Lab previously received
none of them:

```
RETRIEVER_ROUTE_ENABLED=true            RETRIEVER_ROUTE_HEAD_FLOOR=0.55
RETRIEVER_ROUTE_TOP_K=40                RETRIEVER_ROUTE_HEAD_MARGIN=0.01
RETRIEVER_ROUTE_MIN_CHUNKS=3            RETRIEVER_ROUTE_HEAD_WEIGHT=1.0
RETRIEVER_ROUTE_PROBE_TIMEOUT_MS=2000   RETRIEVER_ROUTE_FORBIDDEN_TAG_MAX=0.55
RETRIEVER_ROUTE_RETRY=1                 RETRIEVER_ROUTE_HEADS_SUPERSEDE=true
```

(okf-server and the retriever print the same ten lines.)

**The loader is live and reads per run.** Resolved inside the running
okf-server container, not in a test harness:

```
knobs:  {"ROUTE_ENABLED":true,"ROUTE_TOP_K":40,...,"ROUTE_HEADS_SUPERSEDE":true}
parity: {"production_equivalent":true,"reasons":[]}
```

**The routing-test response carries the knobs it was scored under** —
`fidelity.knobs` holds all ten, so a stored run can say which thresholds
produced it. Before the change the response carried no knobs at all.

**The run summary, as the deployed service computed it.** A suite of two
positives and two negatives (the negatives naming a sibling repository as
their intended owner) was run against the live corpus. The stored run doc
carries, verbatim from the service:

```
sibling_count            13      <- the FULL competitor universe, not the truncated list
avg_margin               -0.044  with avg_margin_n 2   <- the denominator travels with the mean
steals                   [{by_repo: "f5bedc82-…", by_name: "emulator-walk", count: 2}]
lost_no_winner           0
negative_wrongly_claimed 2
parity                   {"production_equivalent": true, "reasons": []}
knobs                    {…all ten…}
```

and the pair matrix:

```
confusion.n_queries 4   claim_accuracy 0   n_unresolved 0
rows:     [Bali (2), www-gov-uk-full-crawl (2)]      <- two resolved intended owners
columns:  [emulator-walk (4)]
cells:    intended=Bali              actual=emulator-walk  count 2  correct false
          intended=www-gov-uk-full-crawl actual=emulator-walk count 2 correct false
```

A second live run named the intended owner by an identifier the deployment
does not carry: the matrix kept the row, marked it **unresolved**, and kept it
OUT of the accuracy rate (`n_unresolved: 2`) instead of folding it into
another row — the unresolved path proven on the running service, not only in a
unit test.

Both live suites and their run docs were deleted afterwards; the deployment
holds no scratch state from this work.

**Not proven live:** the browser rendering of the matrix (the Suites &
analytics tab) was verified by the frontend suite and by the rebuild, not by
driving the UI — the matrix's DOM is covered by the component test, and the
deployed frontend serves it.

### The security baseline that Phase 2 inherits

A read-only baseline review of the **fan-out carrier trust boundary** (the
BFF → chatqna → retriever chain) was run BEFORE the change set, because
Phase 2 replaces the carrier's writer and the baseline says what a
carrier-substituting client inherits. It found six issues in the production
path — **none of them introduced by this change set, and none of them in a
file this change set touches**. They are recorded here and filed as a backlog
issue, because the phasing puts the carrier work in Phase 2 and the fix for
a carrier-trust finding belongs with the carrier work:

- **F1 (HIGH)** — chatqna reads `authorized_graph_names` / `sticky_graph_names`
  / `exclude_legacy` out of the REQUEST BODY (`genieai_chatqna.py:2638-2644`),
  so a caller with any valid bearer can name any graph; the BFF's 4-key
  whitelist (`query-service.js:626-634`) is the only thing that stops it, and
  it lives in a different service from the consumer that trusts the result.
- **F2 (HIGH)** — the retriever enforces NO authorization on the carrier: only
  a character-set check (`genieai_retriever_arangodb.py:327,1393-1394`), with
  the shared root Arango credential behind it (`config.py:71-72`), and its own
  `/v1/retrieval` endpoint carries no auth dependency.
- **F3 (MEDIUM)** — the sticky-graph lookup is scoped by `sessionId` alone
  (`query-service.js:834-853`), and `sessionId` is caller-supplied, so a
  caller can read another session's routed-repository set.
- **F4 (MEDIUM)** — `exclude_legacy` (the "OKF only" posture) rides the wire
  and is honoured as-is; the retriever has no deployment knob of its own.
- **F5 (MEDIUM)** — the carrier's LENGTH is unbounded (`FANOUT_MAX_GRAPHS`
  bounds concurrency, not the array), so a substituting caller can turn the
  retriever into a repository-existence oracle.
- **F6 (LOW)** — the BFF's `okf_only` sticky filter omits the legacy-graph
  exclusion its `hybrid` sibling enforces (`query-service.js:769` vs `:785`).
  Unreachable today; it stops being unreachable when a second writer exists.

**Consequence for the phasing:** Phase 2 (E-4 carrier substitution) MUST NOT
land until F1 and F2 have a fix — the Testing Lab must be able to say "I am
evaluating these graphs", and the retriever must be able to tell that from
"I am authorized to read them". That is Phase 2's entry criterion, not an
optional extra.
