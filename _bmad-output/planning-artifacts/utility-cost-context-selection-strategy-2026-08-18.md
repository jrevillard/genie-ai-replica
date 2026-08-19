---
title: "Strategy — Utility–Cost Adaptive Context Selection for the Multi-Graph OKF RAG"
created: 2026-08-18
updated: 2026-08-18
initiative: okf-server
branch: feat/okf-server
status: proposed (strategy v2 — corrected after adversarial review)
revision_note: >-
  v2 corrects the priority inversion found in review: graph-level utility-cost
  selection (query→graph mapping) is now the PRIMARY deliverable and this
  document drives its design direction; the chunk-level article port is demoted
  to a refinement of the already-live adaptive selector. Also fixes six factual
  errors (cloned_from materialization, token-cap location, invented article
  defaults, gap-table skew misattribution, "single choke point" scope, bump-gating
  conflation) and the trust/dedup-vs-fusion consistency issues.
based_on: >-
  research/utility-cost-adaptive-context-selection-article-2026-08-18.md
  (Roman Chestnov, Medium 2026-08-18) + existing adaptive reranker
  (genie-ai-overlay/reranker/genieai_tei_reranker.py) + OKF architecture
  (prds/prd-okf-server-2026-07-15/architecture.md, ADR-okf-024/025/026/027)
type: strategy
---

# Strategy: Utility–Cost Adaptive Context Selection for the Multi-Graph OKF RAG

## 1. TL;DR

The article [utility-cost-adaptive-context-selection-article-2026-08-18](./research/utility-cost-adaptive-context-selection-article-2026-08-18.md)
proposes replacing fixed context-selection rules with a greedy utility–cost
selector: include a candidate iff `V_i = U_i − C_i > 0`, where utility is
**relevance × complementarity** and cost is **processing + dilution**. Every
signal already exists in the RAG pipeline — **no extra inference**. The framework
is **level-agnostic**: it selects the best subset of *any* ranked candidate set.

**The key architectural insight for a multi-graph RAG is that we have two
chained selection stages, and the article's math applies to *both* — more
naturally to the upstream one than the downstream one:**

| Stage | Question | Dominant cost | Utility-cost role | Status today |
|---|---|---|---|---|
| **Graph Router** (which graphs) | "Which OKF graphs is this query worth fanning out to?" | **Fan-out latency** (NFR-PR1 ≤300ms; ~300+ round-trips at 50 repos) | **Primary** — recall-critical; selects the candidate space | **Unbuilt** (Story 1.3, bump-gated) |
| **Reranker selector** (which chunks) | "Which chunks, within the fused set, are worth the LLM context?" | Token budget + dilution (softer, NFR-PR2) | **Refinement** — precision-critical; trims noise in-set | **Built + live** (adaptive is already the ChatQnA default) |

**The strategy in one sentence:** drive the query→graph mapping design with the
article's utility-cost framework (graph-level selection, promoting it from a
deferred "Phase 4" to the primary deliverable), and treat the chunk-level port
as a modest refinement of the already-shipped adaptive selector.

Two things we are **not** starting from zero on, stated plainly:

1. **The chunk-level selector already exists and is already the live default.**
   The reranker ships `RERANKING_STRATEGY=adaptive` with a utility-cost selector
   ([genieai_tei_reranker.py](../../genie-ai-overlay/reranker/genieai_tei_reranker.py))
   and an offline calibration harness
   ([calibrate.py](../../tests/rag-benchmarks/eval/calibrate.py)). Porting the
   article's cleaner math is a **formula refinement**, not new engineering.
2. **The graph-level selector does not exist at all.** Story 1.3 (Graph Router)
   is `NEW · gated` ([epics.md:228](../prds/prd-okf-server-2026-07-15/epics.md)),
   ADR-okf-024 is `Status: Proposed`, and its *general* case (classifier,
   centroid) is itself already deferred. This is the genuinely open, hard,
   scaling-critical problem — and where the article's framework earns its keep.

## 2. The article in one page

| Component | Formula | Intuition |
|---|---|---|
| Marginal value | `V_i = U_i − C_i`; select iff `V_i > 0`, greedy in rank order | Worth, not relevance |
| Relevance | `R_i = s_i × (1 + tanh((s_i − mean(s))/σ))` | Score normalized against its own distribution |
| Complementarity | `K_i = B^(ε + (1−H))`, `B = (1−O) + (1+γ)D` | Novel info beyond what's selected |
|  — overlap | `O = cos(v_i, v_j)` (j = most-similar selected) | Redundancy penalty |
|  — query complementarity | `D = cos(v_ij, q) − max(cos(v_i,q), cos(v_j,q))`, `v_ij=(v_i+v_j)/2` | Two chunks collectively match the query |
|  — set concentration | `H = μ_q·e^(−σ_q)` | In tight collections, similarity ≠ redundancy |
| Processing cost | `C_processing = α·T` | Token budget |
| Dilution cost | `C_dilution = (1−s_i)(1+ρ(M−s_i))(1+o·G)` | Ambiguity/distraction risk |
|  — structure | `G = ((1+M−mean(s))(1+s_{i−1}−s_i))/(1+mean(Δ))` | Reranker confidence in exclusion |

Tunable parameters: **γ** (complementarity weight), **ε** (redundancy strictness),
**ρ**, **o** (dilution), **α** (token coefficient). The article gives no numeric
defaults — it only reports *tuned* γ/ε values (γ=3/ε=1.5 aggressive vs γ=2/ε=0.5
permissive) and leaves α, ρ, o unspecified. Reference implementation:
`github.com/romanchest/adaptive_context_selection_for_RAG`.

## 3. Where this lands in the OKF RAG pipeline

```
Chat query → AUTHZ RESOLVER (authorized graph set, per-graph labels) →
GRAPH ROUTER (select ≤5 OKF graphs + constant GRAPH) →           ← PRIMARY (unbuilt)
RETRIEVER (per-graph fan-out + 2-level RRF → fused candidates) →
RERANKER (TEI scores → chunk-level context selection) → LLM     ← refinement (live)
```

**This is two chained selection stages, not one choke point.** The Graph Router
sets the *feasible candidate space*; the reranker *refines within it*. Improving
the reranker cannot recover a graph the router wrongly excluded — the router's
error is the ceiling for the chunk selector (the article's own caveat 7,
"retrieval quality remains the ceiling," applies one level up in a multi-graph
system). The reranker also is **not** literally "every query": Epic 5 has
non-retrieval read paths — `get` is a direct fetch from `okf_concepts_meta` +
document-repository, not retrieval ([epics.md:598](../prds/prd-okf-server-2026-07-15/epics.md)),
and `list`/`outline`/`neighbors` likewise bypass the reranker. The selector
governs **free-form chat + OKF `search`** only.

## 4. Gap analysis — what we already have vs. the article

**We have** ([genieai_tei_reranker.py](../../genie-ai-overlay/reranker/genieai_tei_reranker.py),
`adaptive_context_selection`, env vars `NOVELTY_SIGMOID_A/B`,
`CONTEXT_DECAY_FACTOR`, `MIN_VALUE_THRESHOLD`; span `rag.adaptive_breakdown`):

| Article | Our existing implementation | Gap |
|---|---|---|
| `R_i = s_i × (1 + tanh((s_i − mean)/σ))` | `relevance = score + (score − avg·(1+tanh(skew)))`, `skew=(avg−median)/avg` | Our skew term is a **skewness** measure (mean−median) that ignores dispersion **σ**, and it is **additive** (`score + …`) rather than multiplicative. It is *not* the source of instability — see next row. |
| `C_dilution = (1−s)(1+ρ(M−s))(1+o·G)` | `confusion = (1−s) + (M−s)/max(ε, M−avg)` | **This** is where the instability lives: the denominator `M−avg` → 0 when scores cluster tight, producing the 3–5× spikes that `calibrate.py` documents (`conf_bounded_rel` "kills the 3-5x spikes"). The article's product form is bounded by construction and adds distribution structure `G`. |
| `K = B^(ε + (1−H))`, `D = cos(v_ij,q) − max(...)`, `H = μ_q·e^(−σ_q)` | `novelty = 1 − best_sim·(1 − Δq)` (clamped), then sigmoid | No pair-midpoint `D`, no concentration `H`, no power law. Weaker linear approximation. |
| `C_processing = α·T` | `context_decay = CONTEXT_DECAY_FACTOR·token_count` (default 0.0025) | Same idea ✓ |
| Greedy `V_i > 0` | greedy `value > MIN_VALUE_THRESHOLD` (default −1.0) | Same idea ✓ |
| Tunable γ, ε, ρ, o, α | `NOVELTY_SIGMOID_A/B`, `CONTEXT_DECAY_FACTOR`, `MIN_VALUE_THRESHOLD` | Article adds distribution-aware knobs |

**Conclusion:** our implementation is a legitimate first generation of the same
idea (relevance × novelty − token − confusion). The article's contribution is a
cleaner formulation — std-dev relevance, multiplicative complementarity with
concentration, bounded product-form dilution — worth porting as a **refinement**,
but it is not a new capability.

## 5. Implementation strategy

### Phase A (PRIMARY) — Graph-level utility-cost selection: the query→graph mapping design

This is the load-bearing piece the current ADR leaves open. ADR-okf-024 specifies
"domain binding + repo-metadata BM25 → top-K ≤5" but (1) domain **granularity**
is an open item ("top-level vs any node", [architecture.md §14](../prds/prd-okf-server-2026-07-15/architecture.md)),
(2) the **general** query→domain path is deferred (a "lightweight classifier",
ADR-okf-024 D8-c), and (3) the domain-less free-form `GRAPH` corpus is
unhandled. We resolve all three by applying the article's utility-cost lens at
graph granularity — which, because it is a *ranked, value-gated* selection rather
than a hard domain filter, makes the classifier unnecessary.

**A three-layer design:**

**Layer 0 — Constant baseline: the free-form `GRAPH` corpus.** `GRAPH` has no
domain and represents general knowledge. It is **always** in the fan-out set,
never subject to selection — a one-graph constant inclusion. This resolves open
item (3) by declaration: the router selects *among OKF repos*; `GRAPH` is the
mandatory baseline. Fan-out cost stays bounded (one extra graph).

**Layer 1 — Relevance: repo-metadata BM25 is the primary mapper (not a
classifier).** The single AQL over `okf_concepts_meta`
(`title/type/tags/summary`) already exists and is near-free. Make it the *general*
query→graph relevance signal, normalized across the candidate distribution:

```
R_g = bm25_g × (1 + tanh((bm25_g − mean(bm25)) / σ_bm25))
```

This **collapses the deferred classifier** (D8-c): BM25-over-metadata *is* the
general case — it needs no exact domain keyword and no separate model. A
dedicated classifier is demoted from "deferred dependency" to "possible future
boost."

**Layer 2 — Domain binding as a boost, not a hard filter.** Exact match against
`okf_repositories.domain` (and, when available, the existing service-category
classifier) becomes a *multiplicative boost* `D_g ∈ [1, 1+δ]` on `R_g`, not a
cut. This de-risks open item (1): since binding is only a boost, its exact
granularity affects *strength*, not *correctness* — default to top-level match
with any-node fallback, both as boosts. It also handles the edge cases the open
item hides:
- **No exact domain match** → no boost for anyone; BM25 ranks purely on content.
- **Cross-domain query** → multiple boosts; top-K naturally spans domains.
- **Ambiguous/fuzzy domain** → BM25 carries the decision.

**Layer 3 — Complementarity, cost, greedy cut.** Process candidate OKF graphs in
`R_g·D_g` order and include greedily while marginal value is positive:

```
K_g = 1 − overlap(g, already_selected)          # clone lineage + shared concept fingerprint + same-domain
C_g = α_fan + dilution_g                        # α_fan = marginal fan-out latency; dilution = low-relevance/low-trust/stale
V_g = R_g·D_g·K_g − C_g                          # include iff V_g > 0
```

**Hard stops (unchanged, still enforce):** `MAX_FANOUT_GRAPHS` (default 5, safety
cap), the **≤20ms selection-latency gate** (CI-gated, ADR-okf-024), and the
per-query fan-out latency budget feeding NFR-PR1 (≤300ms p95).

- **Complementarity `K_g`** dedups *at graph level before fan-out* — cheaper than
  the chunk-level dedup in Phase C. Sources: (a) `cloned_from` repo-pair lineage
  (Story 4.8), (b) shared concept fingerprint (overlap of `concept_id` /
  `content_hash` between candidate repos, available from `okf_concepts_meta`),
  (c) same-domain redundancy.
- **Cost `C_g`** is dominated by fan-out latency (the ~300+ round-trip blow-up
  ADR-okf-024 warns about), with trust/staleness as a soft dilution term.

**Where this lives:** it *amends Story 1.3's algorithm* (the router is unbuilt, so
this is the moment to get it right) and updates ADR-okf-024. It is **not** a
"v2 to defer behind a non-existent v1." If the team wants the minimal
exact-match+BM25+top-K shipped first, this utility-cost selection is a
**co-deliverable of Story 1.3**, not a follow-up.

### Phase B — Chunk-level article port (a refinement of the live selector)

The existing adaptive selector already runs (and is already the ChatQnA default).
Port the article's cleaner formulation behind an env gate, keeping the legacy
formula as fallback:

```
UTILITY_FORMULA = legacy | article        # default legacy (zero change until opted in)
```

1. **Relevance** — replace skew with σ:
   `R_i = s_i × (1 + tanh((s_i − mean(s)) / σ))`, `σ = stddev(s)`, guard `σ ≈ 0` → `R_i = s_i`.
2. **Complementarity** — replace the clamped linear novelty + sigmoid with
   `O` (max cosine to selected), `D` (pair-midpoint), `H` (set concentration),
   `B = (1−O) + (1+γ)D`, `K_i = B^(ε + (1−H))` clamped to `[0,1]`.
3. **Dilution** — replace the unstable `(M−s)/(M−avg)` denominator with
   `C_dilution = (1−s_i)(1+ρ(M−s_i))(1+o·G)`. This is the fix `calibrate.py`
   already gestures at (`conf_bounded_rel`, `conf_simple`).
4. **Processing** — keep `C_processing = α·T`; **alias `α = CONTEXT_DECAY_FACTOR`
   (default 0.0025)** so switching formulas does not silently change the token
   weight. (The article leaves α unspecified — 0.0025 is our *live* value, not
   the article's.)
5. **Selection** — same greedy `V_i > 0`, keep `MIN_VALUE_THRESHOLD`.

New knobs default to **proposed starting values to be tuned via `calibrate.py`**
(not "the article's untuned values" — the article supplies none): `γ=1, ε=1,
ρ=1, o=1`. Keep emitting the full `rag.adaptive_breakdown`, extended with
`relevance_raw`, `complementarity`, `concentration`, `dilution_structure` so the
offline calibration can sweep the new params.

### Phase C — Multi-graph chunk-level extensions (what the article doesn't cover)

These operate on the **fused candidate set** (post-RRF), so they are precision-side
refinements downstream of Phase A's graph selection.

1. **Cross-graph redundancy (cloned repos).** Story 4.8 clones copy concepts
   verbatim, so near-identical chunks can appear in multiple authorized graphs.
   Dedup uses `cloned_from` repo-pair lineage **and** `cos ≥ ~0.95`. **The
   `cloned_from` discriminator is NOT materialized today** — it is repo-level
   lineage on the *new* repository record (Story 4.8), absent from both the
   `_SOURCE` chunk model and `okf_repositories`. It must be added as a **new
   additive field** (e.g. `cloned_from_repo_id` on `_SOURCE` at ingest, NFR-S7
   additive-only), or resolved via a repo_id→lineage control-plane lookup at
   selection time.
2. **Trust as a utility modifier.** `trust_tier` (`unverified | machine-confirmed |
   human-reviewed`, denormalized on `_SOURCE`, ADR-okf-026) is advisory in v1.
   Use as a **soft weight** on `U`, not a hard filter — consistent with
   ADR-okf-026 D12.
3. **Staleness as a dilution cost.** `stale = today ≥ stale_after`. A stale chunk
   raises dilution risk → scale `C_dilution` by `(1 + stale_penalty)`. **Single
   owner for the derived boolean:** consume the retriever's annotated `stale`
   (ADR-okf-026) rather than recomputing it in the reranker.
4. **Token budget as a hard stop.** The per-response cap is **not** enforced at
   the reranker today — the nearest mechanism is chatqna's `MAX_MODEL_LEN_TEXTGEN`
   history truncation (retrieved context is never budgeted), plus OKF `get`
   slicing. Placing a cap in the selector is a **new/moved** enforcement point:
   accumulate `Σ T_i` and stop at `RERANKER_MAX_CONTEXT_TOKENS`. Optional fairness
   guard: per-graph token-share cap (complements ADR-okf-027 size-normalized
   fusion) — but see the dedup-vs-fusion conflict in §9.

**Wiring requirement (the load-bearing cross-component change):** the reranker
must receive per-chunk `graph_name`/`repo_id`/`trust_tier`/`stale_after`/
`cloned_from` alongside text+embedding. Story 1.0 materializes only
`graph_name`/`repo_id`/`concept_id`; `trust_tier`/`stale_after` are denormalized
on the chunk but their handoff into the reranker is **new**, and `cloned_from`
is a new field. Extend the retriever→reranker handoff with a metadata-parallel
list (same pattern as `chunk_embeddings`).

> **Boundary rule (unchanged):** the selector operates **only** on the
> authorized, ACL-filtered, fused candidate set. It re-ranks *within* the set; it
> never re-introduces excluded chunks and never overrides `chunk_labels`
> enforcement. ACL ≠ selection (ADR-okf-024, applied at chunk level). ACL is
> enforced at retrieval pre-fusion, so this invariant holds regardless of
> whether the handoff widens.

### Phase D — Eval, tuning, gates (extend the existing harness)

- **Extend `calibrate.py`**: add γ/ε/ρ/o/α to the offline replay grid (it already
  replays `(factor, confusion-formula, threshold)` over logged breakdowns). Add
  the article's **noise** metric (`# irrelevant included / # selected`) to
  `metrics.py` alongside precision/recall.
- **Extend Story 8.1 fixtures** with multi-graph selector scenarios:
  - a **cloned repo pair** (same concepts, two repos) for cross-graph dedup,
  - a **stale repo** and an **unverified repo** (trust/staleness signals),
  - a **cross-domain query** and a **no-domain-match query** (Phase A Layers 1–2),
  - a **retrieve-nothing-is-correct** query (selector must return `[]` → abstention).
- **CI gates** (mirroring the Graph Router's ≤20ms gate):
  - *Correctness:* on seed fixtures, the adaptive selector meets a
    `recall_at_precision` floor, beating `slice` on the held-out gold set.
  - *Latency:* selector adds ≤ a budgeted ms on top of rerank.
  - *Determinism:* same input → same selection (needed for Story 5.1's
    deterministic cursor).
- **Tuning is an activity, not a one-off**: offline sweep → validate winner live
  (the `calibrate.py` procedure); extend Story 8.4's sweep scope from "RRF
  weights" to "RRF weights + utility-cost params." The article's 30-query eval is
  small; our seed fixtures + held-out split is the guard.

## 6. Synergies worth exploiting

- **Abstention.** Empty selection (all `V_i ≤ 0`) aligns with
  `CHATQNA_ENFORCE_ABSTENTION`: when nothing is worth including, abstain rather
  than fabricate. Wire the empty-selection signal into the chat flow deliberately.
- **Two halves of one answer, correctly ordered.** Router = "which graphs"
  (recall-critical, coarse, ≤20ms); selector = "which chunks" (precision-critical,
  fine). Keeping them separate preserves the ADR-okf-024 "authorization ≠
  selection" boundary. **Improving the router raises the ceiling; improving the
  selector reduces noise within it** — the strategy now sequences them in that
  order.
- **The eval harness is already seeded for this** (Story 8.1–8.4). This strategy
  extends it rather than adding new infrastructure.

## 7. Config surface (env, additive; defaults preserve current behavior)

```
# Phase B — article formulation (default: legacy / unchanged behavior)
UTILITY_FORMULA=legacy                     # legacy | article
UTILITY_QUERY_COMPLEMENTARITY_GAMMA=1.0    # γ (proposed starting value — tune via calibrate.py)
UTILITY_REDUNDANCY_STRICTNESS_EPSILON=1.0  # ε
UTILITY_DILUTION_RELATIVE_RHO=1.0          # ρ
UTILITY_DILUTION_STRUCTURE_O=1.0           # o
UTILITY_PROCESSING_ALPHA=0.0025            # α — aliases CONTEXT_DECAY_FACTOR (live value, NOT the article's)

# Phase C — multi-graph extensions (default: neutral/off → article behavior unchanged)
OKF_UTILITY_CROSS_GRAPH_DEDUP=false        # opt-in (clone lineage + cos≥0.95 dedup)
OKF_UTILITY_TRUST_WEIGHT=0.0               # 0=off; >0 adds trust premium to U
OKF_UTILITY_STALE_PENALTY=0.0              # 0=off; >0 scales C_dilution for stale chunks
RERANKER_MAX_CONTEXT_TOKENS=0              # 0=unbounded; greedy hard stop when set
OKF_PER_GRAPH_TOKEN_SHARE=0.0              # 0=off; max fraction of context from one graph
```

> Corrected from v1: `OKF_UTILITY_CROSS_GRAPH_DEDUP` now defaults **false** (v1
> said `true`, contradicting the "neutral/off" header and the soft-trust posture),
> and `UTILITY_PROCESSING_ALPHA` is the live `0.0025`, not an invented `0.0001`.

## 8. Story mapping into OKF epics

This touches two query-side Python components (ChatQnA router + reranker) and the
eval harness. **Note:** the reranker has **no owning epic** today (Epic 1 is
"Unified Multi-Graph Grounding" — retriever/ChatQnA/router only), so the chunk
port does not belong under Epic 1's number.

| Story (proposed) | Scope | Depends on | Gated by |
|---|---|---|---|
| **Story 1.3 amendment — graph-level utility-cost router** (Phase A) | Amends the *unbuilt* Story 1.3 algorithm: three-layer query→graph selection (§5 Phase A). Updates ADR-okf-024. | Story 1.0 (provenance `repo_id`/`concept_id` for the fingerprint), Story 2.9.2 (first-class `okf_concepts_meta` fields for BM25), Story 4.8 (`cloned_from` lineage) | OPEA 1.5 bump (ChatQnA/retriever fan-out) |
| **Story R1 — reranker utility-cost refinement** (Phase B, *own home*) | `UTILITY_FORMULA=article` + knobs + extended `rag.adaptive_breakdown`. Pure `adaptive_context_selection` rewrite over already-delivered inputs. | — | **Ungated** (runs on the current base today) |
| **Story R2 — multi-graph chunk-level selection signals** (Phase C, *own home*) | Cross-graph dedup + trust/staleness weights + token-budget stop + the retriever→reranker metadata handoff + new `cloned_from_repo_id` field on `_SOURCE`. | Story 1.0, Story 1.5 (cross-graph RRF), Story 2.6 (trust/staleness denorm), Story 4.8 (clone), new additive `cloned_from` field | OPEA 1.5 bump (provenance + fan-out) |
| **Story 8.6 — context-selection eval + param sweep extension** (Phase D) | Extend `metrics.py` (noise), `calibrate.py` (γ/ε/ρ/o/α replay), Story 8.1 fixtures (clone/stale/unverified/cross-domain/empty), recall@floor + latency + determinism gates. | Story 8.1–8.4 | Ungated (harness); live validation gated with R1/R2 |

> Corrected from v1: the chunk port is split into **R1 (ungated)** and **R2
> (gated)**, rather than one bump-gated "Story 1.7"; the dependency list now
> includes Story 2.6 (trust/staleness) and Story 4.8 (clone lineage) that v1
> omitted, and drops Story 2.6a (ACL-preserve) which gates the *retriever's*
> filter, not the selector's math.

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Router error is the ceiling** (relevant graph never selected → unrecoverable downstream) | This is *why* Phase A is primary. The chunk selector cannot fix a router miss; only graph-level selection addresses it. |
| **Overfitting to a small gold set** (article's own caveat: 30 queries) | Held-out split + `recall_at_precision` floor + live validation of the winner; seed fixtures are larger and CI-driven. |
| **Reranker ceiling** — bad reranker scores propagate to selection (article caveat 7) | Keep the selector transparent (breakdown span); document that selection can't fix retrieval. |
| **Cross-graph dedup vs. size-normalized fusion** — dedup's hard trust/staleness tiebreak can silently undo ADR-okf-027's small-repo up-weighting | Dedup must **respect fusion order** (drop only the later-fused duplicate, never reverse a fusion surfacing); make the trust/staleness tiebreak a **reweight, not a drop**; add an eval scenario proving a clone's distinct content survives. |
| **Trust/staleness gating becomes de-facto access control** (conflicts with ADR-okf-026 D12 advisory) | Keep all trust/staleness effects soft (weights, not filters); hard-filter mode stays a documented future option. |
| **`cloned_from` dedup hides legitimately distinct content** | Dedup only on near-identical embeddings **and** `cloned_from` lineage; threshold knob; eval scenario proves distinct content survives. |
| **Token-budget stop truncates the best answer** | Budget applies after value ordering (never drops a `V_i > 0` before a `V_j ≤ 0`); configurable (NFR-PR2). |
| **Selector latency regression** | Pure arithmetic + cosine on ≤ candidate set; CI latency gate. |
| **Behavior change for existing `adaptive` users** | `UTILITY_FORMULA=legacy` default; new behavior opt-in. |

## 10. Sequencing & gates

1. **Now (ungated):** extend the eval harness + fixtures (Story 8.6 pieces that
   don't need the bump); capture the anchor baseline report; land **Story R1**
   (chunk-level article port, `legacy` default) on the current base.
2. **Post-bump (with Epic 1):** **Story 1.3 amendment** (graph-level utility-cost
   router — the primary deliverable) → **Story R2** (multi-graph chunk signals +
   the metadata handoff + new `cloned_from` field).
3. **Launch gates** (mirroring LG-1/LG-2):
   - *LG-router:* graph selection returns the correct repo subset on seed fixtures
     (incl. cross-domain, no-match, and the constant-`GRAPH` inclusion), ≤20ms.
   - *LG-selection:* `article` beats `slice` on held-out recall-at-precision-floor;
     latency ≤ budget; determinism.

## 11. Open questions (remaining)

1. **Where does the per-response token cap (NFR-PR2) live end-to-end?** Today it's
   split across chatqna history truncation and OKF `get` slicing. Should the
   selector own it for the retrieval leg (OKF + free-form), and do the non-reranker
   Epic 5 paths (`get`/`list`/`outline`/`neighbors`) need their own token
   governance?
2. **Should `UTILITY_FORMULA=article` become the OKF-serving default (Epic 5
   `search`) while `legacy` stays for free-form chat**, or one formula everywhere?
3. **Does the reranker metadata handoff need a protocol change** (like ADR-okf-023's
   `graph_names` boundary probe) or is a metadata-parallel list sufficient?
4. **`cloned_from_repo_id` on `_SOURCE`** (additive field at ingest) vs. a
   control-plane repo_id→lineage lookup at selection time — which is cheaper/safer?
5. **Graph-level complementarity fingerprint**: is `concept_id`/`content_hash`
   overlap over `okf_concepts_meta` a good enough cross-repo redundancy signal, or
   does it need per-concept embedding centroids (the deferred ADR-okf-024 v2 path)?