#!/bin/bash
# run_hybrid_tests.sh

echo "=================================================="
echo "GENIE.AI Hybrid RAG Automated Test Harness"
echo "=================================================="

TEST_SCRIPT="run_rag_config_test_async.py"

echo "[1/2] Rebuilding overlay containers to apply Python orchestration updates..."
# Rebuilding ChatQnA, Reranker, and Retriever to ingest the new payload modifications
# Note: This script must be run from the project root where docker-compose.yaml is located.
# For Swarm deployments, ensure images are rebuilt and pushed to the registry before running tests.
docker build -t genie-ai-chatqna-server:latest genie-ai-overlay/chatqna/
docker build -t genie-ai-reranker:latest genie-ai-overlay/reranker/
docker build -t genie-ai-retriever-arango:latest genie-ai-overlay/retriever/
docker service update --force genieai_chatqna-xeon-backend-server genieai_reranker genieai_retriever-arango-service

echo "[2/2] Launching Python Test Harness..."
# The script will poll until ChatQnA is UP and ready
nohup python3 -u $TEST_SCRIPT > test_results.log 2>&1 &

echo "=================================================="
echo "Testing Complete."
echo "=================================================="
