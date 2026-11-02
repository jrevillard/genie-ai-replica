#!/bin/bash
# Port of upstream GenieAI tests/run_hybrid_tests.sh (upstream/main 672baab5).
# Launcher for run_rag_config_test_async.py — see that file's header for the
# sweep's port deviations. Sprint tracker: sprint/plan_10_17.md N.3.
#
# DEVIATIONS vs upstream (review 10-19):
#   1. cwd fix: upstream's build paths are repo-root-relative while its nohup
#      line assumes the tests/ cwd — contradictory. We resolve the repo root
#      from THIS script's location.
#   2. set -e: a failed build/service update aborts instead of sweeping
#      against stale images (upstream plows on).
#   3. Rebuild step is OPT-IN (REBUILD=1, default skipped): every swept knob
#      is a per-request field — no redeploy is needed to sweep parameters,
#      and a forced `docker service update --force` cold-restarts the stack
#      (violating eval/RUNBOOK.md warm-stack discipline; row-1 latency
#      incomparable). CAVEAT when you DO set REBUILD=1: upstream's build
#      tags below are unqualified :latest names, but this stack resolves
#      images via GENIE_AI_*_IMAGE (see deploy/ansible/templates/env.j2) —
#      build with the stack's real tags or the services never pick them up.
#      Also fixed: `docker service update` takes ONE service per call.
#   4. Sweep outputs land in logs/ (gitignored) instead of straying into the
#      repo root; interpreter is PY-overridable (aiohttp+pandas required —
#      the overlay venv has them); the final message no longer claims
#      "Testing Complete" for a background job whose fate this launcher
#      cannot see — tail the log.
# WHERE TO RUN: the sweep's TARGET_URL default is the in-network service
# name — a HOST shell cannot resolve swarm overlay DNS. Run the sweep from
# inside the network (docker exec into any genieai_network container) or set
# TARGET_URL to a published port.

echo "=================================================="
echo "GENIE.AI Hybrid RAG Automated Test Harness"
echo "=================================================="

set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"
TEST_SCRIPT="tests/run_rag_config_test_async.py"
PY="${PY:-python3}"
mkdir -p logs
export RESULTS_FILE="${RESULTS_FILE:-logs/sweep_$(date +%Y%m%d_%H%M%S).csv}"

if [ "${REBUILD:-0}" = "1" ]; then
    echo "[1/2] Rebuilding overlay containers (REBUILD=1 — mind the tag caveat in the header)..."
    # Rebuilding ChatQnA, Reranker, and Retriever to ingest the new payload modifications
    docker build -t genie-ai-chatqna-server:latest genie-ai-overlay/chatqna/
    docker build -t genie-ai-reranker:latest genie-ai-overlay/reranker/
    docker build -t genie-ai-retriever-arango:latest genie-ai-overlay/retriever/
    # docker service update takes exactly ONE service per invocation
    for svc in genieai_chatqna-xeon-backend-server genieai_reranker genieai_retriever-arango-service; do
        docker service update --force "$svc"
    done
    # Warm-stack rule (eval/RUNBOOK.md Phase 0.3): first query after the
    # update carries the cold start — re-warm with 2-3 throwaway queries.
else
    echo "[1/2] Rebuild skipped (default): every swept knob is a per-request field —"
    echo "      no redeploy needed to sweep. Set REBUILD=1 only after overlay CODE changes."
fi

echo "[2/2] Launching Python Test Harness in the background..."
# The script will poll until ChatQnA is UP and ready
nohup "$PY" -u "$TEST_SCRIPT" > logs/test_results.log 2>&1 &
echo "launched (PID $!) — log: logs/test_results.log — results: $RESULTS_FILE"

echo "=================================================="
echo "Harness is RUNNING IN BACKGROUND — this launcher's exit says nothing"
echo "about its outcome. Follow with: tail -f logs/test_results.log"
echo "=================================================="
