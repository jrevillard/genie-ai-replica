# GENIE.AI Roadmap — Sprint 20 through Sprint 25

**Version 1.0 | April 2026**
**Audience: Internal engineering team**

---

## Executive Summary

GENIE.AI is an open-source generative AI framework for the public sector, built on OPEA (Open Platform for Enterprise AI). It provides a sovereign, DPG-compliant RAG (Retrieval-Augmented Generation) system with multilingual support across 34 languages and 14 UI languages.

This roadmap covers the next 12 months of development, organized into six sprints. The overarching goal is to transform GENIE.AI from a RAG chatbot into the AI Building Block for the GovStack ecosystem — capable of executing multi-step government workflows through agentic automation.

The roadmap is structured in four phases:

1. **Security hardening** (Sprint 20-21) — Fix critical vulnerabilities
2. **Foundation** (Sprint 22) — Streaming, authentication, test framework
3. **Infrastructure** (Sprint 23) — Kubernetes, observability, code quality
4. **Differentiation** (Sprint 24-25) — Agentic workflows, STT/TTS, GovStack integrations

Each phase is a prerequisite for the next. Skipping or rushing any phase creates risk for downstream work.

---

## Current Architecture

GENIE.AI uses a layered microservices architecture:

- **Client Layer**: Vue 3 web app, Flutter mobile app
- **API Gateway**: Kong reverse proxy + NGINX
- **Application Layer**: Node.js/Express backend (BFF pattern)
- **AI Layer**: OPEA microservices — ChatQnA (Python/FastAPI), Retriever, Dataprep, Reranker, Guardrail (disabled), Translation
- **Data Layer**: ArangoDB (graph + vector + document), Redis cache, file storage
- **Inference**: vLLM running Meta-Llama-3.1-8B-Instruct (chat) and google/gemma-3-4b-it (translation), TEI for embeddings (BAAI/bge-base-en-v1.5) and reranking

Deployment targets: Docker Compose (single-node dev), Docker Swarm (multi-node production), with Kubernetes as the target for GovStack/SCS deployment.

GPU configurations: NVIDIA T4 (16GB VRAM) and RTX 6000 ADA (24GB VRAM), with heavy contention between LLM, translation, embedding, and reranking services.

---

## Sprint 20 — Security Hardening (P0 Only)

**Dates**: March 30 - April 30, 2026
**Status**: In progress
**Issue count**: 5 issues (all P0)

Sprint 20 was originally 21 issues spanning P0-P3. It has been trimmed to only the 5 critical P0 security vulnerabilities. All P1-P3 items have been redistributed to Sprint 22 and Sprint 23 where they align with the relevant work streams.

### Issues

| # | Priority | Title |
|---|----------|-------|
| #499 | P0 | Hardcoded credentials in committed source code |
| #500 | P0 | No authentication middleware on any microservice endpoints |
| #501 | P0 | AQL injection via traversal_query.format() in retriever |
| #502 | P0 | Path traversal vulnerability in dataprep file save |
| #503 | P0 | Dataprep Dockerfile runs all processes as root |

### Why This Sprint Exists

These 5 vulnerabilities are exploitable today. Before any new feature work — especially GovStack Building Block integrations that handle citizen data — the foundation must be secure.

### Key Decisions

- Issue #500 (no auth middleware) is addressed in two stages: Sprint 20 removes the hardcoded credentials, and Sprint 22 implements the full JWT validation middleware (new issue #598)
- Issues #499-#503 are security-critical and should be resolved before any Sprint 22 work begins

---

## Sprint 21 — General Bug Fixes

**Dates**: April 13 - April 30, 2026
**Status**: In progress
**Issue count**: Runs in parallel with Sprint 20

Sprint 21 is the current active sprint running in parallel with Sprint 20 security fixes. It addresses general bug fixes and stabilization work.

---

## Sprint 22 — Backend Streaming, Auth & Test Foundation

**Dates**: May 1 - May 31, 2026
**Issue count**: 14 issues (3 new + 11 moved from other sprints)

This sprint establishes the three foundational capabilities that all subsequent work depends on: real-time streaming, microservice authentication, and an automated test framework.

### New Issues Created

| # | Title | Type |
|---|-------|------|
| #597 | Implement SSE streaming for Vue 3, Backend and Flutter | Enhancement |
| #598 | Implement microservice authentication middleware (resolves #500) | Security |
| #599 | Establish automated test suite for OPEA microservices (resolves #518) | Testing |

### Moved Issues (from Sprint 20 and Sprint 12)

| # | Original Sprint | Title |
|---|----------------|-------|
| #506 | Sprint 20 | [P1] No timeouts on external HTTP service calls |
| #507 | Sprint 20 | [P1] No rate limiting on authentication token endpoint |
| #508 | Sprint 20 | [P1] Placeholder URL template with literal HOST/PORT in chatqna response |
| #509 | Sprint 20 | [P1] Bare except clauses swallowing all exceptions |
| #510 | Sprint 20 | [P1] Sensitive user data logged to console and output |
| #519 | Sprint 20 | [P2] Missing dedicated health check endpoints on microservices |
| #526 | Sprint 12 | Fix token refresh lifecycle in Flutter mobile app |
| #332 | Sprint 12 | Develop an API and Stream Connector Service as an Automated Ingestion Layer |
| #347 | No Milestone | Improve ChatQnA system prompt |
| #234 | Sprint 12 | Implement a component to seamlessly configure system prompts for LLM-based micro-services |
| #363 | Sprint 12 | UI text translations fail when backend translation process encounters an error |
| #593 | No Milestone | Optimize Docker build performance |

### Issue #597 — SSE Streaming

The ChatQnA microservice already supports OpenAI-compatible SSE streaming. The Vue 3 frontend (ChatBotComponent.vue, 2,450 lines) does not consume the streaming endpoint — messages appear only after the full LLM response completes. This is the single biggest UX gap.

**Scope**: Modify the Vue frontend to consume SSE, verify backend proxy passes SSE correctly through Kong/nginx, and add streaming support to the Flutter mobile chat.

**Why it matters**: Streaming is a prerequisite for agentic workflows (Sprint 24) which need real-time status updates as multi-step workflows execute.

### Issue #598 — Microservice Authentication Middleware

Currently zero authentication on any OPEA microservice endpoint. Kong protects the backend BFF, but direct container-to-container access bypasses all auth.

**Implementation**: Shared Python JWT validation middleware in genie-ai-overlay/core/, service-to-service auth using AUTH_SERVICE_USERNAME/AUTH_SERVICE_PASSWORD, AUTH_ENABLED env var for dev mode, health endpoint exceptions.

**Why it matters**: Non-negotiable for GovStack deployment with citizen data. Also required before Kubernetes exposure (Sprint 23).

### Issue #599 — Automated Test Suite

Zero automated tests exist for any microservice. As agentic workflows and GovStack integrations are added, manual testing becomes impossible.

**Implementation**: pytest + pytest-asyncio + httpx, contract tests for all endpoints, CI pipeline integration, mock external services for CI.

**Why it matters**: The ChatQnA refactoring in Sprint 24 needs tests to verify nothing breaks. Every subsequent sprint depends on this.

### Sprint 22 Dependencies

```
Sprint 20 (P0 security fixes)
    |
    v
Sprint 22
  #597 SSE Streaming -----> Sprint 24 (Agentic workflows need real-time status)
  #598 Auth Middleware -----> Sprint 23 (K8s exposure), Sprint 24 (MCP security)
  #599 Test Framework ------> Sprint 24 (ChatQnA refactoring needs regression tests)
```

---

## Sprint 23 — Kubernetes, Helm & Observability Platform

**Dates**: June 1 - July 31, 2026 (2 months)
**Issue count**: 28 issues (3 new + 25 moved from Sprint 12, 15, 20)

This is the infrastructure sprint. It accomplishes two goals: making the system deployable on Kubernetes (required for GovStack/SCS) and making the system observable (required for debugging complex agentic workflows).

### New Issues Created

| # | Title | Type |
|---|-------|------|
| #600 | Kubernetes deployment with Helm charts (parent) | Infrastructure |
| #601 | Observability platform — VictoriaMetrics/Signoz + Grafana + OpenTelemetry (parent) | Infrastructure |
| #602 | Fix hardcoded nginx domains for multi-deployment support | Bug fix |

### Issue #600 — Kubernetes Deployment

Consolidates three existing issues (#313, #592, #267) into a single parent with phased approach.

**Phase 1**: Convert docker-compose.yaml to Kubernetes manifests (Deployments, Services, ConfigMaps, Secrets), use Kustomize for environment overlays, GPU scheduling via node selectors, PersistentVolume claims, HPA for stateless services.

**Phase 2**: Helm chart with configurable values, t-shirt size value files (S/M/L/XL matching the GovStack strategy), DEPLOY_OPEA equivalent toggle.

**Phase 3**: CI/CD with Helm chart publish, ArgoCD/Flux for GitOps, Kaniko image builds.

**Phase 4**: SCS (Sovereign Cloud Stack) compatibility verification, GPU operator testing, storage class validation.

**Why it matters**: The GovStack strategy (Section 2.2) defines four deployment sizes: Small (2 nodes, T4), Medium (5 nodes, A10), Large (20+ nodes, A100), XL (50+ nodes, H100). Docker Swarm cannot support this. Kubernetes is required.

**Parent-child relationships**: #600 is parent of #313, #592, #267, #602.

### Issue #601 — Observability Platform

Consolidates the existing observability work (#354 parent + 7 children: #355, #356, #357, #358, #359, #361) plus the OTel and tracing issues (#589, #590, #591) into a single parent.

**Architecture**: OpenTelemetry Collector (DaemonSet) receives traces/metrics from all services. VictoriaMetrics (or Signoz, which was recently evaluated per commit 8346530e) for metrics storage. Grafana for dashboards.

**Instrumentation**: OpenTelemetry SDK added to all Python microservices and Node.js backend. Winston logger refactored to JSON + OTEL trace context. Python logging refactored to JSON stdout. ArangoDB queries and vLLM/TEI HTTP calls instrumented with trace spans.

**Dashboards**: System (container health, GPU utilization), RAG Pipeline (query latency, retrieval quality, token usage, error rates), Business (active users, conversation volume), Agentic Workflow (execution time, step success rates, MCP call latency).

**Why it matters**: Agentic workflows in Sprint 24 will execute multi-step processes across multiple MCP servers. Without observability, debugging failures in a 5-step workflow spanning 3 services is nearly impossible.

**Parent-child relationships**: #601 is parent of #354, #355, #356, #357, #358, #359, #361, #589, #590, #591.

### Moved Issues — Code Quality and Technical Debt

The remaining Sprint 20 P2-P3 issues were moved to Sprint 23 because they are code quality improvements that should happen alongside infrastructure work:

- #514, #515: Code cleanup (print() usage, dead code)
- #516: Leftover Dockerfile
- #520-#523: P3 items (developer entrypoint, unused config, graceful shutdown, AQL parameterization)
- #582: SecurityMiddleware IP reputation (logging-only, needs actual blocking)
- #534: Centralized input validation middleware
- #533: ESLint rules tightening
- #442: Duplicate route definitions
- #379: Kong DB-less migration analysis

### Sprint 23 Dependencies

```
Sprint 22 (Auth middleware, test framework)
    |
    v
Sprint 23
  #600 K8s/Helm -----------> Sprint 25 (GovStack deployment on SCS)
  #601 Observability -------> Sprint 24 (Debug agentic workflows)
  #602 Nginx multi-deploy --> Sprint 23 (K8s Ingress depends on this)
```

---

## Sprint 24 — Agentic Workflows Phase 1 & STT/TTS

**Dates**: August 1 - October 31, 2026 (3 months)
**Issue count**: 9 issues (3 new + 6 moved)

This is the differentiation sprint. It delivers the two capabilities that make GENIE.AI unique: agentic workflow automation and speech interfaces.

### New Issues Created

| # | Title | Type |
|---|-------|------|
| #603 | Agentic Workflows Phase 1 — LangGraph + MCP Foundation (parent) | Enhancement |
| #604 | Refactor monolithic ChatQnA into modular architecture (parent) | Refactor |
| #605 | STT/TTS implementation — Whisper ASR + Web/Flutter TTS | Enhancement |

### Issue #603 — Agentic Workflows Phase 1

This is the core differentiator for GENIE.AI as the GovStack AI Building Block. The architecture is defined in the Agentic Specification on Confluence.

**Architecture**:
```
User Request -> Backend BFF -> LangGraph Orchestrator
                                    |-- Tool: RAG Query (existing)
                                    |-- Tool: MCP Server -> GovStack BB API
                                    |-- Tool: Translation
                                    +-- Tool: Guardrail (optional)

MCP Servers (standalone processes):
  |-- Auth MCP (Security Building Block)
  |-- Payments MCP (Payments Building Block)
  |-- Scheduler MCP (Scheduler Building Block)
  +-- Registration MCP (Registration Building Block)
```

**Phase 1A — LangGraph Core**: Implement genie-ai-overlay/workflows/ package with LangGraph. Define WorkflowState Pydantic model (typed state between nodes). Implement core node types: LLMNode, ToolNode, ConditionalRouter, HumanInputNode. Support streaming and non-streaming execution.

**Phase 1B — MCP Infrastructure**: Deploy mcpo (MCP proxy orchestrator) as a Docker service. Implement MCP client in Python. Register MCP servers in the Node.js backend. Implement WebSocket endpoint for real-time workflow status. Add Node.js API routes for MCP proxying.

**Phase 1C — Initial MCP Servers**: Three mock servers for Auth, Payments, and Scheduler Building Blocks. These will be connected to real GovStack BB APIs in Sprint 25.

**Phase 1D — Frontend Visualization**: Basic workflow status component showing current step, pending steps, completed steps. WebSocket integration for real-time updates.

**Phase 1E — Pause/Resume**: LangGraph checkpointing with state persisted to ArangoDB. Resume interrupted workflows from last checkpoint.

**Why it matters**: This transforms GENIE.AI from a question-answering RAG system into a workflow execution engine. Citizens can say "Apply for a business license" and the AI orchestrates the entire multi-step process across multiple government services.

**Parent-child relationships**: #603 is parent of #269, #270, #271, #272, #273, #274, #275 (consolidated from Sprint 15 Phase 1).

### Issue #604 — ChatQnA Refactoring

The file genieai_chatqna.py is 1,599 lines — a monolith handling streaming, translation, guardrail, prompt management, and orchestration. This must be refactored before agentic workflows can be integrated.

**Target structure**:
```
genie-ai-overlay/chatqna/
  |-- service.py          # FastAPI app, route handlers (slim)
  |-- orchestrator.py     # Pipeline orchestration
  |-- streaming.py        # SSE streaming helpers
  |-- translation.py      # Translation logic
  |-- guardrail.py        # Guardrail integration
  |-- prompt_manager.py   # System prompt loading
  |-- state.py            # Pydantic models (feeds into LangGraph)
  +-- config.py           # Configuration
```

No single file should exceed 300 lines. The Pydantic state models in state.py are designed to integrate directly with LangGraph's typed state mechanism.

**Parent-child relationships**: #604 is parent of #512, #513, #514, #515, #511.

### Issue #605 — STT/TTS Implementation

Implements the strategy defined in issue #596.

**Speech-to-Text**: faster-whisper (CTranslate2-based, 99 languages, approximately 1.5GB VRAM in int8 quantization, automatic language detection). Runs as a new whisper-asr Docker service.

**Text-to-Speech (Vue)**: Web Speech API — browser-native, zero dependencies, supports all 14 UI languages.

**Text-to-Speech (Flutter)**: flutter_tts — wraps native Android/iOS TTS engines, supports all UI languages.

**Architecture**: Hybrid — server-side STT + client-side TTS. This minimizes GPU impact while maximizing language coverage.

**Security**: Update Permissions-Policy and Feature-Policy headers in components/shared/lib/security-headers.js to allow microphone access.

**GPU Budget**: faster-whisper large-v3 int8 requires approximately 1.5GB VRAM. On T4 (16GB), whisper shares GPU with LLM (loaded sequentially, not concurrent). On RTX6000 (24GB), whisper can run concurrently.

**Parent-child relationships**: #605 is parent of #596 (the strategy document).

### Sprint 24 Dependencies

```
Sprint 22 (Streaming, Auth)
Sprint 23 (Observability)
    |
    v
Sprint 24
  #604 ChatQnA Refactor -> #603 Agentic Workflows (needs modular architecture)
  #605 STT/TTS -----------> Sprint 25 (GovStack citizen accessibility)
  #603 Agentic Phase 1 ---> Sprint 25 (GovStack BB integration)
  #352 Reranker threshold -> Sprint 24 (RAG quality improvement)
```

---

## Sprint 25 — GovStack Building Block Integrations

**Dates**: November 1, 2026 - April 30, 2027 (6 months)
**Issue count**: 16 issues (2 new + 14 moved)

This sprint implements the actual GovStack Building Block integrations, transforming GENIE.AI into the AI Building Block for the GovStack ecosystem.

### New Issues Created

| # | Title | Type |
|---|-------|------|
| #606 | GovStack Building Block integrations — Security, Identity, Registration, Payments, Messaging, Scheduler (parent) | Enhancement |
| #607 | Multi-channel messaging — WhatsApp & Telegram integration (parent) | Enhancement |

### Issue #606 — GovStack Building Block Integrations

Each Building Block integration follows the same pattern:
1. Define LangGraph workflow nodes for the BB's capabilities
2. Create an MCP server that wraps the BB's REST API
3. Implement the workflow that orchestrates citizen-facing processes
4. Add frontend UI for workflow interaction and status

**Building Blocks to integrate**:

**Security + Identity BB**: MCP Server for auth, token validation, user profile, permission checks. Workflow for identity verification (verify citizen, check eligibility, proceed). Frontend for login status and permission-gated actions.

**Registration BB**: MCP Server for application lifecycle (start, check status, submit documents, track progress). Workflows for business license registration (multi-step: requirements, forms, review, approval) and birth certificate application (document collection, family verification, certificate generation).

**Payments BB**: MCP Server for fee calculation, payment initiation, status checks, receipts. Workflows for tax payment processing and license fee collection.

**Messaging BB**: MCP Server for notifications, delivery status, templates. Workflows for application status updates, appointment reminders, emergency alerts.

**Scheduler BB**: MCP Server for availability checks, booking, cancellation, modification. Workflows for healthcare appointment booking and DMV service scheduling.

**Advanced Features**: BPMN visualization with bpmn-js, hybrid static/dynamic workflows, cross-BB workflows spanning 3+ Building Blocks, MCP security and audit logging, RAG integration for informed workflow decisions.

**Parent-child relationships**: #606 is parent of #276, #277, #278, #279, #280, #281, #282, #283, #284, #285, #286, #345, #349.

### Issue #607 — Multi-Channel Messaging

WhatsApp Business API and Telegram Bot API integration. Critical for GovStack deployments in developing nations where citizens may not access web interfaces.

**Architecture**: Provider-agnostic message broker abstraction layer. WhatsApp and Telegram as initial providers. Support for text, voice messages (via Whisper STT), and document sharing.

**Integration**: Messaging platforms connected to existing ChatQnA pipeline and agentic workflows. Citizens can trigger government workflows via messaging (for example, "Apply for business license" via WhatsApp).

**Parent-child relationships**: #607 is parent of #226.

### Sprint 25 Dependencies

```
Sprint 24 (Agentic Phase 1, STT/TTS, ChatQnA refactor)
    |
    v
Sprint 25
  #606 GovStack BB -------> GovStack Sandbox deployment (#285)
  #607 Multi-channel ------> WhatsApp/Telegram citizen access
```

---

## GovStack Strategy Alignment

The GovStack Integration Strategy document (January 2025) positions GENIE.AI as the foundational AI Building Block for the GovStack ecosystem. The roadmap is designed to directly support this positioning.

### Strategic Mapping

| Roadmap Phase | GovStack Strategy Reference |
|---------------|---------------------------|
| Sprint 20-21 Security | Section 4.1.2 — Government-Grade Security, Section 7.2 — Cyber Security Risks |
| Sprint 22 Auth + Streaming | Section 3.1.1 — API-First Design, Section 3.2 — Security BB Integration |
| Sprint 23 Kubernetes + Observability | Section 2 — Sovereign Cloud Stack Deployment, Section 2.2 — T-Shirt Sizes |
| Sprint 24 Agentic Workflows | Section 1.3 — GENIE.AI as AI Building Block, Section 3.1.2 — Integration Patterns |
| Sprint 24 STT/TTS | Section 4.3.1 — Enhanced Accessibility (WCAG 2.1 AA) |
| Sprint 25 BB Integrations | Sections 3.2-3.11 — All Building Block Integration Strategies |

### Deployment T-Shirt Sizes

The Kubernetes deployment in Sprint 23 must support the four sizes defined in the GovStack strategy:

- **Small (S)**: 2 nodes, 4 vCPUs, 8GB RAM, 2x NVIDIA T4 (16GB VRAM). Target: Municipal/local government, 100-1,000 concurrent users.
- **Medium (M)**: 5 nodes, 8 vCPUs, 16GB RAM, 3x NVIDIA A10 (24GB VRAM). Target: Regional government, 1,000-10,000 concurrent users.
- **Large (L)**: 20+ nodes, 16 vCPUs, 32GB RAM, 15x NVIDIA A100 (80GB VRAM). Target: National government, 10,000+ concurrent users.
- **XL**: 50+ nodes per region, 32 vCPUs, 64GB RAM, 40x NVIDIA H100 (80GB VRAM). Target: Multi-national, 100,000+ concurrent users.

### 24-Month GovStack Roadmap Alignment

| GovStack Phase | Timeline | Roadmap Coverage |
|----------------|----------|-----------------|
| Phase 1: Foundation (Months 1-6) | May-Oct 2026 | Sprint 22-24 (Security, Auth, K8s, Observability, Agentic Phase 1) |
| Phase 2: Core Services (Months 7-12) | Nov 2026-Apr 2027 | Sprint 25 (GovStack BB Integrations — Security, Identity, Registration, Payments, Messaging) |
| Phase 3: Advanced Features (Months 13-18) | May-Oct 2027 | Future sprint — Scheduler BB, Workflow BB, Wallet BB, Cross-BB workflows |
| Phase 4: Scale (Months 19-24) | Nov 2027-Apr 2028 | Future sprint — National scale, federation, partner ecosystem |

---

## Dependency Graph — Critical Path

The following dependency chain represents the critical path. Any delay on this path delays the entire roadmap.

```
Sprint 20: P0 Security Fixes (#499-#503)
    |
    v
Sprint 22: Auth Middleware (#598) + Test Framework (#599)
    |                        |
    v                        v
Sprint 23: K8s/Helm (#600)   Sprint 24: ChatQnA Refactor (#604)
    |                        |
    v                        v
Sprint 24: Agentic Phase 1 (#603) + STT/TTS (#605)
    |
    v
Sprint 25: GovStack BB Integrations (#606) + Multi-channel (#607)
```

Key parallel tracks:
- Sprint 22 SSE Streaming (#597) runs in parallel with auth and tests
- Sprint 23 Observability (#601) runs in parallel with K8s
- Sprint 24 STT/TTS (#605) runs in parallel with Agentic Workflows (#603)

---

## Risk Assessment

### High Risk

**GPU Contention**: Adding Whisper STT (1.5GB VRAM) to an already tight GPU budget (T4: 16GB shared between LLM, translation, embedding, reranker). Mitigation: Sequential loading on T4, dedicated inference node for M/L/XL GovStack deployments.

**Agentic Complexity**: LangGraph + MCP is architecturally sophisticated. The team has no prior experience with either. Mitigation: Sprint 24 is 3 months, Phase 1 uses mock MCP servers, incremental delivery.

**Kubernetes Expertise**: Current deployment is Docker Swarm. Mitigation: Sprint 23 is 2 months, use Kustomize overlays for gradual migration, leverage existing Helm charts from OPEA.

### Medium Risk

**GovStack Sandbox Availability**: Sprint 25 BB integrations depend on GovStack Sandbox access for testing against real Building Block APIs. Mitigation: Sprint 24 uses mock servers, Sprint 25 has a "Test with mocks" phase before sandbox access.

**Scope Creep**: The GovStack strategy defines 11 Building Blocks. Sprint 25 targets 6 (Security, Identity, Registration, Payments, Messaging, Scheduler). The remaining 5 (Workflow, Wallet, Digital Registries, Information Mediator, Consent) are deferred to future sprints.

**Flutter Mobile Parallel Work**: Sprint 16 (18 Flutter cleanup issues) runs on the el-salvador branch and includes security issues (SSL bypass, plaintext passwords). These should be resolved before any Sprint 24/25 mobile features (streaming, STT/TTS).

### Low Risk

**Sprint 20 P0 Fixes**: Well-defined scope, standard security remediation patterns.

**Sprint 22 Streaming**: ChatQnA already supports SSE, this is primarily frontend work.

**Sprint 23 Code Quality**: P2-P3 cleanup items are low-risk and can be parallelized.

---

## Sprint 16 — Flutter Mobile Cleanup (Parallel Track)

**Dates**: March 28 - May 31, 2026
**Issue count**: 18 issues
**Branch**: el-salvador

Sprint 16 runs in parallel and addresses Flutter mobile app cleanup. It includes critical security issues that should be resolved before Sprint 24 mobile features:

- #365: SSL certificate bypass is active in production builds
- #366: Plaintext password stored in SharedPreferences
- #367: Access tokens and API bodies logged in release builds

Plus UX bugs (#384 language persistence, #383 theme persistence) and cleanup items.

---

## Issues Not Assigned to Sprint 22-25

### Keycloak IDP Integration (No Milestone, 10 issues)

Five issues are marked `status::done` (#585, #586, #587, #588) — OPEA OIDC integration is complete. Three are `status::deferred` (#546, #547, #566) — Kong multi-issuer and health check. One is a PRD (#540).

These are not on the critical path for Sprint 22-25 but may become relevant when GovStack Security BB integration is implemented in Sprint 25.

### Backend Refactor (No Milestone, 2 issues)

- #594: Refactor backend to use iss_sub as canonical user identifier
- #595: Re-implement folder sharing API with iss_sub support

These are backend refactor items that could be addressed in any sprint. They are not on the critical path.

---

## Summary Statistics

| Sprint | Dates | Duration | Issues | Focus |
|--------|-------|----------|--------|-------|
| Sprint 20 | Mar 30 - Apr 30 | 1 month | 5 | P0 Security Fixes |
| Sprint 21 | Apr 13 - Apr 30 | 0.5 month | — | General Bug Fixes (parallel) |
| Sprint 22 | May 1 - May 31 | 1 month | 14 | Streaming, Auth, Tests |
| Sprint 23 | Jun 1 - Jul 31 | 2 months | 28 | Kubernetes, Observability, Code Quality |
| Sprint 24 | Aug 1 - Oct 31 | 3 months | 9 | Agentic Workflows, STT/TTS, ChatQnA Refactor |
| Sprint 25 | Nov 1 - Apr 30 | 6 months | 16 | GovStack BB Integrations, Multi-channel |

**Total new issues created**: 11 (#597-#607)
**Total issues reassigned**: 50+
**Total parent-child relationships created**: 28

---

## New Issues Quick Reference

| # | Sprint | Title | Parent of | Resolves |
|---|--------|-------|-----------|----------|
| #597 | 22 | SSE streaming for Vue 3, Backend and Flutter | — | — |
| #598 | 22 | Microservice authentication middleware | — | #500 |
| #599 | 22 | Automated test suite for OPEA microservices | #518 | #518 |
| #600 | 23 | Kubernetes deployment with Helm charts | #313, #592, #267, #602 | #313, #592, #267 |
| #601 | 23 | Observability platform | #354, #355, #356, #357, #358, #359, #361, #589, #590, #591 | #354 |
| #602 | 23 | Fix hardcoded nginx domains | — | #364 |
| #603 | 24 | Agentic Workflows Phase 1 | #269, #270, #271, #272, #273, #274, #275 | — |
| #604 | 24 | Refactor monolithic ChatQnA | #512, #513, #514, #515, #511 | #512, #513, #514, #515 |
| #605 | 24 | STT/TTS implementation | #596 | — |
| #606 | 25 | GovStack BB integrations | #276-#286, #345, #349 | — |
| #607 | 25 | Multi-channel messaging | #226 | — |
