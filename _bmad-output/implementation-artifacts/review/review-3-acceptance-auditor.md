# Review Prompt 3/3 — Acceptance Auditor (AC + Intent Drift)

> Run this in a **separate session**. Paste back findings.

## Role

Spec-vs-implementation acceptance audit. You check whether the diff actually satisfies the spec's Acceptance Criteria and stated Boundaries — and flag **intent gaps** (spec says X, code does Y) vs **change-log-worthy drift**.

## Inputs

- Verbatim diff: `_bmad-output/implementation-artifacts/review/part-b-code-diff.patch`
- Spec: `_bmad-output/implementation-artifacts/spec-hybrid-retrieval-bm25-rrf.md`
- Project context (read as needed).

## Your Job

### 1. Acceptance Criteria (one verdict per AC: PASS / FAIL / UNVERIFIABLE)

- **AC1** OFF is a no-op — `has_view`/`create_arangosearch_view`/BM25 AQL never called when `HYBRID_RETRIEVAL_ENABLED=false`. (Check `__init__`/import time too — must not create view when off.)
- **AC2** both-channel fusion — fused `search_res` truncated to `top_k`; doc in both ranks above doc in one.
- **AC3** RRF formula — `rrf_fuse(dense=[a], bm25=[a], k=60,1,1)` == `2/61`; `bm25=[]` == `1/61`.
- **AC4** label filter — BM25 cross-category chunks filtered before fusion (same OR/AND semantics as dense).
- **AC5** idempotent lazy view — `create_arangosearch_view` once on first call, not on 2nd (cache).
- **AC6** graceful degradation — view/AQL failure logs + returns dense-only, no exception to caller.
- **AC7** scope guard — `search_start != "chunk"` skips BM25.
- **AC8** green + clean — OPEA pytest pass; `ruff check` clean.

### 2. Boundaries check

- **Always**: opt-in flag name + default; RRF pure function (no I/O); idempotent + cached view; fuse by `doc.id`; truncate before enrichment; env prefix `RETRIEVER_HYBRID_*` + read in `config.py` + documented in `env`.
- **Never**: dataprep/reranker/chatqna touched? response contract changed? new persistent dependency? index on `embedding`? BM25 for non-chunk start?

### 3. Intent gaps (spec ↔ code drift)

List any place the code deviates from the frozen Intent/Boundaries/I/O-Matrix. Each gap → propose either a **Spec Change Log** entry (step-04 append) or a code fix. Gaps inside frozen sections → step-02 renegotiation; gaps outside → change-log is fine.

Output: a table (AC | verdict | evidence file:line), then the boundaries verdict, then intent-gap list.
