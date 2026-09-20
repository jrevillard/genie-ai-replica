---
title: "Project Overview"
description: "What GENIE.AI is, its capabilities, technology stack, architecture layers, and where to read deeper."
weight: 1
section: "core"
audience: "general"
mode: explanation
persona: mixed
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

GENIE.AI is an open-source generative-AI framework for the public sector: a
sovereign, [Digital Public Good (DPG)](https://digitalpublicgoods.net)-compliant
Retrieval-Augmented Generation (RAG) platform with multilingual support. It
answers questions strictly from an indexed knowledge base you control, running
every model on infrastructure you own. It integrates with
[OPEA](https://opea.dev) (Open Platform for Enterprise AI) for AI/ML services.

This page is the **orientation layer** — what GENIE.AI is, how it is built, and
where to read deeper. Each area below has a dedicated page; this overview
intentionally stays high-level. Newcomers of every role (deployer, integrator,
content manager, sovereign reviewer) start here.

## Key capabilities

- **Grounded answers** — the LLM answers only from retrieved context and
  abstains when the knowledge base does not contain the answer.
- **Hybrid retrieval** — dense-vector search plus lexical search
  ([BM25](https://en.wikipedia.org/wiki/Okapi_BM25), keyword scoring) combined
  with reciprocal-rank fusion, plus optional knowledge-graph traversal. See
  [RAG Pipeline](/docs/rag-pipeline/).
- **Sovereign by design** — embedding, reranking, generation, and translation
  models all run on your infrastructure (OPEA / vLLM / TEI). No third-party
  model API is required for the core path.
- **Multilingual** — English is the RAG source of truth; the UI and answer
  stream are translatable, with config-driven locale availability
  (`VUE_APP_AVAILABLE_LOCALES`, `KEYCLOAK_SUPPORTED_LOCALES`; see
  [Restrict active locales](/docs/configure/locale-whitelist/)).
- **Observable** — OpenTelemetry-native metrics, logs, and traces across the
  RAG pipeline (when `ENABLE_OBSERVABILITY=1`). See
  [Observability](/docs/observe/).
- **Secure** — Keycloak OIDC identity, document antivirus scanning (ClamAV),
  PII-filtered telemetry (`tracing-pii.js`, `tracing-pii-logs.js`).

## Technology stack

| Layer | Technology |
|---|---|
| Web frontend | Vue 3, Vuex, vue-i18n, axios, ApexCharts (Vue 3 / Vue CLI) |
| Mobile | Flutter 3.10+ (Dart 3.10.8+), Riverpod (`flutter_riverpod ^3.0.0`) |
| Backend (BFF) | Node.js 22+, Express, JWT (via Keycloak), Winston |
| AI/ML | OPEA, vLLM, TEI (embeddings + reranking) |
| Database | ArangoDB 3.12+ (document + graph + vector) |
| Cache | Redis (`redis-cache` service, ioredis) |
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

Each RAG stage emits OpenTelemetry [spans](https://opentelemetry.io/docs/concepts/signals/traces/#spans)
(units of work in distributed tracing), propagated across service boundaries
with the [W3C `traceparent` header](https://www.w3.org/TR/trace-context/).
For the full C4 diagrams, authentication flows, and the service-to-service auth
matrix, see [Architecture](/docs/architecture/).

## Repository structure

GENIE.AI is organised as a multi-component monorepo with seven logical parts:

| Part | Directory |
|---|---|
| Web frontend | `components/gov-chat-frontend/` |
| Backend (BFF) | `components/gov-chat-backend/` |
| Shared backend lib | `components/shared/lib/` |
| Document repository | `components/document-repository/` |
| AI/ML overlay | `genie-ai-overlay/` |
| API gateway config | `api-gateway-solution/` |
| Deployment & ops | `deploy/`, `docker-compose.yaml`, `configs/` |

For the full source-tree walk-through, see
[Source tree analysis](/docs/core/source-tree-analysis/).

## Design principles

- **Sovereignty & data ownership** — data and models stay on infrastructure
  the operator controls.
- **Privacy by design** — grounded generation avoids leaking training-data
  knowledge; telemetry attributes are PII-filtered.
- **Standards-based interoperability** — OIDC/OAuth2, OpenTelemetry,
  OpenAI-compatible model APIs, W3C trace context.
- **Extensibility** — pluggable models, configurable prompts and retrieval
  knobs, locale-whitelisting per deployment (see
  [Restrict active locales](/docs/configure/locale-whitelist/)).
- **Operational simplicity** — single-node storage binaries, one collector
  per node, a single `docker-compose.yaml` for both Compose and Swarm.

## Where to go next

| Want to know about… | Read |
|---|---|
| The RAG pipeline end-to-end | [RAG Pipeline](/docs/rag-pipeline/) |
| Tracing, metrics, logs, dashboards | [Observability](/docs/observe/) |
| C4 diagrams, auth flows, service matrix | [Architecture](/docs/architecture/) |
| Deploying (Compose / Swarm / Ansible) | [Deployment](/docs/deploy/) |
| Identity, Keycloak, external IdPs | [Configuration](/docs/configure/) |
| Backend API contracts | [Backend](/docs/backend/) |
| Setting up a dev environment | [Development guide](/docs/core/development-guide/) |
| Frontend theming & components | [Frontend](/docs/frontend/) |
| Mobile app | [Mobile](/docs/mobile/) |
| Managing the knowledge base | [Knowledge Base](/docs/knowledge-base/) |

## Quick reference

In Docker Swarm only **Nginx (80/443)** and **ArangoDB (8529)** are
host-exposed. All other services are inter-container only on the
`genieai_network` overlay.

| Service | Container port | Host-exposed? |
|---|---|---|
| Nginx (HTTP / HTTPS) | 80 / 443 | Yes |
| ArangoDB | 8529 | Yes |
| Backend (BFF) | 3000 | No — via Kong `/api` |
| Frontend | 8090 | No — via Nginx on `/` |
| ChatQnA | 8888 | No — internal OPEA |
| Retriever | 7000 | No — internal OPEA |
| vLLM | 8000 | No — internal OPEA |
| TEI (embedding / reranker) | 80 | No — internal OPEA |
| Dataprep | 5000 | No — internal OPEA |
| Translation | 8888 | No — internal OPEA |
| Keycloak | 8080 | No — via Kong `/auth` |
| Kong | 8000 (proxy) / 8001 (admin, internal only) | No |
| PostgreSQL | 5432 | No |
| Redis | 6379 | No |
| ClamAV | 3310 | No |
| OTel Collector | 4318 (OTLP HTTP) | No |
| Grafana | 3000 | No — via Kong `/grafana/` |

If your browser can't reach a port, only **80/443 (Nginx)** and
**8529 (ArangoDB)** are reachable from the host — every other port listed
above is inter-container only and must be reached through Kong on
`https://<gateway-host>`.
