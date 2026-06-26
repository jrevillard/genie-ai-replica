⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set and takes precedence over your claude.ai login · Unset it to load your organization's connectors
Edge-case hunt done. Diff + config + retriever + conftest read. No specs. Findings below.

## Summary

| # | Item | Verdict | Severity |
|---|------|---------|----------|
| 1 | HYBRID OFF no-op | NOT bug | nit |
| 2 | doc.id dense vs BM25 mismatch | **REAL bug** | **HIGH** |
| 3 | process-local view-ensure set | partial bug | MEDIUM |
| 4 | AQL TOKENS/inject/LIMIT | query safe (graph_name pre-existing) | LOW |
| 5 | Python label filter vs dense | quality asymmetry | MEDIUM |
| 6 | `[:int(input.k)]` edge | graceful, k<0 misbehaves | LOW |
| 7 | exception scope | NOT bug | — |
| 8 | MMR `id(doc)` vs BM25 `_key` | pre-existing, masked | LOW |

---

## #1 — HYBRID OFF = true no-op ✅ NOT bug (nit)

`genieai_retriever_arangodb.py:17` — `from langchain_core.documents import Document` **unconditional** at module top. Runs even when OFF. Harmless: `langchain_core` already transitive dep of `langchain_openai`/`langchain_huggingface` (imported lines 18-19). No fail path.

- `__init__:148` — `self._bm25_views_ensured = set()` always alloc. Trivial.
- `_initialize_client:244` — view block guarded `if HYBRID_RETRIEVAL_ENABLED`. Skip.
- `invoke:956` — fusion block guarded. Skip.

True no-op. Module-level fns `_chunk_passes_label_filter`/`rrf_fuse` def-only, no side effects.

---

## #2 — doc.id identity: dense vs BM25 NOT comparable 🔴 REAL bug, HIGH

`rrf_fuse:124,127` — fusion key = `item["doc"].id`. Assumes both channels share key space.

**BM25** hardcodes bare `_key`: `_bm25_search:323` → `Document(id=row.get("key"))`, `row["key"]=doc._key`.

**Dense** `.id` format **unverified** — in-file contradiction proves author unsure:
- `:978` — `chunk_id = r["doc"].id` → `FILTER doc._key == @chunk_id` → **assumes bare `_key`**
- `:1105-1107` — `chunk_key = r["doc"].id; if "/" in str(chunk_key): chunk_key = rsplit("/",1)[-1]` → **defends `COLLECTION/key` form**

**Trigger:** if `langchain_arangodb.ArangoVector` sets `.id` to Arango `_id` (`GRAPH_SOURCE/abc`) or leaves langchain default (UUID4), dense ids ≠ BM25 bare `_key`.
**Impact:** rrf_fuse never matches identities → chunk in both channels counted twice (2 entries, near-dup text) → cross-channel reinforcement (the entire point of RRF) lost. Worst case (UUID): zero reinforcement ever.
**id=None sub-case:** BM25 `row.get("key")` None if `_key` absent → multiple None-id docs collapse into one `scores[None]` entry (`setdefault:125/129` keeps first doc, scores accumulate) → data loss.
**Fix:** normalize both channels to bare `_key` (strip `COLLECTION/` prefix per :1106 pattern) inside `rrf_fuse` or before; guard `id is None`. Verify actual langchain ArangoVector `.id` assignment first.
**Severity HIGH** — silent quality regression, no crash.

---

## #3 — `_bm25_views_ensured` process-local set ⚠️ MEDIUM

`:148` per-instance → per-process. Each uvicorn worker = own singleton.

**Race (benign):** multi-worker cold start → concurrent `create_arangosearch_view` → loser gets HTTP 409 → caught `:281` → logged+raised → caller `_initialize_client:247` logs only. View exists (winner made it) → next `_bm25_search` works. Single-process: async, no `await` in `_ensure_bm25_view` → no interleaving. Race itself OK.

**Real footgun:** `finally: self._bm25_views_ensured.add(graph_name)` `:287` marks ensured **even on failure** (misconfigured `HYBRID_BM25_ANALYZER`, permission, bad link) → never retries → all subsequent BM25 queries hit broken/missing view → fail `:332` → silent `[]` → hybrid permanently dead, only error log at startup. No recovery without restart.
**Fix:** add to set only on success; or distinguish "exists" vs "create-failed" states. Severity MEDIUM (operational, silent feature death).

---

## #4 — ArangoSearch AQL 🟢 query safe; graph_name pre-existing

`@query` bind var `:314` → **NOT injectable**. ✅
`@analyzer`, `@n` bind vars in `TOKENS`/`ANALYZER`/`LIMIT` → if ArangoDB rejects bind var there → execute error → caught `:332` → `[]`. No crash.

**graph_name f-string** `:301` `{view_name}`=`{graph_name}_BM25_VIEW` interpolated direct = injection vector. **BUT pre-existing pattern** — `fetch_neighborhoods:581` `{graph_name}_HAS_SOURCE`, `_build_subquery` throughout. Not a regression. Same trust boundary as rest of codebase. LOW.

- null `text`: `row.get("text") or ""` `:325` handles. BM25 over null text = 0. Fine.
- `LIMIT @n` 0 → empty (valid); negative → AQL execute error → caught. Graceful.
- `BM25(doc)` `:303` no field arg → verify scores meaningful vs view link config (text_en on `text`). Not crash, possible weak scoring. Verify.

---

## #5 — Python label filter vs dense AQL ⚠️ MEDIUM (quality asymmetry)

Semantics MATCH for valid strategies:
- AND: Python `all(...)` `:99` ↔ AQL `ALL IN` `:747`
- OR: Python `any(...)` `:100` ↔ AQL `ANY IN` `:752`

**Divergence (unreachable):** invalid strategy → Python falls back OR (`:100` return), dense raises HTTPException 400 (`:755`). Can't reach (filter_strategy `.upper()` + validated upstream). Nit.

**Real asymmetry:** dense filters **before** limit → k results all qualifying. BM25 filters **after** limit `:321` over `bm25_n=max(k,50)` candidates → selective label filter on large corpus can starve BM25 contribution (qualifying docs deeper than rank 50 never surface). RRF uses **pre-filter rank** → dropped non-qualifying docs inflate survivors' rank numbers → weaker RRF contribution than earned.
**Fix:** push label filter into AQL SEARCH/FILTER (pre-limit) like dense, OR re-rank after filter before fusion. Severity MEDIUM (fusion quality, not crash).

---

## #6 — `[:int(input.k)]` 🟢 LOW (graceful)

`:958` `bm25_n = max(int(input.k), HYBRID_BM25_CANDIDATES)`; `:967` `rrf_fuse(...)[: int(input.k)]`.

- `k=None` → `int(None)` TypeError at `:958` → caught outer except `:969` → dense fallback (misleading log msg). No crash.
- `k=0` → block guarded `and search_res` (`:956`); dense returned 0 → skip. Consistent.
- `k<0` → `bm25_n=max(neg,50)=50` OK; `[:neg]` = Python negative slice → **silently drops tail results**. Caller error but silent.
**Fix:** clamp `max(int(input.k or 0), 0)`. LOW.

---

## #7 — exception scope ✅ NOT bug

`:957-971` try wraps int+bm25_search+rrf_fuse+slice+log.
- `rrf_fuse` builds NEW dict (`scores={}`), assigns atomically `:967` → raise mid-fuse keeps dense `search_res`.
- `_bm25_search` never raises (internal catch `:332`, returns `[]`).
- Outer except `:969` → dense-only fallback. Correct graceful degradation.
Solid. No finding.

---

## #8 — MMR `id(doc)` vs BM25 `_key` 🟢 pre-existing, masked

`:927` `score_map = {id(doc): score ...}` keys on **Python object id (memory addr)** across TWO separate ArangoVector calls (`amax_marginal_relevance_search:910` + `asimilarity_search_with_relevance_scores:920`) → independent cursors → different Document instances → `score_map.get(id(doc),0.0)` `:928` **always misses** → all MMR results score 0.0.

**Pre-existing** (lines 919-928 not in this diff). **Not** collision w/ BM25: rrf_fuse keys on `doc.id` field `:124`, not `id(doc)`; MMR score_map local to MMR branch, consumed `:928`, never reaches fusion; rrf_fuse **ignores input scores** (rank-only) → MMR 0.0 bug **masked**, not propagated. Dense `.id` mismatch (#2) still applies to MMR docs feeding fusion.
Severity LOW for this diff (pre-existing MEDIUM). Worth separate fix ticket.

---

## Headline

**#2 is the ship-blocker.** Verify `langchain_arangodb.ArangoVector` Document.id assignment. If not bare `_key`, fusion is silently broken. Normalize identity (strip `COLLECTION/` prefix) in both channels before `rrf_fuse`. #3 (analyzer-misconfig poisons cache) + #5 (post-limit BM25 filter) are real quality issues. Rest nits/pre-existing.
