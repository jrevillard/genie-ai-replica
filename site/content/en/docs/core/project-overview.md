---
title: "Project Overview"
description: "What GENIE.AI is, its capabilities, technology stack, architecture layers, and where to read deeper."
weight: 1
section: "core"
---

GENIE.AI is an open-source generative-AI framework for the public sector: a
sovereign, Digital Public Good (DPG)-compliant Retrieval-Augmented Generation
(RAG) platform with multilingual support. It answers questions strictly from an
indexed knowledge base you control, running every model on infrastructure you
own. It integrates with [OPEA](https://opea.dev) (Open Platform for Enterprise
AI) for AI/ML services.

This page is the **orientation layer** — what GENIE.AI is, how it is built, and
where to read deeper. Each area below has a dedicated page; this overview
intentionally stays high-level.

## Key capabilities

- **Grounded answers** — the LLM answers only from retrieved context and
  abstains when the knowledge base does not contain the answer.
- **Hybrid retrieval** — dense-vector + lexical (BM25) search with reciprocal-rank
  fusion, plus optional knowledge-graph traversal. See
  [RAG Pipeline]({{< relref "/docs/rag" >}}).
- **Sovereign by design** — embedding, reranking, generation, and translation
  models all run on your infrastructure (OPEA / vLLM / TEI). No third-party model
  API is required.
- **Multilingual** — English is the RAG source of truth; the UI and answer stream
  are translatable, with config-driven locale availability.
- **Observable** — OpenTelemetry-native metrics, logs, and traces across the RAG
  pipeline. See [Observability]({{< relref "/docs/observability" >}}).
- **Secure** — Keycloak OIDC identity, document antivirus scanning, PII-filtered
  telemetry.

## Technology stack

| Layer | Technology |
|---|---|
| Web frontend | Vue 3, Vuex, vue-i18n, axios, ECharts / ApexCharts |
| Mobile | Flutter 3.10+, Dart, Riverpod |
| Backend (BFF) | Node.js 22+, Express, JWT, winston |
| AI/ML | OPEA, vLLM, TEI (embeddings + reranking) |
| Database | ArangoDB 3.12+ (document + graph + vector) |
| Cache | Redis |
| Identity | Keycloak (OIDC) |
| API gateway | Kong, NGINX |
| Observability | OTel SDK, VictoriaMetrics / Logs / Traces, Grafana |
| Orchestration | Docker Swarm |
| CI/CD | GitLab CI |

## Architecture layers

```
1. Client Layer      — Vue 3 web app, Flutter mobile
2. API Gateway       — Kong / NGINX
3. Application Layer — Node.js/Express backend (BFF)
4. AI Layer          — OPEA microservices (ChatQnA, Retriever, Reranker, Dataprep)
5. Data Layer        — ArangoDB (graph + vector), Redis, file storage
```

Each RAG stage emits OpenTelemetry spans, propagated across service boundaries
with the W3C `traceparent` header. For the full C4 diagrams, authentication
flows, and the service-to-service auth matrix, see
[Architecture]({{< relref "/docs/architecture" >}}).

## Repository structure

GENIE.AI is organised as a multi-component monorepo with seven logical parts:

| Part | Directory |
|---|---|
| Web frontend | `components/gov-chat-frontend/` |
| Backend (BFF) | `components/gov-chat-backend/` |
| Document repository | `components/document-repository/` |
| AI/ML overlay | `genie-ai-overlay/` |
| API gateway config | `api-gateway-solution/` |
| Deployment | `deploy/`, `docker-compose.yaml` |
| Configuration | `configs/` (prompts, OTel, Grafana) |

For the full source-tree walk-through, see
[Source tree analysis]({{< relref "/docs/core/source-tree-analysis" >}}).

## Design principles

- **Sovereignty & data ownership** — data and models stay on infrastructure the
  operator controls.
- **Privacy by design** — grounded generation avoids leaking training-data
  knowledge; telemetry attributes are PII-filtered.
- **Standards-based interoperability** — OIDC/OAuth2, OpenTelemetry,
  OpenAI-compatible model APIs, W3C trace context.
- **Extensibility** — pluggable models, configurable prompts and retrieval knobs,
  locale-whitelisting per deployment.
- **Operational simplicity** — single-node storage binaries, one collector per
  node, a single `docker-compose.yaml` for both Compose and Swarm.

## Where to go next

| Want to know about… | Read |
|---|---|
| The RAG pipeline end-to-end | [RAG Pipeline]({{< relref "/docs/rag" >}}) |
| Tracing, metrics, logs, dashboards | [Observability]({{< relref "/docs/observability" >}}) |
| C4 diagrams, auth flows, service matrix | [Architecture]({{< relref "/docs/architecture" >}}) |
| Deploying (Compose / Swarm / Ansible) | [Deployment]({{< relref "/docs/deployment" >}}) |
| Identity, Keycloak, external IdPs | [Configuration]({{< relref "/docs/configuration" >}}) |
| Backend API contracts | [Backend]({{< relref "/docs/backend" >}}) |
| Setting up a dev environment | [Development guide]({{< relref "/docs/core/development-guide" >}}) |
| Frontend theming & components | [Frontend]({{< relref "/docs/frontend" >}}) |
| Mobile app | [Mobile]({{< relref "/docs/mobile" >}}) |
| Managing the knowledge base | [Knowledge Base]({{< relref "/docs/knowledge-base" >}}) |

## Quick reference

Common service ports (Swarm — only Nginx and ArangoDB are host-exposed; all
others are internal):

| Service | Port |
|---|---|
| Nginx (HTTP / HTTPS) | 80 / 443 |
| ArangoDB | 8529 |
| Backend (BFF) | 3000 |
| Frontend | 5173 |
| ChatQnA | 8888 |
| Retriever | 7000 |
| vLLM | 8000 |
| TEI (embedding / reranker) | 80 |
| Grafana (via Kong `/grafana/`) | — |
