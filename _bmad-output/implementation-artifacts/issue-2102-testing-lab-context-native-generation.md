# #2102 — Phase 3: context-native generation + suite binding (E-7)

**Epic:** [#2061](https://opensource.unicc.org/un/itu/genie-ai/-/issues/2061) — OKF Testing Lab:
group-scoped evaluation. **Branch:** `feat/okf-lab-context-native` (from `main` @ `8565481e0`).

**Goal:** a suite is MINTED for a context, and a run answers "did that context's scope hold?" —
not "did the deployment route well?".

---

## The design (party panel + David's rulings, 2026-11-23)

The panel was Winston (architect), Mary (analyst), Amelia (dev), John (PM). Three decisions were
put to David; all three took the recommended answer.

### The carrier at generation time is the CALLER'S, not the context's

The context's frozen set is what the context RESOLVED; the **carrier** is what this caller MAY
measure — `carrierFor(contextId, caller)`, already shipped in phase 2, which also runs the
staleness gate. Generation joins the CARRIER, not the context document. Otherwise the generator
names repositories the caller cannot read and the suite becomes a covert exfiltration channel.

### The `out` set is the CONTEXT's intent, filtered by the caller's authority

`out_set = caller_traversable − context.resolved.repos`

— what the caller MAY read that the context does NOT name. (Corrected 2026-11-23: the
formula first written here was `(context.resolved.repos − carrier.repos) ∩ caller_traversable`,
which names the wrong set — the repositories the caller may NOT traverse, a set that is
EMPTY by construction, because the carrier is the frozen set narrowed to the caller. The
code always implemented the intended semantics; only this formula was wrong. See F12.)

- For a **superadmin** (the Lab's population): everything the group cannot see — the meaningful set.
- For a **repo-scoped admin**: ∅ — they may not know the excluded repositories exist, and the
  abstention probes must not leak them.

### `intended_carrier` is PROVENANCE, not a subject label

One rule, no per-class table: a row minted from the **carrier's** pool is `'in'`; a row minted from
the **excluded** pool is `'out'`. Positives, near-misses, forbidden-derived rows, off-domain rows and
meta rows are all minted from the under-test repository — which the carrier must contain — so they
are `'in'`. Confusables cite carrier rivals → `'in'`. The abstention probes cite excluded rivals →
`'out'`.

### The `out` rows are BOUNDARY probes, and they buy a new number

An `out` row asserts: **the under-test repository must NOT claim this query.** Its expected answer
is "nobody" — it is not a confusable (which cites a competitor as the answer). The run therefore
counts **`boundary_held`** and **`boundary_breached`** — the new evidence phase 2 did not have: did
the group's scope hold?

### The comparison keys are TWO hashes, never the context version

The serving set refreshes on the 30s TTL, so the context version alone says nothing about
comparability. The keys are:

- `repo_set_hash` — over `(repo_id, graph_name)` pairs (the serving set);
- `head_version_hash` — over `(repo_id, head_version)` pairs (the head leg races the head VECTOR,
  so comparability depends on the head version, which the graph name does not carry).

A comparison requires BOTH to match, plus the knob snapshot (E-5, phase 4).

### The drift tiers, at run time

The suite is bound to a context snapshot; the run happens under a carrier. The two may have drifted:

| tier | condition | behaviour |
|---|---|---|
| **block** | the **under-test repository** is not in the run's carrier | the run is REFUSED (409) — the subject of the measurement is absent, so there is no measurement |
| **block** | **more than half the suite's pool** is gone from the carrier (`pool_evaporated`) | the run is REFUSED (409) — past the floor it is a DIFFERENT experiment, not the same one with holes |
| **skip-with-reason** | a row's rival/source repository left the carrier | that ROW is skipped, counted in the coverage, never silent |
| **flag-only** | the carrier GREW (it has repositories the suite never saw) **or SHRANK** (the suite's pool no longer holds) | the run proceeds, flagged `comparable: false`: the corpus was not the one the suite was minted for |

**This table was CORRECTED on 2026-11-23** (the party panel's ruling, below). It
first read "block: the under-test repository, **or the suite's pool**, is not in the
run's carrier" — and the code implemented exactly that. The two rules then
CONTRADICTED each other for the same event: a row's dependency IS a pool member by
construction (a confusable's rival is minted from the carrier's repositories; a
benchmark question's source repository is the corpus it was minted from), so the
pool check fired FIRST and the **skip tier was dead code for its stated purpose**.
The code was resolving the contradiction silently, and in the direction that threw
the whole measurement away.

The corrected rule set, in one sentence — the operator-facing form:

> **A question is measured only if the repository it depends on is in the context. A
> question whose repository is missing is not measured — it is counted as *not
> measured*, with the reason. If the repository under test itself is missing, the run
> is refused.**

Cross-context execution is **blocked by default**. A superadmin lifts it with a run-request flag
(`allow_cross_context` + a reason): the run writes an audit record, stamps itself
`comparable: false`, and the UI renders it as a recorded experiment. **No new collection.**

### The party panel's ruling (2026-11-23) — and David's decision

The review round found the dead skip tier (finding F13). The fix is a DESIGN
change, so the panel was convened (Winston architect, Mary analyst, Amelia dev,
John PM) and one policy number was put to David.

**What the panel settled** (its four verdicts, condensed):

- **Winston (architect)** — "the code contradicts the design, and the design's block
  row is the half that is wrong." The tier boundary belongs between the **subject**
  of the measurement and the **context** of the measurement: without the
  under-test there is no measurement (BLOCK); a shrunken pool means the run
  measures a smaller world than the suite assumed — the same epistemic class as a
  grown carrier, which the code already refuses to block on. "Blocking on shrink
  while flagging on grow is incoherent." The pool check stops being a block; the
  skip tier moves BEFORE the pool decision; a floor replaces the blanket block.
- **Mary (analyst)** — today the operator gets a 409 and **no number at all**, and
  the loss is invisible in the run history (no run doc is written, because the gate
  asks before the doc exists). Under the corrected rule the operator gets "your run
  scored 88 of 100 questions; 12 were not measured because repository X is not in
  this context's corpus; the number is not comparable with your previous runs" — one
  sentence, one number, one named cause. A refusal is not in the history; a
  non-comparable run that exists is.
- **Amelia (dev)** — the change is one service restructure, one summary
  denominator, one envelope exclusion, one test rewrite, one doc row. The test
  that encoded the old behaviour (titled "a row's dependency that left the carrier
  is SKIPPED with a reason" while asserting `blocked`) is **rewritten, not deleted**.
- **John (PM)** — the cheapest honest rule to explain to a curator is the one
  sentence above; it has exactly one special case (the subject), which is why it
  survives contact with the operator.

**The one question that needed David — the evaporation floor.** Below the floor, the
run is the same corpus with holes (scored, coverage says so, marked not
comparable); above it, the operator is reading a different experiment and needs to
be told, not scored. **David's answer (2026-11-23): 50% — refuse above half
gone.** The panel's recommendation, taken as offered.

### The generation is inside the context too (David, 2026-11-23)

> "the prompts used for building the test suites MUST ensure that invalid suites and
> RAGAS benchmarks are NOT generated in the first place" … "the evaluation context
> must also apply to generations"

The context's scope is not only a RUN-time fence: it bounds what may be MINTED.
An invalid row is never generated — it is discarded at mint time, and the
generation loop asks again for the shortfall (the same rule the prompt already
states for duplicated queries).

| leg | the invalid row | what happens to it |
|---|---|---|
| head suite | a confusable naming a repository OUTSIDE the carrier | DISCARDED at mint time; the loop asks again |
| head suite | an abstention probe naming a repository the scope does NOT exclude | DISCARDED at mint time |
| RAGAS | a question whose ground truth cannot be attributed to a context repository | DISCARDED at mint time; `NO_ATTRIBUTABLE_QUESTIONS` if that empties the suite |

The prompt states the closed set and the consequence ("a name you invent … is
DISCARDED"), so the model is told the rule it is being held to. The corpus is
already the carrier's, so the RAGAS leg's context reaches the generator through
the documents it is given.

### Migration

A suite minted before this phase has no binding. It is **unbound-diagnostic**: it still runs, but
its results are labelled non-comparable so they cannot be silently mixed into a comparison. A
superadmin may **explicitly rebind** it to the OPEN context (the honest binding for a suite minted
against the whole deployment). It is **never auto-bound**.

### The supersede gap closes in this phase (David's ruling)

The retriever skips the chunk probe when a head claims
(`genieai_retriever_arangodb.py:2644`); the Lab still ran its probe leg. Under
`ROUTE_HEADS_SUPERSEDE=true` the Lab's LEG B must now skip the probe too and record that it did.
This is E-2's outstanding acceptance box ("Supersede fields present on rows"), and it lives in the
same run leg as the pairing gate, so it ships here.

### Scope note

Phase 3 is **backend**. The Lab UI wave (the context picker, the binding badge, the boundary
readout) rides **phase 4**, because E-5's acceptance box — "read-time redaction verified with a
**scoped viewer**" — is where the viewer is built. The API exposes everything that wave needs.
**Phase 3's visible delta is the LIVE BUILD**: a scoped suite minted against the two-fence
fixture, run against the running service, showing the boundary metric.

---

## Global constraints

- **Scrub constraint (standing, every artifact):** no deployment-name mentions and no
  religious-affiliation terms or worked examples — in docs, MR descriptions, commit messages
  and code strings.
- **No `Co-Authored-By` and no Claude/Anthropic mention in commit messages** (grep before every
  commit, and after every push).
- **Coverage must never decrease** (jest `--coverage`, compared with the baseline on `main`).
- **The CHANGELOG is updated** in the same MR.
- **Deploy to the local build BEFORE merge** — via `C:/Dev/builds/tooling/sync-local-build.sh` only.
- **Every vulnerability finding ends as FIXED / FALSE-POSITIVE / RISK-ACCEPTED** — never silently
  ignored.
- **New dependencies must be permissive-OSS.** Phase 3 adds none.
- **MRs to `main` only**; the merge train owns the landing.
- BMAD artifacts and GitLab artifacts stay in sync.

## Review focus

1. **A generation request naming a context the caller may not read.** The refusal must be a
   refusal — not a silent narrowing to something that looks like the context.
2. **The `out` rows' expected answer.** They assert an ABSTENTION; a verdict that treats "no head
   won" as a pass would make every boundary row trivially pass.
3. **The pairing gate's drift tiers.** A grown carrier must not be silently absorbed, and a
   shrunken one must not silently skip.
4. **The `head_version_hash`.** It must read the HEAD version (the vector the head leg races), not
   the serving graph version — the two differ exactly when a repo is re-published.
5. **The supersede modelling.** The Lab must skip the probe exactly when the retriever does, and
   say that it did.

---

## Tasks

### T1 — The binding primitive (`services/evaluation-context-service.js`)

**Files:** modify `services/evaluation-context-service.js`; test
`__tests__/evaluation-context-service.test.js`.

**Produces:**
- `headVersionHash(repos)` → sha256 (32 hex chars) over the sorted `repo_id:head_version` pairs.
  A repo with no head contributes `repo_id:` — a missing head is a fact, not an absence.
- `bindingFor(contextId, caller)` →
  `{ context: {id, version, hash}, carrier, out_set, repos, repo_set_hash, head_version_hash }`
  where `out_set` is `caller_traversable − context.resolved.repos` — what the caller may
  read that the context does NOT name (the excluded set the abstention probes are minted
  from).

**Consumes:** `carrierFor` (phase 2), `resolveGraphSet` (the caller's authority).

**Steps:**
1. Test `headVersionHash` — same pairs in a different order → the same hash; a changed head
   version → a different hash.
2. Test `bindingFor` — the out-set is the context's exclusion ∩ the caller's authority; a
   repo-scoped admin gets an empty out-set.
3. Implement.
4. Run the suite.

### T2 — The head suite is minted for a carrier (`services/head-suite-service.js`)

**Files:** modify `services/head-suite-service.js` (+ the controller that calls it); test
`__tests__/head-suite-service.test.js`.

**Behaviour:**
- `generateSuite(repoId, payload, opts)` accepts `opts.binding`. Without one, the behaviour is
  byte-identical to today (the migration path).
- With a binding: the under-test repository must be in the carrier, else
  `409 UNDER_TEST_OUT_OF_CARRIER` naming the carrier's repositories.
- The sibling context (the rivals the confusables cite) is the CARRIER's repositories, not every
  repository with a head.
- The abstention rows are minted from the out-set: a new negative class `cls: 'abstention'`,
  `expected_repo: null`, `intended_carrier: 'out'`, carrying the excluded rival's name as the
  reason.
- Every row carries `intended_carrier` (`'in'` or `'out'`).
- The suite doc stores `payload.context = {id, version, hash, repos, repo_set_hash,
  head_version_hash}` — the SNAPSHOT, never a reference alone.

**Steps:** RED (the refusal, the narrowed siblings, the out-rows, the stamps, the stored binding)
→ GREEN → the suite.

### T3 — The RAGAS suite is minted for a carrier (`services/ragas-suite-service.js`)

**Files:** modify `services/ragas-suite-service.js`; test `__tests__/ragas-suite-service.test.js`.

**Behaviour:**
- The pool is the CARRIER's repositories — `payload.repo_ids` is REPLACED by the carrier, not
  merged with it (a caller may not widen the pool beyond what the context names).
- Each question carries its source repository, recovered from the corpus document it was minted
  from (the corpus docs already carry `metadata.repo_id`).
- The suite doc stores the same binding shape as the head suite.

### T4 — The pairing gate + the boundary metric (`services/head-suite-service.js`)

**Files:** modify `services/head-suite-service.js`; test `__tests__/head-suite-service.test.js`.

**Behaviour:**
- At run time the suite's bound context is compared with the run's carrier → the three drift
  tiers.
- A bound suite run under a different context is REFUSED, unless a superadmin passes
  `allow_cross_context` + a reason: the run writes an audit record and stamps
  `comparable: false` + `experiment: {actor, reason, at}`.
- The run record carries the comparison keys (`repo_set_hash`, `head_version_hash`) and
  `comparable`.
- The summary carries `boundary: {held, breached}`.

### T5 — The supersede modelling (`services/head-test-service.js`)

**Files:** modify `services/head-test-service.js`; test `__tests__/head-test-service.test.js`.

**Behaviour:** under `ROUTE_HEADS_SUPERSEDE=true`, when the head leg produced a claim, LEG B does
NOT probe — the selected set is the claimed graphs, and the row says
`supersede: {applied: true, claimed: [...], probe_skipped: true}`. Under the knob off, the probe
leg runs exactly as today.

### T6 — The migration (unbound suites + the rebind endpoint)

**Files:** modify `services/head-suite-service.js` + the controller/routes; tests.

**Behaviour:** an unbound suite runs and its record is labelled `binding: {status: 'unbound'}` and
`comparable: false`. A superadmin-only endpoint rebinds a suite to a named context (the OPEN
context is the permitted rebind target) and audits it.

### T7 — The wiring, the CHANGELOG, the docs, the artifacts

- The generation and run routes accept `context_id` (and `allow_cross_context` + `reason`).
- `CHANGELOG.md` — the operator-facing capability.
- `site/content/en/docs/knowledge-base/testing-lab.md` — the documented behaviour.
- The epic artifact (`issue-2061-testing-lab-scoped-evaluation.md`) — the phase-3 delivery record.
- This artifact — the checkboxes ticked as they land.

---

## Delivery record (2026-11-23)

**Status: CODE COMPLETE, verification green.** okf-server **2558 tests green** (56 new in
the branch: 11 pairing + 6 head-suite generation + 9 head-suite run + 4 bind + 4 RAGAS
generation + 4 RAGAS run + 4 evaluation-context + 3 head-test supersede + 7 controller
powers + 4 more).

**The gates, measured on the branch.** okf-server `eslint .` → no issues; the component's
own `prettier --check "**/*.js"` → clean; the full suite → 2558 green, 0 failed. The
coverage bar is measured against `origin/main` in an isolated worktree, the same way:

| | statements | branches | functions |
|---|---|---|---|
| `origin/main` (base) | 88.12% | 75.49% | 89.02% |
| this branch | **88.32%** | **75.65%** | **89.25%** |

Every figure is ABOVE the base — no decrease. The first measurement did not clear the bar
(statements 88.08% against the base's 88.12%): the phase-3 controller code was the
cause, and the two NEW superadmin powers it introduced — binding a suite to a context,
and lifting the cross-context block — had NO test at all. Seven tests now drive them at
the controller surface (a scoped admin is refused with `FORBIDDEN_SCOPE` and nothing is
bound; an unexplained experiment is a 400; a superadmin's bind is audited; a run without
the flag carries no experiment), which is both the coverage fix and the security
contract those two powers needed.

| Task | What landed | Where |
|---|---|---|
| T1 | The binding primitive: `headVersionHash`, `headVersionsFor`, `narrowCarrier`, `carrierFor`, `bindingFor` | `services/evaluation-context-service.js` |
| T2 | The head suite minted for a carrier: the rivals are the carrier's, the abstention probes come from the excluded set, `intended_carrier` on every row, the snapshot stored | `services/head-suite-service.js` |
| T3 | The RAGAS suite minted for a carrier: the pool REPLACED (never widened), the source stamps per question | `services/ragas-suite-service.js` |
| T4 | The pairing gate + the boundary metric | `services/evaluation-pairing-service.js` (new), `services/head-suite-service.js` |
| T5 | The supersede modelling: the Lab's probe leg mirrors the retriever's | `services/head-test-service.js` |
| T6 | The migration: unbound suites are diagnostic, the explicit superadmin rebind | `services/head-suite-service.js`, `controllers/repository-controller.js`, `routes/repos-routes.js` |
| T7 | The wiring, the CHANGELOG, the artifacts | `controllers/repository-controller.js`, `CHANGELOG.md`, this artifact, the epic artifact |

### The review round (2026-11-23) — every finding, and where it ended

A `/security-review` of the full diff and a `/code-review` (high) of the full diff were run
against the branch. Every finding ends as FIXED, FALSE-POSITIVE (justified in writing) or
RISK-ACCEPTED — none is deferred or silently dropped.

**F1 — "the 409 names the repositories the caller may not traverse" (HIGH, reported) —
FALSE POSITIVE (justified), no code change.** The `missing_pool` list in the refusal
(`head-suite-service.js:1891`, `ragas-suite-service.js:2336`) is computed as
`suiteContext.repos − carrierIds` (`evaluation-pairing-service.js:147-148`), so every id it
names is already in the suite's OWN stored snapshot `payload.context.repos`
(`head-suite-service.js:834`, `ragas-suite-service.js:1452`) — and the suite document is
read-scoped on the SAME repository the run route is admin-scoped on (`repos-routes.js:133`
read vs `:135` admin). A caller who can trigger the refusal can already read every id the
refusal names. Before this phase the same document already carried `sibling_names` — the
NAME of every repository with a head — so the identity of the competitors was never private
to the suite's readers. The finding adds no new disclosure.

**F2 — "the superadmin rebind is unreachable: `resolved.open_context` is never persisted"
(HIGH, reported) — FIXED.** `bindSuite` gated the rebind on
`contextDoc.resolved.open_context === true` (`head-suite-service.js:906`), but
`createContext` (`evaluation-context-service.js:358-369`) and `refreshContext` (`:453-467`)
never wrote that field into the persisted `resolved` block — so the flag was always
`undefined`, every bind was refused (`409 REBIND_NOT_OPEN_CONTEXT`), and the
`eval_context.suite_bind` audit row was structurally unreachable. The unit test mocked a
document shape production can never produce, which is why the whole suite was green over a
dead feature. **FIXED:** the gate now derives openness from the PERSISTED INPUTS — the
effective scope list and the group references, the two fields the resolution itself is
derived from — so it is satisfied by every context that was ever created, and the snapshot
additionally records `open_context`, so the stored document says what it resolved. RED
proof: with the REAL persisted shape the rebind test failed with "not the OPEN context"
(4 failures) before the fix and passes after; a new test asserts the persisted flag on
create AND on refresh.

**F3 — "the staleness refusal names a repository the caller may not traverse" (MEDIUM,
below the reporting threshold, fixed anyway) — FIXED.** The `EVAL_CONTEXT_STALE` refusal
enumerated the stale repositories over the context's FULL frozen set — before the caller's
authority was applied — so a repo-scoped admin naming a context with a stale restricted
repository learned that repository's NAME and the live graph name it now serves. The check
must still see the full frozen set (narrowing first would hide a stale repository from the
gate and let a run measure a set the context's hash does not describe), so the CALLER'S
AUTHORITY is now resolved first and the refusal WITHHOLDS what is outside the caller's
reach, reporting the count instead. A caller who may traverse the repository is told
exactly what is stale, as before. RED proof: the new test failed with the restricted
repository's name in the message before the fix.

**F4 — "the excluded repositories' names reach the suite's readers" (LOW, considered) —
FALSE POSITIVE (justified).** The abstention probes' free-text reason can name an excluded
repository. That is the class the suite payload already had: `sibling_names` carried every
repository-with-a-head's NAME before this phase, and the excluded set is by construction
inside the minting caller's own authority (`bindingFor` filters it through
`resolveGraphSet`'s ACL-filtered rows). A probe that would leak a repository the CALLER
cannot read is therefore not minted at all — the rule the phase-3 design states and the
code enforces.

### The second review round (2026-11-23) — the findings the first round's fixes exposed

The first round's fixes were themselves reviewed, and the round after that was read against
the code as it stood. Every finding ends as FIXED or FALSE POSITIVE — none is deferred.
F5–F7 were found by me while preparing the live proof and confirmed by the review; F8–F11
came out of the review.

**F5 — "the completeness sweep re-answered a SKIPPED question" (HIGH) — FIXED.** The RAGAS
completeness sweep (`ragas-suite-service.js`) retries every row that carries an `error`, so
that a transient judge failure does not silently shrink a benchmark. A SKIPPED row also
carries an `error` — so the sweep re-asked it: the run doc then claimed a row was SKIPPED
while showing it answered and judged (`answer_calls: 2`, `coverage 2/2`), and the question
was answered over a corpus it was never minted against — the one thing the pairing exists
to prevent. **FIXED:** the skip carries its own code (`SKIPPED_DEPENDENCY_NOT_IN_CARRIER`)
and the sweep excludes it. RED proof: the new test asserts one answer for two questions
and the debug dump showed two before the fix.

**F6 — "a skipped question was counted as an ERROR" (MEDIUM) — FIXED.** "Not measured" was
folded into the error bucket, so the summary said the benchmark BROKE when the truth was
that one question could not be scored over this corpus. The five buckets now partition the
in-scope rows exactly (skipped / error / abstained / failed / answered), and the summary
carries `n_skipped`.

**F7 — "the progress denominator excluded the skipped rows" (MEDIUM) — FIXED.** The
retrieval phase's denominator was the RUNNABLE rows while the counter counted every row —
so a run with a skipped row could push the progress bar past 100%. The denominator is now
EVERY question in the run's scope.

**F8 — "a grown carrier was stamped comparable" (MEDIUM) — FIXED.** `comparable` was
computed from the two HASHES alone, so a run whose carrier had GREW past the suite's pool
was still stamped comparable whenever the hashes happened to match — and the unit test
that claimed to cover the tier passed for the WRONG reason: its fixture used DRIFTING
hash keys, so the hash comparison, not the grown carrier, was what made the run
non-comparable. **FIXED:** the tier stands on its own (`let comparable = carrierGrew.length
=== 0;`) — a suite that scored a SMALLER world than the one measured is not a comparable
measurement, whatever the hashes say — and the fixture now uses MATCHING keys, so the
assertion exercises the tier it names. RED proof: with the fix neutralised the test fails
`expect(out.comparable).toBe(false)` (Expected: false, Received: true); restored, the
four phase-3 suites are 53/53 green.

**F9 — "a refused pairing answered the operator a moment too late" (MEDIUM) — FIXED.** The
pairing gate lived inside `runSuite`, but `beginRunSuite` had already created the run doc
and started the worker — so a cross-context run answered 202 plus an animation and then
failed a moment later with the reason in a document the operator has to go looking for.
**FIXED:** ONE helper (`pairingFor` / `pairingRefusal`) is asked in BOTH places:
`beginRunSuite` asks it BEFORE the inflight lock and before a run doc exists (a
synchronous 409 — `CROSS_CONTEXT_BLOCKED` or `PAIRING_BLOCKED`), and `runSuite` asks it
again while the run executes, so the record and the gate cannot drift apart. The refusal
is built in ONE place, so both callers say the same thing. Applied to the head suite and
the RAGAS suite alike.

**F10 — "the head-suite summary did not say how many rows were skipped" (LOW) — FIXED.**
F6 taught the RAGAS summary the `n_skipped` bucket; the head-suite summary did not learn
it, so a reader of the summary alone could not tell a two-row suite from a three-row
suite that lost one. The summary now carries `n_skipped`, and the pairing block names each
skipped row and why.

**F11 — "a re-scored RAGAS run carried neither the pairing nor the carrier" (MEDIUM) —
FIXED.** A re-score re-judges the source run's answers — it measures EXACTLY what the
source measured — but the re-scored doc carried no pairing and no carrier, so it sat in
the run history saying NOTHING about what it is comparable to, beside runs that said
everything. The source's `pairing` and `carrier` now travel with it.

**F12 — "the out-set formula names the wrong set" (LOW) — FALSE POSITIVE in the code,
CORRECTED in the artifact.** The formula written above (`(context.resolved.repos −
carrier.repos) ∩ caller_traversable`) names the repositories the caller may NOT traverse
— a set that is EMPTY by construction, because the carrier IS the frozen set narrowed to
the caller. The code never implemented it: `bindingFor` computes
`caller_traversable − context.resolved.repos`, which is the intended semantics ("what the
caller may read but the context does not name"). The formula, not the code, was wrong; the
formula above is corrected and the code is unchanged.

### The third review round (2026-11-23) — the findings the second round's fixes exposed

A `/code-review` (high) of the full diff, run over the phase-3 branch after the
second round's fixes. Four findings; every one ends FIXED.

**F13 — CRITICAL — "the skip tier is unreachable for the exact scenario it exists
for" — FIXED (the party panel's rule set; David ruled on the floor).** `pair()`
computed the pool check FIRST and returned `blocked` before the skip tier was ever
computed. A row's dependency IS a pool member by construction — a confusable's
rival is minted from the carrier's repositories, a benchmark question's source
repository is the corpus it was minted from — so the moment such a dependency left
the carrier, the whole run was REFUSED instead of that one row being skipped. The
skip tier could only fire for a dependency that was never in the pool, which in
this phase's flow never happens. The module's own header promised a guarantee the
code did not make ("a suite that quietly loses its hardest negatives is a suite
that reports a better pass rate than it earned"). The reviewer reproduced it
against the real service: a RAGAS row whose source repository left the carrier
returned `{status: "blocked", reasons: ["pool_not_in_carrier"], skipped: []}`.
**FIXED** per the panel's rule set above (the subject blocks; the pool shrinks →
flag + skip; the floor refuses a different experiment). RED proof: the four tests
that encoded the old behaviour failed against the new code, and the two new tier
tests (the shrink and the floor) fail against the old code.

**F14 — IMPORTANT — "a never-attempted skipped row is counted as an error in the
failed-run envelope" — FIXED.** `erroredRows` counted every row carrying an
`error`, and a skipped row carries one (that is how it records its reason), so a
run whose rows were skipped filed "the repository this question was minted from is
not in the carrier" as the CAUSE of the run — sending the operator to a row that
was never attempted while the real cause went unnamed. The adjacent `firstErr`
search already excluded `SKIPPED_RUN_ABORTED`; the dependency-skip code was simply
never added to the same exclusion. **FIXED:** the skipped rows are excluded from
the error count and from the cause search, and a run in which EVERY in-scope row
was skipped now reports `NOTHING_MEASURED` — "every answer failed" would point at
a pipeline that worked perfectly. RED proof: with the exclusion neutralised the
new test fails (the envelope names the skip code instead).

**F15 — MINOR — "the boundary metric's total hides boundary rows that errored" —
FIXED.** `boundary.total` was computed over the rows that did NOT error, so a
suite with ten boundary rows of which three errored reported `total: 7` — reading
as "the suite had seven boundary rows". The verdict itself was honest (a
never-evaluated row cannot be counted as held); the DENOMINATOR was not. **FIXED:**
the boundary block reports the POPULATION (`total` = the boundary rows in the
run's scope, `evaluatable` = the ones judged), and the difference is the hole.

**F16 — "the generation must not produce an invalid suite or benchmark" (David,
2026-11-23) — FIXED.** The context's scope was a RUN-time fence only: a
generation could still mint a confusable citing a repository outside the carrier,
an abstention probe claiming a provenance the scope does not have, or a benchmark
question whose ground truth was not in the evaluated corpus. Such a row cannot
ever be scored — it would either be skipped at run time or, worse, counted as a
row that measured nothing. **FIXED** at the mint (see the generation table above):
the invalid row is discarded before it becomes part of the suite, the prompt
states the closed set and the consequence, and the generation loop asks again for
the shortfall. RED proof: with the validation neutralised, the two new generation
tests fail (7 pass / 2 fail).

**The risks the review raised that were NOT defects, and why.** The pairing gate is
computed identically at both call sites (`beginRunSuite` and `runSuite` both ask
the same helper), so the record and the gate cannot drift. Both comparison hashes
are over the measured set. The progress denominator covers every question in the
run's scope, so the bar cannot pass 100%. The completeness sweep excludes the
skipped rows, so a skipped row is never retried and never answered. The rebind
cannot double-bind, and it can only target a context whose PERSISTED inputs
resolve as open. The experiment gate is superadmin-gated, requires a reason, and is
audited. The supersede modelling mirrors the retriever's own selection.

**One risk the review raised that WAS a defect, and is now closed:** the pairing's
skip index is POSITIONAL — the position in the array the caller passed. The head
suite built that array twice (once for the pairing, once for the run), so an
off-by-one would have skipped a measurable row and run an unmeasurable one. The
array is now built ONCE and handed to the pairing, so the index cannot drift.

### The security review of the final diff (2026-11-23)

A `/security-review` of the full diff (and of the working tree on top of it).
**No HIGH or MEDIUM security finding is introduced by this diff.** Four candidates
were raised and each was refuted with file:line evidence — the dispositions, so
none of them is silently dropped:

- **"the new persisted `payload.context.repos` discloses ACL-restricted repository
  identity" — FALSE POSITIVE (justified).** The split-brain that makes it
  reachable (`deriveScopeAuthz` treats ANY wildcard repo segment as privileged) is
  real and pre-existing, but the SAME disclosure already exists on `main` and is
  strictly broader: main's `loadSiblingContext` scans every repository with a head
  with no ACL or serving filter and persists `sibling_names` at read scope. This
  diff **reduces** the leak (the staleness refusal withholds the repositories the
  caller may not traverse). No shipped tooling mints `okf:*:*:read` — the realm
  config and the grant facility emit only `okf:*:*:admin` or per-repo scopes — and
  a holder of such a scope is blocked from minting, binding and the context
  catalogue.
- **"a scope breach is invisible to `pass_rate`" — NOT A SECURITY FINDING; a
  PHASE-4 UI GAP, recorded.** The boundary rows are deliberately outside the
  routing pass rate (a scope breach must never flatter or ruin the routing
  number), and the breach lands in `summary.boundary.breached` — which no frontend
  binds yet. The Lab UI wave (phase 4) must surface it, so a 100% headline can
  never sit beside a breach.
- **"a skipped row is counted as a failed row (RAGAS)" — FIXED** in this change
  (F14 above), and even before the fix it had no authorization effect: the failed
  path writes `summary: null`, so no score was claimed.
- **"the repo-agnostic passage key can collide across repositories" — FALSE
  POSITIVE (justified).** The stamp has exactly one functional consumer (the skip
  tier), the corpus read is scoped by the carrier's graphs and never by the
  stamp, and no content outside the carrier can be read through it.

**Checked and clean:** both superadmin powers (the `tools-admin` realm role or a
wildcard **admin** scope only — strictly narrower than the read-side authority,
one call site each, both behind the repo's admin scope); the carrier boundary
(the narrowing refuses an empty intersection, the head race and the served
retrieval are both bounded by the carrier); the `out_set` (derived from the
caller's own authority and never persisted to any document); no injection (every
new AQL uses bind parameters, the group references are URI-escaped, no shell, exec
or filesystem surface in the diff).

### Two carry-overs, filed rather than fixed here

- **The read-level wildcard bypasses the per-repo fence (PRE-EXISTING, not
  introduced by this diff).** `scope-authz-service.js` treats `okf:*:*:read` as
  unrestricted, which contradicts the codebase's own `isSuperadminCaller`
  predicate and bypasses `acl.restricted` for a READ-level wildcard. The file is
  untouched by this change; the fix belongs in the authority layer, and it is
  filed as a backlog issue rather than smuggled into a scoped-evaluation MR.
- **The boundary breach must be visible in the UI (PHASE 4).** Recorded above —
  the summary bar has to carry `summary.boundary.breached`, or a 100% routing
  headline can sit beside a scope breach.

### The live build (2026-11-23) — the phase's visible delta

The phase was deployed to the local build BEFORE the merge, against the
group-scoped fixture (two fenced repositories, two groups, four principals — the
verifier reports 12 / 13 / 13 / 14 traversable graphs for the control, the two
group holders and the union).

**What the running service did.** A context naming one group was created
(superadmin), it resolved to **13 repositories** (the group's set), and a suite
was minted FOR it. The suite carried the context snapshot, and its rows carried
their provenance: **16 `in` rows and 2 `out` rows** — the two abstention probes
asked about the EXCLUDED repository (the other group's fence), exactly as the
design says. The run was paired with the same context:

```
pairing:  status ok · comparable true · reasons [] · missing_pool [] · carrier_grew []
          suite_context_id == run_context_id   (the SAME context)
          repo_set_hash 85c0176aff03691b2d989cc2be42256c
          head_version_hash 0f6a63b8b18f8cd34320576f9c04f7d5
          experiment null
summary:  n_queries 18 · n_skipped 0 · n_errors 0
          positive 4 (pass rate 0.75) · routing negatives 12 (pass rate 0.83)
          boundary { total 2, evaluatable 2, held 2, breached 0 }
          pass_rate 0.8125
```

**`held: 2, breached: 0`** is the evidence a scoped evaluation exists to produce:
the group's scope held — the repository under test did not claim either query
about the excluded repository. The run was measured over the carrier's **13**
repositories, and the pairing says so.

### The SAST panel's five findings (2026-11-24) — none of them new, two of them answered

The MR's security panel reported "5 new potential vulnerabilities (0 critical, 3 high, 2
others)". **Every one of them exists on `main`** — the finding fingerprint carries the
LINE number, so any edit above a flagged line makes a pre-existing finding look new.
The evidence is the two semgrep reports side by side: the same rules fire in main's own
pipeline, at the pre-branch line numbers. (The severities below are the scanners' own;
the panel's mix comes from its own aggregation, which this diff does not reproduce.)

| finding | rule | where (MR pipeline → main) | disposition |
|---|---|---|---|
| weak PRNG | `node_insecure_random_generator` (Medium) | `head-suite-service.js:364` → `main:297` | **FIXED** |
| SSRF | `node_ssrf` (High) | `ragas-suite-service.js:340` → `main:319` | **FIXED** (the guard) + the repo's own `nosemgrep` annotation |
| assert | `bandit.B101` (Info) | `docs/presentations/.../build_deck.py:810` → `main:1027` | **FALSE POSITIVE** — a build script's assertions; not this branch's file |
| assert | `bandit.B101` (Info) | `docs/presentations/.../build_deck.py:811` → `main:1028` | **FALSE POSITIVE** — the same |
| urlopen | `bandit.B310-1` (Medium) | `docs/presentations/.../fetch_fonts.py:62` → `main:64` | **FALSE POSITIVE** — a font download in a build script; not this branch's file |

**The two that were worth answering.**

- **The egress guard had a real hole.** It checked for a scheme and nothing else, so a
  path carrying the USERINFO separator reached the fetch: `base + '/jobs/@evil.com/x'`
  parses as `userinfo@host`, which is a different host. The RED proof is in the test —
  against the old guard the malicious path produced `ragas-service unreachable
  (unexpected fetch http://ragas-service:8090/jobs/@evil.com/x)`. The guard now demands
  a RELATIVE path (one leading slash, then only the characters a route name and a job id
  need), and refuses everything else BEFORE any fetch. The new cases are pinned by a
  test in `__tests__/ragas-suite-service.test.js`, and the SSRF sink carries the repo's
  own `nosemgrep` annotation with the justification written out — the pattern the
  crawler and the query routes already use.
- **The topic sampler drew with `Math.random()`.** The draw is an INDEX into a fixed,
  public topic pool and carries no secret, so this was never an exposure — but the
  weak generator is exactly what the rule flags, and `crypto.randomInt` costs nothing.
  The draw is now strong; the tests that pin a deterministic draw spy on the new seam
  (the service holds the crypto module OBJECT, not a destructured binding, so the spy
  lands on the live call).

**The three that needed no change.** They are in the walkthrough's build scripts — files
this branch never touches. They appeared because the merge ref that was scanned still
carried the walkthrough branch's content, whose line numbers differ from the copy main
holds today. Rebasing onto the current main (the walkthrough landed at 17:15) puts the
same content in the merge ref, so the scan reports them at main's line numbers and they
are no longer "new".

**The proof that the panel is clean.** The MR pipeline's reports were diffed against
the target branch's, finding by finding (the same comparison the panel draws):

| scanner | MR pipeline | main pipeline | NEW in the MR |
|---|---|---|---|
| semgrep | 113 | 115 | **0** |
| kics (IaC SAST) | 191 | 191 | **0** |
| secret detection | 0 | 0 | **0** |
| gemnasium (dependency) | — | — | **0 by construction**: the branch changes no dependency file |

The two findings that sat in this branch's own files are gone from the MR's report
(the strong draw is not a weak one; the SSRF sink carries the annotation), and the
three in the walkthrough's files are reported at main's own line numbers — so the
panel counts none of them. The merge status followed: `security_policy_violations` →
`mergeable`, and the approval the panel had demanded (`approvals_required: 1`) is
gone with it (`approvals_required: 0`).

### The live build, re-run against the rebased branch (2026-11-24)

The branch was rebased onto the current main (the walkthrough merge), the local build
was re-synced to it and `okf-server` was rebuilt and recreated — the tree's source
matches the branch byte for byte, and `verify-local-build.sh` answers **47 pass, 0
fail**. The phase-3 proof was then run again against the running service, with the
hardening in place:

```
the minted suite:  context ec-1b4582a6…  version 1  ·  13 repositories
                   intended_carrier='in': 16   intended_carrier='out': 2
pairing:           status ok · comparable true · reasons [] · skipped_rows []
                   pool_coverage 1
                   suite_context_id == run_context_id
summary:           n_queries 18 · n_skipped 0 · n_errors 0
                   boundary { total 2, evaluatable 2, held 2, breached 0 }
the cross-context run -> HTTP 409
```

The scope still holds, the pairing still pairs, and the cross-context refusal still
refuses. The build tree was left clean: 0 evaluation contexts, ROPC off, the throwaway
helper deleted.

### The T7 ruling — the site page rides phase 4 (2026-11-23)

`site/content/en/docs/knowledge-base/testing-lab.md` documents the Lab DIALOG, and the
dialog has no context picker: the phase-3 scope note puts the picker, the binding badge and
the boundary readout in phase 4 (E-5's scoped viewer). A page that says "pick a context"
would claim an affordance the code does not have — and phase 1's acceptance criterion 7
("the Lab's docs no longer claim carrier-faithfulness the code lacks") is the rule that
says so. Phase 2 set the precedent: it shipped the whole Evaluation Context API with NO
site-doc change, for exactly this reason. So the phase-3 operator-facing document is the
CHANGELOG entry, and the site page is rewritten in phase 4 together with the UI it
describes.
