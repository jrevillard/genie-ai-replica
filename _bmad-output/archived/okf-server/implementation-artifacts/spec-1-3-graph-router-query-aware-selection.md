---
title: 'Story 1.3 — Query-affinity graph routing (sticky, calibrated): never fan out to all graphs by default'
type: 'feature'
created: '2026-10-06'
status: 'ready-for-dev'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '854613fe6fd2'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-1-retriever-multigraph-fanout-rrf.md'
  - '{project-root}/_bmad-output/planning-artifacts/okf-fanout-course-correction-2026-09-20.md'
  - '{project-root}/genie-ai-overlay/core/label_contract.py'
  - '{project-root}/.claude/rules/DEBUGGING-TRACING.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 1.1's fan-out searches **every serving graph** on every engaged query. On the live local build (8 repos, incl. bali 116k / indonesia 144k chunks) this is measured as: retriever wall **8.9–11s per query** (three legs can never finish inside any sane timeout), abandoned legs keep scanning ArangoDB for **25–151s** after the response (poisoning the *next* query — T1's rerank inflated 0.8s→5.65s; a 10.9s dead gap), and cross-graph noise chunks (MI5, Wikipedia) reaching the LLM context. Query-affinity routing (this story, previously backlog "≤20ms gate") was deferred; the deferral no longer holds at this repo count and corpus size. **It will not scale.**

**Decided design (user interview, 2026-10-06 — all decisions locked):** the retriever selects the search set from **embedding affinity** before extraction, via a **global chunk-level competition**: fire a k=40 vector probe per carrier graph (parallel), merge into one global top-40 ranking, and a graph **qualifies iff it contributes ≥3 chunks**; floor to the single best graph if nothing qualifies. Follow-up continuity via **sticky routing** (BFF persists the routed set per conversation; next carrier marks it; sticky graphs always search). Legacy `GRAPH` leg is **always searched in hybrid and never routed** (D8 untouched). Probe failure: **retry once (2s), then all-graph degraded** with loud log + metric — the only sanctioned all-graph path. Signal = **live probes per query** (~0.4s measured at 8 repos; publish-time signatures deferred to ~50-repo scale). Knobs = **env vars** (`RETRIEVER_ROUTE_*`), code defaults work out-of-the-box.

**Calibration evidence (2026-10-06, local build, bge-large 1024-dim):** global top-40 routes measured — ALPHABET-pure → {alphabet 38/40} (singletons bali 1, uk 1 cut by ≥3 rule); "Alphabet in the UK / government adoption" → {uk 30, alphabet 6, bali 4}; KENYA-pure → {kenya 21, uk 18} (genuinely related domains); INDO-pure → {indonesia 31, bali 9}. Degenerate follow-up ("why are entities like Google cloud missing…") misroutes WITHOUT context (indonesia 22 > alphabet 4) → conversation context (sticky) is mandatory. Per-graph max-cosine is size-biased (bali 0.6155 on a pure Alphabet query) and is explicitly NOT the signal.

**Approach:** Retriever-side, one new module function `_route_graphs()` + a hook at the top of `invoke_fanout`. Carrier grammar gains an additive `::sticky:` segment (same pattern as `::graphs:`/`::no_legacy:`); chatqna's carrier re-encode preserves it; the BFF writes sticky from the finalized sources' distinct `graph_name` values (persisted on the conversation document via the shared db driver) and unions it into the next carrier. **The BFF carrier still carries all serving graphs — the retriever prunes.** Routing only ever *skips OKF legs*; it never adds graphs beyond sticky, never touches the legacy path, and can only fail towards more recall (degraded all-graph), never less.

## Boundaries & Constraints

**Always:**
- `SEARCH = GRAPH (always, hybrid) ∪ sticky(conversation) ∪ {graphs with ≥3 chunks in the global top-40}`, floor top-1 when nothing qualifies.
- Sticky graphs bypass the ≥3 rule (they are searched unconditionally) and are included in the response-time budget.
- Every routing decision logged per-graph (`affinity rank, chunks-in-top40, keep/drop` + `sticky` marker) and emitted as span attributes (`rag.route.*`).
- Degraded path (probes failed after 1 retry): search ALL carrier graphs + `logger.error` + `rag_route_degraded` counter.
- Routed set survives to the BFF via the sources panel (`graph_name` on surfaced sources) — no response-shape change.

**Never:**
- Never route/limit the legacy `GRAPH` leg in hybrid; never modify the legacy single-graph path (no carrier ⇒ this code never runs — D8 byte-identical preserved).
- Never fan out to all graphs except the degraded path.
- Never route to zero graphs (floor top-1).
- Never change the query embedding used for chunk retrieval (sticky is a carrier segment, not an embedding change).
- Never let routing add a graph that isn't in the carrier's authorized set (sticky ∩ carrier graphs — authorization still wins).

</frozen-after-approval>

## Technical Design

### 1. Carrier grammar — `::sticky:` (core/label_contract.py, additive)

`_STICKY_SEPARATOR = "::sticky:"` appended to `_SEGMENTS`; `encode(base_mode, labels, graphs, no_legacy, sticky=None)`; `_decode_all` returns 5-tuple; new `decode_sticky()` accessor; `decode()` keeps its 3-tuple signature. Sticky values are graph names (same no-comma guarantee). An old retriever ignores the segment cleanly (additive contract).

### 2. chatqna pass-through (genieai_chatqna.py, align_inputs)

chatqna decodes the incoming carrier and re-encodes it (~line 1022–1034). The sticky segment must survive: decode sticky from the incoming `search_start`, pass to `encode(..., sticky=_sticky)`. No request-schema change.

### 3. Retriever routing (genieai_retriever_arangodb.py + config.py)

`config.py`: `ROUTE_ENABLED=true`, `ROUTE_TOP_K=40`, `ROUTE_MIN_CHUNKS=3`, `ROUTE_PROBE_TIMEOUT_MS=2000`, `ROUTE_RETRY=1`.

`_route_graphs(self, okf_graphs, query_embedding, input_dict)` — module-level, called from `invoke_fanout` after carrier decode, before leg spawn:
1. Probe per graph (parallel `asyncio.to_thread`, one AQL each): `FOR doc IN \`<g>_SOURCE\` LET s = APPROX_NEAR_COSINE(doc.embedding, @emb) SORT s DESC LIMIT 40 RETURN s` (graph names backtick-quoted — hyphen rule).
2. Merge all (graph, score) rows → global top-40 → count chunks per graph → qualify = count ≥ `ROUTE_MIN_CHUNKS`; floor = best graph by top chunk when zero qualify.
3. `SEARCH = qualifier_set ∪ sticky_graphs` (∩ carrier authorization; GRAPH excluded from routing entirely).
4. Failure: any probe exception/timeout → retry the failed batch once → still failing ⇒ return ALL okf_graphs + degraded log/counter (per-probe timeout via `asyncio.wait`, abandoned probe threads are ~cheap k=40 reads).
5. Log one summary line + span attrs: `rag.route.selected`, `rag.route.dropped`, `rag.route.sticky`, `rag.route.degraded`.

`invoke_fanout` change: `encoded_graph_names` for leg spawn = routed set. Everything downstream (legs, fusion, caps, rerank) unchanged.

### 4. BFF sticky lifecycle (services/query-service.js)

- **Write:** at stream finalize (all three finalize sites), `okfRoutedGraphs = distinct(graph_name from finalized source_documents)` — additive field on the conversation document via the shared db driver (rule: always shared driver).
- **Read:** at `_attachFanoutCarrier`, load the conversation's `okfRoutedGraphs` and emit `::sticky:` with those names (only engaged modes; only names also present in the current authorized set — authorization still wins).
- No new collections; additive document field; absence (legacy conversations) = no sticky segment = today's behavior.

### 5. Performance budget

Probe wall ~0.4s @8 repos (parallel; biggest repos dominate); retriever wall target for a single-graph route ≈ **1.5–2s** (vs 8.9–11s). End-to-end target ~12–18s (LLM-bound remainder). Zombie legs cease (doomed repos never spawn). Phase 2 (NOT this story): publish-time signatures at ~50 repos.

### 6. Failure modes

| Failure | Behavior |
|---|---|
| No query embedding | Skip routing → all carrier graphs (log) |
| Probe timeout (per graph) | Retry once → still out ⇒ degraded all-graph |
| Sticky graph not in authorized set | Dropped (authorization wins) |
| Sticky on conversation with zero sources | No sticky segment (first query) |
| `ROUTE_ENABLED=false` | Byte-identical Story 1.1 behavior |

## Tasks

- [ ] 1. `label_contract.py`: sticky segment (encode/`_decode_all`/`decode_sticky`) + docstring update
- [ ] 2. chatqna: sticky pass-through in align_inputs re-encode
- [ ] 3. retriever `config.py`: ROUTE_* knobs
- [ ] 4. retriever: `_route_graphs()` + `invoke_fanout` hook + routing logs/spans
- [ ] 5. BFF: sticky write at finalize (from sources) + `::sticky:` at carrier build
- [ ] 6. Tests: label_contract sticky round-trip; retriever routing policy pins (≥3 rule, floor, sticky union, GRAPH exclusion, degraded, ENABLED=false); chatqna pass-through pin; BFF sticky emit + persist pins
- [ ] 7. Lint/format (eslint + ruff + prettier) clean; OPEA + backend suites green
- [ ] 8. Local build sync + rebuild retriever/chatqna/backend; live validation per Verification
- [ ] 9. Sprint yaml + memory update

## Verification

1. **Unit**: new pins green; full OPEA + backend suites green (baseline: 451/451 OPEA, 1800/1809 backend w/ 9 pre-existing local-env failures).
2. **Live routing (local build, probe-level)**: the five calibration queries route exactly as measured (alphabet-clean; UK example → {alphabet, uk}; Kenya → {kenya, uk}; Indonesia → {indonesia, bali}); legacy no-carrier probe byte-identical (GRAPH-only, unchanged shape); sticky follow-up stays on Alphabet; wall-time retriever segment ≤2.5s for single-graph routes.
3. **Degrade path**: probe failure simulation → all-graph search + degraded log present.
4. **T-suite**: user re-runs T1–T9 in UI; expectation — response times drop to ~12–18s, sources panel shows only routed graphs, accuracy holds (T3 accuracy is the remote TEI flap, orthogonal — separately tracked).
