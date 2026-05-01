---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories', 'step-04-final-validation']
inputDocuments:
  - "_bmad-output/planning-artifacts/prd.md"
  - "_bmad-output/planning-artifacts/architecture.md"
  - "_bmad-output/planning-artifacts/implementation-readiness-report-2026-04-30.md"
---

# genie-ai - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for the Server-Side Tools initiative, decomposing the requirements from the PRD and Architecture into implementable stories organized by PRD wave.

## Requirements Inventory

### Functional Requirements

- FR1: System administrators can define tools using JSON Schema with YAML as an authoring surface
- FR2: System administrators can import tool definitions from OpenAPI specifications
- FR3: System administrators can enable and disable individual tools without code changes or redeployment
- FR4: System administrators can configure per-tool security settings including PII redaction requirements and domain whitelists
- FR5: System administrators can register custom tools by providing a tool definition file — no core code modification required
- FR6: The tool registry validates all tool definitions against their JSON Schema at startup and rejects invalid definitions
- FR7: The tool registry serves as the single source of truth for all tool definitions, consumed by both the executor and the ingestor
- FR8: The system invokes tools automatically when retrieval confidence falls below a configurable threshold (rule-based trigger)
- FR9: The system invokes tools automatically when time-sensitive query patterns are detected (rule-based trigger)
- FR10: The system can invoke tools when the LLM determines the knowledge base is insufficient (LLM-driven selection, fallback to rule-based)
- FR11: Tools that are disabled or unauthorized cannot be invoked by either rule-based or LLM-driven paths
- FR12: The system redacts personally identifiable information from all tool parameters before external execution (mandatory guardrail)
- FR13: The PII redaction component is pluggable — alternative implementations can be substituted without architectural changes
- FR14: The system captures structured output from tool executions including results, source citations, confidence scores, and execution metadata
- FR15: The system enforces per-tool rate limits to protect external service backends from overload
- FR16: The system executes web searches through a configurable search backend (default: SearXNG)
- FR17: System administrators can restrict web search to approved domains via domain whitelisting
- FR18: The system can route search queries to alternative search backends through a pluggable interface
- FR19: The system merges tool execution results with RAG retrieval results, scoring and deduplicating across both sources
- FR20: The system allocates context window budget between retrieved documents and tool results according to configurable ratios
- FR21: The system includes source citations with tool-augmented responses, showing URLs and distinguishing knowledge base sources from external sources
- FR22: System administrators can configure citation behavior (enabled/disabled) per deployment
- FR23: The system returns a transparent "insufficient information" response when neither the knowledge base nor tool execution provides sufficient context
- FR24: The system discards tool results that fall below a minimum quality threshold before including them in the LLM context
- FR25: The system ingests content from RSS/Atom feeds on configurable polling schedules
- FR26: The system ingests content from JSON API endpoints on configurable polling schedules with field mapping
- FR27: The system receives push-based content via webhook endpoints with authentication (API key or JWT)
- FR28: The system routes ingested content through the existing TEI embedding service and stores it in ArangoDB
- FR29: System administrators can configure data lifecycle policies including retention periods (TTL) and update-vs-append behavior per feed
- FR30: Feed definitions are managed through the tool registry, subject to the same enable/disable and audit controls as other tools
- FR31: System administrators can view and manage all tools through the Vue 3 admin UI (tool list, enable/disable, configuration editing)
- FR32: System administrators can manage domain whitelists through the Vue 3 admin UI
- FR33: System administrators can view tool and feed health status through the Vue 3 admin UI
- FR34: System administrators can review audit logs for all tool invocations through the Vue 3 admin UI
- FR35: System administrators can manage ingestion feeds (add, edit, schedule, configure retention) through the Vue 3 admin UI, integrated into the existing Document Management tab alongside current ingestion features
- FR36: The system validates tool configuration changes before applying them and reports validation errors to the administrator
- FR37: Citizens using the Vue 3 web interface can see source citations on tool-augmented responses, with provenance labels distinguishing knowledge base documents from external web sources
- FR38: Citizens using the Flutter mobile interface can see source citations on tool-augmented responses, with provenance labels matching the Vue 3 behavior
- FR39: Citizens see transparent graceful degradation messages when the system cannot provide a sufficient answer, with guidance on alternative information sources
- FR40: The system renders citation and graceful degradation elements in a manner compliant with government accessibility mandates (WCAG 2.1 AA)
- FR41: The system applies circuit breaker patterns to all external service calls, halting invocations to unhealthy backends
- FR42: The system routes failed ingestion entries to dead letter queues for later reprocessing
- FR43: The system automatically retries failed operations with exponential backoff when the backend recovers
- FR44: The system logs all tool invocations with user identity, timestamp, tool name, parameters, and result metadata for audit and compliance purposes
- FR45: The system provides health check endpoints for all tools and feeds, consumable by monitoring infrastructure
- FR46: The tool executor exposes a standardized ToolExecutor interface consumable by both the current ChatQnA pipeline and future LangGraph orchestrators
- FR47: The system integrates into the existing RAG pipeline at the retrieval stage, after ArangoDB retrieval and before LLM prompt construction
- FR48: The system deploys as containerized services compatible with Docker Swarm and Kubernetes, integrated with the existing Ansible deployment playbooks

### NonFunctional Requirements

- NFR1: Web search tool invocation adds no more than 2 seconds of additional latency to the RAG pipeline (P95)
- NFR2: Stream ingestion delivers content from feed publication to RAG availability within 4 hours end-to-end
- NFR3: Tool registry lookup completes within 50ms
- NFR4: Admin API responses return within 500ms for standard CRUD operations
- NFR5: PII redaction service processes tool parameters within 100ms per invocation
- NFR6: Zero PII leakage events across all deployments — mandatory PII redaction guardrail on all external tool invocations
- NFR7: Every tool invocation is audit-logged with user identity, timestamp, tool name, input parameters, and result metadata
- NFR8: Audit logs are structured, queryable, and exportable to support FOI requests without transformation
- NFR9: Webhook endpoints authenticate every request via API key or JWT Bearer token
- NFR10: Admin API enforces role-based access control — only users with tools-admin role can modify tool configurations
- NFR11: Domain whitelisting restrictions are enforced at the tool executor level, not at the search backend level
- NFR12: Zero hallucinated answers from failed tool invocations — all tool failures produce transparent fallback responses
- NFR13: Circuit breakers open after 3 consecutive failures and automatically close after successful health check
- NFR14: Failed ingestion entries are routed to dead letter queues and automatically reprocessed on recovery
- NFR15: Tools layer degrades gracefully when individual components fail — component isolation
- NFR16: >90% of cited URLs in tool-augmented responses are valid at query time
- NFR17: Tools layer operates on existing infrastructure without additional services beyond CPU-only containers
- NFR18: Redis-backed rate limiting and circuit breaker state support horizontal scaling
- NFR19: SearXNG and PII redaction service support horizontal scaling
- NFR20: Source citations, provenance labels, and degradation messages comply with WCAG 2.1 AA
- NFR21: Citation rendering is consistent across Vue 3 and Flutter platforms
- NFR22: ToolExecutor interface is consumable by ChatQnA and Sprint 24 LangGraph without adapter layers
- NFR23: Tool registry loads tool definitions from YAML/JSON files at startup without requiring network connectivity
- NFR24: Tools layer deploys via existing Ansible playbook with --tags tools
- NFR25: Stream ingestion uses existing TEI embedding and ArangoDB storage without schema modifications to current vector store
- NFR26: All incorporated tools follow DPG permissive licensing — AGPL only for unmodified API-consumed services
- NFR27: Tool invocation audit logs have configurable retention periods

### Additional Requirements

From Architecture Document:
- Brownfield project — no starter template; new services follow existing OPEA patterns (FastAPI, comps, CustomLogger, os.getenv, Ruff)
- Service decomposition: Tool Registry, Tool Executor, Stream Ingestor as three independently deployable Python/FastAPI services
- Data architecture: Hybrid YAML+ArangoDB persistence for tool definitions; per-purpose Redis Streams with DLQs; shared chunks collection with source_type discriminator and extended retraction
- PII redaction: Pluggable Python ABC with hybrid local/HTTP backend; default regex implementation; failure mode = BLOCK
- Admin authorization: Two Keycloak roles (tools-admin, tools-reader); list-and-grant UI paradigm
- Circuit breaker: CLOSED → OPEN → HALF_OPEN; configurable per dependency via environment variables
- Rate limiting: Redis-backed sliding window counter; per-user and per-feed limits
- Citation schema: Shared JSON schema for Vue 3/Flutter parity (url, title, source_type, retrieved_at, confidence)
- Degradation schema: Structured metadata (tool_id, reason, fallback_applied, message) for UI rendering
- SearXNG: AGPL-3.0 consumed as unmodified API backend — within NFR26 exception
- Docker: Multi-stage OPEA v1.3 overlay pattern; non-root user; health checks /health and /ready
- Ansible: --tags tools for targeted deployment; dedicated role in deploy/ansible/roles/tools/
- Redis Streams: tool-config-changes, tool-invocation-audit, feed-ingestion-events + DLQs
- ArangoDB collections: tool_definitions, feed_definitions (new); tool_invocation_audit (new); chunks (extended with source_type, expires_at)
- ArangoDB schema extension: retract_expired_feed_chunks method (new, alongside existing retract_file)
- ChatQnA integration: After retrieval, before LLM prompt construction; depends on #604 refactoring
- LangGraph forward compatibility: HTTP-based ToolExecutor interface consumable by ToolNode
- Implementation patterns: 14 naming conventions, enforcement guidelines, anti-patterns documented
- No tests exist in current OPEA services — pytest to be established

### UX Design Requirements

No UX design document exists. UX requirements are derived from the PRD:
- UX-DR1: Vue 3 admin tool management integrated into existing Document Management tab alongside current ingestion features (FR35)
- UX-DR2: List-and-grant user management paradigm for tools-admin and tools-reader role assignment
- UX-DR3: Domain whitelist editor in Vue 3 admin UI (FR32)
- UX-DR4: Audit log viewer in Vue 3 admin UI with filtering and export (FR34)
- UX-DR5: Health status overview for all tools and feeds in Vue 3 admin UI (FR33)
- UX-DR6: Citation rendering in Vue 3 chat responses with source type icons and provenance labels (FR37)
- UX-DR7: Graceful degradation message display in Vue 3 chat (FR39)
- UX-DR8: Citation rendering in Flutter mobile chat matching Vue 3 behavior (FR38)
- UX-DR9: Graceful degradation message display in Flutter mobile chat (FR39)
- UX-DR10: WCAG 2.1 AA compliance for all citation and degradation UI elements (FR40)

### FR Coverage Map

FR1: Epic 1 - Tool definition via JSON Schema with YAML authoring surface
FR2: Epic 1 - OpenAPI spec import for tool definitions
FR3: Epic 1 - Enable/disable tools without code changes
FR4: Epic 1 - Per-tool security settings (PII redaction, domain whitelists)
FR5: Epic 1 - Custom tool registration via definition file
FR6: Epic 1 - JSON Schema validation at startup
FR7: Epic 1 - Tool registry as single source of truth
FR8: Epic 2 - Rule-based trigger on low retrieval confidence
FR9: Epic 2 - Rule-based trigger on time-sensitive patterns
FR10: Epic 2 - LLM-driven tool selection fallback
FR11: Epic 1 - Disabled tools cannot be invoked
FR12: Epic 1 - PII redaction guardrail on all external invocations
FR13: Epic 1 - Pluggable PII redaction interface
FR14: Epic 1 - Structured tool result capture (citations, confidence, metadata)
FR15: Epic 1 - Per-tool rate limiting
FR16: Epic 2 - Web search via configurable SearXNG backend
FR17: Epic 2 - Domain whitelisting for web search
FR18: Epic 2 - Pluggable search backend interface
FR19: Epic 2 - Result fusion (scoring, deduplication across RAG + tools)
FR20: Epic 2 - Context window budget allocation
FR21: Epic 2 - Source citations with provenance labels
FR22: Epic 2 - Configurable citation behavior
FR23: Epic 2 - Transparent "insufficient information" response
FR24: Epic 2 - Quality threshold enforcement on tool results
FR25: Epic 3 - RSS/Atom feed ingestion on configurable schedules
FR26: Epic 3 - JSON API polling with field mapping
FR27: Epic 3 - Webhook endpoint with API key/JWT auth
FR28: Epic 3 - TEI embedding pipeline for ingested content
FR29: Epic 3 - Data lifecycle policies (retention, update-vs-append)
FR30: Epic 3 - Feed management via tool registry
FR31: Epic 4 - Vue 3 admin tool management views
FR32: Epic 4 - Vue 3 domain whitelist editor
FR33: Epic 4 - Vue 3 tool/feed health status overview
FR34: Epic 4 - Vue 3 audit log viewer
FR35: Epic 4 - Vue 3 feed management in Document Management tab
FR36: Epic 4 - Config validation with error reporting in admin UI
FR37: Epic 4 - Vue 3 citation rendering in chat
FR38: Epic 4 - Flutter citation rendering in mobile chat
FR39: Epic 4 - Graceful degradation messages (Vue 3 + Flutter)
FR40: Epic 4 - WCAG 2.1 AA compliance for citations and degradation
FR41: Epic 1 - Circuit breaker patterns for external service calls
FR42: Epic 3 - Dead letter queues for failed ingestion (also Epic 2 for tool failures)
FR43: Epic 3 - Exponential backoff retry on backend recovery
FR44: Epic 1 - Audit logging for all tool invocations
FR45: Epic 3 - Health check endpoints for feeds (also Epic 1 for tools)
FR46: Epic 1 - Standardized ToolExecutor interface
FR47: Epic 2 - ChatQnA integration at retrieval stage
FR48: Epic 1 - Containerized deployment (Docker Swarm/K8s, Ansible)

## Epic List

### Epic 1: Tool Registry & Executor Foundation
IT administrators can define, validate, and manage tools through YAML configuration, and the system can execute tool invocations through a pluggable, PII-redacted pipeline with circuit breaker protection and full audit logging.
**FRs covered:** FR1-FR15, FR41, FR44-FR48
**Wave:** 1 (Foundation) + cross-cutting resilience

### Epic 2: Web Search & Result Fusion
Citizens receive answers that cite current, live web sources alongside knowledge base documents, with visible provenance and graceful degradation when web search is unavailable.
**FRs covered:** FR8-FR10, FR16-FR24, FR42-FR43, FR47
**Wave:** 2 (Core Tools — highest user value)

### Epic 3: Stream Ingestion & Data Lifecycle
IT administrators can configure continuous content ingestion from RSS/Atom feeds, JSON APIs, and webhooks, with automated TEI embedding, ArangoDB storage in the shared chunks collection, configurable retention policies, and self-healing via circuit breakers and dead letter queues.
**FRs covered:** FR25-FR30, FR42, FR43, FR45
**Wave:** 3 (Stream Ingestion)

### Epic 4: Admin & User Interface Surfaces
IT administrators can manage tools, feeds, domain whitelists, audit logs, and user role grants through the Vue 3 admin dashboard (integrated into Document Management), and citizens can see source citations and graceful degradation messages across both web (Vue 3) and mobile (Flutter) chat interfaces. Vue 3 serves both citizen and admin roles; Flutter remains a citizen-facing end-user app only.
**FRs covered:** FR31-FR40, UX-DR1 through UX-DR10
**Wave:** 4 (UI Surfaces)

## Epic 1: Tool Registry & Executor Foundation

IT administrators can define, validate, and manage tools through YAML configuration, and the system can execute tool invocations through a pluggable, PII-redacted pipeline with circuit breaker protection and full audit logging.

### Story 1.1: Tool Definition Schema & YAML Configuration

As a **system administrator**, I want to define tools using YAML files validated against JSON Schema, so that I can register custom tools without modifying core code.

**Acceptance Criteria:**

**Given** a YAML tool definition file in `configs/tools/`
**When** the Tool Registry service starts
**Then** the file is validated against `configs/tools/schema/tool-definition.schema.json`
**And** invalid definitions are rejected with a descriptive error message logged via CustomLogger
**And** valid definitions are loaded into an in-memory dictionary (satisfies NFR3 ≤50ms lookup)
**And** the service starts successfully without network connectivity to ArangoDB or Redis (NFR23)

**Given** a tool definition YAML with all required fields (name, version, type, enabled, parameters schema, execution config, security config)
**When** validated against the JSON Schema
**Then** the definition passes validation
**And** the `web-search.yaml` sample tool definition ships with the repository

### Story 1.2: Tool Registry Service with Admin API

As a **system administrator**, I want to view, create, update, and delete tool definitions via an API, so that I can manage the tool ecosystem at runtime.

**Acceptance Criteria:**

**Given** the Tool Registry service is running with tool definitions loaded
**When** a GET request hits `/v1/tools/definitions`
**Then** all registered tools are returned with status, configuration, and metadata

**Given** a PUT request to `/v1/tools/definitions/{tool_id}` with a valid configuration change (e.g., enable/disable toggle, rate limit update)
**When** the request is processed
**Then** the YAML file is updated atomically (write to .tmp, rename) and synced to ArangoDB
**And** if ArangoDB sync fails, the YAML change is rolled back and an error is returned
**And** a `tool-config-changes` event is published to Redis Stream (NFR7)

**Given** a DELETE request to `/v1/tools/definitions/{tool_id}`
**When** the tool is in use or referenced by active configurations
**Then** the deletion is rejected with a clear dependency error

**Given** the Tool Registry service at startup
**When** YAML definitions are loaded into ArangoDB
**Then** a content hash is stored in both YAML metadata and ArangoDB for reconciliation
**And** if hashes disagree at startup, YAML overwrites ArangoDB

### Story 1.3: PII Redaction Pluggable Interface & Regex Implementation

As a **system architect**, I want a pluggable PII redaction interface with a default regex-based implementation, so that all external tool invocations are PII-redacted without requiring new GPU infrastructure.

**Acceptance Criteria:**

**Given** the `PIIRedactor` ABC is defined in `genieai_tool_executor_redactor.py` with `redact(text) -> str` and `detect(text) -> list[PIIEntity]` methods
**When** `PII_REDACTOR_IMPL=regex` (default)
**Then** the regex implementation redacts common PII patterns (names, emails, phone numbers, addresses, dates)
**And** processing completes within 100ms per invocation (NFR5)

**Given** an external tool invocation request
**When** the PII redactor processes the input parameters
**Then** PII entities are detected and redacted before the request reaches the external backend
**And** the redaction result (`pii_redacted: true`) is included in the audit event

**Given** the PII redaction service encounters an error
**When** processing input parameters
**Then** the request is blocked (not forwarded to the external tool) and an error is logged (NFR6)
**And** the response includes an error indicating PII redaction failure

**Given** `PII_REDACTOR_IMPL=http://redaction-service:8000/redact`
**When** the Tool Executor starts
**Then** the HTTP backend is used for redaction via `httpx.AsyncClient`

### Story 1.4: Tool Executor Service with Circuit Breaker & Rate Limiting

As a **system architect**, I want the Tool Executor to invoke tools through a standardized interface with circuit breaker protection and rate limiting, so that external backend failures don't cascade and backends aren't overloaded.

**Acceptance Criteria:**

**Given** the Tool Executor service is running with the `web-search` tool definition cached in memory
**When** a POST request hits `/v1/tools/execute/web-search` with valid parameters
**Then** the PII redactor processes the parameters
**And** the tool plugin executes against the configured backend
**And** a structured ToolResult is returned (results, citations, confidence, execution metadata)

**Given** the external backend (SearXNG) fails 3 consecutive times
**When** the 4th invocation is attempted
**Then** the circuit breaker is OPEN and the request is rejected with `degradation` metadata (`fallback_applied: "rag_only"`)
**And** after `CIRCUIT_BREAKER_SEARXNG_RECOVERY_TIMEOUT` seconds, the circuit moves to HALF_OPEN and allows a test request

**Given** a tool invocation that exceeds the configured per-tool rate limit
**When** the rate limit is enforced
**Then** a `rate_limited` status is returned with HTTP 429 and `Retry-After` header
**And** the rate limit event is logged (NFR7)

**Given** the tool definition model from Story 1.1 (JSON Schema with execution config, parameters, security settings)
**When** the Tool Executor loads tool definitions at startup
**Then** each tool's execution config (backend URL, timeout, retry policy, enabled state) is resolved from the validated definition
**And** the executor rejects tools with missing or invalid execution configs with a descriptive error

**Given** the ToolExecutor ABC defined in `genieai_tool_executor_plugins/base.py`
**When** a new tool plugin implements `execute()` and `validate_params()`
**Then** the plugin is discovered and registered at startup

### Story 1.5: Redis Streams Event Backbone & Audit Logging

As a **compliance officer**, I want every tool invocation to be audit-logged in a structured, queryable format, so that FOI requests can be satisfied without transformation.

**Acceptance Criteria:**

**Given** a tool invocation completes (success or failure)
**When** the Tool Executor processes the result
**Then** an audit event is published to Redis Stream `tool-invocation-audit` containing: tool_id, user_sub, timestamp, input_params, result_metadata, pii_redacted, status

**Given** an audit event consumer reading from `tool-invocation-audit`
**When** the event is consumed
**Then** the audit record is persisted to ArangoDB `tool_invocation_audit` collection
**And** failed persistence routes the event to `tool-invocation-audit-dlq`

**Given** the `tool-config-changes` stream
**When** a tool or feed is created, updated, or deleted via the Tool Registry
**Then** an event is published with tool_id, action, and timestamp
**And** the Tool Executor consumes the event and invalidates its in-memory cache

**Given** an admin API query to `/v1/tools/audit`
**When** filtered by tool_id, date range, or user_sub
**Then** matching audit records are returned from ArangoDB (NFR8)

**Given** the Sprint 23 observability platform (#601) may define a standard event consumption interface
**When** the audit event schema is finalized
**Then** the event structure (tool_id, user_sub, timestamp, input_params, result_metadata, pii_redacted, status) is documented as a standalone specification
**And** if #601 is merged before this story, the event schema is verified compatible with the observability consumer expectations
**And** if #601 is not yet merged, the documented schema serves as the alignment contract for future integration

### Story 1.6: Multi-Platform Deployment Configuration

As a **DevOps engineer**, I want to deploy all tool services via Docker Compose (local dev), Docker Swarm with Ansible (production), and Kubernetes with Helm (planned), so that the tools layer can be deployed across all target environments from a single source of truth.

**Acceptance Criteria:**

**Given** the Ansible tools role in `deploy/ansible/roles/tools/`
**When** `ansible-playbook deploy.yml --tags tools` is executed
**Then** Tool Registry, Tool Executor, Stream Ingestor, and SearXNG containers are built and deployed to `genieai=true` nodes via Docker Swarm

**Given** the updated `docker-compose.yaml` with tool services
**When** `docker compose up --profile opea` is executed for local development
**Then** all tool services start with health check endpoints and sensible local defaults

**Given** a Helm chart (or chart stub) for the tools services
**When** `helm install genie-tools ./charts/tools/` is executed against a Kubernetes cluster
**Then** all tool services deploy with configurable replicas, resource limits, and health probes
**And** Kubernetes-native features (HPA, PDB) are available for horizontal scaling (NFR18)

**Given** each new service container across all deployment targets
**When** the container starts
**Then** it runs as non-root `user` (NFR26 compliance)
**And** `/health` returns 200 if the process is running
**And** `/ready` returns 200 only if all dependencies are reachable

**Given** the Dockerfiles for Tool Registry, Tool Executor, and Stream Ingestor
**When** built via multi-stage OPEA v1.3 overlay
**Then** the images follow the established pattern (OPEA clone, dependency patches, custom file overlay, non-root user)
**And** the same image is used across Docker Compose, Docker Swarm, and Kubernetes deployments

**Given** environment-specific configuration
**When** deployed to any target platform
**Then** service-level config (ports, log levels, URLs, rate limits, circuit breaker thresholds) is set via environment variables with sensible defaults
**And** tool/feed definitions are loaded from mounted `configs/tools/` volume

**Given** Sprint 23 infrastructure work — K8s/Helm patterns (#600) and Nginx multi-deploy (#602)
**When** the deployment configuration is finalized
**Then** Docker Compose and Ansible deployment are complete and functional regardless of #600/#602 merge status
**And** Helm charts are created as a documented stub with placeholder structure — finalized to match #600 conventions after #600 merges
**And** nginx routing rules for tool services are compatible with the existing gateway configuration and adaptable to #602 multi-deploy changes
**And** a reconciliation checklist is documented listing the alignment points to verify once #600 and #602 are merged

## Epic 2: Web Search & Result Fusion

Citizens receive answers that cite current, live web sources alongside knowledge base documents, with visible provenance and graceful degradation when web search is unavailable.

### Story 2.1: SearXNG Service Integration & Web Search Plugin

As a **citizen**, I want the system to search the web for current information when the knowledge base lacks sufficient context, so that I receive answers grounded in live sources.

**Acceptance Criteria:**

**Given** SearXNG is deployed as a CPU-only container on a `genieai=true` node
**When** the Tool Executor invokes the `web_search` plugin
**Then** the query is sent to SearXNG's search API via `httpx.AsyncClient` with circuit breaker protection
**And** results are returned within 2 seconds P95 including PII redaction (NFR1)

**Given** the `web_search.py` plugin implementing `ToolPlugin` ABC
**When** the plugin executes against SearXNG
**Then** results are parsed into the standard ToolResult format (content, url, score, source_type="web_search", retrieved_at)
**And** results are filtered through the domain whitelist configured in `web-search.yaml`

**Given** a web search result with a URL
**When** the result is included in the ToolResult
**Then** the URL is validated as reachable and well-formed (NFR16)

### Story 2.2: Rule-Based Tool Trigger Logic

As a **system architect**, I want the RAG pipeline to automatically invoke web search when retrieval confidence is low or time-sensitive patterns are detected, so that citizens get current answers without explicit tool selection.

**Acceptance Criteria:**

**Given** a user query submitted through ChatQnA
**When** ArangoDB retrieval completes with a confidence score below the configured threshold (default 0.70)
**Then** the tool trigger fires and routes the query to the Tool Executor for web search

**Given** a user query containing time-sensitive patterns (e.g., "current", "latest", "today", "deadline")
**When** the pattern detector identifies a time-sensitive query
**Then** the tool trigger fires regardless of retrieval confidence score

**Given** the tool trigger fires
**When** the Tool Executor returns results
**Then** the results are passed to the result fusion engine (Story 2.3)

**Given** the tool trigger fires but the Tool Executor is unavailable (circuit breaker open)
**When** no tool results are available
**Then** the query proceeds with RAG-only results and no degradation message (system still has KB results)

### Story 2.3: Result Fusion & Context Window Budget

As a **citizen**, I want web search results to be merged with knowledge base results in a single coherent answer, so that I get the best available information from both sources.

**Acceptance Criteria:**

**Given** tool execution results (from web search) and RAG retrieval results (from ArangoDB)
**When** the result fusion engine processes both sets
**Then** results are scored, deduplicated by URL/content similarity, and ranked by relevance
**And** the top results are merged into the LLM context window according to configurable budget ratios (NFR20)

**Given** the merged result set
**When** results include both knowledge base documents and web search results
**Then** each result carries a `source_type` label ("document" or "web_search") for citation rendering
**And** the LLM prompt includes provenance information (source, date, URL)

**Given** the context window budget is allocated (e.g., 60% RAG, 40% tools)
**When** the total context exceeds the window size
**Then** lower-scoring results are trimmed to fit within budget

### Story 2.4: Source Citations & Graceful Degradation

As a **citizen**, I want to see which sources informed the answer with clickable citations and provenance labels, so that I can verify the information myself.

**Acceptance Criteria:**

**Given** a tool-augmented response from the LLM
**When** the response includes citations
**Then** each citation contains url, title, source_type ("document" or "web_search"), retrieved_at, and confidence score
**And** the response schema is identical for both Vue 3 and Flutter consumption (NFR21)

**Given** a tool-augmented response
**When** citations are rendered in the Vue 3 chat interface
**Then** each citation shows the source type icon (document vs web), title, and clickable URL
**And** provenance labels distinguish knowledge base documents from external web sources

**Given** the LLM determines that neither the knowledge base nor web search provides sufficient context
**When** the result fusion engine discards all results below the quality threshold
**Then** the system returns a transparent "insufficient information" response with guidance on alternative sources (NFR12, FR23)
**And** the response includes a `degradation` field with `reason: "LOW_QUALITY"` and `fallback_applied: "none"` (NFR12)

**Given** the system administrator has disabled citations via configuration
**When** a tool-augmented response is generated
**Then** the response omits citation metadata (FR22)

### Story 2.5: ChatQnA Pipeline Integration

As a **system architect**, I want the tool executor integrated into the existing RAG pipeline after retrieval and before LLM prompt construction, so that tool results augment the standard retrieval flow.

**Acceptance Criteria:**

**Given** the ChatQnA service processes a user query
**When** the retrieval stage completes
**Then** retrieval confidence is evaluated against the trigger threshold
**And** if triggered, the Tool Executor is invoked via HTTP at `/v1/tools/execute/{tool_id}`
**And** tool results are fused with retrieval results before prompt assembly (FR47)

**Given** the `genieai_api_protocol.py` response model
**When** a tool-augmented response is constructed
**Then** the response includes `citations` array and optional `degradation` object
**And** existing non-tool-augmented queries are unaffected (backward compatible)

**Given** the ChatQnA #604 modular refactoring is in progress or planned
**When** the ToolExecutor integration is implemented
**Then** the integration targets the HTTP contract defined in Story 1.4 (`POST /v1/tools/execute/{tool_id}`) — not ChatQnA internal APIs
**And** a contract validation test suite verifies the HTTP interface independently of ChatQnA's internal structure
**And** the integration is implemented against the current ChatQnA monolith (retrieval stage, before LLM prompt construction)
**And** a documented migration guide specifies the exact call-site change required when #604 splits the monolith into modules — the HTTP contract does not change, only the internal call site moves

**Given** Story 2.5 is the last story in Epic 2 and blocks the Sprint 24 LangGraph gate
**When** #604 refactoring begins before Story 2.5 is complete
**Then** Story 2.5 is prioritized ahead of #604 — the integration must be validated against the current monolith before refactoring begins
**And** if #604 completes first, Story 2.5 targets the refactored modular structure directly using the same HTTP contract

## Epic 3: Stream Ingestion & Data Lifecycle

IT administrators can configure continuous content ingestion from RSS/Atom feeds, JSON APIs, and webhooks, with automated TEI embedding, ArangoDB storage in the shared chunks collection, configurable retention policies, and self-healing via circuit breakers and dead letter queues.

### Story 3.1: RSS/Atom Feed Polling & Content Extraction

As an **IT administrator**, I want the system to periodically poll RSS/Atom feeds and extract content, so that knowledge bases stay current with published government information.

**Acceptance Criteria:**

**Given** a feed definition YAML with type "rss", URL, schedule (cron), and content mapping (title_field, body_field, date_field)
**When** the Stream Ingestor's background scheduler triggers at the configured interval
**Then** the feed URL is polled and entries are parsed
**And** content is extracted using the configured field mappings

**Given** parsed feed entries
**When** extraction completes
**Then** a `feed-ingestion-events` event is published to Redis Stream with event_type "poll_complete" and feed metadata

**Given** the feed publisher's server is unreachable
**When** 3 consecutive polls fail
**Then** the circuit breaker opens for that feed
**And** the feed health status is reported as "degraded"
**And** subsequent polls are routed to DLQ until recovery (NFR15)

### Story 3.2: JSON API Polling with Field Mapping

As an **IT administrator**, I want the system to poll JSON API endpoints on a schedule with configurable field mapping, so that structured data sources can be ingested without custom parsers.

**Acceptance Criteria:**

**Given** a feed definition YAML with type "json_api", URL, schedule, and content_mapping
**When** the Stream Ingestor polls the endpoint
**Then** the JSON response is parsed and fields are mapped to the standard content model using the configured mapping

**Given** the JSON API response schema validation
**When** the response doesn't match the expected structure
**Then** the entry is routed to the dead letter queue with a parse_error status (FR42)

### Story 3.3: Webhook Endpoint for Push-Based Ingestion

As an **IT administrator**, I want an authenticated webhook endpoint for push-based content delivery, so that external systems can send content directly to the ingestion pipeline.

**Acceptance Criteria:**

**Given** a feed definition with webhook configuration
**When** a POST request hits `/v1/tools/webhook/{feed_name}`
**Then** the request is authenticated via API key or JWT Bearer token (NFR9)
**And** unauthenticated requests are rejected with HTTP 401

**Given** an authenticated webhook payload
**When** the payload is received
**Then** content is extracted and routed to the TEI embedding pipeline
**And** a `feed-ingestion-events` event is published with event_type "webhook_received"

**Given** a webhook request that exceeds the per-feed rate limit
**When** the rate limiter detects overflow
**Then** the request is rejected with HTTP 429 and `Retry-After` header

### Story 3.4: TEI Embedding Pipeline & Shared Chunks Storage

As a **system architect**, I want ingested content routed through the existing TEI embedding service and stored in the shared ArangoDB chunks collection, so that feed content participates in the same vector search as uploaded documents.

**Acceptance Criteria:**

**Given** extracted feed content from any ingestion source (RSS/Atom from Story 3.1, JSON API from Story 3.2, or webhook from Story 3.3)
**When** the Stream Ingestor processes the content
**Then** each content item is sent to the TEI embedding service via HTTP for vector embedding
**And** the embedded chunk is stored in the shared `chunks` collection with `source_type: "feed"`, `source_url`, `feed_id`, and `expires_at` fields
**And** the embedding pipeline is source-agnostic — it processes a standardized content model regardless of ingestion origin

**Given** the existing `retract_file` method in the dataprep pipeline
**When** feed chunks are stored alongside file-sourced chunks
**Then** file-sourced chunks are unaffected (no regression)
**And** feed chunks are retrievable via the same vector search path (NFR25)

**Given** the new `retract_expired_feed_chunks` method
**When** the background TTL cleanup job runs on a configurable interval
**Then** chunks where `expires_at < now()` are removed from the shared collection
**And** the cleanup is idempotent and safe to run concurrently with `retract_file`

**Given** the end-to-end ingestion pipeline
**When** measured from feed publication to RAG availability
**Then** content is available within 4 hours (NFR2)

### Story 3.5: Feed Health Monitoring & Dead Letter Queue Reprocessing

As a **DevOps engineer**, I want to monitor feed health, inspect dead letter queue entries, and trigger reprocessing, so that ingestion failures are visible and recoverable.

**Acceptance Criteria:**

**Given** the Stream Ingestor service
**When** a feed health check is requested
**Then** `/health` returns liveness and `/ready` checks dependency status (ArangoDB, Redis, TEI)
**And** feed-level health (poll status, error count, circuit breaker state) is queryable

**Given** failed ingestion entries in the DLQ streams
**When** a DLQ reprocessor cron job runs
**Then** entries are reprocessed with exponential backoff
**And** entries that fail reprocessing after max retries are logged for manual review

## Epic 4: Admin & User Interface Surfaces

IT administrators can manage tools, feeds, domain whitelists, audit logs, user role grants, and tool analytics through the Vue 3 admin dashboard (integrated into Document Management), and citizens can see source citations and graceful degradation messages across both web (Vue 3) and mobile (Flutter) chat interfaces. Vue 3 serves both citizen and admin roles; Flutter remains a citizen-facing end-user app only.

### Story 4.1: Backend Admin API Proxy

As a **system administrator**, I want a backend API proxy that routes admin tool operations to the Tool Registry service, so that admin actions go through the existing API gateway with Keycloak authentication.

**Acceptance Criteria:**

**Given** the `toolsController.js` in the Node.js backend
**When** an authenticated request hits `/api/tools/*`
**Then** the request is proxied to the Tool Registry service at `/v1/tools/*`
**And** only users with `tools-admin` or `tools-reader` Keycloak role are authorized (NFR10)
**And** `tools-admin` allows full CRUD; `tools-reader` allows read-only access

**Given** an admin API request
**When** processed through the proxy
**Then** the response returns within 500ms for standard CRUD operations (NFR4)

### Story 4.2: Vue 3 Admin Tool & Feed Management (Document Management Tab)

As an **IT administrator**, I want to manage tools and feeds through the existing Document Management tab in the Vue 3 admin dashboard, so that all ingestion management is in one place.

**Acceptance Criteria:**

**Given** the DocumentManagement.vue admin view
**When** the admin navigates to the tools section
**Then** a list of registered tools is displayed with name, type, status (enabled/disabled), and last invocation count
**And** enable/disable toggles work immediately (no redeployment required) (FR31)

**Given** the feed management sub-section
**When** the admin adds a new feed
**Then** the feed definition form includes: name, type (rss/json_api/webhook), URL, schedule, retention days, content mapping
**And** the feed definition is validated against the JSON Schema before submission (FR36)

**Given** the domain whitelist editor
**When** the admin adds or removes domains
**Then** the whitelist is persisted to the tool definition YAML and synced to ArangoDB (FR32)

**Given** the audit log viewer
**When** the admin filters by tool, date range, or user
**Then** matching audit records are displayed with export capability (FR34)

**Given** the health status overview
**When** the admin views the tools dashboard
**Then** each tool and feed shows green/yellow/red health status with error summaries (FR33)

### Story 4.3: List-and-Grant User Management (Vue 3 Admin Only)

As an **IT administrator**, I want to assign `tools-admin` and `tools-reader` capabilities to users through a searchable list-and-grant interface in the Vue 3 admin dashboard, so that role management scales with future capability domains.

**Acceptance Criteria:**

**Given** the user management admin view in Vue 3
**When** the admin searches for a user by name or email
**Then** matching users are displayed with their current capability grants

**Given** a user entry
**When** the admin grants `tools-admin` or `tools-reader` capability
**Then** the grant is persisted to Keycloak realm roles
**And** the user gains access to the corresponding admin features on next login

**Given** a user with `tools-reader` capability
**When** they attempt a write operation (tool creation, feed modification)
**Then** the operation is rejected with an authorization error

**Given** a Flutter mobile user
**When** they access the app
**Then** no admin features (tool management, user role grants) are available — Flutter remains a citizen-facing app only

### Story 4.4: Vue 3 Citation Rendering & Graceful Degradation Messages

As a **citizen**, I want to see source citations with provenance labels and clear degradation messages when the system can't provide a sufficient answer.

**Acceptance Criteria:**

**Given** a chat response containing citations
**When** rendered in the Vue 3 chat interface
**Then** each citation shows: source type icon (document vs web_search), title, truncated URL, and confidence indicator
**And** provenance labels distinguish knowledge base documents ("Uploaded document — Jan 2026") from external web sources ("Web search — retrieved today")

**Given** a chat response with a `degradation` object
**When** rendered in the Vue 3 chat interface
**Then** a visible degradation message is displayed with the tool_id, reason, and guidance text
**And** the message is screen-reader compatible (ARIA labels) (NFR20)

**Given** citations are disabled by the administrator
**When** a tool-augmented response is rendered
**Then** no citation elements appear in the UI

### Story 4.5: Flutter Citation Rendering & Graceful Degradation (Citizen-Facing Only)

As a **mobile citizen**, I want to see the same source citations and degradation messages on my phone as on the web, so that I have consistent access to tool-augmented information.

**Acceptance Criteria:**

**Given** a chat response containing citations
**When** rendered in the Flutter mobile chat interface
**Then** each citation matches the Vue 3 behavior: source type icon, title, URL, confidence indicator
**And** tapping a citation opens the URL in the device browser (NFR21)

**Given** a chat response with a `degradation` object
**When** rendered in the Flutter mobile chat interface
**Then** the degradation message matches the Vue 3 rendering: tool_id, reason, guidance text
**And** the message is screen-reader compatible via Semantics widgets (NFR20)

**Given** the shared citation schema from the backend
**When** consumed by both Vue 3 and Flutter
**Then** both platforms render identically from the same JSON structure — no platform-specific API endpoints needed

**Given** the Flutter app user
**When** they navigate the app
**Then** no admin views (tool management, feed management, user role grants, audit log viewer) are available — Flutter is citizen-facing only

### Story 4.6: Tool Invocation Analytics Dashboard (Vue 3 Admin)

As an **IT administrator**, I want to view tool invocation analytics including usage trends, knowledge gap identification, and performance metrics, so that I can optimize tool configuration and identify content ingestion priorities.

**Acceptance Criteria:**

**Given** the audit data accumulated from tool invocations
**When** the admin navigates to the analytics section of the Document Management tools dashboard
**Then** aggregated metrics are displayed: total invocations per tool, success/failure rates, average latency, PII redaction hit rate

**Given** tool invocation patterns over time
**When** the analytics engine identifies queries that triggered web search but returned low-quality results
**Then** these are flagged as potential knowledge gaps — content that citizens need but isn't in the system

**Given** feed ingestion analytics
**When** the admin views ingestion metrics
**Then** per-feed ingestion counts, success/failure rates, and content freshness (time since last successful poll) are displayed
