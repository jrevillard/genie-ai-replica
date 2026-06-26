---
status: done
branch: feat/contextual-retrieval
date: 2026-06-26
baseline_commit: 6ca517c77
commit: 394ebd29a
depends_on: spec-contextual-retrieval.md (Part A — done)
---

# Hybrid Retrieval — BM25 + RRF Fusion (Contextual Retrieval Part B)

## Intent

<!-- What is broken or missing, and why it matters. Then the high-level approach — the "what", not the "how". -->

**Problem:** The retriever is **dense-only** today — `COSINE_SIMILARITY`/`L2_DISTANCE` over the `embedding` field plus graph traversal, with no lexical channel. Exact-match, rare-term, and keyword-heavy queries that dense embeddings rank poorly are missed entirely. Part A now writes a contextualized `text` field on every chunk; Part B exploits that field with a lexical channel fused into retrieval.

**Approach:** Add an opt-in **ArangoSearch (BM25) channel** over `<GRAPH>_SOURCE.text`, fetch an **independent** candidate set, and fuse it with the dense results via weighted **Reciprocal Rank Fusion (RRF)** in Python. Both channels read the same `text` field; fusion emits the same `[{"doc", "score"}]` shape so the existing file-id enrichment, neighborhood traversal, and response contract are untouched. Default OFF = true no-op.

## Boundaries & Constraints

<!-- Three tiers: Always = invariant rules. Ask First = human-gated decisions. Never = out of scope + forbidden approaches. -->

**Always:**

- Hybrid is opt-in via `RETRIEVER_HYBRID_RETRIEVAL_ENABLED` (default `0`/`false`). The **disabled path MUST be byte-for-byte the existing dense-only flow** (true no-op — no view calls, no extra AQL).
- RRF fusion is a **pure function** `rrf_fuse(dense, bm25, k, dense_weight, lexical_weight)` — no I/O, no side effects, unit-testable in isolation.
- BM25 candidates MUST apply the **same label filter** as the dense path (`chunk_labels` semantics, OR/AND via `aql_filter_clause`) so category scoping is not violated (cf. [[project_el-salvador-retriever-label-filter-bug]]).
- ArangoSearch view creation is **idempotent** (`has_view` → `create_arangosearch_view`) and **lazy per `graph_name`** (graph_name is per-request) with an in-memory `_ensured` set cache so only the first call per graph hits ArangoDB.
- Fuse by chunk identity: `doc.id` (`_key`). A doc present in both channels gets **both** rank contributions; a doc in one channel gets that one.
- Fused result truncated to `top_k` **before** downstream enrichment.
- All env vars prefixed `RETRIEVER_HYBRID_*`, read in `retriever/config.py` with the existing `os.getenv` pattern (bools via `.lower() == "true"`), documented in `env`.

**Ask First:**

- If `create_arangosearch_view` fails at runtime on the target ArangoDB 3.12+ (API/feature gap), **HALT and surface** before falling back to an in-memory `rank_bm25` approach.
- Any change to the reranker score/confidence path **downstream** of retrieval.

**Never:**

- Do NOT modify dataprep, reranker, or chatqna — Part B is **retriever-only**.
- Do NOT change the dense-only default behavior or the `invoke` response contract (return type/element shapes).
- Do NOT add a persistent dependency; BM25 must use ArangoDB's **native ArangoSearch** view (no `rank_bm25` unless an Ask-First fallback is agreed).
- Do NOT create indexes on the `embedding` field — vectors stay brute-force.
- Do NOT run BM25 when `search_start != "chunk"` — lexical search targets `<GRAPH>_SOURCE.text`; node/edge starts stay dense-only.

## I/O & Edge-Case Matrix

<!-- If no meaningful I/O scenarios exist, DELETE THIS ENTIRE SECTION. Do not write "N/A" or "None". -->

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Hybrid OFF (default) | `RETRIEVER_HYBRID_RETRIEVAL_ENABLED=0`, any query | Identical to current dense-only retrieval | N/A |
| Hybrid ON, both channels | `=1`, query matches dense + lexical docs | `search_res` = RRF-fused top_k; a doc in both ranks above either channel alone at equal base rank | N/A |
| Hybrid ON, BM25-only match | `=1`, keyword dense misses but BM25 hits | BM25-only doc included via its single rank contribution | 0 BM25 hits → fused = dense |
| Hybrid ON, dense-only match | `=1`, BM25 finds nothing | Fused = dense (BM25 contributes nothing) | N/A |
| Hybrid ON, graph view missing | First hybrid call for a graph_name | View created idempotently, then search proceeds | create fails → log + return dense-only for that request, do NOT raise to caller |
| Hybrid ON, repeated calls | 2nd+ hybrid call, same graph_name | No `create_arangosearch_view` round-trip (cache hit) | N/A |
| Label filter + hybrid | `=1` + categoryLabel/serviceLabels | BM25 candidates filtered by same `chunk_labels` semantics as dense | N/A |
| search_start = node/edge + hybrid | `=1`, non-chunk start | BM25 skipped; dense-only (scope guard) | N/A |

</frozen-after-approval>

## Code Map

- **`genie-ai-overlay/retriever/config.py`** — add `RETRIEVER_HYBRID_*` reads, mirroring the existing `ARANGO_*` block:
  - `HYBRID_RETRIEVAL_ENABLED` (bool, default `false`)
  - `HYBRID_RRF_K` (int, default `60`)
  - `HYBRID_BM25_CANDIDATES` (int, default `50`)
  - `HYBRID_DENSE_WEIGHT` (float, default `1.0`)
  - `HYBRID_LEXICAL_WEIGHT` (float, default `1.0`)
  - `HYBRID_BM25_ANALYZER` (str, default `text_en`)
- **`genie-ai-overlay/retriever/genieai_retriever_arangodb.py`**:
  - `_initialize_client` (`:170`) — after `create_database`, ensure BM25 view for the default `ARANGO_GRAPH_NAME` (mirrors `has_database`/`create_database` idiom).
  - `invoke` (`:528`) — **hook point: after dense `search_res` is built and non-empty (`~:795`), before file-id enrichment (`:798`)**. If hybrid enabled and `search_start == "chunk"` and `search_res`: fetch BM25 candidates, fuse via `rrf_fuse`, truncate to `top_k`, assign back to `search_res`. Guarded so OFF-path runs zero extra code.
  - New **pure module function** `rrf_fuse(dense, bm25, k, dense_weight, lexical_weight) -> list[{"doc","score"}]`.
  - New method `_bm25_search(self, query, graph_name, n, aql_filter_clause) -> list[{"doc","score"}]` — AQL `SEARCH`+`BM25(doc)` over view, returns same shape as dense, matched by `doc.id`.
  - New method `_ensure_bm25_view(self, graph_name)` — idempotent `has_view`→`create_arangosearch_view`; cache in `self._bm25_views_ensured: set[str]` (init in `__init__`).
- **`env`** — new commented `RETRIEVER_HYBRID_*` block referencing this spec.

## Tasks & Acceptance

**Execution:**

1. `config.py` — add the six env reads.
2. Add `rrf_fuse` pure function (module-level).
3. Add `_bm25_search` + `_ensure_bm25_view` methods.
4. Wire fusion into `invoke` behind the flag (true no-op when off).
5. `env` documentation block.
6. pytest: `rrf_fuse` unit tests (pure) + `_bm25_search`/`_ensure_bm25_view`/`invoke` hybrid tests (mock `db.aql.execute`, `db.has_view`, `db.create_arangosearch_view` via the conftest MagicMock pattern).
7. `npm run lint:py` + `npm run format:py`.

**Acceptance Criteria (Given/When/Then):**

- **AC1 — OFF is a no-op.** Given `HYBRID_RETRIEVAL_ENABLED=false`, When `invoke` runs, Then the dense path executes and `create_arangosearch_view`/`has_view` are **never** called and no BM25 AQL executes.
- **AC2 — both-channel fusion.** Given hybrid ON, When a query matches both channels, Then fused `search_res` is truncated to `top_k` and a doc in both channels ranks above a doc in only one channel (at equal base rank).
- **AC3 — RRF formula (pure fn).** Given `rrf_fuse(dense=[{"id":"a","score":..}], bm25=[{"id":"a","score":..}], k=60, dw=1, lw=1)`, Then doc "a" score == `1/(60+1) + 1/(60+1)`; given `bm25=[]`, then "a" score == `1/(60+1)`.
- **AC4 — label filter preserved.** Given hybrid ON + `categoryLabel`, When `_bm25_search` returns cross-category chunks, Then they are filtered out before fusion (same OR/AND `chunk_labels` semantics as dense).
- **AC5 — idempotent lazy view.** Given the first hybrid call for a graph_name, When the view is missing, Then `create_arangosearch_view` is called exactly once; on the 2nd call for the same graph it is **not** called.
- **AC6 — graceful degradation.** Given `create_arangosearch_view` (or BM25 AQL) raises, When hybrid ON, Then `invoke` logs the error and returns the dense-only result (no exception propagates to the caller).
- **AC7 — scope guard.** Given hybrid ON + `search_start` ∈ {`node`, `edge`}, Then BM25 is skipped and behavior is dense-only.
- **AC8 — green + clean.** All OPEA pytest pass; `npm run lint:py` reports no errors.

## Spec Change Log

<!-- step-04 only — append-only. -->

### 2026-06-26 — post-review fixes (3 subagent reviews: blind hunter, edge-case hunter, acceptance auditor)

Driven by review findings (verbatim findings in `_bmad-output/implementation-artifacts/review/findings-{1,2,3}-*.md`). The frozen Intent/Boundaries/I/O-Matrix are unchanged; these are implementation refinements within the approved boundaries.

**Patches applied:**

- **rrf_fuse hardened** — added `_normalize_chunk_id(doc)` (strips `COLLECTION/_key` → `_key`, returns `None` if absent); `rrf_fuse` now (a) matches both channels on the normalized key, (b) de-duplicates within a channel (best rank kept), (c) keeps an unkeyable doc as a standalone entry instead of dropping or mis-merging it. Dense `.id` verified = bare `_key` (`langchain-arangodb` `arangodb_vector.py` sets `Document(id=_key)`), so both channels already align — this is defensive hardening. (findings-1 #2, findings-2 #2, findings-1 #7)
- **`_ensure_bm25_view` is now best-effort + cache-on-success** — it no longer raises (was contradicting its own "never raises" docstring and the `_bm25_search` contract); it caches a graph_name only on success, so a transient/ArangoDB-API failure is retried on the next request instead of permanently disabling the BM25 channel. (findings-1 #3, findings-2 #3)
- **Hybrid hook moved before the empty-check** — so a BM25 hit rescues a dense-empty result (the signature use-case for a lexical channel). OFF-path remains a true no-op. (findings-1 #2) — this **supersedes** the Design Note that said dense-empty is not recovered in v1.
- **BM25 metadata cleanup** — dropped the redundant `file_id` from the BM25 `Document.metadata` and the view link fields; the file id is resolved uniformly (dense + BM25) by the existing per-chunk enrichment AQL downstream, so the metadata shape stays consistent. (findings-2 #5)

**Deferred (documented, not done in v1):**

- **Pre-limit label filter** (findings-2 #5) — pushing `aql_filter_clause` into the BM25 AQL before `LIMIT` (preserves in-category recall when cross-category docs dominate the top-N) is deferred: it cannot be validated without a live ArangoDB and a syntax error would silently disable the channel. v1 applies the label filter post-fetch in Python (`_chunk_passes_label_filter`, same OR/AND semantics); compensated by `HYBRID_BM25_CANDIDATES=50`. Follow-up under real ArangoDB.

**Rejected (not defects):**

- **AQL injection via `graph_name`** (findings-1 #1, findings-2 #4) — `graph_name` is interpolated into the view/AQL via f-string, but this matches the pre-existing, codebase-wide pattern (`fetch_neighborhoods`, `_build_subquery`, the file-id enrichment AQL all f-string `graph_name`/`collection_name`). It is a server-internal value from `ARANGO_GRAPH_NAME` config or the validated request field, not raw user input. Not a regression; hardening it is a codebase-wide change, out of Part B scope.
- **`Document(id=...)` kwarg version concern** (findings-1 #9) — `langchain-core` is pinned `>=0.3` and `Document.id` is supported; verified.
- **MMR `score_map.get(id(doc))` collision** (findings-2 #8) — pre-existing in the MMR branch, not touched by this diff.


## Design Notes

- **Analyzer:** view indexes `text` with `text_en` (configurable via `HYBRID_BM25_ANALYZER`). Multilingual (ES, etc.) Latin-script chunks still match adequately; per-language analyzers deferred.
- **RRF default k=60** (literature standard). Weights default 1.0/1.0 — tunable for recall/precision.
- **Candidate count:** BM25 fetches `max(top_k, HYBRID_BM25_CANDIDATES)`.
- **Score semantics:** the fused RRF score is rank-based and not comparable to raw cosine — but the reranker re-scores on its own rubric downstream, so no contract break.
- **Hook scope:** fusion runs only when dense `search_res` is already non-empty (`:791` short-circuits on empty dense). "Dense threw but BM25 would have worked" is therefore NOT recovered in v1 (acceptable — dense failure is an embedding-infra failure; document, do not over-engineer).
- **First server-side index in the codebase** (vectors stay brute-force today). Idempotent + lazy per-graph → safe to merge with no behavior change while OFF.
- **Conflict resolution:** the deep-research report dismissed RRF claiming ArangoDB native hybrid already exists — that premise is **false for this codebase** (verified: no BM25/view/index anywhere). RRF is applicable; this spec proceeds.
