⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set and takes precedence over your claude.ai login · Unset it to load your organization's connectors
Static analysis complete. AC8 execution permission-blocked (pytest/ruff not run) — flagged honestly. Delivering audit.

---

# Acceptance Audit — Hybrid Retrieval (BM25 + RRF, Part B)

**Sources:** `part-b-code-diff.patch`, `spec-hybrid-retrieval-bm25-rrf.md`, repo files `retriever/config.py`, `retriever/genieai_retriever_arangodb.py`, `tests/test_retriever.py`.

## AC Table

| AC | Verdict | Evidence |
|----|---------|----------|
| **AC1 — OFF no-op (incl `__init__`/import)** | ✅ PASS | `config.py:37` default `"false"`; `invoke` block guarded `HYBRID_RETRIEVAL_ENABLED and search_start=="chunk" and search_res` (`:956`) → skipped OFF. Init view-ensure guarded `if HYBRID_RETRIEVAL_ENABLED` (`:244`). `__init__` adds only `self._bm25_views_ensured=set()` (`:148`) — no I/O. New `Document` import harmless. Test `test_off_is_no_op` (`:817`) patches flag False → `_bm25_search.assert_not_called()`. |
| **AC2 — both-channel fusion, truncate top_k** | ✅ PASS (1 minor) | `invoke:956-968`: `rrf_fuse(search_res, bm25_res)[: int(input.k)]`. Fuse sums both contributions. Test `test_on_fuses_bm25_doc_into_results` (`:828`) → bm25-only doc surfaces. **Gap:** no explicit `len(result) <= top_k` assertion; truncation only inferred from `[:input.k]`. |
| **AC3 — RRF formula (pure fn)** | ✅ PASS | `rrf_fuse` (`:103-131`): `enumerate(...,start=1)`, `weight/(k+rank)`. dense=[a]+bm25=[a],k=60 → `1/61+1/61`; bm25=[] → `1/61`. Tests assert exact (`:662-669`). Matches AC verbatim. |
| **AC4 — BM25 cross-category filtered pre-fusion, same OR/AND** | ✅ PASS | `_chunk_passes_label_filter` (`:87-100`): no-labels→True, null-chunk_labels→False, AND→`all`, else→`any`. Mirrors dense AQL `ANY/ALL IN doc.chunk_labels` + `chunk_labels != null`. Applied before append → pre-fusion (`:321`). Test `test_returns_result_shape_and_filters_by_label` (`:776`) → c2 Agriculture dropped, c1 Health kept. |
| **AC5 — create once then cached** | ✅ PASS | `_ensure_bm25_view` (`:250-287`): early-return if `graph_name in self._bm25_views_ensured`; `finally` adds to set either way. Tests: `test_creates_view_when_missing` (called_once), `test_skips_when_exists` (not_called), `test_cached_no_repeat_call` (has_view=1, create=1 after 2 calls) (`:728-752`). |
| **AC6 — view/AQL fail → log + dense-only, no exception** | ✅ PASS | AQL fail caught in `_bm25_search` (`:332`) → returns `[]`. View fail: `_ensure_bm25_view` re-raises (`:283`), propagates out of `_bm25_search` (ensure call is pre-try, `:297`), caught by `invoke` try/except (`:969`) → dense-only. Tests: `test_never_raises_on_db_error` (`:801`), `test_graceful_degradation_on_bm25_error` (`:840`). |
| **AC7 — `search_start != chunk` skips BM25** | ✅ PASS | Guard `search_start == "chunk"` (`:956`). Test `test_skipped_for_non_chunk_start` (`:851`) → node start → `_bm25_search.assert_not_called()`. |
| **AC8 — pytest pass + ruff clean** | ⚠️ **UNVERIFIED** | Execution permission-gated (pytest + ruff blocked by harness, not run). **Static:** test logic sound; all `HYBRID_*` imports used (no F401); isort order correct (HF_TOKEN→HYBRID_*→OPENAI, langchain_arangodb→community→core→huggingface→openai); no mutable defaults (B006); line-length ≤120; `dict[str,dict]`/`set[str]` valid py310. No obvious ruff (E/W/F/I/UP/B/SIM) violations by inspection. **Run before merge.** |

## Boundaries Verdict: ✅ PASS

**Always (7/7):** opt-in default OFF ✓; `rrf_fuse` pure (no I/O) ✓; BM25 same label semantics ✓; view idempotent + lazy per `graph_name` + cached set ✓; fuse by `doc.id` (`_key`) ✓; truncate top_k before enrichment (fusion `:956` precedes file-id loop `:976`) ✓; all vars `RETRIEVER_HYBRID_*`, bool via `.lower()=="true"`, documented in `env` ✓.

**Ask First (2/2):** view-fail path chose graceful degradation (sanctioned by I/O matrix row "graph view missing") — did **not** adopt `rank_bm25` (respects Never) ✓; no reranker/confidence change ✓.

**Never (5/5):** retriever-only (diff touches only `retriever/`, tests, `env`) ✓; dense default + invoke contract preserved ✓; native ArangoSearch, no `rank_bm25` ✓; no embedding index ✓; BM25 chunk-only ✓.

## Intent-Gap List

1. **AC2 truncation untested.** Code truncates `[:int(input.k)]` but no test asserts `len(search_res) <= top_k` post-fusion. Low risk — add assertion.
2. **BM25 label filter post-fetch, not push-down.** `_bm25_search` applies filter in Python *after* `LIMIT @n` (`:319-322`), not in AQL `SEARCH`/`FILTER`. Spec "Always" said "via `aql_filter_clause`". If cross-category docs dominate top-50 BM25, in-category candidate yield shrinks. Correctness preserved, recall potentially reduced; differs from dense (which pushes `filter_clause` into vector AQL).
3. **BM25 doc metadata shape inconsistency.** `_bm25_search` sets `metadata[ARANGO_FILE_ID_FIELD]=file_id` (single) (`:328`); enrichment later sets `metadata["file_ids"]` (list) (`:988`). BM25-only docs carry **both** keys; dense docs only `file_ids`. Downstream reads `file_ids` → no contract break, but mixed shape.
4. **Init-time view-ensure untested.** `create_retriever` mocks `_initialize_client` (`:44`) → the `if HYBRID_RETRIEVAL_ENABLED: _ensure_bm25_view(ARANGO_GRAPH_NAME)` init branch (`:244-248`) never exercised. `_ensure_bm25_view` covered by direct unit tests; integration path (real init, flag ON) not.
5. **AC1 "byte-for-byte" overstated.** OFF path adds module import + `set()` alloc + one branch test. Functionally equivalent no-op, but not literally byte-for-byte. Spec language looser than reality — acceptable.
6. **BM25 AQL bind_vars/string untested.** `test_returns_result_shape_and_filters_by_label` checks output shape + filter result, not the executed AQL or `bind_vars` (analyzer/n/query). No regression guard on query construction.

**Bottom line:** AC1-AC7 PASS on inspection. AC8 blocked at execution gate — run `pytest tests/test_retriever.py` + `ruff check retriever/ tests/` before merge (static predicts green). No boundary violations. Gaps are minor test-coverage / efficiency notes, no correctness blockers.
