# Story 1-8b — Routing Gate v2: the three-condition affirmative claim

> **Status: VALIDATED — committed f8ead5de0 (31 files, +1972) on
> `fix/story-1-8b-routing-gate-v2` (cut from feat/okf-server 2e9be556);
> gate v2 live on the local build after the 2026-10-09 validation
> cycle (§8). David: "testing is much better." Remaining gap =
> claim-side teaching + near-miss negatives → spun into 1-8c (backend
> committed c87b5e2dc). The first LIVE teaching-loop cycles then
> poisoned a repo through the new advice flow (self-forbidding tag;
> §9) — remediated by 1-8d teaching-loop guardrails (backend committed
> 130a99e + 2f1cbd763, spec §15).** Spec: §13-15 of
> `spec-1-8-head-tester.md`. Predecessor: 1-8a (merged 2e9be556d,
> squash a1046629c). MR → feat/okf-server pending (orchestrator).

## 1. Problem — the margin-only gate (1-8a) is not enough

Story 1-8a replaced rank-alone with one rule: a head claims a query
only when its score clears its averaged forbidden centroid by
`ROUTE_HEAD_MARGIN` (0.01). The 19-query calibration probe on the
NCD Information repo (f043215b, `gate-probe-inner.js`, production TEI
endpoint, BGE query-instruction prefix, 2026-10-09) shows that rule
still fails in BOTH directions:

**A. Four mixed-subject negatives are CLAIMED (accuracy failure).**
A two-subject query dilutes its forbidden half across the AVERAGED
centroid and slips through:

| Failing negative | vs its dominant forbidden tag |
|---|---|
| genetics query | 0.617 |
| epidemiology query | 0.619 |
| exercise query | 0.638 |
| incidence-trends/epi query | 0.567 |

All ≥ 0.55 against their single dominant forbidden tag — yet
margin-only claims them, because the averaged centroid absorbs the
spike. Legit claims never exceed **0.529** on any forbidden tag, so a
per-tag bar at 0.55 separates cleanly.

**B. Off-domain queries are CLAIMED (the "capital of France" class).**
Fully-unrelated queries score 0.32–0.484 on ANY head — "capital of
France" 0.321, "forbidden noise gate" 0.407, "weather today" 0.484 —
and unrelated text still sits slightly ABOVE the averaged forbidden
centroid: France claimed NCD at **+0.012**, clearing the 0.01 margin.
There is no floor; noise can always sneak a claim.

David's frame: "I am sure you understand that we must ascertain that
there either IS or IS NOT a reason to include any repo in the selected
list for any given query… this is a key part of both the RAG accuracy
and efficiency goals." Rank-alone and margin-alone both answer the
wrong question — the gate must decide CLAIM vs NO-CLAIM on positive
evidence.

## 2. Decisions (David, 2026-10-09 — verbatim)

1. **"Forbidden is forbidden — that is a hard contract, it should
   immediately score zero."** → the per-tag VETO: any single forbidden
   tag matching the query at/above the bar kills the claim outright.
2. **The routing decision must be an affirmative claim.** A repo is in
   the selected list ONLY with positive evidence; suppression is a
   no-claim, never a rank demotion. (The quote in §1.)
3. **The Lab must TEACH the user how to adjust tags.** A suppression
   must resolve to: which condition fired + which tag + what to edit
   (the frontmatter forbidden list / the score band). Encoded today as
   `head_claim ∈ {floor, veto, margin, claim}` (the FIRST failing
   condition), `tag_veto` carrying the offending tag's name, and the
   provenance strings (§4). HeadTestDialog surfacing of these fields is
   remaining work (§7).
4. **The suite generator must produce MORE RANDOM adversarial
   negatives.** The deterministic forbidden-derived negatives
   pattern-match too easily; `head-suite-service.js` is untouched so
   far — remaining work (§7).

## 3. Design — three conditions + degradation

A head CLAIMS a query only when ALL of:

```
floor   score ≥ ROUTE_HEAD_FLOOR              (0.55)  — off-domain noise can never win
veto    NO forbidden tag cosine ≥ ROUTE_FORBIDDEN_TAG_MAX (0.55)
margin  score − forbidden_centroid > ROUTE_HEAD_MARGIN    (0.01, 1-8a kept)
head_claimed = floor_pass && !tag_veto && marginPass
```

Calibration (NCD 2026-10-09): unrelated band 0.32–0.484 vs legit claims
≥ 0.614 → floor 0.55 mid-gap; failing mixed-subject ≥ 0.567 vs their
tag vs legit ≤ 0.529 → veto bar 0.55 separates; margin 0.01 unchanged.

**Degradation — never silently suppress on missing data:** a head
without per-tag vectors (pre-1-8b rebuild) skips the veto but still
applies floor + margin; a head without a forbidden centroid skips the
margin (exact 1-8a semantics). Absence of data never fails closed.

**First-failing-condition reporting:** `head_claim` is the first
condition that fails — `floor` → `veto` → `margin` → else `claim`.
This is the teach-the-user hook: the deciding condition names itself,
and `tag_veto` names the tag.

## 4. Files changed (4, uncommitted on fix/story-1-8b-routing-gate-v2)

| File | Change |
|---|---|
| `components/okf-server/services/head-test-service.js` | Knobs `ROUTE_HEAD_FLOOR` (0.55, :106) + `ROUTE_FORBIDDEN_TAG_MAX` (0.55, :111) beside `ROUTE_HEAD_MARGIN` (0.01, :97); `scoreHead` returns `tag_cosines:[{tag,cosine}]` (:149-157); ranked-rows gate sets per row `floor_pass`, `tag_veto` (tag or null), `max_tag_cosine`, `head_margin`, `head_claimed`, `head_claim ∈ {floor,veto,margin,claim}` (:426-455); `verdict.head_suppressed` + provenance `'head-suppressed (off-domain)'` / `'head-suppressed (forbidden: <tag>)'` / `'head-suppressed (forbidden/noise)'` (:575-581); `under_test` carries `tag_veto`/`max_tag_cosine`/`floor_pass`/`head_claim`/`head_claimed` (:550-556); `fidelity.algorithm='story-1.3-replay+v2'` with all 3 knobs (:584-593) |
| `components/okf-server/services/frontmatter-service.js` | `buildVectorizedHead` stores `head.per_field.forbidden_vectors = [{tag, vector}]` — per-tag embeddings at publish (:737-744); averaged `per_field.forbidden` centroid unchanged (margin input) |
| `genie-ai-overlay/retriever/config.py` | `ROUTE_HEAD_FLOOR` (:300) + `ROUTE_FORBIDDEN_TAG_MAX` (:301) beside `ROUTE_HEAD_MARGIN` (:288); code-default env knobs, same family as ROUTE_TOP_K/MIN_CHUNKS/WEIGHT |
| `genie-ai-overlay/retriever/genieai_retriever_arangodb.py` | `_route_graphs` head pseudo-row needs floor (:1833) + per-tag veto (:1836-1851) + margin (:1852-1857) to enter the top-K pool; counters `heads_floored`/`heads_vetoed`/`heads_gated` (:1790-1793); span attrs `rag.route.heads_floored`/`heads_vetoed` (:1880-1882); `Graph routing` log line extended (:1884-1891) |

## 5. Calibration evidence (NCD f043215b, 19-query probe, 2026-10-09)

| Query class | Evidence | v2 verdict |
|---|---|---|
| "capital of France" | 0.321 on head; claimed at +0.012 under margin-only | FLOORED (< 0.55) |
| "forbidden noise gate" | 0.407 | FLOORED |
| "weather today" | 0.484 | FLOORED |
| genetics / epidemiology / exercise / trends negatives | 0.617 / 0.619 / 0.638 / 0.567 vs dominant forbidden tag; slipped the averaged centroid | VETOED |
| legit claims | ≥ 0.614 head score; ≤ 0.529 on ANY forbidden tag | CLAIMED (all three pass) |

NCD forbidden tags: mental-health, nutrition, exercise, genetics,
epidemiology. Probe tool: `gate-probe-inner.js` (session-local, 2026-10-09).

## 6. Validation plan (the gate for flipping status to done)

1. **Rebuild the NCD head** (`POST /api/okf/repos/:id/head/rebuild` or
   re-publish) → mints `per_field.forbidden_vectors` (per-tag vectors).
   Until this runs, the veto degrades open by design.
2. **Suite re-run** → target **17/17**: positives claimed (floor+no
   veto+margin), the 4 mixed-subject negatives vetoed, legacy
   adversarial negatives suppressed.
3. **Off-domain probes** → France/weather-class queries floored;
   `verdict.head_suppressed = true`, provenance
   `head-suppressed (off-domain)`.
4. **Retriever parity probe** → `rag.route.heads_floored` /
   `heads_vetoed` counters non-zero on the same queries; log line shows
   the gate counts.
5. **v2 unit tests**: jest (floor/veto/claim per condition +
   first-failing priority + degradation paths) + retriever pytest
   parity.
6. Then: commit on `fix/story-1-8b-routing-gate-v2` → MR →
   feat/okf-server (local build venue per the 1-8 precedent;
   Path-1-style flow).

## 7. Remaining work

[RESOLVED 2026-10-09 — all three items below shipped in commit
f8ead5de0: v2 unit tests authored (jest `head-test-service.test.js`
+176; pytest `test_fanout.py` +287 incl. gate parity); suite generator
randomized (off-domain + meta negative classes with deterministic
fallbacks); HeadTestDialog teach-the-user live (3-check Floor /
Forbidden-tags / Margin breakdown with DsPill pass/fail/na from
`fidelity.knobs` + veto/floor teach panels, i18n ×14). The validation
cycle then exposed the ONE gap this story could not close — a
CLAIM-side failure (§8) — spun into 1-8c.]

- v2 unit tests (§6.5) — NOT yet authored; existing
  `head-test-service.test.js` is 18/18 green under v2 (margin fixtures
  score 1.0 clear the floor; heads without `forbidden_vectors` skip the
  veto) — re-run 2026-10-09.
- Suite generator: MORE RANDOM adversarial negatives
  (`head-suite-service.js` untouched so far — decision §2.4).
- Lab UI teach-the-user surfacing (`HeadTestDialog.vue` untouched): a
  "deciding condition" column from `head_claim` + which-tag copy from
  `tag_veto`/`max_tag_cosine` + what-to-edit hint (frontmatter forbidden
  list). The response contract is already in place (§4).
- The validation plan (§6).

## 8. Validation results (2026-10-09 — the done gate, PASSED)

Gate v2 is live on the local build after the NCD validation cycle. The
head was rebuilt first (`per_field.forbidden_vectors` minted — the
veto no longer degrades open), then:

- **Suite 18/18 PASS** (08:08 cycle): positives CLAIMED, mixed-subject
  negatives VETOED, off-domain FLOORED. (The §6 plan targeted 17/17;
  the generated suite carried 18 queries — all passed.)
- **TB query 0.509 < floor 0.55** → floor-suppressed, correctly.
- **David: "testing is much better."**

**Residual finding — the CLAIM-side gap (spun into 1-8c):** the HIV /
communicable-disease query CLAIMS the NCD head — head 0.594 > floor
0.55, max tag 0.518 < 0.55, margin +0.049 > 0.01: all three gate
conditions PASS, so the gate affirms a claim on a query that must be
excluded. Root cause: **communicable-disease is UNDECLARED** — no
forbidden tag covers the subject. A curation gap, NOT a gate bug — but
the Lab had no surface to teach the curator what to add (the 1-8b
teach panels cover veto + floor only; nothing renders for
`head_claim = claim`). 1-8c closes it: `POST /routing-explain`
(claim-side forbidden-tag suggestions), `POST
/routing-testsuite/:suite_key/explain` (batch advice, ONE LLM call per
run), the near-miss negative class, and per-class count controls —
backend committed c87b5e2dc; the in-Lab tag-edit → rebuild → re-run
loop is the remaining frontend work. Spec §14.

## 9. First live teaching-loop cycles — the poisoning, and the 1-8d remediation (2026-10-09)

The gate itself held (§8), but the TEACHING LOOP built on it (1-8c)
failed in live use within its first three cycles — the failure mode is
recorded here because it bounds this story's claim: the three-condition
gate answers correctly at every instant; it cannot stop a curator from
redefining the repo's scope through the advice flow.

**Cycle outcome:** the explain LLM proposed 'lung-cancer' — the repo's
OWN entity tag — as a forbidden tag, three add-all cycles applied it,
and the 0.55 veto bar turned against the repo's own corpus: positives
collapsed **7/8 → 2/8** while negatives "improved" to **20/20** by
over-suppression (a head that vetoes its own subject suppresses
everything). The Explain button — gated on negative failures only —
disappeared exactly when the loop was most needed: the moment negatives
looked "perfect", the advisory loop went dark. Recovery was a MANUAL
frontmatter restore (which is what 1-8d's Revert button now does).

**Remediation — 1-8d teaching-loop guardrails** (backend committed
130a99e + 2f1cbd763 on this branch; spec §15):

1. **Mechanical suggestion guardrail** — `guardSuggestions` embeds every
   proposed forbidden tag and rejects it when cosine vs ANY
   topic/entity/keyword head vector ≥ `OKF_GUARD_SELF_SUBJECT` (0.55) or
   vs an existing forbidden vector ≥ `OKF_GUARD_DUPLICATE_FORBIDDEN`
   (0.9); 2f1cbd763 adds veto-impact simulation against the run's own
   positive queries (a candidate that would suppress even one gold
   positive is rejected with the kill list). Rejections are reported
   with reasons; a screened-out proposal never reaches the UI chips.
   Self-forbidding suggestions are structurally impossible, not a
   prompt request.
2. **Advice for BOTH failure kinds** — `explainSuiteFailures` v2:
   `removal_suggestions` [{tag, killed}] from the killed positives'
   `tag_veto` attribution (remove-side advice), `positive_failures`
   {count, veto_counts, margin_killed}, explicit `improvements` advice,
   and a failures-are-suppressed-positives note when only positives
   failed — the Explain blind spot is closed. Every explain run is
   persisted (`kind: 'explain'`) so cycles are auditable.
3. **Revert in the Lab** — every frontmatter save snapshots into bounded
   `frontmatter_history` (10) on the repo doc; `GET .../frontmatter/history`
   + `POST .../frontmatter/revert` (re-enters update(), so
   revert-of-revert works). Plus `forbidden_snapshot` on every suite
   (cycle-staleness detection) and the forbidden-tag ceiling raised
   6 → 24 (47171229 — add-all on a 5-tag repo was a guaranteed 400).

Requirement status vs David's three properties: (1) every cycle
improves — enforced by the guardrail + tripwire data now in the
payload; (2) unlimited cycles — both failure kinds now advise, failures
cannot hide; (3) revert in the Lab — history/revert shipped backend,
panel UI remaining. 1-8d frontend loop remaining (spec §15.6).

## 10. 1-8e — the advisor cycles live: findings, hardening, and the tuning identity (2026-10-09)

Live NCD cycling with the 1-8d advisor surfaced four defects and one
design insight; all four are fixed on this branch (commits dd41684,
f642e65 + the advisor UI wiring 6b1dbab/e2c7e87/364916a/57dcf69/ff85ba2).

**Defects found and fixed:**

1. **TEI batch cap (57dcf69)** — the advisor aggregates every deduped
   query of the last N runs and embedded them in ONE `/embed` call; the
   remote TEI rejects batches above its client cap with 422 (observed:
   32 OK, 48 → 422). `teiEmbed` now chunks at 32 — every caller bounded,
   no per-caller workaround.
2. **Duplicate tag propagation (dd41684)** — granite emitted
   `"mental-health"` 5× inside ONE forbidden array (raw model output in
   `frontmatter.suggest.llm_response`); suggestTags had no dedup and the
   duplicates reached the stored frontmatter AND the head's per-tag veto
   vectors. Fixed at both origin points: suggestTags dedups every tag
   array, and `repository-service.update()` dedups topic/entity/keyword/
   forbidden at the WRITE BOUNDARY — no path can persist duplicates.
   RepoEditor also remounts the concept pane after a chip-panel save
   (the stale-YAML display bug).
3. **The pass-rate "bounce"** — run-record forensics (diffing same-head
   run pairs): same tags + same suite = **0 flipped rows** — evaluation
   is bit-stable. Every score swing traced to a tag-set change (advisor
   applies + hand edits) compared as if it were the same experiment.
   Compounding: the margin gate uses the forbidden CENTROID, so adding
   any tag shifts the margin verdict of every query — the 82↔87 oscillation.
4. **The Apply race (f642e65)** — the advisor-apply leg (save → rebuild →
   re-run) chained through guard clauses that return SILENTLY; when a
   precondition flickered the flow just stopped ("why did everything
   stop"). Apply now owns ONE busy token across the whole leg and every
   failure path writes the error strip; jest pins the dispatch order and
   both failure paths.

**Design insight — the tuning identity:** pass rates are only comparable
within a tag-set configuration. Runs now stamp `tagset {forbidden, hash}`
(f642e65); the history table shows the hash so like compares with like.
The advisor's aggregate is already configuration-safe (it re-PREDICTS
every query via `predict()`, never trusts stored outcomes).

**Anti-treadmill damping (f642e65):** the live cycle added one admin tag
per advisor round for +1 suppressed negative each — the treadmill David
banned ("must not become a long term full time job"). `recommendTagSet`
now rejects a negatives-only add that suppresses < 2
(`OKF_ADVISOR_MIN_NEGATIVE_GAIN`) and caps adds at 3 per run
(`OKF_ADVISOR_MAX_ADDS`); only "no predicted improvement" rejections are
retried on the interaction pass (damping/cap verdicts are final — the
unit test pins this after the retry pass double-counted damped adds).

**Live cycle evidence (suite s1791548461754, 45 rows):** failing 7 → 6 →
5 across three advisor cycles, positive kills constant at 1 (the
mislabelled HIV query — vetoed by `communicable-diseases` at 0.562, the
exact routing the gate was built for; the "fail" is the manual label).
The advisor converged (add=[] remove=[], score 58→58) after 4 rounds —
the cycle TERMINATES, it does not treadmill. ~6 of the remaining fails
are suite-label errors (5 in-scope near-misses + HIV), not gate errors.

**Open decisions:** (a) B — margin on worst-tag instead of centroid
(compositional tuning; gate-semantics change, lab + retriever parity,
David's call, deferred); (b) honest-label benchmark regeneration
(HIV as negative, the 5 in-scope near-misses as positives) — the
prerequisite for 100%-meaningful numbers at scale; (c) branch push → CI →
MR to feat/okf-server once David validates NCD as done.

## 11. 1-8f — suites are savable, modifiable and rerunnable (2026-10-09)

David: "the test suites need to be able to be saved, modified and rerun
(of course)". Suites already persisted (kind:'suite' docs in
okf_head_test_runs) and reran by key; the gaps were LOADING one back into
the Lab and EDITING its rows — a row could only be ADDED, so a mislabeled
row (the HIV positive) was permanent noise: it could not be relabeled or
removed, only duplicated with the other kind (which the advisor then
reads as two contradictory rows).

**Backend (cf9fe2c):** GET /okf/repos/:id/routing-testsuite/:suite_key
returns the full saved suite (read scope; 'runs' stays registered first
so the key is never parsed as a suite id). POST .../:suite_key/rows
{updates, removes} (admin): kind flips search BOTH payload arrays — the
mislabeled row sits in the WRONG array (kind:'positive' inside
payload.negative), which the first implementation missed and the unit
test now pins; cls is cleared on flip (the class is the GENERATOR's
assessment — a relabeled row has none); 409 on a resulting
cross-array contradiction (same text both kinds) or in-kind duplicate;
run doc untouched (runs are immutable history — edit the SUITE, rerun).

**Frontend:** Saved-suites table in the Suites tab (key / when /
positives / negatives + Load); suite rows visible and editable BEFORE
any run (the old view only rendered post-run — suiteResultRows gated on
lastRunSummary); per-row ⇄ (flip) and × (remove) buttons adopt the
server-returned suite on every edit; DS tokens only (--danger etc.).

**Also in this cycle:** translateMixin switched to RAW message lookup
(4ba28e5) — vue-i18n's compiler was rendering every {placeholder} EMPTY
in the browser (the advisor scorecard showed "positives / claimed ·
negatives / suppressed") while jest stayed green; the {'{'}-escape
workaround string (teach.veto ×14) reverted to plain {tag}.

**Validation:** okf-server 843 (one pre-existing flake:
import-links-integration timeout under full-suite load, green in
isolation at 1.4s), frontend 1664, live smoke 32/32 (section 14 = suite
load + flip + flip-back roundtrip + 401), verify-local-build 46/46.
Commits: 4ba28e5 (translate), cf9fe2c (1-8f), ce7d7a7 (smoke §14).

## 12. 1-8f2 — async generation + the dashboard escape bug (2026-10-09, 036af473b)

Two live findings from David's 100-positive generate + dashboard pass:

**Async 202 + poll.** The synchronous POST /routing-testsuite/generate
died at the gateway on large asks: the 100-positive suite SAVED at
minute 5 while the browser gave up at 60s ("I just tried to generate and
never got the suite after" — the suite was actually there:
s1791559159861-e67759). Now: beginSuiteGeneration mints the suite key
up-front, kicks generateSuite DETACHED (suiteGenInFlight Map, one per
repo — a second begin 409s GENERATION_IN_FLIGHT, sync throw), the
controller responds 202 {suite_key, status:'generating'} immediately,
and the dialog polls GET /routing-testsuite/:key (96 × 2.5s ≈ 4 min,
GET-first-then-sleep) adopting the suite when it lands, with an honest
timeout message. i18n: suites.generateTip/.generating rewritten for the
batched reality + error.generateTimeout ×14.

**The {'{'}-escape convention is DEAD.** The raw-lookup mixin made every
remaining escape render AS ITSELF: all dashboard cards showed "Ingested
v{'{'}n{'}'}" — the caller's .replace('{n}') can never match the
escaped form. All ~47 okf.* escaped strings un-escaped ×14
(scripts/unescape-okf-braces-async-i18n.cjs). admin.documents.* KEEPS
its escapes deliberately: its consumer is AdminDashboard.translate,
which still routes through vue-i18n's compiled $t and would swallow a
plain {x} as an empty named slot. The localeConsistency guard re-inked
to pin the split invariant: plain {x} required for mixin-consumed okf.*
keys, escaped form required for admin.documents.*. (Follow-up noted:
aligning AdminDashboard.translate to raw lookup would let the escape
die everywhere — legacy-file blast radius, not this story.)

**Validation:** okf-server 845+42 (import-links flake green in
isolation), frontend 1668, live smoke 32/32 with the poll-based
generation, verify-local-build 46/46 (patched_files_expected 42). One
commit: 036af473b. NOTE: first smoke run against the build tree failed
24/32 — the build tree held a STALE pre-async smoke copy; always cp the
fresh smoke before running.
