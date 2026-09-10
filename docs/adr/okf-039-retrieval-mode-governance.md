# ADR okf-039: Retrieval mode governance — legacy / OKF-only / hybrid, with the option-(d) tiered fan-out

- **Status**: Proposed (David Forden directive, 2026-09-10)
- **Date**: 2026-09-10
- **Decision owners**: David Forden (steward directive), Genie.ai Dev
- **Companion**: [utility-cost-context-selection-strategy-2026-08-18](../../_bmad-output/planning-artifacts/utility-cost-context-selection-strategy-2026-08-18.md) (strategy v2)

## Context

The OKF multi-graph grounding work (Epic 1: fan-out + RRF, Graph Router, Authz
Resolver) is fully specified but **unbuilt** — it lands on the OPEA 1.5 bump.
Meanwhile live OKF repositories **are already ingesting and serving** their own
graphs (`OKF_<slug>_vN`, ADR-okf-030 lifecycle; the Alphabet bundle proved the
whole born-right path end-to-end 2026-09-01). Deployments therefore face a
coexistence problem the current specs do not address:

1. **The legacy retriever must run unchanged until the operator says otherwise.**
   The free-form `GRAPH` corpus is the production chat path today; Epic 1 must
   not change its behavior merely by merging.
2. **Fan-out must not engage until there is something to fan out to.** A
   deployment with zero ingested OKF repositories must not pay — or risk — any
   fan-out code path.
3. **When both legacy ingestions and serving OKF graphs exist**, the operator
   — not the code — decides how retrieval combines them.

The substrate (verified live 2026-09-10 on the Alphabet serving graph
`OKF_alphabet-company-information-llm_v1`): each OKF graph already carries the
**curated concept spine** — one concept-root `ENTITY` vertex per concept
(`safeKey('c', concept_id)`, 17 roots) joined by **author-stated `_LINKS_TO`
edges** (`source='author'`, 52 edges, ADR-okf-035 `writeRepoAuthorLinks`) —
alongside dataprep's entity-extraction graph (479 entity vertices, 816
extracted `LINKS_TO`, 1,154 `HAS_SOURCE`, 108 `SOURCE` chunks with
`concept_id`/`chunk_labels`/embeddings). The retriever
(`genieai_retriever_arangodb.py`) today takes a single `graph_name` (dense
COSINE + lazy BM25 view + optional traversal, `rrf_fuse` fusion) — the legacy
path Story 1.1 extends.

## Decision

**Introduce an operator-owned retrieval mode (`legacy | okf_only | hybrid`,
default `legacy`) enforced at the ChatQnA→retriever boundary, plus a tiered
option-(d) fan-out inside each OKF graph and a utility-cost gate at the union
layer.** Eight sub-decisions:

### D1 — The three modes (normative semantics)

| Mode | Legacy `GRAPH` corpus | OKF serving graphs | Who is served |
|---|---|---|---|
| `legacy` (default) | Served — **byte-for-byte today's path** (single `graph_name=GRAPH`, existing hybrid + rerank) | Ignored entirely | Existing behavior, zero regression risk |
| `okf_only` | Ignored entirely | Served — router-selected ∩ authorized (Story 1.3) | OKF-first deployments (e.g. a ministry serving only curated bundles) |
| `hybrid` | Served (always included — the constant baseline) | Served — router-selected ∩ authorized, fused with the legacy list (2-level RRF, ADR-okf-027) | The FR-24 unified-grounding end state |

`legacy` mode additionally **skips** the Graph Router, the Authz-Resolver graph
enumeration and the fan-out machinery entirely — no new latency, no new failure
modes on the production path.

### D2 — Engagement gate (fan-out cannot wake up on its own)

Fan-out engages **only when both** hold:

1. `mode ≠ legacy` in the effective runtime config (D3); **and**
2. at least one OKF repository is **serving** (`okf_repositories.lifecycle =
   'ingested'` with a promoted serving graph).

The serving-set check is computed by the config read itself (the same
okf-server call returns `{config, serving_graph_count, serving_repo_ids}`), so
the gate costs one cached read, not a graph scan. **Fail-safe:** selecting
`okf_only` while `serving_graph_count = 0` yields zero OKF contribution (the
LLM is told there is no grounded context — abstention-friendly per the
enforce-abstention posture) and emits a structured span warning; the admin UI
(D7) shows the live serving count next to the mode selector so an operator
cannot configure this by accident.

### D3 — Runtime configuration lives in ArangoDB, owned by okf-server

A new tiny collection **`okf_system_config`** (one doc, `_key='retrieval'`)
holds the live retrieval configuration; **env vars are only the boot default**
(compose/ansible set `OKF_RETRIEVAL_MODE`, `OKF_MAX_FANOUT_GRAPHS`, … — the
existing precedence law: defaults in code, deployment values in env, runtime
overrides in the DB). Shape:

```json
{
  "mode": "legacy",
  "max_fanout_graphs": 5,
  "spine_max_hops": 2,
  "extracted_hop_cap": 1,
  "candidate_cap_per_graph": 50,
  "candidate_cap_global": 200,
  "utility_gate": { "enabled": true },
  "label_federation": { "enabled": false, "max_labels": 8, "max_graphs": 3 },
  "updated_at": "...", "updated_by": "...", "revision": 7
}
```

- **Read path:** ChatQnA/retriever fetch `GET /api/okf/retrieval-config`
  (okf-server governance, alongside the Authz Resolver it already calls —
  ADR-okf-024 keeps selection in ChatQnA but **configuration** in okf-server
  governance) with a **≤30s TTL cache**; on fetch failure the last-known-good
  config is used; with none, the env default. The retriever never writes config.
- **Write path:** `PUT /api/okf/retrieval-config`, **admin-scoped**
  (`repo_id`-independent admin role), validated (mode enum, caps ≥1, ≤ sane
  maxima), revision-bumped, and **audited** to `okf_audit_logs`
  (actor, before→after, revision) — the same audit spine as every other
  steward action (ADR-okf-029).

### D4 — Tiered option-(d) fan-out inside each OKF graph

Per selected OKF graph the retriever runs the **existing per-graph hybrid
retrieval unchanged** (dense + BM25 over `_SOURCE`), then expands along two
explicitly-weighted tiers instead of unbounded traversal:

- **Tier 1 — curated spine (high-utility prior).** From each chunk hit, join to
  its concept root via the chunk's `concept_id` attribute against
  `safeKey('c', concept_id)` keys (**indexed join, not new edges** — the
  chunk→root association already exists as data; an edge per chunk would add
  nothing the attribute does not), then walk **`source='author'` edges ≤
  `spine_max_hops` (default 2)** and pull the neighbor concepts' chunks.
- **Tier 2 — extracted relations (bounded).** Entity-level `LINKS_TO`/
  `HAS_SOURCE` expansion ≤ `extracted_hop_cap` (default 1), capped per concept —
  measured at ~4.2 edges/entity, two-hop entity walks touch most of a graph;
  the cap is what keeps a K-graph union bounded.

Every candidate is tagged **`{graph_name, repo_id, concept_id, hop,
edge_provenance: 'vector'|'bm25'|'author'|'parser'|'label'}`** (extends Story
1.0's provenance triple). Provenance feeds the utility priors of D5.

**Ingest-side completion items (additive, drain-time, Node-side/ungated —
amended into FR-7 / ADR-okf-035):** (a) author edges must carry the **curator's
label** (anchor text / link kind) — the settle mirror currently writes
`weight`+`source` only; (b) concept-root vertices are **enriched** with
`title`/`labels` (KH) so spine walks explain themselves; (c) a **persistent
index on `SOURCE.concept_id`** is ensured at drain so the tier-1 join is O(log n)
(this index is the D4 load-bearing wall).

### D5 — Utility-cost gate at the union layer

The per-graph candidate lists merge into one pool; the pool is cut by the
article-form utility-cost selector (`V_i = U_i − C_i > 0`, greedy in rank order
— [strategy doc §5](../../_bmad-output/planning-artifacts/utility-cost-context-selection-strategy-2026-08-18.md)),
with **graph provenance as a utility prior** (curated hop-1 > vector/bm25 seed >
parser hop-1 > extracted hop-2) and **hard caps as backstops**
(`candidate_cap_global`, `candidate_cap_per_graph`, `MAX_FANOUT_GRAPHS`,
`RERANKER_MAX_CONTEXT_TOKENS`). The gate is **`utility_gate.enabled`, default
true only when mode ≠ legacy**; disabling it leaves the plain 2-level RRF +
rerank behavior (Story 1.5). Legacy mode never touches this machinery.

### D6 — KH label federation (cross-graph expansion, opt-in)

Knowledge-Hierarchy labels are a **global vocabulary on per-repo chunks**
(`chunk_labels`), so shared KH labels are the one cross-graph relevance pathway
that neither curated links (intra-repo by construction) nor entity names (not
aligned across repos) provide. When enabled, the top concepts of the seed set
contribute their KH label set (≤`max_labels`); chunks across **≤`max_graphs`**
other selected graphs carrying those labels join the pool as
`edge_provenance='label'` candidates (bounded per ADR-okf-033/034
bounded-vocabulary law). Default **off** until the eval harness (Story 8.6)
proves it on fixtures.

### D8 — Legacy path invariants (main owns the legacy code)

The legacy paths — **file-based ingestion** into the free-form `GRAPH` corpus
(document-repository → dataprep) and **single-graph legacy retrieval**
(`invoke(graph_name='GRAPH')`, the existing hybrid dense+BM25+traversal path) —
are **owned by `main`**: after the OPEA-1.5 rebase, the branch carries main's
version of every legacy-path file verbatim. Concretely:

1. `genie-ai-overlay/retriever/`, `genie-ai-overlay/chatqna/`,
   `genie-ai-overlay/reranker/` must be **byte-identical to `origin/main`**
   post-rebase (asserted: `git diff origin/main..feat/okf-server -- <paths>` is
   empty — the branch never modified them; verified 2026-09-10).
2. `genie-ai-overlay/dataprep/` may differ from main **only** by branch deltas
   that are **provably no-ops for legacy inputs** (each with its proof):
   - `repo_id` identity + born-right naming: legacy requests carry no
     `repo_id` and `graph_name='GRAPH'` (not `OKF_*`) → `_current_repo_id`
     stays null (`genieai_dataprep_arangodb.py` ingest entry, fallback
     explicitly `OKF_`-prefixed only);
   - bundle-log mirroring: guarded by `_is_concept_id(file_id)` — legacy
     file_ids are numeric timestamps → no mirror, no bundle-log writes;
   - ACL-prefix preservation (Story 2.6a): legacy files carry no
     `t:`/`r:`/`d:` file_labels → nothing to preserve;
   - `DATAPREP_INGEST_CONCURRENCY` slot pool (microservice): default `1` =
     the historical single-flight (one lock file, same 429 semantics); >1 is
     an explicit operator act and applies equally to OKF and legacy.
3. **Retrieval mode default `legacy`** (D1/D2) keeps the served query path
   byte-identical; the legacy-only configuration is a permanent first-class
   posture, not a migration state.
4. Each rebase/merge to this branch re-runs the assertions in (1) and the
   legacy-input no-op proofs in (2), plus the golden legacy parity replay
   (rebase plan §4a) before the result may be pushed.

### D7 — Admin controls in the OKF Studio tab

The **OKF Studio** admin tab gains a **"Retrieval" card** (new Epic 10 story):
mode selector (three explicit radio choices with consequence text), live
serving-graph count + the effective-config revision, cap/parameter editors
(revealed under an "Advanced" disclosure), and the config **audit trail**
(from `okf_audit_logs`). Built exclusively with the DS primitives and existing
admin-dashboard paradigms (tabs/dialogs/httpService — the zero-inconsistency
rule); every change is an audited `PUT` with before→after confirmation. The
card is operable while the system serves traffic (TTL ≤30s means live effect).

## Alternatives considered

| Alternative | Status |
|---|---|
| Env-var-only configuration (no runtime control) | Rejected — the operator must re-mode retrieval **without a redeploy** (David's directive: controls over "the live system"); env remains the boot default only. |
| Per-request mode (caller picks) | Rejected for v1 — retrieval mode is a **deployment governance** decision (ACL, latency, curation posture), not a user preference; the admin owns it, audited. |
| Graph edges chunk→concept-root instead of the indexed attribute join | Rejected — duplicates existing data (`concept_id` on every chunk), adds ~1 edge per chunk to every graph, and the indexed join is O(log n); revisit only if traversal-projection needs it. |
| Merge OKF into the legacy `GRAPH` corpus | Rejected (again) — ADR-okf-012 already rejected it; modes make the isolation *usable*, not dissolved. |
| Auto-select mode by presence of OKF graphs (no config) | Rejected — silent behavior change on ingest; the operator, not the pipeline, owns the retrieval contract (D2 makes engaging fan-out an explicit act). |

## Consequences

- **Positive**: legacy chat is provably untouched by Epic 1's merge (mode
  default `legacy` = today's path); a deployment can adopt OKF grounding
  gradually (okf_only pilots before hybrid); union-scale stays bounded by
  construction (tiers + caps + gate); every mode/param change is audited and
  takes effect live; the curated spine — the product's differentiator — becomes
  the retrieval priority signal it was built to be.
- **Negative**: a new config surface to document and secure; the ≤30s TTL means
  mode changes are near-real-time, not instantaneous; the utility gate adds a
  calibration activity (the strategy doc's harness covers it).
- **Mitigations**: fail-safe defaults everywhere (legacy; last-known-good
  config; hard caps independent of the gate); the admin card shows live serving
  state to prevent foot-gun configurations; CI gates (≤20ms selection, gate
  latency) extend to the mode machinery.

## References

PRD FR-24/FR-35 (amended 2026-09-10), new FR-44; epics.md Epic 1 (Story 1.1
amendment, new Story 1.7), Epic 10 (new Story 10.7); [ADR-okf-012](okf-012-multi-graph-grounding.md),
[ADR-okf-024](okf-024-graph-selection-router.md), [ADR-okf-025](okf-025-authz-resolver.md),
[ADR-okf-027](okf-027-cross-graph-rrf.md), [ADR-okf-035](okf-035-bundle-manifest-and-author-graph.md);
[strategy: utility-cost adaptive context selection](../../_bmad-output/planning-artifacts/utility-cost-context-selection-strategy-2026-08-18.md);
live verification: Alphabet serving graph query, 2026-09-10 (52 author edges /
17 concept roots / 816 extracted edges; `label` absent on author edges; zero
root↔chunk edges — `concept_id` attribute join only).
