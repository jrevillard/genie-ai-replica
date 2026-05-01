---
stepsCompleted: ['step-01-init', 'step-02-context', 'step-03-starter', 'step-04-decisions', 'step-05-patterns', 'step-06-structure', 'step-07-validation', 'step-08-complete']
status: 'complete'
completedAt: '2026-05-01'
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

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Service decomposition and inter-service contracts
- Data persistence and streaming topology
- PII redaction pluggable interface
- ChatQnA integration contract and forward compatibility

**Important Decisions (Shape Architecture):**
- Admin API authorization model
- Configuration management and runtime reload
- Circuit breaker and degradation strategy

**Deferred Decisions (Post-MVP):**
- LangGraph ToolNode integration specifics (Sprint 24 dependency)
- Horizontal scaling thresholds (requires production load data)
- Advanced feed deduplication strategies (content-hash vs. semantic similarity)

### Data Architecture

#### Decision 1: Tool Definition Persistence

**Decision:** Hybrid — YAML source of truth + ArangoDB runtime state

**Rationale:** Two NFRs create competing constraints. NFR23 requires startup without external network (YAML files on disk satisfy this directly). NFR7/8 require queryable audit logs (ArangoDB runtime state satisfies this). Hybrid is the only option that doesn't violate a constraint.

**Implementation Details:**
- YAML files in `configs/tools/` directory, git-controlled, validated against JSON Schema at startup
- On startup, Tool Registry loads YAML files into ArangoDB (upsert)
- Admin API mutations: write YAML first (atomic via `os.rename()`), then sync to ArangoDB
- If ArangoDB sync fails: rollback YAML, raise error — YAML is always the source of truth
- Content hash stored in both YAML and ArangoDB for cheap reconciliation at startup
- Single-writer pattern for admin mutations (tool definitions change infrequently)
- In-memory cache populated from YAML at startup for O(1) lookup (sub-millisecond, satisfies NFR5 ≤50ms)

**NFRs Satisfied:** NFR5 (≤50ms registry lookup), NFR7 (audit trail), NFR8 (FOI-exportable), NFR23 (startup without network)

#### Decision 2: Redis Streams Topology

**Decision:** Per-purpose streams with dedicated consumer groups and application-level dead letter queues

**Stream Definitions:**

| Stream | Consumer Groups | Purpose | MAXLEN |
|--------|----------------|---------|--------|
| `feed-ingestion-events` | `stream-ingestor` | Feed poll complete, webhook received | ~10,000 |
| `tool-invocation-audit` | `audit-persistor`, `audit-monitor` | Tool invocation records for NFR7/8 | ~50,000 |
| `tool-config-changes` | `tool-executor`, `stream-ingestor` | Cache invalidation on tool/feed CRUD | ~1,000 |
| `feed-ingestion-events-dlq` | `dlq-reprocessor` | Failed ingestion events | ~5,000 |
| `tool-invocation-audit-dlq` | `dlq-reprocessor` | Failed audit persistence | ~5,000 |

**Consumer Group Naming Convention:** `{service-name}-{stream-name}` (e.g., `stream-ingestor-feed-ingestion-events`)

**Dead Letter Queue Pattern:** Application-level logic (not Redis-native). Consumer reads main stream, on failure publishes to DLQ stream with original message + error metadata + timestamp. DLQ entries are queryable for audit purposes. A `dlq-reprocessor` cron job drains DLQs with exponential backoff.

**NFRs Satisfied:** NFR7 (audit trail), NFR8 (FOI-exportable), NFR14 (dead letter queues), NFR15 (component isolation), NFR27 (configurable retention via MAXLEN)

#### Decision 3: Ingested Content Storage

**Decision:** Shared `chunks` collection with `source_type` discriminator and extended retraction

**Rationale:** The existing graph system with ingestion and retraction is well-tested and functioning. Creating a parallel collection would duplicate graph structure, reindexing, and retrieval paths. Instead, feed-sourced chunks share the existing `chunks` graph vertex collection with optional metadata fields and an extended retraction service.

**Schema Extension (optional nullable fields on chunk documents):**
- `source_type`: `"file"` (default, existing) | `"feed"` (new)
- `source_url`: URL of the feed source (feed chunks only)
- `feed_id`: Reference to feed configuration (feed chunks only)
- `expires_at`: TTL expiry timestamp (feed chunks only; null on file chunks)

**Retraction Extension:**
- Existing `retract_file` handles file-scoped cleanup by `file_id` (unchanged)
- New `retract_expired_feed_chunks` method purges feed chunks where `expires_at < now()` on a configurable interval (background cron job, not inline)
- Both methods operate on the same `chunks` collection; retraction service gets a new method, not a new class
- Idempotent and safe to run concurrently with file-based retraction

**Retrieval Impact:**
- RAG retriever pulls from `chunks` collection (unchanged path)
- Feed chunks participate in vector search alongside file chunks (single collection, no query fan-out)
- Retrieval layer explicitly handles mixed chunk types — no accidental filtering

**Conditions (from party review):**
1. Feed retraction must not affect file-sourced chunks (test-verified regression guard)
2. Mixed vector search relevance validated against curated-only baseline before production
3. Optional nullable fields — no polymorphic collection gymnastics
4. Test coverage: feed insert with correct `expires_at`, expired feed purge, file retraction regression, mixed retrieval

**NFRs Satisfied:** NFR25 (no schema modifications to current vector store — optional fields are additive, not structural), NFR1 (≤2s web search P95 — single collection, no fan-out), NFR3 (≤4h ingestion freshness)

### Authentication & Security

#### Decision 4: Admin API Authorization — Two Roles

**Decision:** Two Keycloak roles: `tools-admin` (full CRUD on tools, feeds, domain whitelist) + `tools-reader` (read-only access to tool/feed configs and audit logs)

**Rationale:** The NFRs define admin CRUD and audit viewing but no intermediate operator tier. Two roles cover the requirement set without over-engineering. `tools-reader` serves FOI auditors who need audit log access without config modification rights (NFR8). Roles are assigned via Keycloak realm management.

**UI Paradigm Shift — List and Grant:**
The Vue 3 admin user management UI will shift from static role assignment to a list-and-grant paradigm. Admins see a list of users and grant/revoke capabilities (including `tools-admin`, `tools-reader`, and existing roles) per user. This is more flexible than role-based checkboxes and scales as new capability domains are added in future initiatives.

**NFRs Satisfied:** NFR9 (Keycloak RBAC), NFR8 (FOI-accessible audit logs)

#### Decision 5: PII Redaction — Pluggable Hybrid Interface

**Decision:** Python ABC (Abstract Base Class) defining the redaction contract, with local same-process implementation for CPU-based redaction and optional async HTTP backend for external redaction services

**Interface Contract:**
```python
class PIIRedactor(ABC):
    @abstractmethod
    async def redact(self, text: str) -> str: ...

    @abstractmethod
    async def detect(self, text: str) -> list[PIIEntity]: ...
```

- `PIIEntity`: dataclass with `entity_type`, `start`, `end`, `redacted_value`
- Default MVP implementation: regex-based redaction (no new GPU dependency, satisfies NFR17)
- Pluggable via environment variable (`PII_REDACTOR_IMPL=regex|presidio|http://...`)
- Same-process implementations run directly in the Tool Executor for low latency
- HTTP backend option for deployments with dedicated external redaction services
- Failure mode: block (refuse to forward unredacted content to external tools) per NFR6 (zero PII leakage)

**NFRs Satisfied:** NFR6 (zero PII leakage), NFR10 (configurable redaction), NFR17 (no new GPU infrastructure)

### API & Communication Patterns

#### Decision 6: Sync vs Async Communication Boundaries

**Decision:** Synchronous HTTP for request-path operations, Redis Streams for fire-and-forget events

| Communication Path | Protocol | Rationale |
|-------------------|----------|-----------|
| Tool Registry → Tool Executor (schema lookup) | HTTP (sync) | Fallback on cache miss; user waiting |
| Tool Registry → Tool Executor (config changes) | Redis Stream `tool-config-changes` (async) | Cache invalidation; non-blocking |
| Tool Executor → SearXNG | HTTP (sync) | User waiting for results; ≤2s P95 budget |
| Tool Executor → `tool-invocation-audit` | Redis Stream (async) | Audit must not block response |
| Stream Ingestor → TEI Embedding | HTTP (sync) | Embedding must complete before storage |
| Stream Ingestor → Tool Registry (feed config) | HTTP (sync) | Config needed at poll time |
| Stream Ingestor → `feed-ingestion-events` | Redis Stream (async) | Event notification; non-blocking |

**NFRs Satisfied:** NFR1 (≤2s web search), NFR2 (≤4h ingestion freshness), NFR14 (component isolation)

#### Decision 7: Error Handling & Graceful Degradation

**Decision:** Standard OPEA JSON error format with degradation metadata for tool failures

- Standard errors: `{ "error": { "code": "TOOL_EXECUTION_FAILED", "message": "...", "details": {} } }`
- Tool failure with degradation: response includes `degradation` field so UI can render provenance labels:
```json
{
  "degradation": {
    "tool_id": "web-search",
    "reason": "CIRCUIT_OPEN",
    "fallback_applied": "rag_only"
  }
}
```

Per NFR12, tool failures produce zero hallucinations — the system degrades to RAG-only responses with a user-visible degradation message rather than fabricating tool results.

**NFRs Satisfied:** NFR12 (zero hallucinations from tool failures), NFR13 (graceful degradation), NFR20/21 (accessible degradation messages)

#### Decision 8: Rate Limiting

**Decision:** Redis-backed sliding window counter with per-user and per-feed limits

- Per-user rate limits on tool invocation (configurable per tool definition)
- Per-feed rate limits on webhook intake (prevent feed flooding)
- Redis atomic operations ensure consistency across service replicas (NFR18: horizontal scaling support)
- Rate limit exceeded returns HTTP 429 with `Retry-After` header

**NFRs Satisfied:** NFR18 (horizontal scaling), NFR15 (component isolation)

### Frontend Architecture

#### Decision 9: Admin UI — List-and-Grant User Management

**Decision:** Vue 3 admin user management shifts from static role assignment to a list-and-grant paradigm

Admins see a searchable list of users and grant/revoke individual capabilities per user. This replaces role-based checkboxes and scales as new capability domains are added. New tool-related grants: `tools-admin` (full CRUD), `tools-reader` (read-only + audit access). Existing grants remain unchanged.

**NFRs Satisfied:** NFR9 (Keycloak RBAC), NFR20 (WCAG 2.1 AA accessible interface)

#### Decision 10: Citation Rendering — Shared Response Schema

**Decision:** Structured citation schema consumed identically by Vue 3 and Flutter

```json
{
  "citation": {
    "url": "https://...",
    "title": "...",
    "source_type": "document|web_search|feed",
    "retrieved_at": "2026-04-30T12:00:00Z",
    "confidence": 0.85
  }
}
```

- `source_type` enables platform-specific rendering (e.g., web search icon vs. document icon vs. feed icon)
- `confidence` threshold controls citation display (low-confidence results hidden or marked as unverified)
- Both platforms render from the same schema; no platform-specific API endpoints

**NFRs Satisfied:** NFR20 (WCAG 2.1 AA), NFR21 (Vue 3/Flutter parity)

### Infrastructure & Deployment

#### Decision 11: Service Placement & Container Strategy

**Decision:** All new services are CPU-only containers on `genieai=true` nodes

| Service | Container | CPU/GPU | Placement |
|---------|-----------|---------|-----------|
| Tool Registry | `genie-ai-overlay/tool-registry` | CPU | `genieai=true` |
| Tool Executor | `genie-ai-overlay/tool-executor` | CPU | `genieai=true` |
| Stream Ingestor | `genie-ai-overlay/stream-ingestor` | CPU | `genieai=true` |
| SearXNG | `searxng/searxng` (upstream image) | CPU | `genieai=true` |
| PII Redaction | Pluggable (regex = in-process, external = separate container) | CPU | `genieai=true` |

Zero new GPU infrastructure per NFR17.

**NFRs Satisfied:** NFR17 (zero new GPU infrastructure), NFR22 (startup without external network for tool definitions)

#### Decision 12: Health Checks & Restart Policy

**Decision:** Each new service exposes `/health` (liveness) and `/ready` (readiness with dependency checks)

- `/health`: Returns 200 if process is running (Docker Swarm liveness probe)
- `/ready`: Returns 200 only if all dependencies are reachable (ArangoDB, Redis). Tool Executor additionally checks SearXNG connectivity. Stream Ingestor additionally checks TEI embedding service.
- Swarm restart policy: `on-failure:3` with 5-second delay, consistent with existing services

#### Decision 13: Deployment Tags & Configuration

**Decision:** Ansible `--tags tools` for targeted deployment; YAML-based tool/feed config with environment variable overrides

- `ansible-playbook deploy.yml --tags tools` deploys all three new services + SearXNG
- Tool and feed definitions: YAML files in `configs/tools/`, validated against JSON Schema at startup
- Service-level config (ports, log levels, URLs): environment variables with sensible defaults (existing OPEA pattern)
- PII redactor selection: `PII_REDACTOR_IMPL` environment variable

**NFRs Satisfied:** NFR23 (startup without external network), NFR24 (Ansible --tags tools)

### Decision Impact Analysis

**Implementation Sequence:**
1. Data architecture (Redis Streams, shared chunks extension) — foundation for all services
2. PII redaction interface — guardrail must exist before tool execution
3. Tool Registry service — other services depend on tool definitions
4. Tool Executor service — depends on Registry + PII redactor
5. Stream Ingestor service — depends on Registry + shared chunks extension
6. ChatQnA integration — depends on Tool Executor
7. Admin API + Vue 3 admin UI — depends on all services
8. Flutter chat extensions — depends on citation schema from ChatQnA integration

**Cross-Component Dependencies:**
- Redis Streams configuration must precede all service development
- ArangoDB schema extension (`source_type`, `expires_at` fields) must precede Stream Ingestor
- PII redaction ABC must be defined before Tool Executor implementation
- ChatQnA integration contract must be finalized before Sprint 24 LangGraph work begins
- Admin UI list-and-grant paradigm affects existing user management views

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

**Critical Conflict Points Identified:** 14 areas where AI agents implementing different services could diverge from the existing codebase or from each other.

### Naming Patterns

**Inherited from existing codebase (do NOT deviate):**
- Python: `snake_case` for variables, functions, modules
- API request models: `camelCase` (frontend compatibility — see `genieai_api_protocol.py`)
- API response bodies: `snake_case`
- ArangoDB collections: `{graph_name}_SOURCE`, `{graph_name}_ENTITY`, `{graph_name}_HAS_SOURCE`, `{graph_name}_LINKS_TO`
- Log tags: `[operation]` format in square brackets (e.g., `[tool-registry]`, `[tool-executor]`, `[stream-ingestor]`)
- Service names in logs: `genieai_tool_registry`, `genieai_tool_executor`, `genieai_stream_ingestor`

**New for this initiative:**
- Redis Streams: `kebab-case` (e.g., `tool-config-changes`, `feed-ingestion-events`, `tool-invocation-audit`)
- Consumer groups: `{service-name}-{stream-name}` (e.g., `tool-executor-tool-config-changes`)
- Tool definition YAML files: `kebab-case` (e.g., `web-search.yaml`, `rss-reader.yaml`)
- Feed definition YAML files: `kebab-case` (e.g., `who-rss.yaml`, `news-api.yaml`)
- Environment variables for new services: `TOOL_` prefix (e.g., `TOOL_REGISTRY_PORT`, `TOOL_EXECUTOR_SEARXNG_URL`)
- DLQ streams: `{stream-name}-dlq` (e.g., `feed-ingestion-events-dlq`)

### Structure Patterns

**Service directory layout (must follow existing pattern):**
```
genie-ai-overlay/
├── tool-registry/
│   ├── genieai_tool_registry_microservice.py  # FastAPI entry point + @register_microservice
│   ├── genieai_tool_registry_arangodb.py      # ArangoDB operations
│   ├── genieai_tool_registry_schema.py        # JSON Schema validation for tool YAML
│   ├── config.py                              # Service config constants
│   ├── entrypoint.sh
│   └── Dockerfile-tool-registry-genie-ai
├── tool-executor/
│   ├── genieai_tool_executor_microservice.py  # FastAPI entry point
│   ├── genieai_tool_executor_redactor.py      # PII redaction ABC + implementations
│   ├── genieai_tool_executor_plugins/         # Tool-specific plugins (web_search.py, etc.)
│   ├── config.py
│   ├── entrypoint.sh
│   └── Dockerfile-tool-executor-genie-ai
├── stream-ingestor/
│   ├── genieai_stream_ingestor_microservice.py
│   ├── genieai_stream_ingestor_feeds.py       # RSS/Atom/JSON feed parsers
│   ├── genieai_stream_ingestor_arangodb.py    # Chunk storage + retraction extension
│   ├── config.py
│   ├── entrypoint.sh
│   └── Dockerfile-stream-ingestor-genie-ai
└── configs/
    └── tools/
        ├── schema/                            # JSON Schema files for validation
        │   ├── tool-definition.schema.json
        │   └── feed-definition.schema.json
        ├── web-search.yaml                    # Tool definitions
        └── feeds/                             # Feed definitions
```

**Test location:** `tests/` at project root (consistent with existing `tests/` directory). Test files: `test_tool_registry.py`, `test_tool_executor.py`, `test_stream_ingestor.py`, `test_pii_redactor.py`. Use pytest.

### Format Patterns

**API endpoint prefix:** `/v1/tools/` for all new endpoints (consistent with existing `/v1/dataprep/`, `/v1/retrieval`)

| Endpoint | Method | Service |
|----------|--------|---------|
| `/v1/tools/definitions` | GET | Tool Registry |
| `/v1/tools/definitions/{tool_id}` | GET/PUT/DELETE | Tool Registry |
| `/v1/tools/execute/{tool_id}` | POST | Tool Executor |
| `/v1/tools/feeds` | GET/POST | Tool Registry |
| `/v1/tools/feeds/{feed_id}` | GET/PUT/DELETE | Tool Registry |
| `/v1/tools/audit` | GET | Tool Registry (query ArangoDB) |
| `/v1/tools/health` | GET | All services |

**Error response format (extend existing pattern):**
```json
{
  "error": {
    "code": "TOOL_NOT_FOUND",
    "message": "Tool 'xyz' does not exist or is disabled",
    "details": {}
  }
}
```

**Degradation response (new for tool failures):**
```json
{
  "degradation": {
    "tool_id": "web-search",
    "reason": "CIRCUIT_OPEN",
    "fallback_applied": "rag_only",
    "message": "Web search is temporarily unavailable. Showing document results only."
  }
}
```

**Date/time format:** ISO 8601 strings (`2026-04-30T12:00:00Z`) in all API responses and ArangoDB documents. No Unix timestamps.

**Tool invocation audit event (Redis Stream payload):**
```json
{
  "tool_id": "web-search",
  "user_sub": "keycloak-sub-uuid",
  "timestamp": "2026-04-30T12:00:00Z",
  "input_params": {"query": "..."},
  "result_metadata": {"result_count": 5, "latency_ms": 342},
  "pii_redacted": true,
  "status": "success"
}
```

### Communication Patterns

**Redis Streams event naming:** `{domain}-{action}` in kebab-case
- `tool-config-changes` — tool/feed CRUD events
- `feed-ingestion-events` — feed poll/webhook events
- `tool-invocation-audit` — tool execution audit records

**Event payload structure:** Flat JSON with string/numeric/boolean primitives. No nested objects beyond one level. All events include `timestamp` (ISO 8601) and `event_type` fields.

**Service-to-service HTTP calls:** Use `httpx.AsyncClient` with circuit breaker wrapper. No `requests` library (blocking). Connection pooling with `httpx.AsyncClient` as module-level singleton.

**Circuit breaker pattern:** Wrap all external service calls (SearXNG, TEI, ArangoDB) in circuit breaker logic. Configuration per dependency: `CIRCUIT_BREAKER_{SERVICE}_FAILURE_THRESHOLD=3`, `CIRCUIT_BREAKER_{SERVICE}_RECOVERY_TIMEOUT=30`. States: CLOSED → OPEN → HALF_OPEN.

### Process Patterns

**Startup sequence (each service):**
1. Load YAML config files from `configs/tools/`
2. Validate against JSON Schema — fail fast on invalid config
3. Initialize ArangoDB connection
4. Initialize Redis connection + register consumer groups
5. Load tool/feed definitions into memory (Tool Registry) or cache (Tool Executor)
6. Start background tasks (Stream Ingestor pollers, TTL cleanup cron)
7. Register health check endpoints
8. Start FastAPI app via `@register_microservice`

**PII redaction failure mode:** BLOCK — never forward unredacted content to external tools. Log the failure, return error to caller, do not fall back to unredacted.

**Tool execution failure mode:** DEGRADE — return RAG-only response with `degradation` metadata. Never fabricate tool results (NFR12).

**Feed ingestion failure mode:** DLQ — publish failed event to `{stream}-dlq`, log error, continue processing other feeds. One feed failure must not block others (NFR15).

### Enforcement Guidelines

**All AI agents implementing these services MUST:**
- Use `@register_microservice` decorator (not raw `FastAPI()` app creation)
- Use `CustomLogger` from `comps` with `[service-tag]` prefixes
- Use `os.getenv()` with sensible defaults for configuration (no pydantic BaseSettings)
- Use `httpx.AsyncClient` for outbound HTTP (no `requests`)
- Use `snake_case` in response bodies, `camelCase` in request model fields
- Use `/v1/tools/` prefix for all new API endpoints
- Follow the multi-stage Dockerfile pattern with OPEA v1.3 overlay
- Use `pytest` for tests in `tests/` directory
- Run as non-root `user` in Dockerfile
- Include health check endpoints (`/health`, `/ready`)
- Copyright headers: `# Copyright (c) 2026 ITU` for new service files

**Anti-patterns to avoid:**
- Creating a standalone `FastAPI()` app — use OPEA `@register_microservice`
- Using `requests` library — use `httpx.AsyncClient`
- Using pydantic `BaseSettings` — use `os.getenv()` with defaults
- CamelCase in response JSON — use `snake_case`
- Storing tool definitions only in ArangoDB — YAML is source of truth
- Bypassing PII redaction for any external tool call
- Returning fabricated results on tool failure — degrade instead

## Project Structure & Boundaries

### Complete Project Directory Structure

**New and modified files only** (existing structure unchanged):

```
genie-ai-overlay/
├── tool-registry/
│   ├── genieai_tool_registry_microservice.py   # FR1-FR7: Tool CRUD API, YAML validation, enable/disable
│   ├── genieai_tool_registry_arangodb.py       # ArangoDB sync, audit log queries (FR7)
│   ├── genieai_tool_registry_schema.py         # JSON Schema validation for tool/feed YAML files
│   ├── config.py                               # TOOL_REGISTRY_PORT, ARANGO_*, REDIS_* constants
│   ├── entrypoint.sh                           # Startup script
│   └── Dockerfile-tool-registry-genie-ai       # Multi-stage OPEA overlay build
│
├── tool-executor/
│   ├── genieai_tool_executor_microservice.py   # FR8-FR15: Tool invocation, PII guardrail, rate limiting
│   ├── genieai_tool_executor_redactor.py       # PIIRedactor ABC + regex implementation (FR10)
│   ├── genieai_tool_executor_plugins/          # Pluggable tool backends
│   │   ├── __init__.py
│   │   ├── base.py                            # ToolPlugin ABC: execute(), validate_params()
│   │   └── web_search.py                      # SearXNG backend (FR16-FR18)
│   ├── config.py                               # TOOL_EXECUTOR_PORT, SEARXNG_URL, PII_REDACTOR_IMPL
│   ├── entrypoint.sh
│   └── Dockerfile-tool-executor-genie-ai
│
├── stream-ingestor/
│   ├── genieai_stream_ingestor_microservice.py # FR25-FR30: RSS/Atom polling, JSON API, webhook intake
│   ├── genieai_stream_ingestor_feeds.py        # Feed parsers (RSS, Atom, JSON API)
│   ├── genieai_stream_ingestor_arangodb.py     # Chunk storage in shared chunks collection, retraction extension
│   ├── genieai_stream_ingestor_embedder.py     # TEI embedding pipeline integration
│   ├── config.py                               # STREAM_INGESTOR_PORT, POLL_INTERVAL, TEI_ENDPOINT
│   ├── entrypoint.sh
│   └── Dockerfile-stream-ingestor-genie-ai
│
├── core/
│   ├── genieai_api_protocol.py                 # MODIFY: add citation, degradation fields
│   ├── genieai_circuit_breaker.py              # NEW: CircuitBreaker class for external service calls
│   ├── genieai_redis_streams.py                # NEW: Redis Streams producer/consumer helpers
│   └── constants.py                            # MODIFY: add ToolSource, DegradationReason enums
│
└── configs/
    └── tools/
        ├── schema/
        │   ├── tool-definition.schema.json     # JSON Schema for tool YAML validation
        │   └── feed-definition.schema.json     # JSON Schema for feed YAML validation
        ├── web-search.yaml                     # FR16: SearXNG tool definition
        └── feeds/                              # Feed definitions directory

components/gov-chat-backend/src/controllers/
└── toolsController.js                          # NEW: Admin API proxy for tool/feed CRUD, audit queries

components/gov-chat-frontend/src/views/admin/
└── DocumentManagement.vue                      # MODIFY: add tools/feeds management section

mobile/genie_ai_mobile/lib/features/chat/widgets/
└── citation_widget.dart                        # NEW: Citation rendering for tool results

tests/
├── test_tool_registry.py                       # Unit + integration tests for Tool Registry
├── test_tool_executor.py                       # Unit + integration tests for Tool Executor
├── test_tool_executor_redactor.py              # PII redaction tests (regex, edge cases, PII injection suite)
├── test_stream_ingestor.py                     # Unit + integration tests for Stream Ingestor
├── test_circuit_breaker.py                     # Circuit breaker state transition tests
├── test_redis_streams.py                       # Redis Streams producer/consumer tests
└── fixtures/
    ├── tools/                                  # Sample tool YAML files for tests
    └── feeds/                                  # Sample feed responses for tests

deploy/ansible/roles/
└── tools/                                      # NEW: Ansible role for tools deployment
    ├── tasks/main.yml                          # Build + deploy all tool services
    ├── templates/tools.env.j2                  # Environment variable template
    └── defaults/main.yml                       # Default configuration values

docker-compose.yaml                             # MODIFY: add tool-registry, tool-executor, stream-ingestor, searxng
```

### Architectural Boundaries

**API Boundaries:**

| Boundary | Inbound | Outbound | Auth |
|----------|---------|----------|------|
| Tool Registry (`/v1/tools/definitions`) | Backend admin proxy | ArangoDB, Redis | Keycloak `tools-admin` / `tools-reader` |
| Tool Registry (`/v1/tools/feeds`) | Backend admin proxy | ArangoDB, Redis | Keycloak `tools-admin` / `tools-reader` |
| Tool Registry (`/v1/tools/audit`) | Backend admin proxy | ArangoDB | Keycloak `tools-reader` |
| Tool Executor (`/v1/tools/execute`) | ChatQnA service | SearXNG, Redis | Internal service-to-service |
| Stream Ingestor (internal) | Cron scheduler | TEI, ArangoDB, Redis | Internal (no user-facing API) |

**Component Boundaries:**
- Tool Executor **never calls** ArangoDB directly — reads tool definitions from in-memory cache (populated from Tool Registry via Redis Stream `tool-config-changes`)
- Stream Ingestor **never calls** Tool Executor — stores chunks directly into shared `chunks` collection via its own ArangoDB client
- ChatQnA calls Tool Executor via HTTP; Tool Executor returns structured results; ChatQnA handles result fusion and prompt assembly

**Data Boundaries:**
- Tool definitions: YAML files (source of truth) → ArangoDB `tool_definitions` collection (runtime)
- Feed definitions: YAML files (source of truth) → ArangoDB `feed_definitions` collection (runtime)
- Audit logs: ArangoDB `tool_invocation_audit` collection (write-only, queryable via admin API)
- Ingested content: shared `chunks` collection with `source_type="feed"` discriminator
- Circuit breaker state: In-memory per service instance (no persistence — resets on restart)

### Requirements to Structure Mapping

| FR Category | Primary Location | Supporting Files |
|-------------|-----------------|------------------|
| FR1-FR7: Tool Registry & Management | `genie-ai-overlay/tool-registry/` | `configs/tools/schema/`, `core/constants.py` |
| FR8-FR15: Tool Execution | `genie-ai-overlay/tool-executor/` | `core/genieai_circuit_breaker.py`, `core/genieai_redis_streams.py` |
| FR16-FR18: Web Search | `tool-executor/plugins/web_search.py` | `configs/tools/web-search.yaml` |
| FR19-FR24: Result Fusion & Response | `chatqna/genieai_chatqna.py` (modify) | `core/genieai_api_protocol.py` |
| FR25-FR30: Stream Ingestion | `genie-ai-overlay/stream-ingestor/` | `core/genieai_redis_streams.py` |
| FR31-FR36: Admin Configuration | `backend/src/controllers/toolsController.js` | `frontend/DocumentManagement.vue` |
| FR37-FR40: User Interaction | `frontend/` (chat views), `mobile/` | `core/genieai_api_protocol.py` (citation schema) |
| FR41-FR45: Resilience & Operations | `core/genieai_circuit_breaker.py`, all services | `core/genieai_redis_streams.py` (DLQ) |
| FR46-FR48: Integration Contracts | `core/genieai_api_protocol.py`, `core/constants.py` | `tool-executor/plugins/base.py` |

### Integration Points

**Synchronous Request Flow:**
```
User Query → Backend (BFF) → ChatQnA
  → [tool trigger logic] → Tool Executor (/v1/tools/execute)
    → PII Redactor (in-process) → SearXNG (HTTP)
  → Result + citation → Result fusion (score, deduplicate, budget)
  → LLM with augmented prompt → Response with citations + degradation metadata
  → Frontend renders citations (Vue 3 / Flutter)
```

**Async Event Flow:**
```
Admin CRUD tool/feed → Tool Registry (YAML + ArangoDB)
  → Redis Stream: tool-config-changes
    → Tool Executor (cache invalidation)
    → Stream Ingestor (feed config reload)

Tool Executor invocation → Redis Stream: tool-invocation-audit
  → Audit persistor → ArangoDB audit collection

Stream Ingestor poll/webhook → TEI embedding → shared chunks collection
  → Redis Stream: feed-ingestion-events
    → (future: monitoring, analytics consumers)
```

**External Integrations:**
- SearXNG: HTTP API for web search (AGPL-3.0 — consumed unmodified as API backend, no derivative work per NFR26)
- TEI Embedding: HTTP API for vector embeddings (Stream Ingestor → TEI)
- ArangoDB: Document + vector storage (Tool Registry, Stream Ingestor)
- Redis: Streams for async events, rate limiting (all services)
- Keycloak: RBAC for admin API (Backend → Keycloak token validation)

### Licensing Note

**SearXNG is AGPL-3.0.** NFR26 permits AGPL for "unmodified API-consumed services." SearXNG is consumed purely via its HTTP API as an unmodified upstream Docker image. No code modification, no derivative work — the Tool Executor treats it as an external HTTP service. This falls within the NFR26 exception.

## Architecture Validation Results

### Coherence Validation

**Decision Compatibility:** All 13 decisions are mutually compatible. No contradictory choices. The hybrid YAML+ArangoDB persistence feeds cleanly into Redis Streams for cache invalidation, which feeds into the Tool Executor's in-memory cache. The shared chunks collection with `source_type` discriminator integrates with the existing retraction pipeline via the agreed extension pattern.

**Pattern Consistency:** Implementation patterns are grounded in actual codebase analysis (file paths, line numbers). All patterns inherit from existing OPEA conventions (`@register_microservice`, `CustomLogger`, `os.getenv()`). No conflicts between patterns and decisions.

**Structure Alignment:** Project structure maps every FR category to specific files. Component boundaries are respected (Tool Executor never touches ArangoDB, Stream Ingestor never calls Tool Executor). Integration points are explicit.

### Requirements Coverage Validation

**Functional Requirements (48 FRs):**

| FR Category | Count | Status | Notes |
|-------------|-------|--------|-------|
| FR1-FR7: Tool Registry & Management | 7 | Covered | Tool Registry service + admin API |
| FR8-FR15: Tool Execution | 8 | Covered | Tool Executor + PII redactor + circuit breaker |
| FR16-FR18: Web Search | 3 | Covered | SearXNG plugin + domain whitelisting |
| FR19-FR24: Result Fusion & Response | 6 | Covered | ChatQnA integration + citation schema; #604 refactoring dependency acknowledged |
| FR25-FR30: Stream Ingestion | 6 | Covered | Stream Ingestor + shared chunks + TEI |
| FR31-FR36: Admin Configuration | 6 | Covered | Backend controller + Vue 3 DocumentManagement |
| FR37-FR40: User Interaction | 4 | Covered | Citation widget (Vue 3 + Flutter) + degradation schema |
| FR41-FR45: Resilience & Operations | 5 | Covered | Circuit breaker + DLQ + health checks |
| FR46-FR48: Integration Contracts | 3 | Covered | ToolPlugin ABC + ChatQnA interface + Ansible tags |

**Non-Functional Requirements (27 NFRs):**

| NFR Category | Count | Status |
|-------------|-------|--------|
| NFR1-NFR5: Performance | 5 | Covered |
| NFR6-NFR11: Security | 6 | Covered |
| NFR12-NFR16: Reliability | 5 | Covered |
| NFR17-NFR19: Scalability | 3 | Covered |
| NFR20-NFR21: Accessibility | 2 | Covered |
| NFR22-NFR25: Integration | 4 | Covered |
| NFR26-NFR27: Compliance | 2 | Covered |

### Gap Analysis

**Critical Gaps:** None.

**Important Gaps (acknowledged dependencies, not blockers):**
1. ChatQnA integration wiring depends on #604 modular refactoring — the ToolExecutor contract is defined; exact ChatQnA integration deferred to implementation
2. Sprint 24 LangGraph ToolNode compatibility — HTTP-based ToolExecutor interface is the forward-compatible contract; exact LangGraph wiring deferred

**Nice-to-Have Gaps (deferred to implementation):**
1. Observability consumer for Sprint 23 platform
2. Advanced feed deduplication strategy (content-hash vs. semantic similarity)
3. Additional tool plugins beyond web search

### Architecture Completeness Checklist

- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped
- [x] 13 critical decisions documented with rationale and NFR traceability
- [x] Technology stack inherited from existing codebase
- [x] Integration patterns defined (sync HTTP + async Redis Streams)
- [x] Performance budgets mapped to architectural mechanisms
- [x] 14 naming conventions established (inherited + new)
- [x] Service structure patterns defined from codebase analysis
- [x] Communication patterns specified (Redis Streams, HTTP, circuit breaker)
- [x] Process patterns documented (startup sequence, failure modes)
- [x] Enforcement guidelines with anti-patterns
- [x] Complete directory structure for all new files
- [x] Component boundaries established and verified
- [x] Integration points mapped with data flow diagrams
- [x] FR-to-structure mapping complete
- [x] All 48 FRs architecturally supported
- [x] All 27 NFRs architecturally addressed

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High — all critical decisions are made, all FRs and NFRs are architecturally supported, and the brownfield integration approach minimizes risk by extending proven patterns rather than introducing new ones.

**Key Strengths:**
- Leverages existing well-tested graph system with minimal extension
- PII redaction is pluggable — no technology lock-in, satisfies sovereign deployment requirements
- SearXNG AGPL licensing properly documented within NFR26 exception
- Clear enforcement guidelines prevent AI agent implementation conflicts

**First Implementation Priority:** Data architecture foundation — Redis Streams configuration and ArangoDB `chunks` collection extension (`source_type`, `expires_at` fields). These must exist before any service can be built.
