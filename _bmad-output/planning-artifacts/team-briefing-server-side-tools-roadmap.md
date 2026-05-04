# GENIE.AI Comprehensive Roadmap Briefing

**Date:** May 2026
**Audience:** Engineering team review
**Scope:** Server-Side Tools initiative and its position within the Sprint 20-25 roadmap

---

## 1. What is GENIE.AI

GENIE.AI is an open-source generative AI framework for the public sector, providing a sovereign, DPG-compliant RAG (Retrieval-Augmented Generation) system with multilingual support across 34 languages. It integrates with OPEA (Open Platform for Enterprise AI) for AI/ML services.

The 12-month roadmap transforms GENIE.AI from a RAG chatbot into the AI Building Block for the GovStack ecosystem — capable of executing multi-step government workflows through agentic automation.

---

## 2. The 12-Month Roadmap — Sprint 20 through Sprint 25

### Phase 1: Security Hardening (Sprint 20-21, March-April 2026)

**Status: Complete**

Fix 5 critical P0 security vulnerabilities before any new feature work begins. Key issues: hardcoded credentials in source code, no authentication middleware on microservice endpoints, AQL injection, path traversal, and root-running Dockerfiles.

### Phase 2: Foundation (Sprint 22, May 2026)

**Status: Complete**

Establish three foundational capabilities that all subsequent work depends on:

- **#597 SSE Streaming** — Real-time streaming for Vue 3, Backend, and Flutter. Prerequisite for Sprint 24 agentic workflows which need real-time status updates as multi-step workflows execute.
- **#598 Auth Middleware** — JWT validation on all microservice endpoints. Non-negotiable for GovStack deployment with citizen data and required before Kubernetes exposure in Sprint 23.
- **#599 Test Framework** — pytest + pytest-asyncio + httpx for OPEA microservices. Zero tests existed before this. Every subsequent sprint depends on having regression tests.

### Phase 3: Infrastructure (Sprint 23, June-July 2026)

**Status: In progress**

- **#600 Kubernetes & Helm** — Convert from Docker Swarm to Kubernetes. Four-phase approach: K8s manifests, Helm charts with T-shirt sizing (S/M/L/XL), CI/CD with ArgoCD, SCS compatibility. Required because GovStack strategy defines deployment sizes that Docker Swarm cannot support.
- **#601 Observability Platform (MELT)** — VictoriaMetrics + Grafana + OpenTelemetry. OpenTelemetry Collector as universal pipeline. Services emit structured JSON to stdout/stderr, never coupled to a specific log database. MELT Provider API provides backend-agnostic abstraction (swap VictoriaMetrics for SigNoz or OpenSearch without application code changes). Dashboards for system health, RAG pipeline, business metrics, and agentic workflow debugging.
- **#602 Nginx Multi-Deploy** — Fix hardcoded nginx domains for multi-deployment support.

**Server-Side Tools initiative begins in Sprint 23** — Epic 1 (Foundation) and Epic 2 (Web Search) run in parallel with Sprint 23 infrastructure work, with soft dependencies on #600 (Helm chart alignment) and #601 (audit event schema compatibility).

### Phase 4: Differentiation (Sprint 24-25, August 2026 - April 2027)

The capability layer that makes GENIE.AI unique.

#### Sprint 24 (August-October 2026, 3 months)

- **#603 Agentic Workflows Phase 1** — LangGraph orchestrator with MCP (Model Context Protocol) foundation. Core node types: LLMNode, ToolNode, ConditionalRouter, HumanInputNode. Initial mock MCP servers for Auth, Payments, and Scheduler Building Blocks. Frontend visualization for workflow status. LangGraph checkpointing with ArangoDB for pause/resume.
- **#604 ChatQnA Refactoring** — Break the 1,599-line monolith into modular architecture (service.py, orchestrator.py, streaming.py, translation.py, guardrail.py, prompt_manager.py, state.py, config.py). Pydantic state models integrate directly with LangGraph typed state. **Server-Side Tools Story 2.5 must complete before #604 begins active refactoring.**
- **#605 STT/TTS** — faster-whisper for speech-to-text (99 languages, 1.5GB VRAM). Web Speech API for Vue TTS (zero dependencies). flutter_tts for mobile. Hybrid architecture: server-side STT + client-side TTS.

#### Sprint 25 (November 2026 - April 2027, 6 months)

- **#606 GovStack Building Block Integrations** — Connect real GovStack BB APIs via MCP servers. Building Blocks: Security + Identity, Registration, Payments, Messaging, Scheduler. Each follows the pattern: define LangGraph workflow nodes, create MCP server wrapping BB REST API, implement citizen-facing workflow, add frontend UI.
- **#607 Multi-Channel Messaging** — WhatsApp Business API and Telegram Bot API. Provider-agnostic message broker abstraction. Critical for developing nations where citizens may not access web interfaces.

---

## 3. Keycloak/OIDC Initiative (Completed)

**Status: Archived — all 4 epics done**

The completed initiative established enterprise identity management:

- **Epic 1 (11 stories):** Keycloak Foundation & User Authentication — JIT provisioning, multi-realm support, frontend OIDC, air-gapped deployment capability
- **Epic 2 (11 stories):** Secure API Access — JWKS force-refresh, token passthrough headers, Swagger UI with OIDC authorize button, OPEA continuity (Keycloak-agnostic downstream)
- **Epic 3 (8 stories):** Session Management & GDPR — Logout, session invalidation, role/group management via Keycloak, external IdP attribute mapping, right to erasure
- **Epic 4 (2 stories):** Audit Logging — Closed as YAGNI; Keycloak native event listener covers all requirements

**What this delivers:** Composite user identity key (`{iss}#{sub}`) for cross-realm uniqueness, defense-in-depth JWT validation, GDPR Article 17 compliance, sovereign deployment without external authentication dependencies.

**Connection to Server-Side Tools:** The tools-admin and tools-reader Keycloak roles defined in Server-Side Tools Story 4.3 build on this foundation. The list-and-grant UI paradigm replaces the existing static role checkboxes.

---

## 4. Server-Side Tools Initiative — Deep Dive

### Why This Initiative Exists

Without tools, the RAG system can only answer questions from uploaded documents. With tools, every external API becomes an agent action, every data feed becomes a knowledge source, and every GovStack Building Block becomes consumable by AI. The tool registry is the bridge between Sprint 24 agentic workflows and Sprint 25 GovStack integrations.

### What It Delivers

Three new Python/FastAPI services in the OPEA tier, operating on existing infrastructure (Redis, ArangoDB, TEI) with zero new dependencies beyond SearXNG (CPU-only):

1. **Tool Registry** — YAML-based tool definitions validated against JSON Schema at startup. Admin CRUD API. ArangoDB for runtime state, YAML as source of truth (works offline per NFR23).
2. **Tool Executor** — Pluggable tool invocation with PII redaction guardrail, circuit breaker protection (CLOSED/OPEN/HALF_OPEN), per-tool rate limiting. Standardized ToolExecutor interface consumable by both ChatQnA and future LangGraph orchestrators.
3. **Stream Ingestor** — RSS/Atom feeds, JSON API polling, and webhook push ingestion. Content routed through existing TEI embedding service into the shared ArangoDB chunks collection. Configurable retention policies (TTL) with automated cleanup.

### Architecture Decisions (13 total)

Key decisions:
- **Data:** Hybrid YAML + ArangoDB persistence (YAML source of truth, ArangoDB for runtime)
- **Events:** Per-purpose Redis Streams (tool-config-changes, tool-invocation-audit, feed-ingestion-events) with dead letter queues
- **PII Redaction:** Pluggable Python ABC, default regex implementation, failure mode = BLOCK (NFR6)
- **Search:** SearXNG (AGPL-3.0) consumed as unmodified API backend — within NFR26 exception
- **Citations:** Shared JSON schema for Vue 3/Flutter parity (url, title, source_type, retrieved_at, confidence)
- **Admin:** List-and-grant paradigm for tools-admin/tools-reader roles

### Epic and Story Breakdown

**Epic 1: Tool Registry & Executor Foundation (6 stories)** — Sprint 23
- Story 1.1: Tool Definition Schema & YAML Configuration
- Story 1.2: Tool Registry Service with Admin API
- Story 1.3: PII Redaction Pluggable Interface & Regex Implementation
- Story 1.4: Tool Executor Service with Circuit Breaker & Rate Limiting
- Story 1.5: Redis Streams Event Backbone & Audit Logging
- Story 1.6: Multi-Platform Deployment Configuration

**Epic 2: Web Search & Result Fusion (5 stories)** — Sprint 23-24 boundary
- Story 2.1: SearXNG Service Integration & Web Search Plugin
- Story 2.2: Rule-Based Tool Trigger Logic (confidence threshold + time-sensitive patterns)
- Story 2.3: Result Fusion & Context Window Budget
- Story 2.4: Source Citations & Graceful Degradation
- Story 2.5: ChatQnA Pipeline Integration (contract-first, resilient to #604 refactoring)

**Epic 3: Stream Ingestion & Data Lifecycle (5 stories)** — Sprint 24
- Story 3.1: RSS/Atom Feed Polling & Content Extraction
- Story 3.2: JSON API Polling with Field Mapping
- Story 3.3: Webhook Endpoint for Push-Based Ingestion
- Story 3.4: TEI Embedding Pipeline & Shared Chunks Storage (source-agnostic)
- Story 3.5: Feed Health Monitoring & Dead Letter Queue Reprocessing

**Epic 4: Admin & User Interface Surfaces (6 stories)** — Sprint 24-25 boundary
- Story 4.1: Backend Admin API Proxy (Node.js BFF → Tool Registry)
- Story 4.2: Vue 3 Admin Tool & Feed Management (Document Management tab)
- Story 4.3: List-and-Grant User Management (Vue 3 admin only)
- Story 4.4: Vue 3 Citation Rendering & Graceful Degradation Messages
- Story 4.5: Flutter Citation Rendering (citizen-facing only)
- Story 4.6: Tool Invocation Analytics Dashboard

### Sprint Targets

| Sprint | Epics | Stories | Dependency |
|--------|-------|---------|------------|
| Sprint 23 | Epic 1 + Epic 2 | 11 | Must complete before Sprint 24 #603 LangGraph starts |
| Sprint 24 | Epic 3 + Epic 4 | 11 | Should complete before Sprint 25 #606 GovStack |
| Sprint 25 | All done | 22 | Registry ready for GovStack BB tool registration |

### Critical Path

```
Epic 1 (Foundation) → Epic 2 (Web Search) → Sprint 24 LangGraph gate
Epic 3 (Ingestion) runs parallel with Epic 2 after Epic 1
Epic 4 (UI) starts after Epic 1 backend APIs are available
```

### Cross-Sprint Dependency Management

All cross-sprint dependencies have been resolved with explicit acceptance criteria:

| Dependency | Type | Mitigation |
|------------|------|------------|
| Sprint 22 #599 → Epic 1 | Hard (merged) | Test framework available |
| Sprint 23 #600 → Story 1.6 Helm | Soft | Helm chart as stub; finalized after #600 patterns established |
| Sprint 23 #601 → Story 1.5 events | Soft | Event schema documented as standalone spec; verified against #601 if merged |
| Sprint 23 #602 → Story 1.6 nginx | Soft | Routes use existing patterns; reconciliation checklist documented |
| Sprint 24 #603 → Epic 1 + Epic 2 | Hard gate | ToolExecutor HTTP interface validated by integration tests |
| Sprint 24 #604 → Story 2.5 | Hard risk | Contract-first integration; validation test suite; Story 2.5 MUST complete before #604 starts |

---

## 5. MELT Framework (Observability)

MELT stands for **Metrics, Events (Logs), and Traces** — the industry-standard observability stack.

### Architecture

- **OpenTelemetry Collector** (DaemonSet) receives traces, metrics, and logs from all services
- **VictoriaMetrics** for metrics storage (backend-agnostic via MELT Provider API)
- **Grafana** for dashboards
- **MELT Provider API** — backend-agnostic abstraction layer allowing swap between VictoriaMetrics, SigNoz, or OpenSearch without application code changes

### Implementation (Sprint 23 #601)

- Phase 1: stdout/stderr structured JSON + OTel Collector
- Phase 2: VictoriaMetrics deployment (vmcluster for production)
- Phase 3: Integration with MELT Provider API

### Connection to Server-Side Tools

Story 1.5 (Redis Streams Event Backbone & Audit Logging) publishes tool invocation audit events. The observability platform consumes these events for dashboards and alerting. The event schema is documented as a standalone specification and verified compatible with the #601 consumer expectations.

### Dashboard Categories

- **System**: Container health, GPU utilization
- **RAG Pipeline**: Query latency, retrieval quality, token usage, error rates
- **Business**: Active users, conversation volume
- **Agentic Workflow** (Sprint 24): Execution time, step success rates, MCP call latency

---

## 6. Agentic Workflows (Sprint 24)

### Architecture

```
User Request → Backend BFF → LangGraph Orchestrator
                                    |-- Tool: RAG Query (existing ChatQnA)
                                    |-- Tool: Web Search (Server-Side Tools Epic 2)
                                    |-- Tool: MCP Server → GovStack BB API
                                    |-- Tool: Translation
                                    +-- Tool: Guardrail (optional)
```

### How Server-Side Tools Enables This

- **Tool Registry** becomes the central interface for registering all tools — including MCP-wrapped GovStack BB APIs in Sprint 25
- **ToolExecutor HTTP interface** (Story 1.4) is designed to be consumable by LangGraph ToolNode without adapter layers (NFR22)
- **ChatQnA integration** (Story 2.5) inserts tool invocation after retrieval and before LLM prompt construction — the exact insertion point LangGraph will use
- **Citation schema** (Stories 2.4, 4.4, 4.5) provides the shared JSON structure for both RAG and tool-augmented responses

### MCP (Model Context Protocol) Integration

- `mcpo` (MCP proxy orchestrator) deployed as Docker service
- MCP servers as standalone processes wrapping GovStack BB REST APIs
- Sprint 24 Phase 1C: Three mock MCP servers (Auth, Payments, Scheduler)
- Sprint 25: Real GovStack BB API connections

---

## 7. GovStack Integration (Sprint 25)

### Strategic Positioning

GENIE.AI is positioned as the foundational AI Building Block for the GovStack ecosystem. The 24-month roadmap aligns with GovStack phases:

| GovStack Phase | Timeline | Coverage |
|----------------|----------|----------|
| Phase 1: Foundation | May-Oct 2026 | Sprint 22-24 |
| Phase 2: Core Services | Nov 2026-Apr 2027 | Sprint 25 |
| Phase 3: Advanced Features | May-Oct 2027 | Future sprints |
| Phase 4: Scale | Nov 2027-Apr 2028 | Future sprints |

### How Server-Side Tools Enables This

Every GovStack Building Block API registers as a tool in the registry:
1. Sprint 23-24: Server-Side Tools establishes the tool registry, executor, and ingestion patterns
2. Sprint 25: Each GovStack BB API is wrapped in an MCP server and registered as a tool
3. Citizens interact with GovStack services through AI-orchestrated workflows

### Building Blocks (Sprint 25 Target)

- **Security + Identity**: Auth, token validation, user profile, permission checks
- **Registration**: Application lifecycle, document submission, progress tracking
- **Payments**: Fee calculation, payment initiation, receipts
- **Messaging**: Notifications, delivery status, templates
- **Scheduler**: Availability checks, booking, cancellation

### Deployment T-Shirt Sizes (Kubernetes)

| Size | Nodes | GPU | Target |
|------|-------|-----|--------|
| Small | 2 | 2x T4 (16GB) | Municipal, 100-1K users |
| Medium | 5 | 3x A10 (24GB) | Regional, 1K-10K users |
| Large | 20+ | 15x A100 (80GB) | National, 10K+ users |
| XL | 50+ | 40x H100 (80GB) | Multi-national, 100K+ users |

---

## 8. Kubernetes Deployment (Sprint 23)

### Why Kubernetes

Docker Swarm (current) cannot support the GovStack deployment sizes. Kubernetes is required for:
- Horizontal Pod Autoscaler (HPA) for stateless services
- GPU scheduling across node pools
- Helm chart-based configuration management
- SCS (Sovereign Cloud Stack) compatibility

### Phased Approach (Issue #600)

1. **K8s Manifests**: Convert docker-compose.yaml to Deployments, Services, ConfigMaps, Secrets. Kustomize for environment overlays. GPU scheduling via node selectors.
2. **Helm Charts**: Configurable values. T-shirt size value files (S/M/L/XL). DEPLOY_OPEA equivalent toggle.
3. **CI/CD**: Helm chart publish, ArgoCD/Flux for GitOps, Kaniko image builds.
4. **SCS Compatibility**: Sovereign Cloud Stack verification, GPU operator testing, storage class validation.

### Connection to Server-Side Tools

Story 1.6 (Multi-Platform Deployment) creates Helm charts for the three new tool services (Tool Registry, Tool Executor, Stream Ingestor). Docker Compose and Ansible deployment are complete regardless of #600 merge status. Helm charts are created as documented stubs and finalized to match #600 conventions after #600 establishes the project-wide patterns.

---

## 9. Complete Dependency Graph

```
Sprint 20: P0 Security Fixes ─── COMPLETE
    |
Sprint 21: Bug Fixes ──────────── COMPLETE
    |
Sprint 22: Auth + Streaming + Tests ── COMPLETE
    |           |           |
    v           v           v
Sprint 23: K8s    Observability  Server-Side Tools
(#600)     (#601)        Epic 1 (Foundation)
    |           |           |        |
    |           |           v        v
    |           |      Epic 2 (Web Search)
    |           |           |
    v           v           v
Sprint 24: ChatQnA    Agentic Workflows   Epic 3 (Ingestion)
Refactor (#604)  (#603 LangGraph+MCP)  Epic 4 (UI)
    |           |           |
    v           v           v
Sprint 25: GovStack BB Integrations (#606)
           Multi-Channel (#607)
```

---

## 10. GitLab Tracking

All work tracked via GitLab issues on the `un/itu/genie-ai` project:

- **PRD Issue**: #695
- **Epic Issues**: #696, #704, #711, #718
- **Story Issues**: #697-#725 (22 stories)
- **Merge Request**: [!77](https://opensource.unicc.org/un/itu/genie-ai/-/merge_requests/77)
- **Branch**: `feat/server-side-tools/prd`

---

## 11. Key Metrics and Success Criteria

| Metric | Target | Measurement |
|--------|--------|-------------|
| Knowledge base freshness | <4 hours from publication to RAG | End-to-end pipeline latency |
| Web search accuracy | >80% relevant for gov queries | Labeled test set |
| Custom tool registration | 3+ tools in first pilot | Registry audit log |
| PII leakage events | Zero across all deployments | PII redaction audit logs |
| LangGraph ToolNode integration | Tools consumable by Sprint 24 | Integration test suite |
| Citation validity | >90% URLs valid at query time | Automated link validation |
| Graceful degradation incidents | Zero hallucinated answers | Adversarial test suite |
