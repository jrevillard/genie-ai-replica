#!/bin/bash
# bench_tei_reranker.sh — measure TEI reranker VRAM + latency across concurrent values.
#
# Spec: docs/specs/2026-10-07-reranker-input-validation-design.md § Rollout Step 1.
# Gate: must run before merging the reranker input validation MR; the MR description
# must cite the chosen --max-concurrent-requests value backed by this bench.
#
# Acceptance criteria (per spec):
#   concurrent=8  → VRAM peak < 50% total → OK
#   concurrent=16 → VRAM peak < 65% total → OK
#   concurrent=32 → VRAM peak < 80% total → OK (recommended default)
#   concurrent=64 → VRAM peak < 90% total → marginal, OK only if colleague agrees
#   concurrent=128 → VRAM peak ≥ 90% or OOM → BANNED in test env
#
# All load generation and sampling run ON the GPU node via ssh — the TEI
# container is only reachable there, so local curls would measure nothing.
#
# Output: TSV on stdout, one row per (concurrent, n_docs) combo:
#   concurrent<TAB>n_docs<TAB>latency_p50_ms<TAB>latency_p95_ms<TAB>latency_p99_ms<TAB>throughput_rps<TAB>vram_peak_mib<TAB>timestamp
# Grep/awk compatible. No JSON, no fancy output — easy to paste in a MR description.
#
# Usage:
#   TEI_IMAGE=registry/.../genie-ai-reranker:<tag> \
#     GPU_NODE=<user>@<host> \
#     scripts/bench_tei_reranker.sh
#
# Requirements:
#   - ssh access to a node with GPU + nvidia-smi (default: $GPU_NODE)
#   - docker, curl and shuf on the remote host
#   - python3 on the LOCAL host (for the payload-generation helper)
set -euo pipefail

: "${TEI_IMAGE:?TEI_IMAGE must point to a reranker image}"
: "${GPU_NODE:?GPU_NODE must be set (user@host)}"

CONCURRENTS="${CONCURRENTS:-8 16 32 64 128}"
N_DOCS="${N_DOCS:-32}"
DOC_SIZES_CHARS="${DOC_SIZES_CHARS:-500 1500 4000 8000}"
DURATION_S="${DURATION_S:-30}"
BENCH_PORT="${BENCH_PORT:-18080}"
RERANKER_MODEL_ID="${RERANKER_MODEL_ID:-BAAI/bge-reranker-v2-m3}"
TEI_RERANKING_MAX_BATCH_TOKENS="${TEI_RERANKING_MAX_BATCH_TOKENS:-8192}"
TEI_RERANKING_AUTO_TRUNCATE="${TEI_RERANKING_AUTO_TRUNCATE:-false}"
REMOTE_DIR="/tmp/tei-bench-$$"

# 1) Generate the doc corpus (deterministic, easy to replay).
TMPDIR_LOCAL=$(mktemp -d)
CONTAINER_ID=""
cleanup() {
    if [ -n "$CONTAINER_ID" ]; then
        ssh "${GPU_NODE}" "docker kill ${CONTAINER_ID} >/dev/null 2>&1 || true" >/dev/null 2>&1 || true
    fi
    ssh "${GPU_NODE}" "rm -rf ${REMOTE_DIR}" >/dev/null 2>&1 || true
    rm -rf "$TMPDIR_LOCAL"
}
trap cleanup EXIT
python3 - <<PY > "$TMPDIR_LOCAL/docs.tsv"
import random
random.seed(42)
sizes = [int(s) for s in "${DOC_SIZES_CHARS}".split()]
with open("$TMPDIR_LOCAL/docs.tsv", "w") as f:
    for size in sizes:
        for i in range(${N_DOCS}):
            text = " ".join(["word"] * (size // 5))
            f.write(f"{size}\t{text}\n")
PY
ssh "${GPU_NODE}" "mkdir -p ${REMOTE_DIR}"

echo -e "concurrent\tn_docs\tdoc_size_chars\tlatency_p50_ms\tlatency_p95_ms\tlatency_p99_ms\tthroughput_rps\tvram_peak_mib\ttimestamp"
for CONCURRENT in $CONCURRENTS; do
    # Launch the reranker container ONCE per concurrent value (it depends only
    # on CONCURRENT, not on doc size) and iterate the doc sizes against the
    # same warm container. TEI takes --max-concurrent-requests as a CLI FLAG
    # (no env var exists), and the image entrypoint is fixed at build time —
    # so override the entrypoint to vary the parameter under test. The port
    # is bound to the remote loopback only; load curls run on the remote host.
    CONTAINER_ID=$(ssh "${GPU_NODE}" "docker run -d --rm --gpus all \
        -p 127.0.0.1:${BENCH_PORT}:80 \
        --entrypoint /bin/sh ${TEI_IMAGE} -c \
        'text-embeddings-router --json-output \
         --model-id ${RERANKER_MODEL_ID} \
         --max-batch-tokens ${TEI_RERANKING_MAX_BATCH_TOKENS} \
         --max-concurrent-requests ${CONCURRENT} \
         --auto-truncate ${TEI_RERANKING_AUTO_TRUNCATE}'" 2>/dev/null | tr -d '\r')

    # Wait for TEI /health to come up (timeout 60s) with a SINGLE ssh that
    # retries remotely — one connection instead of one per second. The probe
    # runs INSIDE the container via docker exec on the actual container id.
    if ! ssh "${GPU_NODE}" "docker exec ${CONTAINER_ID} curl -sf http://127.0.0.1:80/health >/dev/null 2>&1"; then
        if ! ssh "${GPU_NODE}" "for i in \$(seq 1 60); do docker exec ${CONTAINER_ID} curl -sf http://127.0.0.1:80/health >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1"; then
            echo "ERROR: TEI container ${CONTAINER_ID} (concurrent=${CONCURRENT}) never became healthy; skipping concurrent value" >&2
            ssh "${GPU_NODE}" "docker kill ${CONTAINER_ID} >/dev/null 2>&1 || true"
            CONTAINER_ID=""
            continue
        fi
    fi

    for DOC_SIZE_CHARS in $DOC_SIZES_CHARS; do
        # Pre-generate request payloads for this doc size (query + 8 random
        # docs). Replayed by `shuf` on the remote host so each request still
        # samples a different doc subset without needing python3 remotely.
        python3 - "$TMPDIR_LOCAL/docs.tsv" "$DOC_SIZE_CHARS" > "$TMPDIR_LOCAL/payloads.jsonl" <<'PY'
import json, random, sys

docs_path, size = sys.argv[1], int(sys.argv[2])
random.seed(42 + size)
docs = [
    line.split("\t", 1)[1].rstrip("\n")
    for line in open(docs_path)
    if line.startswith(f"{size}\t")
]
for _ in range(200):
    print(
        json.dumps(
            {
                "query": "what is the answer?",
                "texts": random.sample(docs, k=min(8, len(docs))),
                "truncate": False,
            }
        )
    )
PY
        scp -q "$TMPDIR_LOCAL/payloads.jsonl" "${GPU_NODE}:${REMOTE_DIR}/payloads.jsonl"

        # Start VRAM sampling CONCURRENTLY with the load — nvidia-smi polls
        # every 2s on the remote GPU node into a local log; peak extracted
        # after the load finishes. Sampling before launch would measure
        # model-load spikes; after `wait` would measure idle.
        VRAM_LOG="$TMPDIR_LOCAL/vram_${CONCURRENT}_${DOC_SIZE_CHARS}.log"
        ssh "${GPU_NODE}" "nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits -l 2" > "$VRAM_LOG" 2>/dev/null &
        VRAM_SAMPLER_PID=$!

        # Run the concurrent load ON the GPU node. Latencies are sorted
        # remotely and streamed back for local percentile computation.
        START_TS=$(date +%s.%N)
        ssh "${GPU_NODE}" "BENCH_PORT=${BENCH_PORT} PAYLOADS=${REMOTE_DIR}/payloads.jsonl \
            DURATION_S=${DURATION_S} CONCURRENT=${CONCURRENT} bash -s" <<'REMOTE_LOAD' > "$TMPDIR_LOCAL/latencies_sorted.txt"
RESULTS="$(mktemp)"
END=$(( $(date +%s) + DURATION_S ))
for _ in $(seq 1 "$CONCURRENT"); do
    (
        while [ "$(date +%s)" -lt "$END" ]; do
            PAYLOAD=$(shuf -n 1 "$PAYLOADS")
            curl -s -X POST "http://127.0.0.1:${BENCH_PORT}/rerank" \
                -H 'Content-Type: application/json' \
                --data-binary "$PAYLOAD" \
                -w '%{time_total}\n' -o /dev/null >> "$RESULTS" || true
        done
    ) &
done
wait
sort -n "$RESULTS"
rm -f "$RESULTS"
REMOTE_LOAD
        END_TS=$(date +%s.%N)

        # Stop the VRAM sampler and extract the peak sample.
        kill "$VRAM_SAMPLER_PID" 2>/dev/null || true
        wait "$VRAM_SAMPLER_PID" 2>/dev/null || true
        VRAM_PEAK=$( { sort -n "$VRAM_LOG" || true; } | tail -1 | tr -d '\r ')
        [ -n "$VRAM_PEAK" ] || VRAM_PEAK="NA"

        # Compute latencies from the remotely sorted per-request times.
        TOTAL_REQS=$(wc -l < "$TMPDIR_LOCAL/latencies_sorted.txt")
        ELAPSED=$(echo "$END_TS - $START_TS" | bc -l)
        THROUGHPUT=$(echo "scale=4; $TOTAL_REQS / $ELAPSED" | bc -l)
        P50=$(awk -v n="$TOTAL_REQS" 'NR==int(n*0.50){print $1*1000}' "$TMPDIR_LOCAL/latencies_sorted.txt")
        P95=$(awk -v n="$TOTAL_REQS" 'NR==int(n*0.95){print $1*1000}' "$TMPDIR_LOCAL/latencies_sorted.txt")
        P99=$(awk -v n="$TOTAL_REQS" 'NR==int(n*0.99){print $1*1000}' "$TMPDIR_LOCAL/latencies_sorted.txt")

        echo -e "$CONCURRENT\t${N_DOCS}\t${DOC_SIZE_CHARS}\t${P50:-NA}\t${P95:-NA}\t${P99:-NA}\t${THROUGHPUT}\t${VRAM_PEAK}\t$(date -Iseconds)"
    done

    # Tear down the container before the next concurrent value.
    ssh "${GPU_NODE}" "docker kill ${CONTAINER_ID} >/dev/null 2>&1 || true"
    CONTAINER_ID=""
done
