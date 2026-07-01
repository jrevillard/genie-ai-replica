[![pipeline status](https://opensource.unicc.org/un/itu/genie-ai/badges/main/pipeline.svg)](https://opensource.unicc.org/un/itu/genie-ai/-/pipelines?ref=main)
[![coverage report](https://opensource.unicc.org/un/itu/genie-ai/badges/main/coverage.svg)](https://opensource.unicc.org/un/itu/genie-ai/-/graphs/main/charts)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![Digital Public Good](https://img.shields.io/badge/DPG-aligned-0089D6.svg)](https://www.digitalpublicgoods.net/standard)
[![OSI Open Source AI](https://img.shields.io/badge/OSI%20Open%20Source%20AI-compliant-3DA639.svg)](https://opensource.org/ai/open-source-ai-definition)
[![documentation](https://img.shields.io/badge/docs-GENIE.AI-FF6A00.svg)](https://genie-ai-7e342b.opensource.unicc.org/)

# GENIE.AI

**GENIE.AI** is a sovereign, open-source Retrieval-Augmented Generation (RAG) framework for the public sector. It lets governments and public institutions deploy grounded, multilingual, auditable AI assistants over their own document repositories — on their own infrastructure, with full data sovereignty and no vendor lock-in.

It is compliant with the [OSI Open Source AI Definition](https://opensource.org/ai/open-source-ai-definition) and aligned with the [Digital Public Goods (DPG) Standard](https://www.digitalpublicgoods.net/standard), and integrates [OPEA (Open Platform for Enterprise AI)](https://opea.dev) for its AI/ML services.

GENIE.AI was initiated under the [ITU Open Source Ecosystem Enabler (OSEE)](https://www.itu.int/en/ITU-D/ICT-Applications/Pages/Initiatives/OSEEPSI/home.aspx) programme and is refined within the [AI for Good track on open-source generative AI for Digital Public Goods](https://aiforgood.itu.int/eventcat/discovery-open-source-ai-for-digital-public-goods/).

---

## Why GENIE.AI

Public-sector institutions face licensing costs, limited configurability, model-opacity, data-privacy and extraterritorial-exposure concerns, and weak interoperability with national systems when adopting proprietary generative AI. GENIE.AI addresses these with a standards-based, auditable, adaptable open-source alternative that deploys within national infrastructure and strengthens institutional control over data and models.

### Core characteristics

- **Fully open source and interoperable** — aligned with [GovStack principles](https://govstack.global/about/govstack-principles/) and the [DPI Universal Safeguards](https://www.dpi-safeguards.org/), for integration within national digital ecosystems.
- **Modular and adaptable** — customizable UI, hybrid RAG pipeline, support for agentic workflows and tool-calling.
- **Sovereign by design** — embedding, reranking, generation and translation models all run on infrastructure you control (OPEA / vLLM / TEI). No third-party model API is required.
- **Grounded answers** — the LLM answers only from retrieved knowledge-base content and abstains when the answer is not present.
- **Multilingual** — English as the RAG source of truth, with translated UI and answer streams (11+ languages).
- **Observable** — OpenTelemetry-native metrics, logs and traces across the whole RAG pipeline.
- **Containerized** — single `docker-compose.yaml` for both Docker Compose (local) and Docker Swarm (production), with Ansible automation.

Built on state-of-the-art open-source components for production-grade RAG — [Docling](https://github.com/docling-project/docling), [OPEA](https://opea.dev), [vLLM](https://github.com/vllm-project/vllm) — among other community-driven libraries.

---

## Quick start

### Prerequisites

- Docker and Docker Compose v2+ (with Swarm support)
- An NVIDIA GPU for optimal performance (CPU-only is possible but slow)
- A Hugging Face API token (for pulling models)

### 1. Clone

```bash
git clone https://opensource.unicc.org/un/itu/genie-ai.git
cd genie-ai
```

### 2. Configure

```bash
cp env .env
# Edit .env with your secrets: ARANGO_PASSWORD, KEYCLOAK_ADMIN_PASSWORD,
# KEYCLOAK_CLIENT_SECRET, HUGGING_FACE_HUB_TOKEN, VLLM_API_KEY, ...
```

### 3. Deploy

```bash
# Core services only
docker compose up -d

# Full stack with OPEA / AI services
docker compose --profile opea --profile gpu-models up -d

# GPU-specific overrides (e.g. NVIDIA T4)
docker compose --env-file .env --env-file env.t4 --profile opea --profile gpu-models up -d
```

### 4. Access

- **Web UI**: https://localhost/
- **API docs**: https://localhost/api-docs
- **Mobile app**: see [mobile/genie_ai_mobile/README.md](mobile/genie_ai_mobile/README.md)

For the full end-to-end install procedure, read the
[Installation & Configuration Guide](https://genie-ai-7e342b.opensource.unicc.org/docs/deployment/install-guide/).

---

## Documentation

The full documentation lives on the **[GENIE.AI Docs site](https://genie-ai-7e342b.opensource.unicc.org/)**, organised by audience:

| Section | For |
|---|---|
| [Project overview](https://genie-ai-7e342b.opensource.unicc.org/docs/core/project-overview/) | Everyone — the 10-minute orientation. |
| [RAG pipeline](https://genie-ai-7e342b.opensource.unicc.org/docs/rag/) | How retrieval, reranking and generation work. |
| [Knowledge base](https://genie-ai-7e342b.opensource.unicc.org/docs/knowledge-base/) | Content/knowledge managers — ingesting and curating documents. |
| [Deployment](https://genie-ai-7e342b.opensource.unicc.org/docs/deployment/) | Operators — install, Compose, Swarm, GPU. |
| [Operations](https://genie-ai-7e342b.opensource.unicc.org/docs/operations/) | Operators — backup/restore, updates, scaling, troubleshooting. |
| [Observability](https://genie-ai-7e342b.opensource.unicc.org/docs/observability/) | Metrics, logs, traces, dashboards, alerting. |
| [Architecture](https://genie-ai-7e342b.opensource.unicc.org/docs/architecture/) | Developers/integrators — C4 diagrams, auth flows. |

### In this repository

| File | Purpose |
|---|---|
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution guidelines and submission process. |
| [STANDARDS.md](STANDARDS.md) | Coding standards (JS, Vue 3, Node.js, Python, Bash, Docker). |
| [CLA.md](CLA.md) | Contributor License Agreement (accept before contributing). |
| [THIRD_PARTY.md](THIRD_PARTY.md) | Third-party software disclosure and licensing. |
| [UNICC-ITU-Genie-AI Code Management Process.md](UNICC-ITU-Genie-AI%20Code%20Management%20Process.md) | Development workflow, branching, code review. |
| [`site/`](./site) | Source of the Hugo/Docsy documentation site. |
| [`docs/`](./docs) | Internal engineering documentation (ADRs, e2e tests, roadmap). |

---

## Project structure

```
genie-ai/
├── components/                 # Core application components
│   ├── gov-chat-backend/       #   Node.js/Express backend (BFF)
│   ├── gov-chat-frontend/      #   Vue 3 web interface
│   ├── document-repository/    #   File upload + ClamAV scanning
│   ├── arangodb/               #   ArangoDB config + backup/restore scripts
│   └── shared/                 #   Shared libraries
├── mobile/genie_ai_mobile/     # Flutter mobile app (Android/iOS/Web/Desktop)
├── genie-ai-overlay/           # OPEA integration layer (Python/FastAPI)
│   ├── chatqna/                #   RAG orchestrator
│   ├── retriever/              #   Hybrid vector-graph retriever
│   ├── reranker/               #   Cross-encoder reranker
│   ├── dataprep/               #   Document ingestion + chunking
│   └── core/                   #   Shared types, protocols, constants
├── api-gateway-solution/       # API gateway (Kong / NGINX)
├── configs/                    # Prompts, OTel collector, Grafana dashboards
├── deploy/ansible/             # Automated Docker Swarm deployment
├── site/                       # Hugo/Docsy documentation site
├── docs/                       # Internal engineering documentation
├── tests/                      # E2E (Playwright), config validation, benchmarks
├── docker-compose.yaml         # Dual-mode: docker compose up + docker stack deploy
├── env                         # Environment template (copy to .env)
├── env.t4 / env.rtx6000        # GPU overrides (NVIDIA T4 / RTX 6000 ADA)
└── package.json                # Root Node.js scripts (lint/format/test)
```

---

## Architecture

```
1. Client layer       — Vue 3 web app, Flutter mobile
2. Identity           — Keycloak (OIDC, JWKS, JIT provisioning, service accounts)
3. API gateway        — Kong / NGINX (routing, rate limiting, TLS)
4. Application layer  — Node.js/Express backend (BFF)
5. AI layer           — OPEA microservices (ChatQnA, Retriever, Reranker, Dataprep; vLLM, TEI)
6. Data layer         — ArangoDB (graph + vector), Redis cache, file storage
```

Each RAG stage emits OpenTelemetry spans, propagated with the W3C `traceparent` header. See the [Architecture](https://genie-ai-7e342b.opensource.unicc.org/docs/architecture/) docs for the full C4 diagrams and authentication flows.

### Technology stack

| Layer | Technology |
|---|---|
| Web frontend | Vue 3, Vuex, vue-i18n, axios, ECharts/ApexCharts |
| Mobile | Flutter 3.10+, Dart, Riverpod |
| Identity | Keycloak (OIDC) |
| Backend (BFF) | Node.js, Express |
| AI/ML | OPEA, vLLM, TEI |
| Database | ArangoDB 3.12+ (document + graph + vector) |
| Cache | Redis |
| API gateway | Kong, NGINX |
| Observability | OTel SDK, VictoriaMetrics / Logs / Traces, Grafana |
| Orchestration | Docker Swarm |
| CI/CD | GitLab CI |

---

## Features

- **Multilingual RAG** — 11+ languages; English as source of truth, translated UI and answer streams.
- **Hybrid retrieval** — dense-vector + lexical (BM25) search with reciprocal-rank fusion, plus optional knowledge-graph traversal.
- **Grounded answers with abstention** — the LLM answers only from retrieved context and declines when the answer is not there.
- **Multi-platform** — web, and a Flutter mobile app (Android, iOS, Windows, macOS, Linux).
- **Security** — Keycloak OIDC, role-based access, ClamAV document scanning, PII-filtered telemetry.
- **Analytics** — usage and satisfaction analytics, admin dashboard.
- **Observable** — distributed tracing, metrics and logs across the RAG pipeline with pre-built Grafana dashboards.

---

## Deployment

GENIE.AI ships a single `docker-compose.yaml` for both local (Compose) and production (Swarm) use. Production deployments are automated with Ansible.

```bash
# Local (Compose)
docker compose up -d

# Production (Swarm)
set -a && source .env && set +a
docker stack deploy -c docker-compose.yaml genieai

# Remove
docker stack rm genieai
```

Full guides: [Docker Compose setup](https://genie-ai-7e342b.opensource.unicc.org/docs/deployment/docker-compose-setup/), [Docker Swarm setup](https://genie-ai-7e342b.opensource.unicc.org/docs/deployment/docker-swarm-setup/), [GPU deployment](https://genie-ai-7e342b.opensource.unicc.org/docs/deployment/gpu/).

---

## Development

```bash
# Backend
cd components/gov-chat-backend && npm install && npm test

# Frontend
cd components/gov-chat-frontend && npm install && npm run test

# Mobile
cd mobile/genie_ai_mobile && flutter pub get && flutter test

# Lint + format (all)
npm run lint && npm run format:check
```

See the [Development guide](https://genie-ai-7e342b.opensource.unicc.org/docs/core/development-guide/) for the full local setup.

---

## Contributing

Contributions are welcome. Before contributing:

1. Read and accept the [CLA](CLA.md).
2. Follow [CONTRIBUTING.md](CONTRIBUTING.md) and [STANDARDS.md](STANDARDS.md).
3. Respect the [Code Management Process](UNICC-ITU-Genie-AI%20Code%20Management%20Process.md) (branching, code review).
4. Comply with [THIRD_PARTY.md](THIRD_PARTY.md) for dependencies.

---

## License

Licensed under the **Apache License 2.0** — see [LICENSE](LICENSE).

---

## Resources

- [ITU Initiative on Open Source AI for Public Services](https://www.itu.int/en/ITU-D/ICT-Applications/Pages/Initiatives/ITU_OSPO/Open-Source_AI_for_Public_Services/About_the_Initiative.aspx)
- [AI for Good — Open-Source AI for Digital Public Goods track](https://aiforgood.itu.int/eventcat/discovery-open-source-ai-for-digital-public-goods/)
- [ITU Open Source Programme Office (OSPO)](https://www.itu.int/en/ITU-D/ICT-Applications/Pages/Initiatives/ITU_OSPO/About.aspx)
- [OPEA — Open Platform for Enterprise AI](https://opea.dev)
- [GovStack — Digital Public Infrastructure](https://specs.govstack.global)
- [Multi-stakeholder working group (Confluence)](https://osaips.atlassian.net/wiki/external/ZjA2MjBhMWM1NDQ4NDFhY2EzNTRiYjZjMWNjNjI3NjQ)

---

**Maintained by:** ITU (International Telecommunication Union) · **License:** Apache-2.0
