# Retrieval Evaluation

Two complementary eval paths, fed from **one** query drive through chatqna. Use
both — each catches failures the other can't.

| Path | Tool | Trait | Catches |
|---|---|---|---|
| **Deterministic anchor** | `run_eval.py --mode anchor` | Reproducible, no LLM | "chunk X stopped getting retrieved" (regressions) |
| **Semantic** | `run_eval.py --mode dump-tuples` → `run_ragas_eval.py` | LLM-judged | "answer hallucinated / off-topic despite good chunks" |

## Why two paths

Retrieval quality is invisible end-to-end: a confident answer can hide that the
reranker dropped a relevant chunk (anchor catches this), and a perfect chunk set
can still produce a wrong answer (semantic catches this). Neither sees the
other's failures.

## Identity is content-based, not `_key`

Chunk `_key`s are auto-generated UUIDs (langchain-arangodb) and churn on every
re-ingestion. So the anchor matches on a **content fingerprint** (`chunk_identity.content_hash`)
— stable across re-ingests as long as chunking params are unchanged. A chunking-
param change correctly invalidates the gold set → re-baseline (signal, not bug).

## Pipeline (no auth bypass of user flows)

```
gold_dataset.json ── run_eval.py ──┬── docker exec <chatqna> curl localhost:8888/v1/chatqna
                                   │     payload: {messages, context{categoryLabel,serviceLabels,language}, stream:false}
                                   │     (internal service — NO OIDC; faithful label-filtered retrieval)
                                   │
                                   ├── docker exec <chatqna> curl <victoriatraces>:10428  (by service + time window)
                                   │     → extract rag.candidate_chunk_ids / rag.selected_chunk_ids
                                   │     (chatqna.reranker_selection span, shipped from MR !215)
                                   │
                                   ├── ArangoDB (direct) → resolve _key → content_hash + text
                                   │
            ┌──────────────────────┴──────────────────────┐
            ▼                                              ▼
   --mode anchor                                  --mode dump-tuples
   metrics.py: recall / precision /               eval_tuples.json:
   complete_recall / noise                        {question, contexts, answer, reference}
                                                  → run_ragas_eval.py (external LLM judge)
```

chatqna is the orchestrator → the drive exercises the full pipeline (embed →
retrieve [label-filtered] → rerank → LLM) and emits the selection span.

## Prerequisites

- Observability **enabled** (`ENABLE_OBSERVABILITY=1`) — traces must reach VictoriaTraces.
- Deployed chatqna carries the `chatqna.reranker_selection` span (shipped with MR !215).
- Run on a swarm node with docker access to chatqna + victoriatraces, and ArangoDB reachable.

## Step 1 — Build the gold dataset (one-time per corpus)

```bash
# List every chunk _key + content_hash + preview → chunks_registry.json
GRAPH_SOURCE=genieai_graph_SOURCE ARANGO_URL=... ARANGO_DB=... \
  ARANGO_USER=root ARANGO_PASSWORD=... python3 dump_chunks.py
```

Browse `chunks_registry.json`; for each representative query, copy the
`content_hash` of the chunks that should be retrieved. Copy
`gold_dataset.example.json` → `gold_dataset.json`:

```json
{ "id": "q1", "query": "...",
  "categoryLabel": "Agriculture", "serviceLabels": ["..."], "language": "en",
  "reference_answer": "ground-truth answer (for the LLM judge)",
  "expected_chunks": [
    {"content_hash": "a1b2c3d4e5f60718", "min_rank": 5, "preview": "..."}
  ] }
```

`categoryLabel`/`serviceLabels`/`language` mirror the backend→chatqna payload —
keep them faithful so retrieval is label-filtered exactly as in production.

## Step 2a — Deterministic anchor (per config)

```bash
CHATQNA_CONTAINER=genieai_el-salvador_chatqna \
VICTORIATRACES_SVC=genieai_el-salvador_victoriatraces \
  python3 run_eval.py anchor gold_dataset.json report_A.json
```

Reports per-query + aggregate recall / precision / complete_recall / noise /
retrieval_recall. `retrieval_recall` isolates retriever failure (gold chunk
never retrieved) from reranker failure (retrieved but dropped).

## Step 2b — Semantic eval (per config)

```bash
# 1. Collect tuples from the deployment (stays sovereign — only tuples leave):
python3 run_eval.py dump-tuples gold_dataset.json eval_tuples.json

# 2. Judge with an external OpenAI-compatible LLM (run locally; ragas + langchain-openai installed):
EVAL_JUDGE_BASE_URL=https://api.example.com/v1 \
EVAL_JUDGE_API_KEY=...  EVAL_JUDGE_MODEL=<your-judge> \
  python3 run_ragas_eval.py eval_tuples.json ragas_A.json
```

The judge is **model-agnostic** — point `EVAL_JUDGE_*` at any OpenAI-compatible
endpoint. Sovereignty is your call: the tuples contain document content, so the
judge endpoint receives it. Calibrate the judge (Cohen's κ vs a human spot-check
on 10–20% of the sample, κ ≥ 0.6) before trusting absolute scores; track score
deltas across runs for regressions.

## Step 3 — A/B

Redeploy with the alternate config, re-run both paths saving `_B.json`, diff.

## Notes

- `stream:false` is a supported chatqna mode — affects only response delivery,
  not retrieval/reranking (selection is identical to streaming).
- Trace lookup is by **service + time window**, not traceparent-in-headers.
- Empty trace right after a query → spans flushing; bump `TRACE_FLUSH_WAIT` (default 3s).
- `run_ragas_eval.py` requires `pip install ragas langchain-openai` (NOT a repo
  dependency) — run it where you installed those.
