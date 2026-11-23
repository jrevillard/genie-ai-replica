# #2061 — OKF Testing Lab: group-scoped evaluation (Phased epic)

**Status:** IN PROGRESS (2026-11-23) — Phases 1, 2 and 3 code complete and green; each phase lands as its own MR, verified on the local build before merge. Phase 4 next.
**Issue:** https://opensource.unicc.org/un/itu/genie-ai/-/issues/2061
**Branch:** `feat/okf-testing-lab-scoped-eval`, off `origin/main` (`56d87e763`).
**Worktree:** `.claude/worktrees/okf-lab-scoped-eval`.
**Delivery:** MRs to `main` only. Never push to a release branch.

The epic's own phasing (issue text §Phasing) is binding — each phase lands
and is verified before the next begins.

| Phase | Scope | Status |
|---|---|---|
| 1 | E-3 pair-level reporting + F7 steal accounting + F6 knob unification + the blank-principal fix | CODE COMPLETE — verification green |
| 2 | E-1 Evaluation Context object + E-2 carrier-faithful head testing + E-4 carrier substitution | CODE COMPLETE on `feat/okf-lab-eval-context` — E-1 + E-2 + E-4 (the serve carrier and the source attribution). E-4's remaining half (the suite-side binding and the generation pool) is E-7's, Phase 3 |
| 3 | E-7 context-native generation + suite binding | CODE COMPLETE on `feat/okf-lab-context-native` — the suite is minted FOR a context, the run is paired with it, and the boundary verdict is the evidence a scoped evaluation exists to produce. The Lab UI wave rides Phase 4 |
| 4 | E-4 attribution metrics + E-5 evidence-grade run records | pending |
| 5 | E-6 offline harness parity + the tenant-segment decision | pending |

## Operator decisions (2026-11-22)

1. **Blank-principal fix: in Phase 1**, at the actor shape (one additive
   line) + a regression test at the real boundary. The Lab's run records
   name the acting principal from Phase 1 onward.
2. **Superadmin gate (Phase 2): both populations** — the `tools-admin`
   realm role OR a wildcard `okf:*:*:admin` scope.
3. **Restricted scenario: after Phase 1 — DONE (2026-11-22).** The per-repo
   `acl.restricted` + group scope grants are built once Phase 1's evidence
   exists. The global scope mode stays `open`; only per-repo fencing is used.
   The group/user structure for the local build is authored from the existing
   repository inventory. Built and verified in the local build by
   `scripts/okf-testing-lab/lab-scoped-scenario.js` (MR !1039): two fenced
   repositories, two groups, four principals, and the union measured at
   12 / 13 / 13 / 14 traversable graphs.
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

**Consequence for the phasing — CORRECTED (2026-11-22).** This paragraph
first read "Phase 2 (E-4 carrier substitution) MUST NOT land until F1 and F2
have a fix". **That was wrong**, and it contradicted the epic's own EXPLICIT
NON-GOAL: the BFF-as-trusted-side / carrier-as-enforcement-contract model
stands, changing it is a SEPARATE security-model epic, and a scoped
evaluation is faithful without it — "the carrier array *is* the membership
emulation, consumed by the same routing code a citizen's query hits". E-4
substitutes the context carrier into the EXISTING
`context.authorized_graph_names` field, and the epic's own acceptance
criterion for it is "No modification to chatqna/retriever required for scoped
runs". The findings stay real, stay filed (**#2081**) and keep their
severities — on their own timeline, as their own epic. They do NOT gate
phase 2, and this artifact's earlier claim to the contrary is withdrawn.

**What the local build then proved (2026-11-22).** The mechanism the
Evaluation Context rides is the one that already exists: a group grant makes
the scope-shaped role a group member's realm role, the okf-server middleware
folds realm role names that are scope strings into the caller's effective
scopes (`components/okf-server/middleware/auth.js:43-51`), and the per-repo
gate reads those scopes
(`components/okf-server/services/access-control-service.js:50-58`). The
union of two group memberships is therefore two scope strings on one token —
which is the shape E-1's `principal_refs[]` has to resolve to. The
group-scoped fixture that proves it (`feat/okf-lab-scoped-scenario`, MR !1039)
measured 12 / 13 / 13 / 14 traversable graphs for the control, the two group
holders and the union, through the carrier's own read.

## Phase 2 — E-1 + E-2 + E-4 (2026-11-22, branch `feat/okf-lab-eval-context`)

**Status: code complete, verification green.** Stacked on the phase-1 branch;
okf-server **98 suites / 2487 tests green** (29 new).

### What landed

| Epic item | What it does | Where |
|---|---|---|
| **E-1** | The Evaluation Context: a named, versioned, snapshot-resolved authorization principal. Resolution goes through the ONE authority (`resolveGraphSet`) with the UNION of the groups' scope lists — byte-identical to the authority's answer for the same list, asserted by a test. The inputs are scopes and group references ONLY; there is no way to hand a context a graph list. The OPEN context (no scopes, no groups) resolves as the deployment's default posture, and in closed mode it is an EMPTY carrier WITH a loud warning. A refresh re-resolves, BUMPS the version and audits. | `services/evaluation-context-service.js`, `controllers/evaluation-context-controller.js`, `routes/okf-routes.js` (`/api/okf/eval-contexts`), `db/collections.js` |
| **E-2** | The carrier-scoped head test: a request may name a context; the Lab races the CONTEXT's repositories instead of the deployment's. The narrowing happens BEFORE the race (the prefetched sibling list IS the universe), it is a SUBSET, and without a carrier the query is byte-identical to what it always was. The verdict says which carrier it was measured over; the run record carries the carrier with its resolved set. | `services/head-test-service.js` (`loadSiblings`, `routingTest`), `services/head-suite-service.js` (`runSuite`), `controllers/repository-controller.js` |
| **E-4** | The scoped RAGAS serve: the served retrieval set is the carrier's, and the array rides the EXISTING `context.authorized_graph_names` field — chatqna and the retriever are UNCHANGED, so the served pipeline is the production one measured over the group the benchmark asks about. The per-source provenance chatqna already emits (`graph_name` / `repo_id` / `bundle_version`) is carried through instead of stopping at the text and the document id, which makes two new numbers possible: WHICH repository answered (the histogram) and how often an answer was grounded OUTSIDE the carrier (the wrong-source rate). "Not measured" is null throughout. | `services/ragas-suite-service.js` (`serveGraphNames`, `serveAnswer`, the row and the run roll-up), `controllers/repository-controller.js` |

### The gate that was withdrawn, and why it was wrong

The phase-1 artifact said phase 2 must not land until the carrier-trust
findings F1/F2 have a fix. **That was wrong** — it contradicted the epic's
own EXPLICIT NON-GOAL, which says the BFF-as-trusted-side /
carrier-as-enforcement-contract model stands, that changing it is a separate
security-model epic, and that a scoped evaluation is faithful without it
because the carrier array *is* the membership emulation. E-4's own
acceptance criterion is "no modification to chatqna/retriever required for
scoped runs" — and that is what shipped. The findings stay real and stay
filed (**#2081**), on their own timeline.

### What Phase 2 does NOT do

- **E-7 is Phase 3**: the context-native GENERATION (the prompt pool becomes
  the carrier's rivals, the rows carry `intended_carrier: in|out`, the suite
  binds a context snapshot, the cross-context pairing gate) is not here.
- **E-5 is Phase 4**: the evidence-grade run records (schema v2, the
  principal digest, the repo-set hash, the retention change, the read-time
  redaction) are not here. What phase 2 adds is the carrier ON the record —
  the first of the evidence fields.
- The supersede modelling (`ROUTE_HEADS_SUPERSEDE` in the verdict) is
  measured but not yet modelled: the retriever skips the chunk probe when a
  head claims (`genieai_retriever_arangodb.py:2644`), and the Lab still runs
  its probe leg. That is a real fidelity gap and it is the first thing
  phase 3 should close.

### The live build found a defect the unit suite could not (2026-11-22)

Phase 2 was deployed to the local build and driven against the RUNNING
service, and the first run answered **HTTP 500 on the context LIST**:
`no value specified for declared bind parameter '@collection'`.

The AQL placeholder `@@collection` is a COLLECTION-NAME bind parameter, and
ArangoDB reads its value under the key **`@collection`** — the sigil stays
in the key. The key `collection` leaves the placeholder empty and the engine
refuses the whole query. Three services in this repo already use the form the
engine wants (`pii-service` `'@meta'`, `graph-lifecycle-service` `'@edge'`,
`graph-retract-service` `'@collections'`); the new service was the only one
that did not.

**Every unit test was green because the mock never resolved a bind
parameter** — the wrong key could not fail. The mock now refuses a query
whose collection-name placeholder has no value, exactly as the engine refuses
it, and it really runs a BARE collection scan so a LIST endpoint's rows are
the ones it saved. A query with a FILTER is still not executed by the mock:
it has no AQL engine, and pretending to filter would hand a caller rows the
real database would never return.

The snapshot also now records the **EFFECTIVE** scopes it resolved from, not
only the input list. A context that names only groups has an empty INPUT
scope list, and storing that alone under-reported the principal the snapshot
was measured against — and the audit row counted zero scopes.

### Phase 2 — the live build (2026-11-22, deployed)

The local build carries phase 1 + phase 2 (`verify-local-build.sh`: 47 pass,
0 fail). Measured against the RUNNING service, through the API:

| Check | Result |
|---|---|
| A context naming ONE group | created (201); resolves to **13** repositories |
| A context naming the OTHER group | created (201); resolves to **13** repositories |
| A context naming BOTH groups | created (201); resolves to **14** repositories |
| The union | **exactly** the union of the two single-group contexts (14 = 13 + 13 − 12 shared) |
| The effective scopes | group A → `okf:t:<fence-a>:read`; group B → `okf:t:<fence-b>:read`; A+B → **both** |
| The repo-set hash | differs between two different carriers; 32 chars, stable across a refresh |
| The version | a new context is v1; a refresh answers 200 and **bumps to v2** |
| The LIST | **200** with the created context in it (was 500 — see above) |
| An unknown context | **404** — an honest refusal, not a crash |
| A non-superadmin | **403** on the list AND on the create |
| The carrier-scoped routing test | 200; the response carries the carrier: id, **version 2**, hash, **14 repositories** |

The probe contexts were removed from the local build's Arango afterwards (six
rows), so the fixture leaves nothing behind.

### The phase issues the triage demands (2026-11-22)

Jerome's triage note on the epic (2026-11-21) pins the dispatch scope to
**Phase 1 only**: "Phases 2-5 must be split into their own issues (or
re-scoped) before any of them is dispatched — this issue is the epic
tracker, not a single work order." Each phase therefore now carries its own
work issue, all related to the epic:

| Phase | Issue | Work | Status |
|---|---|---|---|
| 2 | **#2101** | E-1 + E-2 + E-4 | `status::in-progress` (MR !1043) |
| 3 | **#2102** | E-7 — context-native generation + suite binding | `status::in-progress` (branch `feat/okf-lab-context-native`) |
| 4 | **#2103** | E-5 — evidence-grade run records + the attribution metrics | `status::backlog` |
| 5 | **#2104** | E-6 + the tenant decision | `status::backlog` |


### The review round (2026-11-22) — what the reviews found and what changed

A `/security-review` and a `/code-review` (high) of the phase-2 diff found
real defects. Every finding is FIXED, each with a regression test proven RED
against the pre-fix code. okf-server: **2501 tests green** (16 new in the
branch).

**The carrier was a side-door around the superadmin-gated catalogue.** The
catalogue is gated because "a context names the repositories a PRINCIPAL
traverses" — but `carrierOf` was a second, UNGATED read of the same
document, and any caller of the run routes (repo-scoped-admin, with
read-scoped run records) could name any context id: a foreign, possibly
restricted, repository set was measured and persisted into a record that
caller could read. **FIXED:** the carrier is now filtered through the
CALLER's own authority, resolved the same way a live caller's is
(`resolveGraphSet` — mode + scope + acl, one rule); an empty intersection is
REFUSED (403 `CARRIER_NOT_TRAVERSABLE`); `carrierOf` is no longer exported,
so the carrier boundary is the only way in.

**An unreadable principal must not widen.** A group Keycloak could not answer
for resolved to an EMPTY scope list, which in the default OPEN mode resolves
to the WHOLE public corpus — so a context that could not measure the group
measured the deployment, silently, and the run was scored as if it had
measured the group. **FIXED:** such a principal is REFUSED (422
`PRINCIPAL_UNREADABLE`) at create AND at refresh, and the stored snapshot
stands when a refresh fails. A group that resolves but carries no scope says
so ON THE WIRE; a scope string that is not a scope is reported rather than
dropped in silence.

**An empty carrier is not the deployment.** An empty carrier used to drop the
universe filter — the head race widened to every repository in the deployment
while the record claimed a zero-repo universe — and the RAGAS serve fell
back to the suite's repositories while the record said the carrier was used.
**FIXED:** both now mean what they say (nothing); the serve refuses with
`EMPTY_CARRIER`.

**A principal reference must not reach a path.** The group id is now encoded
in the Keycloak admin-API path, and a reference that is neither a resolvable
name nor a uuid-shaped id never becomes a path segment at all.

**A stale carrier is refused (design-panel ruling).** The snapshot froze the
serving graph NAMES, and a re-publish renames the serving graph
(`OKF_alpha_v1` → `OKF_alpha_v2`), so a frozen name names a corpus that no
longer exists — and the retriever answers a missing graph with an empty
result. The failure is silent and TOTAL in the worst case: with 13 of 14
carrier repositories re-published, the run completes, is scored, and the
record lists 14 graph names while 13 corpora were measured. **FIXED:** the
carrier is refused (409 `EVAL_CONTEXT_STALE`) with the context, the version,
every stale repository, BOTH names and the remedy. The live name comes from
`servingRepos()` — the same derivation the snapshot was built from — and the
comparison is per REPOSITORY, never per name (a graph name is slug-derived,
so a freed name can be re-minted by another repository). A repository that no
longer serves at all is stale too. Serving the LIVE names instead was
considered and rejected: the context hash is over the (repo_id, graph_name)
pairs on purpose — "two evaluations are comparable only if they saw the same
set" — so following the content would make two runs with the SAME hash
measure DIFFERENT corpora.

**The record says which set it measured.** The carrier carries the context's
own hash (over its FULL frozen set — it identifies the version) AND the
measured set's own hash (over the repositories the run actually raced, after
the narrowing). After a narrowing those are different populations; all three
record writers carry the same shape.

**One pre-existing defect the new mock exposed.** The graph teardown's orphan
sweep had TWO independent reasons never to run: its AQL took its bind
variable from the second argument of an `aql` template — which the engine
never reads, so ArangoDB refused the query ("no value specified for declared
bind parameter '@collections'") and the error was swallowed — and `slugFor`
was destructured from a module that does not export it, so the slug was
always empty. **FIXED:** the sweep lists the GRAPHS through the driver's own
listing (the same route the teardown drops through) and finds the draft
graphs a mid-drain retract leaves behind.

### The license-compliance gate (2026-11-22) — a comparison artifact, not a new dependency

The MR's "License Compliance" panel reported **17 licenses and policy
violations for the source branch only**. Measured, not assumed:

- The source pipeline's dependency set and main's are **IDENTICAL** — 2018
  components on both sides, zero difference (the SBOMs of the gemnasium
  job, compared component by component). Neither phase 1 nor phase 2
  touched a single manifest or lockfile, so the branch introduces NO new
  dependency and NO new license.
- The project's own documented rule explains the rest
  (`docs/security/cve-triage-2026q3.md:819-835`, measured 2026-11-16): the
  two MR approval policies (`scan_finding` `new_needs_triage`,
  `license_finding` `newly_detected`, each `role_approvers: [maintainer]`)
  compare against the **TARGET branch's latest pipeline** — and when the
  target side is empty, EVERY source finding counts as newly introduced.
- The target of !1043 was the phase-1 branch, which has **no pipeline of
  its own** (the workflow rule suppresses branch pipelines for a branch with
  an open MR) → the target side was empty → all 17 licenses counted as new.
- !1037 merged into `main` (2026-11-22 17:27), GitLab auto-retargeted
  !1043 to `main`, and main's pipeline 19098 (green, carrying the SBOM)
  gives the comparison a real target side. The branch was rebased onto
  main, so the MR diff is phase 2 only.

**What David may still have to do:** if GitLab still asks for a maintainer
approval on the license policy, it is Jérôme's to give — the MR author
cannot approve their own MR (author-approval-prevention), which is the
second half of the same documented rule.

## Phase 3 — E-7: context-native generation + suite binding (2026-11-23, branch `feat/okf-lab-context-native`)

**Status: code complete, verification green.** okf-server **2558 tests green** (56 new in
the branch). The task-by-task table and the full review rounds live in the phase-3 artifact
(`issue-2102-testing-lab-context-native-generation.md`); this is the epic-level summary.
The component's coverage is measured against `origin/main` in an isolated worktree, the
same way: statements **88.32%** (base 88.12%), branches **75.65%** (base 75.49%),
functions **89.25%** (base 89.02%) — every figure above the base.

### What landed

| Epic item | What it does | Where |
|---|---|---|
| **E-7** | The suite is MINTED FOR a context: the confusable rivals are the carrier's repositories, the abstention probes come from the EXCLUDED set, and every row carries `intended_carrier` (`in`/`out`) as PROVENANCE — which pool the row was minted from, never a subject label. The RAGAS pool is the carrier's (the caller's list REPLACES it, never widens it) and every question carries the repository it was minted from ("not measured" is null). A suite and a run are now **paired**: a bound suite may only be measured over the context it was minted for; a pool that no longer holds is refused; a row whose rival or source repository left the carrier is skipped WITH A REASON (never silently dropped); a carrier that grew is flagged. Comparability rests on TWO hashes — the serving set's and the head vectors' — never the context version alone, because the serving set refreshes on a timer and a re-built head moves the measurement without moving the graph. The new **boundary verdict** (`held` / `breached`) is the evidence a scoped evaluation exists to produce: did the group's scope hold? Suites minted before contexts existed are diagnostic, and a superadmin may bind one EXPLICITLY to the OPEN context — never automatically. And the Lab's chunk probe now **mirrors the retriever**: a claimed head skips the probe and the claimed graphs ARE the selection (`ROUTE_HEADS_SUPERSEDE`) — closing E-2's outstanding acceptance box, so the Lab stops measuring a leg production never runs. | `services/evaluation-pairing-service.js` (new), `services/evaluation-context-service.js`, `services/head-suite-service.js`, `services/ragas-suite-service.js`, `services/head-test-service.js`, `controllers/repository-controller.js`, `routes/repos-routes.js` |

### What phase 3 does NOT do

- **The Lab UI wave is phase 4** (E-5): the context picker, the binding badge and the
  boundary readout ride the scoped viewer. Phase 3's API exposes everything that wave needs;
  the phase's visible delta is the live build.
- **The site page rides phase 4 too** — it documents the DIALOG, and the dialog has no
  context picker yet. The operator-facing document for this phase is the CHANGELOG entry.
  Phase 2 set the precedent: it shipped the whole Evaluation Context API with no site-doc
  change, for the same reason.
- **E-5 (the evidence-grade run records) and E-6 (the offline harness parity) are phases 4
  and 5.**

### The review rounds (2026-11-23)

A `/security-review` and a `/code-review` (high) of the phase-3 diff, run TWICE — the
second time over the first round's fixes. Every finding is accounted for — none is deferred
or silently dropped.

- **The superadmin rebind was unreachable.** The gate read `resolved.open_context`, a flag
  no writer ever persisted, so every bind was refused with `409 REBIND_NOT_OPEN_CONTEXT` and
  the `eval_context.suite_bind` audit row was structurally unreachable. The gate had been
  tested against a document shape production can never produce, which is why the whole suite
  was green over a dead feature. **FIXED:** openness is derived from the PERSISTED INPUTS
  (the effective scope list and the group references), and the snapshot records the flag.
  RED proof: 4 failures before the fix, green after.
- **The 409 named repositories the caller may not traverse — FALSE POSITIVE, justified in
  writing.** The ids it names are a strict subset of the suite's OWN stored snapshot
  (`payload.context.repos`), which the same principal can already read — the suite is
  read-scoped on the very repository the run route is admin-scoped on — and the suite payload
  carried every competitor's NAME (`sibling_names`) before this phase. No new disclosure.
- **The staleness refusal named repositories outside the caller's reach — FIXED** (it was
  below the reporting threshold, and it was fixed anyway). The `EVAL_CONTEXT_STALE` refusal
  now WITHHOLDS the names of repositories the caller may not traverse and reports the count;
  the check itself still runs over the context's full frozen set, because narrowing first
  would hide a stale repository from the gate.

The second round (F5–F12 in the phase-3 artifact) found eight more, all FIXED or justified:

- **The RAGAS completeness sweep re-answered a SKIPPED question** — the sweep retries every
  row carrying an `error`, and a skipped row carries one, so the run doc claimed a row was
  skipped while showing it answered and judged, over a corpus it was never minted against.
  The skip now has its own code and the sweep excludes it.
- **A skipped question was counted as an ERROR, and the progress denominator EXCLUDED the
  skipped rows** — so the summary said the benchmark broke when a question had merely not
  been measurable, and the progress bar could pass 100%. The buckets now partition the
  in-scope rows exactly (`n_skipped` is its own bucket) and the denominator covers every
  question in the run's scope.
- **A grown carrier was stamped comparable** — `comparable` was computed from the two
  hashes alone, and the unit test that claimed to cover the tier passed for the wrong reason
  (its fixture used drifting hash keys). The tier now stands on its own and the fixture
  uses MATCHING keys. RED proof: with the fix neutralised the test fails
  `expect(out.comparable).toBe(false)`; restored, the phase-3 suites are 53/53 green.
- **A refused pairing answered the operator a moment too late** — `beginRunSuite` had
  already created the run doc and started the worker before the gate refused it. ONE helper
  now answers the CALLER synchronously (a 409) before a run doc exists, and the gate is
  asked again inside the run so the record and the gate cannot drift apart. The head suite
  and the RAGAS suite share the shape.
- **The head-suite summary did not say how many rows were skipped**, and **a re-scored
  RAGAS run carried neither the pairing nor the carrier** — a re-score measures exactly what
  the source measured, so the source's `pairing` and `carrier` travel with it.
- **The out-set formula in the artifact named the wrong set** — the code always implemented
  the intended semantics (`caller_traversable − context.resolved.repos`); only the formula
  was wrong. Corrected in the artifact; the code is unchanged.

A third round found the one that mattered, and it changed a DESIGN, so the party
panel ruled on it and David decided the one policy number in it:

- **The skip tier was unreachable for the case it exists for.** `pair()` refused the
  whole run when a pool repository left the carrier — and a row's dependency IS a pool
  member by construction — so the row-level skip the module's own header promised
  could never fire. **FIXED** per the panel's rule set and David's ruling (50% floor):
  only the repository UNDER TEST being absent refuses a run; a pool that shrank skips
  the rows that depend on what left, counts them, and stamps the run not comparable
  with the share of the corpus it covered; past half the pool gone the run is refused
  as a different experiment. A grown carrier and a shrunken one are now the same
  tier.
- **The context binds the GENERATION too (David).** An invalid suite or benchmark is
  no longer generated: the prompt states the closed set, and a row citing anything
  outside it — a competitor outside the carrier, a probe naming a repository the
  scope does not exclude, a benchmark question whose ground truth is not in the
  evaluated corpus — is discarded at mint time.
- **The accounting caught up.** A not-attempted row is not a failed row (the failed
  envelope says NOTHING MEASURED when every row was skipped), the boundary block
  reports the population (a boundary row that was not measured is a scope question
  left unanswered), and the summary carries `n_total` beside `n_queries`.
- **The security review found no HIGH or MEDIUM finding** introduced by the diff;
  its four candidates were refuted with file:line evidence, and its two carry-overs
  (a pre-existing read-level wildcard that bypasses the per-repo fence, and the
  phase-4 UI gap where a scope breach is not yet on the summary bar) are recorded in
  the phase-3 artifact rather than smuggled into this MR.
- **The decisions are documented where both audiences read them**: the phase-3
  artifact carries the panel's verdicts, David's ruling, every finding and the
  live-build evidence; `.claude/rules/TESTING-LAB-SCOPING.md` is the agent-facing rule
  for the model (the tiers, the generation rules, and the traps).
