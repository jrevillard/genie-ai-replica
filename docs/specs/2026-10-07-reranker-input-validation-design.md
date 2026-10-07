# Reranker Input Validation — Fail-Fast on Overflow

**Date**: 2026-10-07
**Status**: Draft → review
**Branch**: `fix/reranker-input-validation`
**Worktree**: `.claude/worktrees/reranker-input-validation/`

---

## Context

`docker-compose.yaml:1106` launches TEI reranker with:

```
text-embeddings-router --json-output --model-id BAAI/bge-reranker-v2-m3 \
  --max-batch-tokens 1024 --max-concurrent-requests 128 --auto-truncate
```

**Observed behaviour**: `--auto-truncate` (TEI default `true`) silently truncates each `(query, doc)` pair beyond the effective per-input token cap. TEI 1.9.3 computes this cap as `min(model.max_position_embeddings, --max-batch-tokens)`. The shipped `--max-batch-tokens=1024` clamps the model's 8192 capacity to 1024, so any oversized input is silently truncated to 1024 and returns `HTTP 200` + a saturated score (~`-8.4` after sigmoid ≈ `0.0002`). No error, no warning log on TEI. The OPEA wrapper receives the low score, the adaptive strategy filters the chunk, `reranked_docs` becomes empty, chatqna abstains.

**Note**: the spec originally named the relevant flag `--max-client-input-length`. That flag does not exist in any released TEI version (latest v1.9.4). The real control is `--max-batch-tokens` (per-batch token cap, also clamping the per-input cap). Empirically verified on `text-embeddings-router --help` against TEI 1.9.3 deployed at `govstack@10.0.0.110`.

**Impact**: silent abstention (the pipeline answers "I don't know" even though the KB contains the information). No operator-side signal; truncation cannot be distinguished from genuinely irrelevant context.

**Actual model capacity**: `bge-reranker-v2-m3` is an `XLMRobertaForSequenceClassification` with `max_position_embeddings=8194` (`config.json`) and `model_max_length=8192` (`tokenizer_config.json`). The TEI cap at 1024 tokens = 12.5 % of the model's real capacity. Architectural inconsistency between the model and its runtime.

**Empirical validation**:

| chars (input) | tokens (~) | logit (raw_scores=true) | sigmoid (default) |
|---:|---:|---:|---:|
| 6 000 | 1 100 | +4.50 (relevant visible) | 0.989 |
| 6 100 | 1 140 | -6.90 (relevant cut) | 0.001 |
| 8 000 | 1 500 | -8.69 (plateau, filler only) | 0.0002 |
| 80 000 | 14 917 | -8.69 (plateau) | 0.0002 |

With `truncate=false` per request, TEI returns `HTTP 422`:

```
{"error":"Input validation error: `inputs` must have less than 1024 tokens. Given: 19505","error_type":"Validation"}
```

The strict mode exists; it just needs to be activated.

---

## Goals

1. **Eliminate silent truncation** on the reranker path. Any input > cap ⇒ exploitable HTTP 4xx.
2. **Align cap with the model**: 8192 tokens (coherent with `max_position_embeddings`).
3. **vLLM-like consistency**: caller sees the error as an input problem, not an upstream incident.
4. **Telemetry**: OTel span + Prometheus counter so any overflow is detectable in prod.

## Non-goals

- Pre-truncation of `top_n` on the chatqna side (increases latency, doesn't fix root cause).
- Local tokenizer in the wrapper (TEI already validates; redundant).
- Rejecting legitimate requests with a single oversized chunk (legitimate RAG queries may have one long context).

---

## Design

### 1. Compose files — raise cap to model max, disable auto-truncate

**`docker-compose.yaml:1106`** (remote GPU topology, `concurrent=128`):

```
text-embeddings-router --json-output --model-id ${RERANKER_MODEL_ID:-BAAI/bge-reranker-v2-m3} \
  --max-batch-tokens ${TEI_RERANKING_MAX_BATCH_TOKENS:-1024} \
  --max-concurrent-requests ${TEI_RERANKING_MAX_CONCURRENT_REQUESTS:-32} \
  --max-client-input-length ${TEI_RERANKING_MAX_CLIENT_INPUT_LENGTH:-8192}
```

**`docker-compose.gpu.yaml:131`** (local GPU topology, `concurrent=8`):

```
text-embeddings-router --json-output --model-id ${RERANKER_MODEL_ID:-BAAI/bge-reranker-v2-m3} \
  --max-batch-tokens ${TEI_RERANKING_MAX_BATCH_TOKENS:-1024} \
  --max-concurrent-requests ${TEI_RERANKING_MAX_CONCURRENT_REQUESTS:-4} \
  --max-client-input-length ${TEI_RERANKING_MAX_CLIENT_INPUT_LENGTH:-8192}
```

Diff per file: remove `--auto-truncate`, add `--max-client-input-length 8192`, reduce `--max-concurrent-requests` to a test-env safe baseline.

**Belt-and-suspenders rationale**: `--max-client-input-length` on the runtime forces TEI to reject; removing `--auto-truncate` prevents any direct caller (curl, debug, integration test) from accidentally inheriting silent truncation.

**GPU cost** — risk table BEFORE the baseline adjustment:

| Topology | concurrent | max-input | batch-budget total | OOM risk |
|---|---:|---:|---:|---|
| Remote GPU (compose.yaml) | 128 | 8192 | 1 048 576 tokens in-flight | **High** (inacceptable in test env) |
| Local GPU (compose.gpu.yaml) | 8 | 8192 | 65 536 tokens | Moderate (measurable) |

`--max-batch-tokens=1024` caps individual forward-pass size: a doc >1024 tokens consumes the entire batch, others wait. Latency spike possible but no OOM if `--max-concurrent-requests` is calibrated for the available VRAM.

**Concurrent reduced for the first iteration** (shared .110 test env):

| File | concurrent before | concurrent after (MR) |
|---|---:|---:|
| `const/docker-compose.yaml` (remote GPU) | 128 | **32** |
| `docker-compose.gpu.yaml` (local GPU) | 8 | 4 |

Calculation: 32 × 4 096 (typical doc < 8192 tokens) = 131 072 in-flight tokens (practical mean). Theoretical peak 32 × 8192 = 262 144 tokens. Comfortable on a 24 GB GPU.

These are **test-env safety bounds**. Production value is recalibrated by the VRAM measurement in § Rollout. Env vars remain tunable (`TEI_RERANKING_MAX_CONCURRENT_REQUESTS`) — operators can bump to 64 or 128 without code changes if VRAM allows.

### 2. OPEA wrapper — fail-fast + telemetry

**File**: `genie-ai-overlay/reranker/genieai_tei_reranker.py`

Four changes:

**a. Force `truncate=false` per request** (around line 261):

```python
json={"query": query, "texts": docs, "truncate": False}
```

Belt-and-suspenders: protects against a compose-file regression (someone reintroducing `--auto-truncate` does not reintroduce silent truncation).

**b. New exception type**:

```python
class RerankerInputTooLongError(RuntimeError):
    """Raised when (query + doc) exceeds TEI's max-client-input-length.

    Distinct from the generic RuntimeError raised on TEI HTTP errors so
    callers can fail loud (HTTP 400) instead of bubbling a 503.
    """
```

**c. Detect 422 from TEI** (after the POST, around line 280):

```python
if resp.status == 422 and decoded_response.get("error_type") == "Validation":
    span.set_status(Status(StatusCode.ERROR, "Reranker input exceeds max-client-input-length"))
    span.set_attribute("reranker.input_too_long", True)
    span.set_attribute("reranker.rejected_tokens", _extract_given_tokens(decoded_response))
    raise RerankerInputTooLongError(
        f"TEI rejected input: {decoded_response.get('error', 'unknown')}"
    )
```

Helper `_extract_given_tokens` parses `"Given: 19505"` from the error message.

**d. Prometheus counter**:

```python
RERANKER_INPUT_TOO_LONG_COUNTER = meter.create_counter(
    "rag.rerank.input_too_long",
    description="Count of rerank calls rejected because input exceeded max-client-input-length",
)
```

Incremented in the `except RerankerInputTooLongError` block or in-band before the raise.

**e. Structured log** (`logger.warning`):

```
Reranker input too long: {n_docs} docs, actual={actual} tokens
```

### 3. Chatqna — graceful abstention

**File**: `genie-ai-overlay/chatqna/genieai_chatqna.py`

Catch `RerankerInputTooLongError` around the reranker microservice call. Behaviour:

- `_emit_reranker_selection_span(...)` with `selected_chunk_keys=[]`.
- API response: `abstained=true`, message: `"I cannot reliably answer this query because the retrieved documents exceed the reranker's input limit. This indicates a data ingestion issue."`
- HTTP 200 (not 400) — the caller's request is valid; abstention is a normal RAG answer.

Alternative considered: HTTP 400. **Rejected**: semantically, the frontend caller has not made an error; the internal pipeline self-protects. Abstention is more graceful and coherent with the "no confident answer" behaviour.

### 4. Tests

**a. Contract test** (`genie-ai-overlay/contracts/test_contract_reranker.py`):

New test: send an oversized input through the wrapper, verify:
1. `RerankerInputTooLongError` is raised.
2. Span attribute `reranker.input_too_long` is `true`.
3. Counter `rag.rerank.input_too_long` incremented.

**b. Unit test** (`genie-ai-overlay/tests/test_reranker.py`):

Mock TEI `session.post` returning `HTTP 422 + Validation error`. Verify the wrapper raises `RerankerInputTooLongError` (not generic `RuntimeError`).

**c. Chatqna abstention test** (`genie-ai-overlay/tests/test_chatqna.py`):

Mock reranker microservice raising `RerankerInputTooLongError`. Verify chatqna returns a response with `abstained=true` and an explicit message.

**d. Live E2E** (smoke post-rollout):

On .102: `POST /api/chat/...` with a request crafted to generate context > 8192 tokens. Verify:
- Abstention.
- Ingestion log contains "Reranker input too long".
- OTel VictoriaTraces span exposes the attribute.

---

## Deployment topology impact

### Topology 1: Remote GPU (compose.yaml)

- TEI runs on the .110 remote GPU, exposed via Kong `:444/rerank`.
- `RERANKER_SERVICE_URL=https://${GPU_NODE_HOST}/rerank` (.110).
- compose.yaml change → rebuilt client OPEA calls TEI .110 with `truncate=False`.
- TEI .110 must be rebuilt with `--max-client-input-length 8192 --auto-truncate` removed.

### Topology 2: Local GPU (compose.gpu.yaml)

- TEI runs in the swarm on the node labelled `gpu=true`.
- compose.gpu.yaml change → rebuilt client and new-rebuild TEI in the same image.

**Single image** : `genie-ai-reranker` (`docker-compose.yaml:820`). Rebuild covers both topologies. No behavioural divergence.

### Local-only path (sandbox compose)

Root `docker compose up -d` uses compose.yaml. Same fix.

---

## Rollout

### Step 1 — GPU memory validation (mandatory before merge)

**Bench script** (`scripts/bench_tei_reranker.sh`, to be created):

1. Pull a TEI reranker image rebuilt with `--max-client-input-length 8192 --max-concurrent-requests N` (N variable: 8, 16, 32, 64).
2. Launch a local container with GPU allocated, mount the `--max-client-input-length` to test.
3. Concurrent load: 100 requests / 30 s with docs of sizes 500 / 1500 / 4000 / 8000 chars (token-equivalent), 32 docs / request.
4. Measure: latency p50 / p95 / p99, throughput (req/s), VRAM peak (`nvidia-smi` every 2 s).
5. Output: readable TSV table (grep / awk compatible).

**Acceptance criteria** for MR validation:

| Concurrent tested | VRAM peak / VRAM total | Verdict |
|---:|---:|---|
| 8 | < 50 % | OK |
| 16 | < 65 % | OK |
| 32 | < 80 % | OK (recommended default) |
| 64 | < 90 % | Marginal, OK only if colleague agrees |
| 128 | ≥ 90 % or OOM | **BANNED in test env** |

**Gating**: the MR cannot be merged until the bench has run and the chosen `--max-concurrent-requests` value is documented in the changelog/PR.

**If bench fails**: rollback to `--max-client-input-length 4096` (half model, 50 % current perf). Concurrent default 64.

### Step 2 — MR from main

- Source worktree: `.claude/worktrees/reranker-input-validation/`
- Branch: `fix/reranker-input-validation` off main.
- Files modified:
  - `docker-compose.yaml`
  - `docker-compose.gpu.yaml`
  - `genie-ai-overlay/reranker/genieai_tei_reranker.py`
  - `genie-ai-overlay/chatqna/genieai_chatqna.py`
  - `genie-ai-overlay/contracts/test_contract_reranker.py`
  - `genie-ai-overlay/tests/test_reranker.py`
  - `genie-ai-overlay/tests/test_chatqna.py`
- Changelog entry `[Unreleased]`: `Fixed: reranker silently truncates inputs > 1024 tokens. Now fails fast via TEI 422. Cap raised to 8192 (model max).`
- CI: lint + test + contract. No automatic E2E (E2E scheduled).
- Merge → main.

### Step 3 — Cherry-pick on release/el-salvador

- `dev/el-salvador` reset → `release/el-salvador` (per `EL-SALVADOR-WORKFLOW.md` cycle reset).
- Validate live on .102 (ingestion logs, abstention behaviour).
- Cherry-pick via dedicated MR → `release/el-salvador` (never direct push).

### Step 4 — Rollback plan

If VRAM peak too high on .110 or abstention too frequent:
- `--max-client-input-length 4096` (compromise 50 % model max, 50 % current perf).

---

## Risks

| Risk | Probability | Mitigation |
|---|---|---|
| GPU OOM .110 with cap=8192 × concurrent=128 | Medium | VRAM measurement pre-rollout, adjust concurrent max |
| False positives (legitimate requests > 1024 tokens) | Low | Dataprep chunk_size << 1024 tokens today; logs/metrics alert if a chunk > 1024 enters circulation |
| Silent ingestion long-polymetry regression | Medium | Prometheus counter + warning log |
| Wrapper regression (422 not caught) | Low | Contract test covers the error path |

## Open questions

None at draft time.