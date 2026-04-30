---
stepsCompleted: ['step-01-init', 'step-02-context', 'step-03-starter']
inputDocuments:
  - "_bmad-output/planning-artifacts/prd.md"
  - "_bmad-output/planning-artifacts/implementation-readiness-report-2026-04-30.md"
  - "docs/architecture.md"
  - "docs/roadmap-sprint-20-to-25.md"
  - "_bmad-output/project-context.md"
workflowType: 'architecture'
project_name: 'genie-ai'
user_name: 'God'
date: '2026-04-30'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Starter Template Evaluation

### Primary Technology Domain

Brownfield agent infrastructure — extending existing Python/OPEA tier microservices. No starter template applies. New services (Tool Registry, Tool Executor, Stream Ingestor) must follow the architectural patterns established by existing OPEA services (ChatQnA, Retriever, Dataprep).

### Selected Foundation: Existing GENIE.AI Codebase

**Rationale:** The three new services integrate directly into the existing RAG pipeline and must share language, runtime, logging, configuration, deployment, and monitoring patterns with the OPEA tier. Introducing a separate starter template would create architectural inconsistency.

**Established Patterns New Services Must Follow:**

**Language & Runtime:**
- Python 3.11+, FastAPI
- `CustomLogger` from `comps` library for structured logging
- Environment configuration via `os.getenv()` with sensible defaults
- Ruff for linting and formatting (`pyproject.toml` configuration in `genie-ai-overlay/`)
- Copyright headers (ITU for new services, Intel+ITU for OPEA adaptations)

**Service Structure:**
- Follow `genie-ai-overlay/<service>/` directory convention
- `Dockerfile` based on existing OPEA service Dockerfiles
- Health check endpoints consistent with existing services
- Service-specific configuration via environment variables with `TOOL_` prefix

**Deployment:**
- Docker Swarm with Ansible (existing `deploy/ansible/` playbook)
- `--tags tools` for targeted deployment (per NFR24)
- Service placement via node labels (`genieai=true`)
- Health checks for Swarm restart policy

**Testing:**
- Unit tests following existing test patterns
- Integration tests depend on Sprint 22 test framework
- PII injection test suite for sovereignty validation

**Code Organization:**
- Follow existing `genie-ai-overlay/` module structure
- Shared utilities in `genie-ai-overlay/core/` where applicable
- Configuration files in YAML (validated against JSON Schema at startup)

## Project Context Analysis

### Requirements Overview

**Functional Requirements (48 FRs, 9 capability areas):**

The 48 FRs map to three new services and two UI platforms:

| Capability Area | FRs | Architectural Implication |
|----------------|-----|--------------------------|
| Tool Registry & Management | FR1–FR7 | New service: schema validation, YAML loading, enable/disable, CRUD API |
| Tool Execution | FR8–FR15 | New service: PII redaction guardrail, tool invocation, rate limiting, structured result capture |
| Web Search | FR16–FR18 | Tool Executor plugin: SearXNG backend integration, domain whitelisting |
| Result Fusion & Response | FR19–FR24 | ChatQnA integration: scoring, deduplication, context window budget, graceful degradation |
| Stream Ingestion | FR25–FR30 | New service: RSS/Atom polling, JSON API polling, webhook intake, TEI embedding pipeline |
| Admin Configuration | FR31–FR36 | Vue 3 admin UI + Admin API: tool/feed CRUD, domain whitelist editor, audit viewer |
| User Interaction | FR37–FR40 | Vue 3 + Flutter chat UI: citation rendering, provenance labels, degradation messages |
| Resilience & Operations | FR41–FR45 | Cross-cutting: circuit breakers, dead letter queues, health checks, audit logging |
| Integration Contracts | FR46–FR48 | Cross-cutting: ToolExecutor interface, ChatQnA pipeline integration, deployment config |

**Non-Functional Requirements (27 NFRs, 7 categories):**

NFRs that will directly shape architectural decisions:

- **Performance (NFR1–NFR5)**: Web search adds ≤2s latency (P95); ingestion freshness ≤4h end-to-end; registry lookup ≤50ms; admin API ≤500ms; PII redaction ≤100ms — these define service-level latency budgets and dictate synchronous vs asynchronous execution patterns
- **Security (NFR6–NFR11)**: Zero PII leakage (mandatory guardrail); full audit logging; FOI-exportable logs; Keycloak RBAC; domain whitelisting at executor level (not bypassable via backend config) — these define the security architecture: where guardrails sit in the request path, how audit data is stored and queried
- **Reliability (NFR12–NFR16)**: Zero hallucinations from tool failures; circuit breakers (3 failures → open); dead letter queues; component isolation; >90% citation URL validity — these define the resilience pattern: circuit breaker configuration, degradation strategies, dead letter queue implementation
- **Scalability (NFR17–NFR19)**: Zero new infrastructure beyond CPU containers; horizontal scaling support for rate limiting and circuit breakers — these constrain deployment: Redis must support clustering, services must be stateless
- **Accessibility (NFR20–NFR21)**: WCAG 2.1 AA; Vue 3/Flutter parity — these define the response schema: citation and degradation metadata must be structured for screen-reader-compatible rendering
- **Integration (NFR22–NFR25)**: ToolExecutor consumable by ChatQnA and LangGraph; startup without external network; Ansible `--tags tools`; no ArangoDB schema modifications — these define the integration contract and deployment boundaries
- **Compliance (NFR26–NFR27)**: DPG permissive licensing; configurable audit log retention — these define the licensing audit process and data retention architecture

### Scale & Complexity

- Primary domain: Agent infrastructure (Python/FastAPI microservices extending existing OPEA tier)
- Complexity level: High — three new services, two new container images, ChatQnA monolith integration during concurrent refactoring, cross-platform UI, Redis Streams event backbone, and Sprint 24/25 cascade dependency
- Estimated architectural components: 3 new services + 2 new containers + admin API extensions + ChatQnA integration module + Vue 3 admin views + Flutter chat extensions + Ansible deployment config + monitoring integration

### Technical Constraints & Dependencies

**Hard Constraints:**
- Python/OPEA tier placement — all three services share the OPEA runtime (FastAPI, `comps` library, CustomLogger)
- No ArangoDB schema modifications — stream ingestion stores in existing collections using existing vector search
- No new GPU services — SearXNG and PII redaction are CPU-only
- Existing deployment model — Docker Swarm with Ansible, planned K8s compatibility

**Dependencies:**
- Sprint 22 test framework (hard prerequisite for integration testing)
- Sprint 23 observability platform (for tool invocation monitoring)
- ChatQnA modular refactoring (#604) — the integration point changes mid-sprint; the `ToolExecutor` contract must be defined before refactoring begins
- Sprint 24 LangGraph orchestrator — the `ToolExecutor` interface must be consumable by LangGraph `ToolNode`

**Integration Points:**
- `genieai_chatqna.py` — retrieval-to-prompt stage (tool trigger logic, result fusion, prompt assembly)
- `genieai_api_protocol.py` — existing unused `tools` and `tool_choice` fields (partial integration surface)
- Redis — currently cache-only; must be configured for Streams (event backbone)
- TEI embedding service — stream ingestion routes through existing embedding pipeline
- ArangoDB — vector store for ingested content, existing collections
- Keycloak — RBAC for admin API (`tools-admin`, `tools-reader` roles)
- Kong/NGINX — admin API routing through existing API gateway

### Cross-Cutting Concerns Identified

1. **PII Redaction Guardrail** — Every external tool invocation passes through the pluggable redaction service. This is the most critical cross-cutting concern: it sits between the tool executor and every external backend, and its failure mode (redact vs. block) affects all tool capabilities.

2. **Audit Logging** — Every tool invocation generates structured audit data (user identity, timestamp, tool, parameters, results). This spans all three services and must be queryable for FOI requests.

3. **Circuit Breaker & Graceful Degradation** — Every external service call (SearXNG, custom tool backends, feed sources) is wrapped in circuit breaker logic. Failure of any external backend must not affect other capabilities.

4. **Configuration Management** — Tools and feeds are YAML-defined, validated at startup, and modifiable at runtime via admin API. This pattern spans all three services: the registry loads definitions, the executor reads them, the ingestor uses them for feed configuration.

5. **WCAG 2.1 AA Accessibility** — Citation rendering and degradation messages must be accessible across Vue 3 and Flutter. This requires a shared response schema that both platforms consume identically.
