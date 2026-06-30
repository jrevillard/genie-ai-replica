# Reranker Selection Evaluation

Measures reranker **chunk-selection quality** — does it pass the right chunks to
the LLM? — via recall / precision / complete-recall / noise against a gold
standard. Used to A/B reranker config changes (relevance formula,
`MIN_VALUE_THRESHOLD`, `CONTEXT_DECAY_FACTOR`, etc.).

## Why this exists

Retrieval quality is invisible end-to-end: a confident LLM answer can hide that
the reranker dropped the relevant chunk. These metrics make selection
measurable, decoupled from LLM fluency.

## Metrics (per query, averaged across the gold set)

| Metric | Definition |
|---|---|
| recall | `\|gold ∩ selected\| / \|gold\|` — fraction of correct chunks that survived |
| precision | `\|gold ∩ selected\| / \|selected\|` — fraction of selected that are correct |
| complete_recall | 1.0 iff **all** gold chunks selected, else 0.0 |
| noise | `1 − precision` — irrelevant selected / total selected |
| retrieval_recall | `\|gold ∩ candidates\| / \|gold\|` — was the gold chunk even retrieved? (isolates retriever vs reranker failure) |

## Architecture (no duplication, no auth bypass of user flows)

```
gold_dataset.json ── run_eval.py ──┬── docker exec <chatqna> curl localhost:8888/v1/chatqna
                                   │     payload: {messages, context{categoryLabel,serviceLabels,language}, stream:false}
                                   │     (internal service — NO OIDC; faithful label-filtered retrieval)
                                   │
                                   ├── docker exec <chatqna> curl <victoriatraces>:10428  (by service + time window)
                                   │     → extract rag.candidate_chunk_ids / rag.selected_chunk_ids
                                   │
                                   └── metrics.py → recall / precision / complete_recall / noise
```

**Identity is canonical throughout** — chatqna already recovers chunk `_key` via
`text_to_id` after reranking and emits it on the `chatqna.reranker_selection`
span. The eval matches `_key`-to-`_key`. No hashing, no metadata duplication.

## Prerequisites

- Observability **enabled** (`ENABLE_OBSERVABILITY=1`) — traces must reach VictoriaTraces.
- The deployed chatqna carries the `chatqna.reranker_selection` span (shipped with this change).
- Run on a swarm node with docker access to the chatqna + victoriatraces containers.

## Steps

### 1. Build the gold standard (one-time per corpus)

```bash
# List every chunk _key + preview → chunks_registry.json
GRAPH_SOURCE=genieai_graph_SOURCE ARANGO_URL=... ARANGO_DB=... \
  ARANGO_USER=root ARANGO_PASSWORD=... python3 dump_chunks.py
```

Browse `chunks_registry.json`, and for each representative query mark the chunks
that **should** be retrieved. Copy `gold_dataset.example.json` →
`gold_dataset.json` and fill entries:

```json
{ "id": "q1", "query": "...", "categoryLabel": "Agriculture",
  "serviceLabels": ["..."], "language": "en",
  "gold_chunk_keys": ["chunk_123", "chunk_456"] }
```

The `categoryLabel`/`serviceLabels`/`language` mirror what the backend sends to
chatqna — keep them faithful so retrieval is label-filtered exactly as in
production.

### 2. Run the eval (per config)

```bash
CHATQNA_CONTAINER=genieai_el-salvador_chatqna \
VICTORIATRACES_SVC=genieai_el-salvador_victoriatraces \
  python3 run_eval.py gold_dataset.json report_config_A.json
```

Streams per-query metrics to stderr; writes the full report (per-query + aggregate) to JSON.

### 3. A/B

Redeploy with the alternate reranker config, re-run saving to
`report_config_B.json`, then diff the `aggregate` blocks. Example toggle:
`MIN_VALUE_THRESHOLD` (`-1.0` keep-all vs `0.0` drop-negatives).

## Notes

- `stream:false` is a supported chatqna mode (`genieai_chatqna.py` route handler
  branches on `chat_request.stream`). It affects only response **delivery**, not
  retrieval/reranking — selection is identical to streaming.
- Trace lookup is by **service + time window**, not traceparent-in-headers, so it
  works regardless of stream mode.
- If a trace comes back empty right after a query, spans may still be flushing —
  bump `TRACE_FLUSH_WAIT` (default 3s).
