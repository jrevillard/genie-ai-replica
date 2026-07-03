# RAG Benchmarks — Knowledge File

This directory holds the retrieval-quality eval harness + offline calibrator
for the GENIE.AI RAG pipeline. Capture operational knowledge here so it
survives across sessions and contributors.

This file documents the **methodology** — how the tools work, how to reason
about retrieval quality, how to calibrate the adaptive reranker. Specific
parameter values (CONTEXT_DECAY_FACTOR, thresholds, stack hostnames, IPs)
change over time and live in the deployment (ansible `.env`, compose), not
here. This file stays valid as those values evolve.

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

## Running against a deployed stack

The eval runs ON the swarm node (the chatqna container is there). The exact
hostname, stack name, and VictoriaTraces service name are **deployment-specific**
— substitute your stack's values. Resolve the chatqna container name live
(Swarm replica suffixes are dynamic).

```bash
SWARM_NODE=<your swarm node>          # e.g. govstack@<ip>
STACK=<your stack prefix>             # e.g. genieai-<flavor>

# 1. Sync the eval dir to the swarm node
rsync -az tests/rag-benchmarks/eval/ $SWARM_NODE:/tmp/rag-eval/
scp <gold_dataset.json> $SWARM_NODE:/tmp/rag-eval/gold_dataset.json

# 2. Run on the node (resolve the dynamic container name; set VT service name)
ssh $SWARM_NODE 'bash -s' <<EOF
cd /tmp/rag-eval
export CHATQNA_CONTAINER=\$(docker ps --format '{{.Names}}' | grep chatqna-xeon-backend-server | head -1)
export CHATQNA_SERVICE_NAME=genieai-chatqna              # OTel service name (constant across stacks)
export VICTORIATRACES_SVC=${STACK}_victoriatraces        # <stack>_victoriatraces; hyphenated
python3 run_eval.py anchor gold_dataset.json results.json
EOF
```

### Env vars (override for your stack)

| Var | What it is | How to resolve |
|-----|------------|----------------|
| `CHATQNA_CONTAINER` | Docker container name to exec curl inside | `docker ps --format '{{.Names}}' \| grep chatqna-xeon-backend-server \| head -1` — Swarm replica suffix is dynamic (`.1.<random>`), never hardcode |
| `CHATQNA_SERVICE_NAME` | OTel service name chatqna reports | `genieai-chatqna` — constant across stacks (the OTel SDK ignores the swarm stack prefix) |
| `VICTORIATRACES_SVC` | VictoriaTraces service DNS name inside the overlay | `<stack>_victoriatraces` (hyphenated, matching the swarm service name) |

### Observability must be ON

The eval needs spans (VictoriaTraces). If `ENABLE_OBSERVABILITY != 1`, every
query shows "no reranker_selection span — trace missed" and nothing is scored.
Trace indexing lag on a busy VT node can exceed 60s — `TRACE_FETCH_TIMEOUT`
default is 120s, raise if needed.

### Gold dataset schema

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

## Adaptive reranker — the parameter surface (methodology)

The `adaptive` reranker strategy (`RERANKING_STRATEGY=adaptive`, default) keeps
a chunk only when its marginal value exceeds `MIN_VALUE_THRESHOLD`:

```
value      = utility − cost
utility    = relevance × novelty_weight
cost       = context_decay_cost + confusion_cost
context_decay_cost = CONTEXT_DECAY_FACTOR × token_count
confusion_cost     = (1 − score) + (max_score − score) / (max_score − avg_score)
```

Three tunable knobs (values live in reranker env / ansible, NOT here):

| Knob | Where set | What it controls |
|------|-----------|------------------|
| `CONTEXT_DECAY_FACTOR` | reranker env | Per-token context cost. Balances context-window consumption against utility. Must be recalibrated when chunk_size changes — the cost scales with token count, so the right factor depends on the deployment's chunk size. |
| `MIN_VALUE_THRESHOLD` | reranker env | Marginal-value cutoff for keeping a chunk. Stricter (higher) = less noise but more empty selections; lower = permissive. |
| confusion formula | reranker CODE | `(1−s)+(mx−s)/(mx−avg)` is the default. The relative term double-counts low relevance and has an unstable denominator (cliff when scores cluster). Alternatives exist in `calibrate.py` (`simple`, `bounded_rel`, `rank`) — pick by offline sweep, then change code in a separate MR. |

### Calibration methodology (the point of this directory)

Don't tune by redeploy-guess-and-check. Use the offline calibrator:

1. **Run one instrumented eval** → `anchor_results.json` with `adaptive_breakdown`
   per candidate (real token counts + every cost term).
2. **Sweep offline** (`calibrate.py`) — replays the selection for any
   (factor × confusion × threshold) combo against the logged data. Seconds, not
   hours. The algorithm is a pure function of the logged data, so the replay
   reproduces live selection exactly (validity check: baseline replay recall
   must match the live report's recall).
3. **Pick the winner** by F1 (or recall at a precision floor — recall alone
   games toward "select everything").
4. **Validate live** — set the winning params in the deployment, redeploy,
   rerun eval. Confirm the recall matches the offline prediction. This guards
   against overfitting a small gold set.

### Failure-mode diagnosis (what the breakdown tells you)

- **`selected=0` on a query with high top score (≥0.7)** → cost too high; lower
  `CONTEXT_DECAY_FACTOR`. The breakdown shows idx0's utility vs cost directly.
- **`selected=0` with top score < 0.1** → retriever returned junk (no relevant
  candidate). No reranker param rescues this; it's a retriever/filter problem.
- **TEI reranker HTTP 429 "Model is overloaded"** → GPU node saturated. Raise
  TEI's `--max-concurrent-requests` (deployment config). The reranker surfaces
  this as a clear `RuntimeError` (HTTP 429), not a crash.

## Offline calibrator (`calibrate.py`) — method

Replays the adaptive selection against the per-candidate breakdown captured in
an instrumented anchor report. The replay is a **pure function** of the logged
data: the breakdown records the computed `utility` per candidate (fixed at eval
time — depends on score + embeddings); only the COST side changes when
retuning (`value = utility − (factor×token_count + confusion)`). Same logged
data + same formula = same selection the live reranker would produce.

### Validity check (always run first)

Baseline replay (production params) must reproduce the live report's recall.
If it doesn't, the breakdown→candidate mapping is broken (see
position-vs-order pitfall) or the metrics module drifted.

### Position-vs-order pitfall (bit us once)

The breakdown is in **TEI rank order** (best score first). The report's
`candidates` list is in **retriever output order** (retrieved_docs). These
differ. Map via `breakdown[i].original_index → candidates[original_index]`,
NOT by index. The reranker annotates `original_index` on each breakdown record
for exactly this reason.

### Run

```bash
# Sweep defaults (factor × confusion × threshold grid)
python3 calibrate.py anchor_results.json --top 15

# Narrow sweep
python3 calibrate.py anchor_results.json --factors 0.001,0.0015,0.002 --thresholds -1.0,-0.5

# Rank by recall (favors permissive cells — watch precision)
python3 calibrate.py anchor_results.json --metric recall
```

Outputs top-N combos to stdout + full grid to `<report>_calibration.json`.

### Limitations (be honest)

- **Tunes only the adaptive cost path.** Upstream changes (retriever k, label
  filter, contextual retrieval, `RERANKER_SCORE_CALIBRATION`) change the
  candidate stack and require a fresh eval run.
- **Gold set size matters.** Small sets (≈30 queries) — top cells may differ
  by noise. The live validation step guards against overfitting.
- **recall is the target** but the loop reports precision + F1 so it can't
  game recall by selecting everything.

## Workflow: A/B two configs

```bash
# Config A (current) — deploy, run eval → report_A.json
python3 run_eval.py anchor gold.json report_A.json

# Change params in deployment (e.g. CONTEXT_DECAY_FACTOR in ansible .env), redeploy
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
      "id": "q1", "query": "...", "trace_found": true,
      "gold": ["<content_hash>", ...],
      "selected": ["<content_hash>", ...],
      "candidates": ["<content_hash>", ...],
      "adaptive_breakdown": [
        {
          "idx": 0, "original_index": 3,
          "score": 0.83, "relevance": 1.21, "novelty": 1.0, "novelty_weight": 1.0,
          "utility": 1.21, "token_count": 712,
          "context_decay_cost": 1.78, "confusion_cost": 0.12, "total_cost": 1.90,
          "value": -0.69, "selected": true
        }
      ],
      "recall": 1.0, "precision": 1.0, "complete_recall": 1.0,
      "noise": 0.0, "retrieval_recall": 1.0
    }
  ],
  "aggregate": {"n": 32, "recall": 0.40, "precision": 0.47, "complete_recall": 0.34, "noise": 0.53, "retrieval_recall": 0.72},
  "n_missed_traces": 0
}
```

## Pitfalls log (what bit us — methodology, not deployment-specific)

- **Swarm container name has a dynamic replica suffix** (`...backend-server.1.<random>`).
  Resolve live via `docker ps --format`, never hardcode.
- **VictoriaTraces service name** = `<stack>_victoriatraces` (hyphenated,
  matching the swarm service name). Wrong separator → DNS fails silently
  inside the container → curl returns empty → "no reranker_selection span" for
  every query.
- **TEI `/rerank` returns a JSON OBJECT on error** (429/5xx), not a list. The
  reranker must check `resp.status` + `isinstance(decoded_response, list)`
  before consuming it, or it crashes with a misleading TypeError.
- **Span `startTime` not `timestamp`**, `duration` in microseconds. VT indexing
  lag can exceed 60s right after a query — the eval polls with a wide window.
- **`categoryLabels` (list) vs `categoryLabel` (string)** — schema migrated.
  Old datasets/payloads silently deaden the label filter.
- **Breakdown position ≠ candidate position** — TEI rank order vs
  retrieved_docs order. Map via `original_index`.
- **Image `git_sha` label ≠ branch commit.** Verify deployed code by
  `docker exec ... grep` inside the container, not by trusting the tag.
