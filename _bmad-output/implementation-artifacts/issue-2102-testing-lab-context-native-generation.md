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
| **block** | the under-test repository, or the suite's pool, is not in the run's carrier | the run is REFUSED (409) — it cannot measure what the suite was minted for |
| **skip-with-reason** | a row's rival/source repository left the carrier | that ROW is skipped, counted in the coverage, never silent |
| **flag-only** | the carrier GREW (the run's carrier has repositories the suite never saw) | the run proceeds, flagged: the extra repositories were not evaluated |

Cross-context execution is **blocked by default**. A superadmin lifts it with a run-request flag
(`allow_cross_context` + a reason): the run writes an audit record, stamps itself
`comparable: false`, and the UI renders it as a recorded experiment. **No new collection.**

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

**Status: CODE COMPLETE, verification green.** okf-server **2551 tests green** (49 new in
the branch: 11 pairing + 6 head-suite generation + 9 head-suite run + 4 bind + 4 RAGAS
generation + 4 RAGAS run + 4 evaluation-context + 3 head-test supersede + 4 more).

**The gates, measured on the branch.** okf-server `eslint .` → no issues; the component's
own `prettier --check "**/*.js"` → clean (the eight phase-3 files were the only ones the
gate saw, and they are formatted); the full suite → 2551 green, 0 failed; the component's
coverage totals → statements **88.08%**, branches **75.40%**, functions **89.11%**,
measured the same way as the base (no coverage decrease).

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
