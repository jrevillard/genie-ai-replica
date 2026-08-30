---
title: Pipeline Architecture
description: End-to-end request lifecycle of the GENIE.AI RAG pipeline, from query to grounded, translated response.
weight: 1
---

The RAG pipeline is orchestrated by the **ChatQnA** mega-service
(`genie-ai-overlay/chatqna/`), a Python/FastAPI service built on the OPEA
mega-service framework. It wires together five specialist microservices into a
directed acyclic graph (DAG) and streams the final answer back to the client.

## Service roles

| Stage | Service | Stack | Role |
|---|---|---|---|
| Orchestration | **ChatQnA** | Python / FastAPI | Owns the DAG; calls each stage; enforces abstention and confidence. |
| Embedding | **TEI Embedding** | Hugging Face TEI | Vectorises the query (and chunks at ingest time). |
| Retrieval | **Retriever** | Python / ArangoDB | Hybrid vector + graph search over indexed chunks. |
| Reranking | **TEI Reranker** | Hugging Face TEI | Re-scores retrieved chunks by query relevance. |
| Generation | **vLLM** | vLLM (OpenAI-compatible) | Produces the grounded answer. |
| Translation | **Translation** (optional) | TranslaTron or vLLM | Translates the stream into the user's UI language. |

All services are containerised and communicate over the internal Docker network.
Only the backend (BFF) and the public Nginx gateway are reachable from outside
the cluster.

## Request lifecycle

```
1. Client (Web/Mobile)
2. → API Gateway (Kong)
3. → Backend BFF (Node.js/Express)   — auth, rate limit, conversation history
4. → ChatQnA (Python/FastAPI)
   4a. → Embedding (TEI)            — query → vector
   4b. → Retriever (ArangoDB)       — vector + graph search → top-K chunks
   4c. → Reranker (TEI)             — relevance re-score → top-N (default N=2)
   4d. → LLM (vLLM)                 — system prompt + chunks → streamed answer
   4e. → Translation (optional)     — stream → user language
5. ← Streamed response + confidence
```

### 1. Embedding

The user's query is sent to the embedding service, which returns a dense vector
using the configured embedding model (default
`BAAI/bge-base-en-v1.5`, 768-dim). The same model is used at ingest time so that
query and chunk vectors live in the same space.

### 2. Hybrid retrieval

The retriever searches ArangoDB with a hybrid strategy that fuses two signals:

- **Vector search** — cosine similarity between the query vector and chunk
  embeddings (top `K` after fetching a wider `fetch_k` candidate set).
- **Graph traversal** (optional) — follows knowledge-graph edges from hit chunks
  to surface related chunks the vector search would miss.

The two result sets are merged with **reciprocal-rank fusion (RRF)** controlled
by `lambda`. See [Retrieval]({{< relref "retrieval" >}}) for the full knob set.

### 3. Reranking

The candidate chunks are re-scored by a cross-encoder reranker (default
`BAAI/bge-reranker-v2-m3`). The reranker applies one of several selection
**strategies** (`adaptive`, `slice`, `threshold`, `knee_threshold`) to decide how
many chunks to keep and whether to keep any at all. The default keeps the top
`N=2` chunks.

The reranker's normalised scores feed the **confidence score** shown to the user.
See [Reranking]({{< relref "reranking" >}}).

### 4. Generation

The kept chunks are assembled into a prompt with the **system prompt** and sent
to the LLM (default `ibm-granite/granite-4.1-8b`). The system prompt instructs
the model to:

- answer **only** from the provided context,
- be concise and personalised using the user's profile and chat history,
- **abstain** when the answer is not in the context.

When self-confidence is enabled, the model also emits a `[[CONF:0-100]]` token
that the pipeline parses separately from the visible answer. See
[Generation]({{< relref "generation" >}}).

The answer is **streamed** back to the client token-by-token.

### 5. Translation (optional)

For multilingual deployments, the streamed answer can be translated into the
user's UI language on the fly by a dedicated translation model (TranslaTron or a
vLLM-hosted model). Streaming translation publishes the target language
incrementally rather than waiting for the full English answer. See
[Generation &rarr; Translation]({{< relref "generation" >}}#translation).

## Configuration surface

The pipeline is configured almost entirely through environment variables with
safe defaults. Key groups:

| Group | Representative variables |
|---|---|
| Endpoints | `EMBEDDING_SERVER_HOST_IP`, `RETRIEVER_SERVICE_HOST_IP`, `RERANK_SERVER_HOST_IP`, `VLLM_LLM_ENDPOINT` |
| Models | `EMBEDDING_MODEL_ID`, `RERANKER_MODEL_ID`, `LLM_MODEL`, `VLLM_TRANSLATION_MODEL_ID` |
| Retrieval | `RETRIEVER_ARANGO_K`, `RETRIEVER_ARANGO_FETCH_K`, `RETRIEVER_ARANGO_SCORE_THRESHOLD`, `RETRIEVER_ARANGO_LAMBDA_MULT` |
| Reranker | `RERANKING_STRATEGY`, `RERANKER_TOP_N`, `RERANKING_THRESHOLD` |
| Generation | `CHATQNA_SYSTEM_PROMPT`, `CHATQNA_ENFORCE_ABSTENTION`, `LLM_SELF_CONFIDENCE_ENABLED` |
| Translation | `TRANSLATION_ENDPOINT`, `STREAMING_TRANSLATION_ENABLED` |

> **Two-tier prompt priority.** Prompt strings follow a simple rule: an
> environment variable (highest) overrides the built-in default (lowest). This
> lets deployments customise behaviour without forking the code.

See the top-level `env` file for the canonical variable list and
[Choosing models]({{< relref "choosing-models" >}}) for model/GPU-profile
guidance.

## Tracing

Every stage emits an OpenTelemetry span. The backend injects a `traceparent`
header that ChatQnA propagates to each downstream call, so a single user query
produces one contiguous trace in VictoriaTraces / Grafana. This is what makes
latency regressions and retrieval-quality problems diagnosable. The
[Observability]({{< relref "/docs/observability" >}}) section covers how to read
those traces.
