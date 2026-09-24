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
                                       (gold is content-hash-keyed; span _keys are mapped to
                                        content_hash at eval time — survives re-ingest)
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

### Identity: matching is content-hash based (span emits `_key`; eval maps it to `content_hash`)

The chatqna `reranker_selection` span emits **`chunk_key` = the ArangoDB `_key`**
(recovered by the retriever via `metadata["chunk_key"]`, which survives the
langchain retriever->chatqna handoff; see `run_eval.py` docstring). Matching is
CONTENT-BASED: `run_eval.py` builds a `_key -> content_hash` map from the SOURCE
collection and scores gold `expected_chunks[].content_hash` (sha256 of normalized
text, `chunk_identity.py`) against the converted selection. `chunk_key` (the
`_key`) is retained in the gold for traceability only.

**Consequence:** `content_hash` is stable across re-ingests as long as chunking
params are unchanged — a corpus re-ingest does NOT invalidate the gold. Only a
chunking-param change (which alters chunk text) changes the hashes: a signal to
re-baseline, not a bug.

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
SWARM_NODE=<user>@<host>              # SSH target for the swarm node
STACK=<your stack prefix>             # e.g. genieai-<flavor>

# 1. Sync the eval dir to the swarm node
rsync -az tests/rag-benchmarks/eval/ $SWARM_NODE:/tmp/rag-eval/
scp <gold_dataset.json> $SWARM_NODE:/tmp/rag-eval/gold_dataset.json

# 2. Run on the node (resolve the dynamic container name; set VT service name)
ssh $SWARM_NODE 'bash -s' <<EOF
cd /tmp/rag-eval
export CHATQNA_CONTAINER=\$(docker ps --format '{{.Names}}' | grep chatqna-xeon-backend-server | head -1)
export CHATQNA_SERVICE_NAME=genieai-chatqna              # OTel service name (constant across stacks)
export VICTORIATRACES_SVC=${STACK}_victoriatraces        # Swarm service name (DNS, underscore)
python3 run_eval.py anchor gold_dataset.json results.json
EOF
```

### Env vars (override for your stack)

| Var | What it is | How to resolve |
|-----|------------|----------------|
| `CHATQNA_CONTAINER` | Docker container name to exec curl inside | `docker ps --format '{{.Names}}' \| grep chatqna-xeon-backend-server \| head -1` — Swarm replica suffix is dynamic (`.1.<random>`), never hardcode |
| `CHATQNA_SERVICE_NAME` | OTel service name chatqna reports | `genieai-chatqna` — constant across stacks (the OTel SDK ignores the swarm stack prefix) |
| `VICTORIATRACES_SVC` | VictoriaTraces service DNS name inside the overlay | `<stack>_victoriatraces` (hyphenated, matching the swarm service name) |

### Quick start: the wrapper script

For stack-agnostic anchor runs that handle ROPC enable/disable, container
discovery, and VT trace timeouts automatically, use the wrapper:

```bash
# On the swarm node, with the .env already in place at /opt/<stack>/.env:
ssh $SWARM_NODE bash -s <<'EOF'
export EVAL_KC_URL=https://kc.example.com/auth
export KEYCLOAK_ADMIN_PASSWORD=...
export ARANGO_DB=<db_name>
export ARANGO_PASSWORD=...

scripts/run_anchor_with_cleanup.sh gold_dataset.json results.json
EOF
```

The wrapper:
1. Gets a master admin token from `KEYCLOAK_ADMIN_PASSWORD`
2. Temporarily enables `directAccessGrantsEnabled` on the OIDC client
3. Runs `run_eval.py anchor` with all env vars set
4. **Always** disables ROPC again on exit (signal-safe `trap` on EXIT/INT/TERM) — leaving ROPC enabled in prod is a security vulnerability

All other env vars (`CHATQNA_CONTAINER`, `VICTORIATRACES_SVC`, etc.) have
defaults or resolve live from the Swarm state.

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
        {"chunk_key": "<ArangoDB _key>", "content_hash": "<sha256[:16]>", "preview": "..."}
      ]
    }
  ]
}
```

`content_hash` (sha256 of normalized text) is the **matched** identity — the eval
compares it against the span's `_key`s converted via the SOURCE `_key->content_hash`
map. `chunk_key` is the ArangoDB `_key` (dump_chunks.py's `key` field), retained
for traceability (what the deployed `reranker_selection` span emits).

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
      "gold": ["<_key>", ...],
      "selected": ["<_key>", ...],
      "candidates": ["<_key>", ...],
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

## Baseline capture (`capture_baseline.py`) — the RAG-parity reference artifact

`capture_baseline.py` (one level up, at `tests/rag-benchmarks/`) is the multi-run
driver that produces the committed RAG-parity baseline — the reference Story 3.1
compares post-upgrade metrics against. It REUSES `run_eval.py anchor` N times via
subprocess (never forks it), and adds the baseline layer `run_eval.py` doesn't
have: per-metric `min/median/max` triples, a parity tolerance derived from the
baseline's OWN run-to-run variance (`median ± k·MAD`), a resolved-env config
snapshot (AC:5), the three homes of `RERANKER_TOP_N` / `RERANKING_STRATEGY`
(code / docker-compose / env template), stack identity, and `gold_sha256`.

```bash
# Run ON the swarm node where the stack is deployed, with the eval env set:
#   CHATQNA_CONTAINER, CHATQNA_SERVICE_NAME, VICTORIATRACES_SVC
python3 capture_baseline.py --runs 3 --seed 42 \
  --gold tests/rag-benchmarks/eval/gold_dataset.json \
  --out _bmad-output/implementation-artifacts/rag-baseline-v1.3.json \
  --stack release-el-salvador \
  --stack-prefix genieai-el-salvador_        # disambiguate on multi-stack nodes \
  --repo-root <repo checkout>                # for code/compose/env homes
```

Key behaviors:
- **Reproducible artifact:** the driver emits `harness_sha` (sha256 of the eval
  `*.py` files) + `gold_sha256`, so the baseline is regenerable from the
  committed code + gold. If you modify any eval script or gold query, RE-CAPTURE
  — a mismatched `harness_sha` means the baseline no longer matches its code.
- **Fail-fast:** if any trace is missed (observability off / VT down), the driver
  ABORTS rather than committing a zero baseline (use `--allow-missed-traces` to
  override).
- **Deterministic runs:** `PYTHONHASHSEED` is set per run; a deterministic anchor
  collapses tolerance to exact equality (MAD=0) — documented in the artifact as
  `anchor.tolerance_semantics`.
- **Unit tests:** `tests/rag-benchmarks/test_capture_baseline.py` (tolerance
  math, idempotency with a mocked harness subprocess, env parsing, homes drift).

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

## Semantic path (RAGAS) — operational guide

The anchor path catches retrieval regressions deterministically; the semantic
path catches what anchor cannot: **the LLM hallucinated, the LLM went
off-topic, or the retrieved context failed to cover the reference answer
despite the right chunks being ranked first.** Run both — neither sees the
other's failures.

### Layout (delta from anchor path)

```
tests/rag-benchmarks/eval/
├── xlsx_to_gold.py           # xlsx → gold_dataset.json skeleton (Phase 1)
├── match_gold_chunks.py      # preview → content_hash via ArangoDB substring (Phase 2, optional)
├── run_eval.py dump-tuples … # gold_dataset → eval_tuples.json (Phase 3)
└── run_ragas_eval.py         # eval_tuples → ragas_results.json (Phase 4)
```

`xlsx_to_gold.py` and `match_gold_chunks.py` are GENERIC (parameterised for any
benchmark xlsx + any ArangoDB source collection) and live on `main` since MR
!442. The two-phase gold-building pattern (xlsx first, then chunk matching)
keeps the corpus-independent parts off the ArangoDB dependency, so you can
author gold without an ingested corpus.

### Three-phase flow

```
┌────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│ Phase 1            │  │ Phase 2 (optional)   │  │ Phase 3              │
│ xlsx → gold.json   │→ │ match previews →     │→ │ run chatqna, capture │
│ (no corpus needed) │  │ content_hash + key   │  │ (q, contexts, ans)   │
└────────────────────┘  └──────────────────────┘  └──────────┬───────────┘
                                                           │
                                       ┌───────────────────▼─────────────┐
                                       │ Phase 4: run_ragas_eval.py       │
                                       │ judge LLM scores 4 metrics × N  │
                                       └───────────────────┬─────────────┘
                                                           │
                                       ┌───────────────────▼─────────────┐
                                       │ Phase 5: human analysis         │
                                       │ OTel + ragas → attribute failure│
                                       └─────────────────────────────────┘
```

### Phase 1 — `xlsx_to_gold.py`

Convert a benchmark xlsx to `gold_dataset.json` skeleton. Column mapping is
fully parameterised via CLI flags (defaults match the El Salvador / generic
schemas — adjust for any benchmark).

```bash
python3 -m venv /tmp/xlsx && /tmp/xlsx/bin/pip install openpyxl
/tmp/xlsx/bin/python3 xlsx_to_gold.py \
  --input-xlsx benchmark.xlsx \
  --output-json gold_dataset.json \
  --source-tag domain=<name>        # extra tag on every entry
```

Output schema matches `gold_dataset.example.json`: `entries[]` with
`{id, query, language, difficulty, categoryLabels, serviceLabels,
reference_answer, expected_chunks[{preview, source_doc}]}`. `content_hash`
and `chunk_key` are empty here — filled in Phase 2.

**Out-of-scope queries**: cells marked `N/A`, `Out-of-Scope`, `Not applicable`
become empty `expected_chunks[]`. This is correct semantics: the eval expects
zero gold chunks retrieved for an unanswerable query. (See xlsx_to_gold.py
split_passages — matches case-insensitive at cell start.)

### Phase 2 — `match_gold_chunks.py` (optional)

For ANCHOR path only (deterministic chunk-level scoring). Skip if you're only
running RAGAS — RAGAS only needs `query` + `reference_answer`, not chunk-level
identity.

Dumps `GRAPH_SOURCE` from ArangoDB, matches each `expected_chunks[].preview`
against chunk text via the same normaliser as `chunk_identity.normalize`
(whitespace-collapse, lowercase). Match strategy: **substring** — preview
appears verbatim inside chunk text (or vice versa for short previews).

Reports `match_status` per entry: `resolved_*`, `ambiguous`, `unresolved`.
Operator reviews ambiguous cases manually.

```bash
match_gold_chunks.py --gold-dataset gold.json \
  --arango-url http://<host>:8529 --arango-db <db> \
  --arango-user root --arango-password "$ARANGO_PASSWORD" \
  --graph-source GRAPH_<STACK>_SOURCE
```

### Phase 3 — dump-tuples (on the swarm node)

The chatqna container lives on the swarm node. Drive each gold query through
chatqna via internal docker exec (no OIDC, faithful label-filtered retrieval).

```bash
SWARM=<user>@<host>
scp tests/rag-benchmarks/eval/run_eval.py $SWARM:/tmp/
scp tests/rag-benchmarks/eval/{chunk_identity,metrics,arango}.py $SWARM:/tmp/
scp gold_dataset.json $SWARM:/tmp/

ssh $SWARM bash -s <<EOF
cd /tmp
export CHATQNA_CONTAINER=\$(docker ps --format '{{.Names}}' | grep chatqna-xeon-backend-server | head -1)
export CHATQNA_SERVICE_NAME=genieai-chatqna              # OTel service name
export VICTORIATRACES_SVC=<STACK>_victoriatraces         # Swarm service name (DNS, underscore)
export GRAPH_SOURCE=GRAPH_<STACK>_SOURCE
export ARANGO_URL=http://localhost:8529
export ARANGO_DB=<STACK_DB>
export ARANGO_USER=root ARANGO_PASSWORD=\$ARANGO_PASSWORD
export TRACE_FETCH_TIMEOUT=30
python3 run_eval.py dump-tuples /tmp/gold_dataset.json /tmp/eval_tuples.json
EOF
```

Time budget: ~40 s per query (chatqna roundtrip + VT trace fetch). For 42
queries ≈ 28 min. To fit a shorter shell timeout, slice `gold.entries[]`
into N round-robin chunks and run one `dump-tuples` per chunk:

```bash
python3 -c "
import json, os
gold = json.load(open('/tmp/gold_dataset.json'))
os.makedirs('/tmp/batches', exist_ok=True)
N = 5  # 42/5 → ~9 queries per batch
for i in range(N):
    chunk = dict(gold); chunk['entries'] = gold['entries'][i::N]
    open(f'/tmp/batches/gold_{i:02d}.json', 'w').write(json.dumps(chunk))
"
for f in /tmp/batches/gold_*.json; do
  python3 run_eval.py dump-tuples "$f" "/tmp/batches/tuples_$(basename "$f" .json).json"
done
```

Per-batch outputs can be merged downstream before Phase 4.

Per-query latency is dominated by the **trace fetch** — VT indexing lag on a
busy node can exceed 60 s. Raise `TRACE_FETCH_TIMEOUT` (default 120) if you
see "no reranker_selection span — trace missed" warnings.

### Phase 4 — `run_ragas_eval.py`

LLM-judged semantic scoring. Requires `eval_tuples.json` from Phase 3 plus
a configured judge endpoint. Install once on the eval runner (NOT a repo
dependency — see the script header):

```bash
pip install ragas langchain-openai
```

**Judge config (env vars)** — OpenAI-compatible, model-agnostic. Sovereign
deployments point this at any local OpenAI-compatible endpoint (vLLM,
LiteLLM, ollama, etc.). External API keys work too.

| Var | Purpose | Example |
|-----|---------|---------|
| `EVAL_JUDGE_BASE_URL` | Judge LLM endpoint | `http://127.0.0.1:3456/v1` (local), `http://<vllm-host>:8000/v1` (sovereign vLLM), `https://api.openai.com/v1` (external) |
| `EVAL_JUDGE_API_KEY` | Bearer token (use `sk-no-key` for local that ignores auth) | varies |
| `EVAL_JUDGE_MODEL` | Model id as the endpoint reports it | `ibm-granite/granite-4.1-8b` (sovereign default), `gpt-4o-mini` (external reference) |
| `EVAL_JUDGE_TEMPERATURE` | Default `0` | `0` |
| `EVAL_EMBED_BASE_URL` | Embeddings endpoint (default = judge) | optional separate endpoint |
| `EVAL_EMBED_API_KEY` | Embeddings bearer (default = judge) | optional |
| `EVAL_EMBED_MODEL` | Embedding model id (required for `answer_relevancy`) | varies |

```bash
export EVAL_JUDGE_BASE_URL=http://127.0.0.1:3456/v1
export EVAL_JUDGE_API_KEY=sk-...
export EVAL_JUDGE_MODEL="<judge-model>"
python3 run_ragas_eval.py eval_tuples.json ragas_results.json
```

**Metrics computed**:

| Metric | What it measures | Needs reference_answer? |
|--------|------------------|--------------------------|
| `faithfulness` | Is the answer grounded in the retrieved contexts? (LLM-judged, hallucination detector) | No |
| `context_precision` | Are relevant chunks ranked above irrelevant ones? (LLM-judged ranking quality) | No |
| `context_recall` | Do the retrieved contexts cover the reference answer? (LLM-judged) | Yes |
| `answer_relevancy` | Does the answer address the question? (embedding-based) | No |

If your xlsx has `reference_answer` (free — most benchmark schemas do),
you get all four. Without it, RAGAS runs `context_recall` anyway — but with
empty references, RAGAS 0.2.x returns `0.0`/`NaN` for the affected rows.
Populate `reference_answer` per query, or post-filter the report.

### Phase 5 — failure attribution (the why)

RAGAS numbers alone don't tell you WHERE the pipeline broke. Cross-reference
with OTel traces:

| Failure pattern | Stage | Fix surface |
|---|---|---|
| Low `context_recall` + OTel shows long retriever time + correct chunks NOT in candidates | **Embeddings** | Try different embedding model, check model dim matches vector index |
| Low `context_recall` + gold chunk present in ArangoDB but not in candidates | **Retriever** | Check `` `categoryLabels` `` / `` `serviceLabels` `` filter, vector index rebuild, hybrid score weights |
| Low `context_recall` + gold in candidates but NOT in top-N selected | **Reranker** | Tune `RERANKER_TOP_N`, `CONTEXT_DECAY_FACTOR`, `MIN_VALUE_THRESHOLD`, or `RERANKING_STRATEGY`. Use `calibrate.py` offline first |
| Low `context_precision` + good recall | **Reranker** (ranking) | Tune reranker weights / confusion formula |
| Low `faithfulness` + good contexts | **LLM** | Tighten `CHATQNA_SYSTEM_PROMPT`, lower temperature, swap model |
| Low `answer_relevancy` + good contexts | **LLM** | System prompt or model-language mismatch |

The VictoriaTraces Trace Explorer (Grafana) renders the full span waterfall —
combine with `rag.adaptive_breakdown` on the reranker span (when the reranker
is on the OTel-upgraded image) for per-candidate cost/utility attribution.

### End-to-end timing (42 queries)

| Phase | Time | Repeatable? |
|-------|------|-------------|
| 1 — xlsx_to_gold | <1 min | one-time per benchmark |
| 2 — match_gold_chunks | 1-2 min | one-time (anchor path) |
| 3 — dump-tuples | ~28 min | per config change |
| 4 — run_ragas_eval | ~10-15 min | per config change |
| 5 — analysis | 10-30 min | per run (Claude-driven) |

**Best ROI**: re-run Phases 3 + 4 after any config change. Phase 5 only when
scores regress.

### Reusing a gold dataset across stacks

The gold dataset is corpus-INDEPENDENT (only depends on benchmark xlsx). To
eval a different stack, just re-run Phases 3 + 4 with new env vars. The same
`gold_dataset.json` works for any deployment. Re-run Phase 2 only when the
corpus has been re-ingested (chunks get new `_key`s, but `content_hash`
survives — see "Identity" section above).

### Common pitfalls (semantic path)

- **Reasoning-token judge eats the budget**. Models exposing `reasoning_content`
  (chain-of-thought surface) burn the completion budget on internal
  reasoning, then emit empty `answer=` → RAGAS scores every metric `0`/`NaN`.
  Symptom: every metric flatlines while judge `completion_tokens` is
  non-zero. Mitigations: switch to a non-reasoning judge model, or split
  reasoning budget from answer budget at the endpoint layer (provider-
  specific, e.g. OpenAI `o-*` reasoning effort). `run_ragas_eval.py` does
  not yet expose an `EVAL_JUDGE_MAX_TOKENS` knob — fix at the endpoint
  until the script grows one.
- **Judge model must output JSON** when asked. Non-JSON responses silently
  score 0 for the affected metric. Validate with one query before launching
  the full eval.
- **Embedding model missing for answer_relevancy**. `_build_embeddings()`
  returns `None` when `EVAL_EMBED_MODEL` is unset and `_metrics()` drops
  `answer_relevancy` from the wanted list — silently, with no warning
  printed. Always set `EVAL_EMBED_MODEL` (sovereign default: `bge-large` on
  the project's vector node) to keep the 4th metric and the eval sovereign
  end-to-end.
- **Context strings truncated by chatqna's token budget**. If `contexts[i]`
  looks chopped, chatqna is fitting `prompt + history + max_answer` into
  `VLLM_MAX_MODEL_LEN - 200` (`genieai_chatqna.py:1012`). Tune via
  `VLLM_MAX_MODEL_LEN` (model window) or per-request `max_tokens` (smaller
  → more room for contexts). RAGAS judges the truncated string — bump the
  model length or drop `max_tokens` before blaming retrieval.
- **Container name with dynamic replica suffix**. Same as anchor path — never
  hardcode the chatqna container name, resolve live via `docker ps`.

### What semantic path does NOT catch

- **Retrieval regression on a SPECIFIC chunk** (anchor catches via
  `content_hash` match). If you suspect a chunk-level regression, re-run
  the anchor path alongside RAGAS.
- **Latency regressions** (no metric for that — use the OTel trace
  waterfall).
- **Cost regressions** (e.g. embedding model switched to a pricier one
  without business case). RAGAS doesn't track $.

For latency / cost attribution: the Grafana RAG Pipeline Trace Waterfall
dashboard + the OTel resource attributes on each span.
