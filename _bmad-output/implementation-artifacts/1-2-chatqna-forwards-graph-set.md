# Story 1.2 — ChatQnA forwards the authorized graph set (production forwarding)

**Status:** BACKLOG → acceptance criteria pinned 2026-09-21 (David, 2026-09-21
mid-R3 directive: "always fan out when >1 graph is encoded" + "flag that as a
Story 1.2 acceptance criterion"). Implementation follows Wave R5.

**Sources:** epics.md 1.2 (G7/G22 + 2026-08-13 amendments); ADR-039 D4/D5/D7/D8;
[fan-out course-correction](../planning-artifacts/okf-fanout-course-correction-2026-09-20.md)
amendments B/D/E; [retriever provenance story](1-0-retriever-provenance-materialization.md).

## Story

As a **chat caller (via ChatQnA)**,
I want **my chat query to ground across all graphs I'm authorized for — legacy
+ every authorized OKF repo, treated equally**,
So that **the answer cites concepts from the free-form corpus and the
authorized OKF repositories together, with provenance preserved end-to-end**.

## Acceptance criteria

### AC1 — Carrier shape (case B, fan-out with legacy + OKF graphs)

The chat-side carrier **MUST** carry `[GRAPH, OKF_<repo_a>_v<N_a>, OKF_<repo_b>_v<N_b>, ...]`
when ≥1 OKF graph is authorized for the caller. `GRAPH` is always present
(first element — the legacy free-form corpus) because the retriever's fan-out
engages with the FULL set; the chat-side forwarder MUST NOT omit the legacy
graph from the carrier, since the retriever treats every entry equally and
the carrier is the single source of truth (David, 2026-09-21: "the
retriever must work smoothly and consistently when we have A: the single
legacy graph only, B: fan out with the legacy graph and one or more OKF
graphs if they exist").

The carrier continues to use `core/label_contract.encode` /
`decode` (Story 1.0b). When the caller has ZERO authorized OKF graphs,
chatqna forwards `[GRAPH]` (single element) and the fan-out still engages
(case B with one leg) — by design. When the carrier is empty, chatqna
does not encode at all; the retriever falls through to the legacy
single-graph path against `ARANGO_GRAPH_NAME` (case A).

### AC2 — RAG-accuracy preservation (the inherited Contextual Retrieval contract)

The retriever's fan-out path runs the SAME per-leg extraction as the
single-graph path (Story 1.0/1.1 `invoke_fanout`):
- Vector ANN per leg
- BM25 hybrid per leg (the Contextual Retrieval Part B accuracy win must
  NOT regress)
- `source='author'` spine traversal per leg (ADR-039 D4 tier-1)
- Tier-2 extracted-relation traversal capped per leg (ADR-039 D4)

No leg-level optimization is acceptable that would sacrifice RAG accuracy
on the existing single-graph baseline. The retriever's byte-equivalent
extraction is the contract; chatqna forwards the query unchanged.

### AC3 — Per-leg provenance survives the chat pipeline (David, 2026-09-21)

The fan-out returns each hit with metadata enriched by
`attach_provenance` (Story 1.0):
- `graph_name` — the per-leg graph (`GRAPH`, `OKF_<repo>_v<N>`, ...)
- `repo_id` — populated by chatqna from `/api/okf/authz/graphs.serving_graphs[]`
  (Story 6.1b lookup table); null when not yet resolvable
- `concept_id` — chunk's `file_id` per the content-only-chunking invariant
- `chunk_key` — preserved from the legacy path (already wired)

**Chat-side acceptance**: the chat pipeline (reranker selection span, response
assembly, Studio tab card render) MUST read these new fields and propagate
them through to the response. Specifically:
- The reranker selection span (`chatqna._emit_reranker_selection_span`)
  MUST include `graph_name` + `repo_id` in the span attributes so the
  Studio card can render provenance per result.
- The response builder MUST NOT drop `graph_name` / `repo_id` /
  `concept_id` from the chunk metadata before streaming back to the
  frontend.
- The Studio card render MUST show the per-chunk provenance (graph_name +
  repo name) so the user can audit which repository each grounded fact
  came from (epics.md Story 10.7 dependencies).

A missing provenance field in the final response = AC3 failure.

### AC4 — ≤30s TTL cache aligned with the retriever serving-set cache

The chat-side resolver cache MUST use the same ≤30s TTL as the
`/api/okf/authz/graphs` endpoint (okf-server Story 6.1b) so a fan-out
graph set and the resolver's graph set never disagree for >30s. The cache
key is the caller's token (sub + azp + tenant). Cache misses invalidate
on `authz/graphs` PUT (Steward updates the caller's scopes → invalidation
needed) — a future Story 6.1b hardening, not this story.

### AC5 — Zero-hit graceful handling

When the fan-out returns zero hits (e.g. all OKF repos retracted
between resolve and traverse), chatqna MUST surface a structured
abstention message (not a 500, not a silent empty response). The current
abstention path on empty `retrieved_docs` covers this — verify it does.

### AC6 — LG-5 boundary probe (live-deploy)

The live-deploy leg from Story 1.0b MUST be exercised on
`release/el-salvador` before Story 1.2 merges: a real chat POST against
the deployed retriever confirms the carrier reaches `invoke_fanout` and
the per-leg hits arrive with provenance metadata populated. The probe
script lives alongside `scripts/check-okf-repo.js` (smoke harness
extension).

## Verification plan

- pytest for chatqna's `align_inputs` retriever branch (mock the resolver
  endpoint, assert carrier shape per AC1)
- pytest asserting the per-leg provenance fields flow through to
  `RetrievalResponse.metadata` (AC3)
- Live LG-5 probe (AC6) — smoke harness script
- CI gate: the boundary probe MUST be green before 1.2 merges

## Non-goals

- The graph router (Story 1.3) lives downstream of this story — 1.2
  forwards the AUTHORIZED set; 1.3 is what SELECTS that set from the
  discovery endpoint. 1.2 is the transport; 1.3 is the selection.
- Story 10.7 (Studio retrieval card) consumes the per-chunk provenance
  rendered to the frontend but is its own backlog item with its own
  i18n + site-docs completion gates.
