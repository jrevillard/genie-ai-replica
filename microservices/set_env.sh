#!/usr/bin/env bash

# Copyright (C) 2024 Advanced Micro Devices, Inc.
# SPDX-License-Identifier: Apache-2.0

export HUGGINGFACEHUB_API_TOKEN="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"
# export OPENAI_API_KEY="sk-..."

pushd "." > /dev/null
source .set_env.sh
popd > /dev/null

# Set OpenTelemetry Tracing Endpoint
export JAEGER_IP=$(ip route get 8.8.8.8 | grep -oP 'src \K[^ ]+')
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=grpc://$JAEGER_IP:4317
export TELEMETRY_ENDPOINT=http://$JAEGER_IP:4318/v1/traces

export LOGFLAG="True"
export no_proxy="noproxy"

# ArangoDB Configuration
export ARANGO_USERNAME="root"
export ARANGO_PASSWORD="test"
export ARANGO_DB_NAME="kenya" # "kenya"

# Dataprep Configuration
export DATAPREP_CHUNK_SIZE=500
export DATAPREP_CHUNK_OVERLAP=50
export DATAPREP_ARANGO_INSERT_ASYNC="false"
export DATAPREP_ARANGO_USE_GRAPH_NAME="true"
export DATAPREP_NODE_PROPERTIES=""
export DATAPREP_RELATIONSHIP_PROPERTIES=""
export DATAPREP_OPENAI_CHAT_ENABLED="true"
export DATAPREP_OPENAI_EMBED_ENABLED="true"
export DATAPREP_EMBED_NODES="true"
export DATAPREP_EMBED_RELATIONSHIPS="true"
export DATAPREP_EMBED_SOURCE_DOCUMENTS="true"
export DATAPREP_ARANGO_GRAPH_NAME="GRAPH"
# export DATAPREP_SYSTEM_PROMPT_PATH = "./todo/ # REVISIT

# Retriever Configuration
# Current configuration: Chunk-based RAG (i.e no Full-Text Search, No Graph)

# - To enable Full-Text Search, set "RETRIEVER_ARANGO_SEARCH_MODE" to "hybrid"
# - To enable Graph Search, set "RETRIEVER_ARANGO_TRAVERSAL_ENABLED" to "true"
#     - (Optional) Set "RETRIEVER_ARANGO_TRAVERSAL_MAX_DEPTH" to the preferred maximum depth of the graph traversal
# - To enable Approximate Search (Approximate Nearest Neighbor instead of K-Nearest Neighbors), set "RETRIEVER_ARANGO_USE_APPROX_SEARCH" to "true"

export RETRIEVER_ARANGO_SEARCH_START="chunk" # <---- "node", "edge", "chunk"
export RETRIEVER_ARANGO_SEARCH_MODE="hybrid" # <-----
export RETRIEVER_ARANGO_TRAVERSAL_ENABLED="false" # <-----
export RETRIEVER_ARANGO_TRAVERSAL_MAX_DEPTH=0 # <-----
export RETRIEVER_ARANGO_USE_APPROX_SEARCH="false"
export RETRIEVER_SUMMARIZER_ENABLED="false"
export RETRIEVER_OPENAI_CHAT_ENABLED="true"
export RETRIEVER_OPENAI_EMBED_ENABLED="true"
export RETRIEVER_OPENAI_EMBED_MODEL="text-embedding-3-small"

# VLLM Configuration
export VLLM_ENDPOINT="http://vllm:80"
export VLLM_API_KEY="eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJBV2QyR2lmQVRFT2wtRExhdFF0Qi1GRGRXVHRDdzlONUZWYWpXR2EwTjRzIn0.eyJleHAiOjE3NDQzNDA2OTcsImlhdCI6MTc0MzAwMTQ5NywianRpIjoiMDU5ZDg1YTUtYTlmOC00NTBhLTg5ODktYjRhYTJkZDczZDA0IiwiaXNzIjoiaHR0cHM6Ly9pbmZlcmVuY2UtYXBpLmNsb3VkLmRlbnZyZGF0YS5jb20vcmVhbG1zL21hc3RlciIsImF1ZCI6ImFjY291bnQiLCJzdWIiOiJkMGJjYjQ3Zi1lYTI4LTQ1YjQtYjQyOS0zNGExMjAzMWVlOTkiLCJ0eXAiOiJCZWFyZXIiLCJhenAiOiJ1bl9pdHVfUHJlZXRoaV92cnMiLCJhY3IiOiIxIiwicmVhbG1fYWNjZXNzIjp7InJvbGVzIjpbImRlZmF1bHQtcm9sZXMtbWFzdGVyIiwib2ZmbGluZV9hY2Nlc3MiLCJ1bWFfYXV0aG9yaXphdGlvbiJdfSwicmVzb3VyY2VfYWNjZXNzIjp7ImFjY291bnQiOnsicm9sZXMiOlsibWFuYWdlLWFjY291bnQiLCJtYW5hZ2UtYWNjb3VudC1saW5rcyIsInZpZXctcHJvZmlsZSJdfX0sInNjb3BlIjoicHJvZmlsZSBjdXN0b21fbW9kZWxfbGxhbWFfM184QiBlbWFpbCIsImNsaWVudEhvc3QiOiIxMC4yMzMuOTIuMTU4IiwiZW1haWxfdmVyaWZpZWQiOmZhbHNlLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJzZXJ2aWNlLWFjY291bnQtdW5faXR1X3ByZWV0aGlfdnJzIiwiY2xpZW50QWRkcmVzcyI6IjEwLjIzMy45Mi4xNTgiLCJjbGllbnRfaWQiOiJ1bl9pdHVfUHJlZXRoaV92cnMifQ.S9KcGTwc8MIK7vTm9NrWGM0hGcxdRDD6XEhu5E3zJCHQNJLaVDzJv_CC-jDwPYMPK4fHV0AsRXBstJUDDG0DFsFDDYr9z0rhwCgVVCX36m2WS7E9mOPoLzOFW-Rp8evfLOr2xbF0PtU7eeSbTP6g0zou1MA0BMJVq86EkMDwDgH41Ns4frAHuM0nKzbzMDqHtLbuF8Ey_EzAmbnzB5xYHICV2AEqN6sd_G_Zgbf9fA6NL801_3ebtHgH5QIjz92KyrNCqG8fZSWrfpuXOSfgfwMyfMBn7QhSqW5ZkhkxTcQDEDKZEsbmNhHHQx-M_bSt3MemnVRB-4JpprJ6W6yBWA" # "EMPTY"

# Commenting out the old endpoint token (expired on 26 March)
# export VLLM_API_KEY="eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJBV2QyR2lmQVRFT2wtRExhdFF0Qi1GRGRXVHRDdzlONUZWYWpXR2EwTjRzIn0.eyJleHAiOjE3NDI5ODczOTUsImlhdCI6MTc0MTY0ODE5NSwianRpIjoiYzcwY2NiMjEtZTI5My00MmJjLTkwZDktMTE1MDFmNDUwZTVhIiwiaXNzIjoiaHR0cHM6Ly9pbmZlcmVuY2UtYXBpLmNsb3VkLmRlbnZyZGF0YS5jb20vcmVhbG1zL21hc3RlciIsImF1ZCI6ImFjY291bnQiLCJzdWIiOiJkMGJjYjQ3Zi1lYTI4LTQ1YjQtYjQyOS0zNGExMjAzMWVlOTkiLCJ0eXAiOiJCZWFyZXIiLCJhenAiOiJ1bl9pdHVfUHJlZXRoaV92cnMiLCJhY3IiOiIxIiwicmVhbG1fYWNjZXNzIjp7InJvbGVzIjpbImRlZmF1bHQtcm9sZXMtbWFzdGVyIiwib2ZmbGluZV9hY2Nlc3MiLCJ1bWFfYXV0aG9yaXphdGlvbiJdfSwicmVzb3VyY2VfYWNjZXNzIjp7ImFjY291bnQiOnsicm9sZXMiOlsibWFuYWdlLWFjY291bnQiLCJtYW5hZ2UtYWNjb3VudC1saW5rcyIsInZpZXctcHJvZmlsZSJdfX0sInNjb3BlIjoicHJvZmlsZSBjdXN0b21fbW9kZWxfbGxhbWFfM184QiBlbWFpbCIsImNsaWVudEhvc3QiOiIxMC4yMzMuOTIuMTU4IiwiZW1haWxfdmVyaWZpZWQiOmZhbHNlLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJzZXJ2aWNlLWFjY291bnQtdW5faXR1X3ByZWV0aGlfdnJzIiwiY2xpZW50QWRkcmVzcyI6IjEwLjIzMy45Mi4xNTgiLCJjbGllbnRfaWQiOiJ1bl9pdHVfUHJlZXRoaV92cnMifQ.vvW1h-usSHIEJTl4wajDKDfmp2ZAxVH4Wy8VJD9jGOy8FxDHn1I5PPBt1ZL4Q2m1O3g_sGfWD5HPX60BPsRGi4rjQSgcLyq3r7ElK3LPliPZFIzRgz4sxQiD3IBkEib8bKZGmdSQ93z_2tQ51tImfbnkuJtilrFa7h48yVct30Y1bhNidbeV6z8HYPcYGd2dIkUA8Wp6UgyoUY3sa1jyOj9ZLATGBG788HZm7AAG65FcHIg0bjh1Ox_W25aSgDUKhIXlh5r_jqbSg14Qf-OvbxdQEGZ_FLWoWPjM9xRVpG3IELVWUmtqqtEhsXbsEFAaJWObcfxKD31JLZuznjeGoA" # "EMPTY"

# Model Configuration
export EMBEDDING_MODEL_ID="BAAI/bge-base-en-v1.5" # TODO: change if needed
export RERANK_MODEL_ID="BAAI/bge-reranker-base"
export LLM_MODEL_ID="meta-llama/Llama-3.3-70B-Instruct" #"Intel/neural-chat-7b-v3-3" # meta-llama/Meta-Llama-3-8B-Instruct
export TEI_EMBED_MODEL="BAAI/bge-base-en-v1.5"

# NOTE: Envs not used for now:

# # Jaeger Configuration
# export JAEGER_IP=$(ip route get 8.8.8.8 | grep -oP 'src \K[^ ]+')
# export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=grpc://$JAEGER_IP:4317
# export TELEMETRY_ENDPOINT=http://$JAEGER_IP:4318/v1/traces
