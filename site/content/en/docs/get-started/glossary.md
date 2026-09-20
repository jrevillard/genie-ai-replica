---
title: "Glossary"
weight: 7
description: "Every acronym from BM25 to RAG to OPEA — a one-line definition for each."
mode: reference
persona: mixed
owner: docs-stewards
last_reviewed: 2026-09-18
---

## A–Z

| Term | Definition |
|---|---|
| **Ansible** | Agentless automation tool used for the production Swarm deploy (`deploy/ansible/`). |
| **ArangoDB** | Multi-model database (document + graph + vector) that holds the knowledge base. |
| **BFF** | "Backend for frontend" — the `gov-chat-backend` Node.js service that brokers HTTP for both web and mobile clients. |
| **BM25** | Classic lexical relevance score used alongside vector search in hybrid retrieval. |
| **ChatQnA** | The OPEA mega-service that orchestrates the RAG pipeline. |
| **ClamAV** | Open-source antivirus used by the document repository to scan uploads. |
| **Contextual Retrieval** | Anthropic-style technique: prepend an LLM-generated doc-context prefix to each chunk before embedding, improving retrieval precision. Enabled by `CONTEXTUAL_RETRIEVAL_ENABLED=true`. |
| **Diataxis** | Documentation framework that splits docs into **Tutorial**, **How-to**, **Reference**, **Explanation**. Every doc on this site carries a `mode:` field reflecting its quadrant. |
| **DPG** | Digital Public Goods — a UN-endorsed standard for open-source projects. GENIE.AI targets DPG compliance. |
| **Docling** | IBM document-parser used by `dataprep` to turn PDFs / DOCX / HTML into chunks. |
| **Docsy** | The Hugo theme this site is built on. |
| **Embedding** | A 768-D vector representation of a text passage (BAAI/bge-base-en-v1.5 by default). |
| **Fluentd** | Log forwarder used by every container (Docker `fluentd` driver) to ship stdout/stderr to the OTel Collector. |
| **Grafana** | The dashboards + alerting UI for the observability stack. Reachable at `/grafana/`. |
| **Hybrid retrieval** | Combines vector search (semantic) with BM25 (lexical) and fuses the scores. Enabled by `RETRIEVER_HYBRID_RETRIEVAL_ENABLED` (default `true`). `RETRIEVER_ARANGO_SEARCH_MODE` (default `vector`) is independent and selects the dense strategy — similarity vs Maximum Marginal Relevance (MMR). |
| **JWT** | JSON Web Token — the format of Keycloak access tokens used to authorize API calls. |
| **Keycloak** | OIDC identity provider; default realm is `genie`. |
| **Kong** | API gateway that fronts every service; routes by path prefix. |
| **MELT seam** | The backend abstraction that exposes **M**etrics, **E**vents, **L**ogs, **T**races to the admin UI. |
| **NGINX** | TLS-terminating reverse proxy exposed on 80 / 443. |
| **OIDC** | OpenID Connect — the protocol used for SSO via Keycloak. |
| **OPEA** | Open Platform for Enterprise AI — the framework GENIE.AI's RAG pipeline is built on. |
| **OTel** | OpenTelemetry — the standard for emitting traces, metrics, and logs. |
| **OTLP** | OpenTelemetry Line Protocol — the wire format over which app services ship telemetry to the Collector. |
| **RAG** | Retrieval-Augmented Generation — answer questions by grounding an LLM in retrieved documents. |
| **Reranker** | A cross-encoder that re-scores the top-K retrieval candidates. |
| **Retriever** | The microservice that fetches candidate chunks from ArangoDB. |
| **ROPC** | Resource Owner Password Credentials (also called "Direct Access Grant") — a Keycloak grant. **Disabled by default** for security. |
| **SSE** | Server-Sent Events — the wire format ChatQnA streams the response over. |
| **TEI** | Text Embeddings Inference — HuggingFace's serving runtime for embedding and reranking models. |
| **TEI Reranker** | The reranker microservice; runs a cross-encoder model. |
| **TEI Embedding** | The embedding microservice; runs an encoder model. |
| **Translation** | Optional microservice that translates the LLM response to the user's UI locale. |
| **vLLM** | The high-throughput LLM serving runtime; runs the chat + labeling models. |
| **VictoriaLogs** | Single-node log store used by the observability stack. |
| **VictoriaMetrics** | Single-node metrics store. |
| **VictoriaTraces** | Single-node trace store; exposes a Jaeger-compatible API. |
| **W3C `traceparent`** | The standard HTTP header used to propagate trace context across service boundaries. |
| **WSS** | WebSocket Secure — the CSP allows `wss://<domain>` for WebSocket traffic, but the admin logs UI currently uses on-demand request/response search against `/api/admin/logs/*` rather than live WebSocket tailing. |

## Related

- [Concepts in 5 minutes](/docs/get-started/concepts/)
- [Reference → Glossary](/docs/reference/glossary/)
- [Architecture overview](/docs/architecture/architecture/)