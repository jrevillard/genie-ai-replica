# RAG Benchmarks — Knowledge File

This directory holds the retrieval-quality eval harness + offline calibrator
for the GENIE.AI RAG pipeline. Capture operational knowledge here so it
survives across sessions and contributors.

## Layout

```
tests/rag-benchmarks/
├── eval/
│   ├── run_eval.py            # Drives gold queries through chatqna, scores recall/precision
│   ├── calibrate.py           # Offline adaptive-reranker parameter sweep
│   ├── run_ragas_eval.py      # LLM-judged semantic eval (faithfulness etc.)
│   ├── metrics.py             # recall / precision / complete_recall / noise / retrieval_recall
│   ├── chunk_identity.py      # content_hash (sha256 of normalized text) — identity is content-based
│   ├── arango.py              # ArangoDB cursor helper
│   ├── dump_chunks.py         # Dump chunk keys + labels from ArangoDB for gold annotation
│   ├── gold_dataset.json      # Curated gold (template-only in repo; real set is local-only)
│   └── gold_dataset.example.json
└── CLAUDE.md                  # this file
```

## Two eval paths — use both

| Path | Command | Trait | Catches |
|------|---------|-------|---------|
| **Anchor (deterministic)** | `run_eval.py anchor gold.json out.json` | No LLM, reproducible | "chunk X stopped getting retrieved/selected" regressions |
| **Semantic (LLM-judged)** | `run_eval.py dump-tuples ...` → `run_ragas_eval.py` | LLM judge | "answer hallucinated / off-topic despite good chunks" |

Retrieval quality is invisible end-to-end: a confident answer can hide a
dropped gold chunk (anchor catches this); a perfect chunk set can still yield a
wrong answer (semantic catches this). Neither sees the other's failures.

## How the anchor eval works

```
gold_dataset.json ── run_eval.py ──┬── docker exec <chatqna> curl localhost:8888/v1/chatqna
                                   │     payload: {messages, context{categoryLabels,serviceLabels,language}, stream:false}
                                   │     (internal service — NO OIDC; faithful label-filtered retrieval)
                                   │
                                   ├── docker exec <chatqna> curl <victoriatraces>:10428  (by service + time window)
                                   │     → harvest rag.candidate_chunk_keys / rag.selected_chunk_keys
                                   │       (chatqna.reranker_selection span)
                                   │     → harvest rag.adaptive_breakdown (reranker.tei_invoke span)
                                   │       for offline calibration
                                   │
                                   └── score recall/precision/complete_recall/noise/retrieval_recall
                                       (gold is content_hash-keyed; identity survives re-ingestion)
```

### Metrics

- **recall** — fraction of gold chunks that survived reranking (in `selected`).
  This is what the LLM actually sees. The headline number.
- **precision** — fraction of selected chunks that are gold (signal vs noise).
- **complete_recall** — fraction of queries where ALL gold chunks were selected.
  Penalizes partial hits harshly.
- **noise** — fraction of selected chunks that are NOT gold.
- **retrieval_recall** — fraction of gold chunks in the CANDIDATE set (pre-rerank).
  Diagnoses retriever vs reranker: low retrieval_recall = retriever miss;
  retrieval_recall high but recall low = reranker dropping gold.

### Identity is content-based (`chunk_identity.content_hash`), NOT `_key`

Chunk `_key`s are auto-generated UUIDs (langchain-arangodb) and churn on every
re-ingestion. The gold set keys on `content_hash` (sha256 of normalized text) —
stable across re-ingests as long as chunking params are unchanged. A chunking-
param change correctly invalidates the gold set → re-baseline (signal, not bug).

## CLI — positional args, NOT flags

`run_eval.py` takes **positional** args: `mode gold_path out_path`.
`python3 run_eval.py --mode anchor --gold x --out y` is WRONG (no argparse).
```
python3 run_eval.py anchor gold_dataset.json results.json
python3 run_eval.py dump-tuples gold_dataset.json tuples.json
```

## Swarm deployment specifics (el-salvador on 10.0.0.102)

The eval runs on the swarm node (the chatqna container is there). Run via SSH:

```bash
# 1. Sync the eval dir to the swarm node
rsync -az tests/rag-benchmarks/eval/ govstack@10.0.0.102:/tmp/rag-eval/
scp <gold_dataset.json> govstack@10.0.0.102:/tmp/rag-eval/gold_dataset.json

# 2. Run on the node (env vars resolve swarm-specific names)
ssh govstack@10.0.0.102 'bash -s' <<'EOF'
cd /tmp/rag-eval
export CHATQNA_CONTAINER=$(docker ps --format '{{.Names}}' | grep chatqna-xeon-backend-server | head -1)
export CHATQNA_SERVICE_NAME="genieai-chatqna"
export VICTORIATRACES_SVC="genieai-el-salvador_victoriatraces"
python3 run_eval.py anchor gold_dataset.json results.json
EOF
```

### Env vars (defaults are WRONG for el-salvador — must override)

| Var | Default | el-salvador value | Why |
|-----|---------|-------------------|-----|
| `CHATQNA_CONTAINER` | `genieai_el-salvador_chatqna` | `$(docker ps ... \| grep chatqna-xeon-backend)` | Swarm replica suffix is dynamic (`.1.<random>`) — resolve live, never hardcode |
| `CHATQNA_SERVICE_NAME` | `genieai-chatqna` | `genieai-chatqna` | The OTel SDK reports this regardless of swarm stack name |
| `VICTORIATRACES_SVC` | `genieai_el-salvador_victoriatraces` (underscores) | `genieai-el-salvador_victoriatraces` (hyphens) | Default has WRONG separator — DNS fails inside container |

### Observability must be ON

The eval needs spans (VictoriaTraces). If `ENABLE_OBSERVABILITY != 1`, every
query shows "no reranker_selection span — trace missed" and nothing is scored.
Trace indexing lag on a busy VT node can exceed 60s — `TRACE_FETCH_TIMEOUT`
default is 120s, raise if needed.

### Gold dataset schema (current)

```json
{
  "entries": [
    {
      "id": "q1",
      "query": "...",
      "categoryLabels": ["Tomato"],      // LIST (multi-crop support)
      "serviceLabels": [],
      "language": "en",
      "reference_answer": "...",          // for semantic eval
      "expected_chunks": [
        {"chunk_key": "<content_hash>", "text": "..."}
      ]
    }
  ]
}
```

`categoryLabels` is a LIST (supports multi-crop queries like ["Tomato","Cucumber"]).
Older datasets used `categoryLabel` (string) — incompatible with the current
chatqna schema (RequestContext.categoryLabels: list[str]). Sending the old
shape silently deadens the label filter.

## Adaptive reranker — the parameter surface

The `adaptive` reranker strategy (`RERANKING_STRATEGY=adaptive`, default) keeps
a chunk only when its marginal value exceeds `MIN_VALUE_THRESHOLD`:

```
value      = utility − cost
utility    = relevance × novelty_weight
cost       = context_decay_cost + confusion_cost
context_decay_cost = CONTEXT_DECAY_FACTOR × token_count
confusion_cost     = (1 − score) + (max_score − score) / (max_score − avg_score)
```

| Param | Default | Where | Effect |
|-------|---------|-------|--------|
| `CONTEXT_DECAY_FACTOR` | `0.0025` | reranker env | Per-token context cost. Too high → drops strong top chunks (cost > utility). Tuned for ~400-token chunks originally; el-salvador chunks are 450-950 tokens → overcharges. |
| `MIN_VALUE_THRESHOLD` | `-1.0` | reranker env | Marginal-value cutoff. Raising it = stricter selection (less noise, more empties). Lowering = permissive. |
| confusion formula | `current` | reranker CODE | `(1-s)+(mx-s)/(mx-avg)`. The rel-term double-counts low relevance and has an unstable denominator (cliff when scores cluster). Alternatives: `simple(1-s)`, `bounded_rel`, `rank_i/n`. |

### Known calibration failure modes (proven by eval data)

- **`CONTEXT_DECAY_FACTOR` too high** → top chunks dropped on ~25% of queries
  (`selected=0`, catastrophic — LLM gets no context). Factor 0.0025 × ~700-tok
  chunk = cost ~1.75, which exceeds utility+threshold for borderline tops.
- **Retriever junk** (top score < 0.1) → no reranker param rescues it. These
  are retriever/filter failures, not reranker. Diagnose via `selected=0` + low
  `candidates` scores in the breakdown.
- **TEI reranker 429 "Model is overloaded"** → GPU node saturated. Default
  `--max-concurrent-requests 8` is too low for k=20 (each chat request fans
  out to 20 rerank inputs). Raised to 128. The reranker now surfaces this
  clearly (RuntimeError naming HTTP 429) instead of a cryptic
  `TypeError: string indices must be integers` (caused by iterating the
  JSON error object).

## Offline calibration (`calibrate.py`)

Replays the adaptive selection algorithm against the per-candidate breakdown
captured in an instrumented anchor report. Lets us sweep
`CONTEXT_DECAY_FACTOR × confusion_formula × MIN_VALUE_THRESHOLD`
(140+ combos) in seconds — no redeploy, no eval rerun — then validate only
the winner live.

### Why it's a pure function

The breakdown records the computed `utility` per candidate (fixed at eval time
— depends on score + embeddings). Only the COST side changes when we retune:
`value = utility − (factor×token_count + confusion)`. Same logged data + same
formula = same selection the live reranker would produce.

### Validity check (always run first)

The baseline replay (factor=0.0025, current confusion, threshold=-1.0) MUST
reproduce the live report's `recall`. If it doesn't, the breakdown→candidate
mapping is broken (the `original_index` field maps TEI-rank order back to
retrieved_docs order, which is the order chatqna emits candidate hashes in).
A mismatch means either the report predates the `original_index` fix, or the
metrics module drifted.

### Position-vs-order pitfall (bit us once)

The breakdown is in **TEI rank order** (best score first). The report's
`candidates` list is in **retriever output order** (retrieved_docs). These
differ. Map via `breakdown[i].original_index → candidates[original_index]`,
NOT by index. Without `original_index`, recall scoring is impossible.

### Run

```bash
# Sweep defaults (7 factors × 4 formulas × 5 thresholds = 140 combos)
python3 calibrate.py anchor_instrumented.json --top 15

# Narrow sweep
python3 calibrate.py anchor_instrumented.json --factors 0.001,0.0015,0.002 --thresholds -1.0,-0.5

# Rank by recall instead of F1 (will favor permissive cells — watch precision)
python3 calibrate.py anchor_instrumented.json --metric recall
```

Outputs top-N combos to stdout + full grid to `<report>_calibration.json`.

### Limitations (be honest)

- **Tunes only the adaptive cost path.** Upstream changes (retriever k, label
  filter, contextual retrieval, `RERANKER_SCORE_CALIBRATION`) change the
  candidate stack and require a fresh eval run.
- **32-query gold set is small.** Top-3 cells may differ by noise. The live
  validation step (redeploy winner, rerun eval) guards against overfitting.
- **recall is the target** but the loop also reports precision + F1 so it
  can't game recall by selecting everything.

## Workflow: A/B two configs

```bash
# Config A (current)
# deploy, run eval → report_A.json
python3 run_eval.py anchor gold.json report_A.json

# Change params (e.g. CONTEXT_DECAY_FACTOR in ansible .env), redeploy
# Config B
python3 run_eval.py anchor gold.json report_B.json

# Compare aggregates
python3 -c "import json; a=json.load(open('report_A.json'))['aggregate']; b=json.load(open('report_B.json'))['aggregate']; print('recall', a['recall'], '->', b['recall'])"
```

For parameter exploration, run the calibrator FIRST (offline, fast), pick the
top 1-2 cells, THEN do live A/B validation. Don't redeploy per candidate.

## Output JSON schema (anchor report)

```json
{
  "per_query": [
    {
      "id": "q1",
      "query": "...",
      "trace_found": true,
      "gold": ["<content_hash>", ...],
      "selected": ["<content_hash>", ...],        // post-rerank
      "candidates": ["<content_hash>", ...],      // pre-rerank (retrieved)
      "adaptive_breakdown": [                      // per-candidate, TEI rank order
        {
          "idx": 0,                                // TEI rank position
          "original_index": 3,                     // position in retrieved_docs
          "score": 0.83, "relevance": 1.21,
          "novelty": 1.0, "novelty_weight": 1.0,
          "utility": 1.21,
          "token_count": 712,
          "context_decay_cost": 1.78,
          "confusion_cost": 0.12,
          "total_cost": 1.90,
          "value": -0.69,
          "selected": true
        }
      ],
      "recall": 1.0, "precision": 1.0, "complete_recall": 1.0,
      "noise": 0.0, "retrieval_recall": 1.0
    }
  ],
  "aggregate": {
    "n": 32, "recall": 0.40, "precision": 0.47,
    "complete_recall": 0.34, "noise": 0.53, "retrieval_recall": 0.72
  },
  "n_missed_traces": 0
}
```

## Pitfalls log (what bit us)

- **Swarm container name has a dynamic replica suffix** (`...backend-server.1.<random>`).
  Resolve live via `docker ps --format`, never hardcode. Old default
  `genieai_el-salvador_chatqna` is stale.
- **VictoriaTraces service name** is `genieai-el-salvador_victoriatraces`
  (hyphens). The eval default uses underscores → DNS fails silently inside the
  container → curl returns empty → "no reranker_selection span" for every query.
- **TEI `/rerank` returns a JSON OBJECT on error** (429/5xx), not a list. The
  reranker must check `resp.status` + `isinstance(decoded_response, list)`
  before consuming it, or it crashes with a misleading TypeError.
- **Span `startTime` not `timestamp`**, `duration` in microseconds. VT indexing
  lag can exceed 60s right after a query — the eval polls with a wide window.
- **`categoryLabels` (list) vs `categoryLabel` (string)** — schema migrated.
  Old datasets/payloads silently deaden the label filter.
- **Breakdown position ≠ candidate position** — TEI rank order vs retrieved_docs
  order. Map via `original_index`.
- **Image `git_sha` label ≠ branch commit.** Verify deployed code by
  `docker exec ... grep` inside the container, not by trusting the tag.
