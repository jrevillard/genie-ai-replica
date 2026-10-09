# Story 1-8b — Routing Gate v2: the three-condition affirmative claim

> **Status: IN-PROGRESS — core implemented (uncommitted on
> `fix/story-1-8b-routing-gate-v2`, cut from feat/okf-server 2e9be556),
> gated on local validation.** Spec: §13 of
> `spec-1-8-head-tester.md`. Predecessor: 1-8a (merged 2e9be556d,
> squash a1046629c). Branch rules: do NOT commit/push until the
> validation plan in §6 passes; nothing here has touched a remote.

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
