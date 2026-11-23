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

`out_set = (context.resolved.repos − carrier.repos) ∩ caller_traversable`

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

- **Scrub constraint (standing, every artifact):** no deployment-name mentions, no Muslim terms, no
  shia/sunni example — in docs, MR descriptions, commit messages and code strings.
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
  where `out_set` is `(context.resolved.repos − carrier.repos) ∩ caller_traversable`.

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
