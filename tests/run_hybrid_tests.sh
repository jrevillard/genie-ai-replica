#!/bin/bash
# run_hybrid_tests.sh

echo "=================================================="
echo "GENIE.AI Hybrid RAG Automated Test Harness"
echo "=================================================="

TEST_SCRIPT="run_rag_config_test_async.py"

echo "[1/2] Rebuilding overlay containers to apply Python orchestration updates..."
# Rebuilding ChatQnA, Reranker, and Retriever to ingest the new payload modifications
docker compose build chatqna-xeon-backend-server reranker retriever-arango-service
docker compose up -d chatqna-xeon-backend-server reranker retriever-arango-service

echo "[2/2] Launching Python Test Harness..."
# The script will poll until ChatQnA is UP and ready
nohup python3 -u $TEST_SCRIPT > test_results.log 2>&1 &

echo "=================================================="
echo "Testing Complete."
echo "=================================================="