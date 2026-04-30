---
prd_key: server-side-tools
assessmentDate: 2026-04-30
documentsAssessed:
  prd: "_bmad-output/planning-artifacts/prd.md"
  architecture: null
  epics: null
  uxDesign: null
projectArchitecture: "docs/architecture.md"
---

# Implementation Readiness Report — Server-Side Tools for GENIE.AI

## Document Inventory

| Document | Status | Location |
|----------|--------|----------|
| PRD | Complete | `_bmad-output/planning-artifacts/prd.md` (678 lines) |
| Architecture | Not created | Next workflow |
| Epics | Not created | Follows architecture |
| UX Design | Not created | Follows architecture or PRD |
| Project Architecture | Exists | `docs/architecture.md` |

## PRD Analysis

### Functional Requirements

**Tool Registry & Management (FR1–FR7)**
- FR1: System administrators can define tools using JSON Schema with YAML as an authoring surface
- FR2: System administrators can import tool definitions from OpenAPI specifications
- FR3: System administrators can enable and disable individual tools without code changes or redeployment
- FR4: System administrators can configure per-tool security settings including PII redaction requirements and domain whitelists
- FR5: System administrators can register custom tools by providing a tool definition file — no core code modification required
- FR6: The tool registry validates all tool definitions against their JSON Schema at startup and rejects invalid definitions
- FR7: The tool registry serves as the single source of truth for all tool definitions, consumed by both the executor and the ingestor

**Tool Execution (FR8–FR15)**
- FR8: The system invokes tools automatically when retrieval confidence falls below a configurable threshold (rule-based trigger)
- FR9: The system invokes tools automatically when time-sensitive query patterns are detected (rule-based trigger)
- FR10: The system can invoke tools when the LLM determines the knowledge base is insufficient (LLM-driven selection, fallback to rule-based)
- FR11: Tools that are disabled or unauthorized cannot be invoked by either rule-based or LLM-driven paths
- FR12: The system redacts personally identifiable information from all tool parameters before external execution (mandatory guardrail)
- FR13: The PII redaction component is pluggable — alternative implementations can be substituted without architectural changes
- FR14: The system captures structured output from tool executions including results, source citations, confidence scores, and execution metadata
- FR15: The system enforces per-tool rate limits to protect external service backends from overload

**Web Search (FR16–FR18)**
- FR16: The system executes web searches through a configurable search backend (default: SearXNG)
- FR17: System administrators can restrict web search to approved domains via domain whitelisting
- FR18: The system can route search queries to alternative search backends through a pluggable interface

**Result Fusion & Response (FR19–FR24)**
- FR19: The system merges tool execution results with RAG retrieval results, scoring and deduplicating across both sources
- FR20: The system allocates context window budget between retrieved documents and tool results according to configurable ratios
- FR21: The system includes source citations with tool-augmented responses, showing URLs and distinguishing knowledge base sources from external sources
- FR22: System administrators can configure citation behavior (enabled/disabled) per deployment
- FR23: The system returns a transparent "insufficient information" response when neither the knowledge base nor tool execution provides sufficient context, rather than fabricating an answer
- FR24: The system discards tool results that fall below a minimum quality threshold before including them in the LLM context

**Stream Ingestion (FR25–FR30)**
- FR25: The system ingests content from RSS/Atom feeds on configurable polling schedules
- FR26: The system ingests content from JSON API endpoints on configurable polling schedules with field mapping
- FR27: The system receives push-based content via webhook endpoints with authentication (API key or JWT)
- FR28: The system routes ingested content through the existing TEI embedding service and stores it in ArangoDB
- FR29: System administrators can configure data lifecycle policies including retention periods (TTL) and update-vs-append behavior per feed
- FR30: Feed definitions are managed through the tool registry, subject to the same enable/disable and audit controls as other tools

**Admin Configuration & Monitoring (FR31–FR36)**
- FR31: System administrators can view and manage all tools through the Vue 3 admin UI (tool list, enable/disable, configuration editing)
- FR32: System administrators can manage domain whitelists through the Vue 3 admin UI
- FR33: System administrators can view tool and feed health status through the Vue 3 admin UI
- FR34: System administrators can review audit logs for all tool invocations through the Vue 3 admin UI
- FR35: System administrators can manage ingestion feeds (add, edit, schedule, configure retention) through the Vue 3 admin UI, integrated into the existing Document Management tab alongside current ingestion features
- FR36: The system validates tool configuration changes before applying them and reports validation errors to the administrator

**User Interaction (FR37–FR40)**
- FR37: Citizens using the Vue 3 web interface can see source citations on tool-augmented responses, with provenance labels distinguishing knowledge base documents from external web sources
- FR38: Citizens using the Flutter mobile interface can see source citations on tool-augmented responses, with provenance labels matching the Vue 3 behavior
- FR39: Citizens see transparent graceful degradation messages when the system cannot provide a sufficient answer, with guidance on alternative information sources
- FR40: The system renders citation and graceful degradation elements in a manner compliant with government accessibility mandates (WCAG 2.1 AA)

**Resilience & Operations (FR41–FR45)**
- FR41: The system applies circuit breaker patterns to all external service calls, halting invocations to unhealthy backends
- FR42: The system routes failed ingestion entries to dead letter queues for later reprocessing
- FR43: The system automatically retries failed operations with exponential backoff when the backend recovers
- FR44: The system logs all tool invocations with user identity, timestamp, tool name, parameters, and result metadata for audit and compliance purposes
- FR45: The system provides health check endpoints for all tools and feeds, consumable by monitoring infrastructure

**Integration Contracts (FR46–FR48)**
- FR46: The tool executor exposes a standardized `ToolExecutor` interface consumable by both the current ChatQnA pipeline and future LangGraph orchestrators
- FR47: The system integrates into the existing RAG pipeline at the retrieval stage, after ArangoDB retrieval and before LLM prompt construction
- FR48: The system deploys as containerized services compatible with Docker Swarm and Kubernetes, integrated with the existing Ansible deployment playbooks

**Total FRs: 48**

### Non-Functional Requirements

**Performance (NFR1–NFR5)**
- NFR1: Web search tool invocation adds no more than 2 seconds of additional latency to the RAG pipeline (P95)
- NFR2: Stream ingestion delivers content from feed publication to RAG availability within 4 hours end-to-end
- NFR3: Tool registry lookup completes within 50ms
- NFR4: Admin API responses return within 500ms for standard CRUD operations
- NFR5: PII redaction service processes tool parameters within 100ms per invocation

**Security (NFR6–NFR11)**
- NFR6: Zero PII leakage events across all deployments
- NFR7: Every tool invocation is audit-logged with user identity, timestamp, tool name, input parameters, and result metadata
- NFR8: Audit logs are structured, queryable, and exportable for FOI requests
- NFR9: Webhook endpoints authenticate every request via API key or JWT
- NFR10: Admin API enforces role-based access control (`tools-admin` role)
- NFR11: Domain whitelisting enforced at tool executor level (not bypassable via backend config)

**Reliability (NFR12–NFR16)**
- NFR12: Zero hallucinated answers from failed tool invocations
- NFR13: Circuit breakers open after 3 consecutive failures, auto-close on health check pass
- NFR14: Failed ingestion entries routed to dead letter queues, auto-reprocessed on recovery
- NFR15: Graceful degradation — component failures isolated (SearXNG down doesn't affect registry)
- NFR16: >90% of cited URLs valid at query time

**Scalability (NFR17–NFR19)**
- NFR17: Tools layer operates on existing infrastructure (no new services beyond CPU containers)
- NFR18: Redis-backed rate limiting and circuit breaker state support horizontal scaling
- NFR19: SearXNG and PII redaction service support horizontal scaling

**Accessibility (NFR20–NFR21)**
- NFR20: Citations, provenance labels, degradation messages comply with WCAG 2.1 AA
- NFR21: Citation rendering consistent across Vue 3 and Flutter

**Integration (NFR22–NFR25)**
- NFR22: `ToolExecutor` interface consumable by ChatQnA and LangGraph without adapter layers
- NFR23: Tool registry loads definitions from YAML/JSON at startup without external network dependency
- NFR24: Deploys via existing Ansible playbook with `--tags tools`
- NFR25: Stream ingestion uses existing TEI and ArangoDB without schema modifications

**Compliance (NFR26–NFR27)**
- NFR26: All incorporated open-source tools follow DPG permissive licensing guidelines
- NFR27: Audit logs meet national archival standards where applicable; retention configurable per deployment

**Total NFRs: 27**

### Additional Requirements

**From Domain-Specific Requirements:**
- Audit logs must support FOI requests (structured, queryable, exportable)
- Government AI interactions may constitute public records under national archival legislation
- Content neutrality — web search must not introduce political/editorial bias
- Interoperability — JSON Schema/OpenAPI alignment with government frameworks

**From Agent Infrastructure Requirements:**
- Three-service decomposition: Tool Registry, Tool Executor, Stream Ingestor
- Admin API: 10 endpoints documented (Keycloak-authenticated)
- Internal interfaces: 5 documented (ToolExecutor, ToolRegistry, PIIRedactor, ResultFusion)
- Authentication model: Keycloak for admin, API key/JWT for webhooks, no-auth for inter-service
- Three data schemas defined: Tool Definition, Tool Result, Feed Definition (JSON Schema)
- Error handling: 8 error categories with defined behaviors
- Rate limiting: Per-tool, Redis-backed sliding window, 100 req/hr default

**From Innovation/Risk:**
- PII redaction is pluggable (not Presidio-pinned)
- ToolExecutor contract must survive ChatQnA refactoring
- Zero-infrastructure constraint: CPU-only containers for new services

### PRD Completeness Assessment

**Strengths:**
- Comprehensive FR coverage across 9 capability areas — 48 FRs provide strong traceability foundation
- NFRs are specific and measurable (P95 latencies, percentage thresholds, exact counts)
- Clear traceability chain: Executive Summary → Success Criteria → User Journeys → FRs → NFRs
- Implementation sequence (4 waves) provides clear build order with dependency rationale
- Data schemas (Tool Definition, Tool Result, Feed Definition) give architects concrete contracts
- Error handling model (8 categories) covers the full failure surface
- Domain-specific requirements (FOI, public records, accessibility, content neutrality) are addressed
- Risk mitigation strategy covers technical, market, and resource risks with specific mitigations

**Gaps Identified:**
- None critical — the PRD is comprehensive for an initiative at this stage
- Architecture, epics, and UX design are downstream artifacts not yet created (expected)

## Epic Coverage Validation

### Coverage Matrix

| FR Range | PRD Area | Epic Coverage | Status |
|----------|----------|---------------|--------|
| FR1–FR7 | Tool Registry & Management | Not created | Uncovered |
| FR8–FR15 | Tool Execution | Not created | Uncovered |
| FR16–FR18 | Web Search | Not created | Uncovered |
| FR19–FR24 | Result Fusion & Response | Not created | Uncovered |
| FR25–FR30 | Stream Ingestion | Not created | Uncovered |
| FR31–FR36 | Admin Configuration & Monitoring | Not created | Uncovered |
| FR37–FR40 | User Interaction | Not created | Uncovered |
| FR41–FR45 | Resilience & Operations | Not created | Uncovered |
| FR46–FR48 | Integration Contracts | Not created | Uncovered |

### Coverage Statistics

- Total PRD FRs: 48
- FRs covered in epics: 0
- Coverage percentage: 0%
- **Assessment: EXPECTED** — Epics are a downstream artifact. No epics document has been created yet. This is the normal state after PRD completion and before architecture/epic workflows.

### Suggested Epic Grouping (for future reference)

The PRD's 4-wave implementation sequence provides a natural epic boundary:

| Proposed Epic | FRs | Wave |
|---------------|-----|------|
| Tool Registry & Executor Foundation | FR1–FR7, FR11, FR13–FR15, FR36, FR44, FR45, FR46, FR48 | Wave 1 |
| Web Search & Result Fusion | FR8–FR10, FR12, FR16–FR24, FR47 | Wave 2 |
| Stream Ingestion | FR25–FR30, FR41–FR43 | Wave 3 |
| UI Surfaces (Vue 3 Admin + User Interaction) | FR31–FR40 | Wave 4 |

## UX Alignment Assessment

### UX Document Status

**Not Found.** No dedicated UX design specification exists for server-side-tools.

### UX Implications in PRD

The PRD explicitly defines UI requirements across 10 functional requirements (FR31–FR40), spanning two platforms and two user tiers:

| UI Surface | Platform | FRs | Tier |
|------------|----------|-----|------|
| Admin tool management dashboard | Vue 3 | FR31 | Admin |
| Domain whitelist editor | Vue 3 | FR32 | Admin |
| Tool/feed health status | Vue 3 | FR33 | Admin |
| Audit log viewer | Vue 3 | FR34 | Admin |
| Feed management (Document Management tab) | Vue 3 | FR35 | Admin |
| Citation rendering (source URL, provenance) | Vue 3 + Flutter | FR37, FR38 | User |
| Graceful degradation messages | Vue 3 + Flutter | FR39 | User |
| WCAG 2.1 AA compliance | Vue 3 + Flutter | FR40 | User |

### Alignment Issues

**WARNING: UX design specification is implied but not documented.** The PRD defines what the UI must do (FR31–FR40) but not how it should look, feel, or behave from a user experience perspective. Specifically:

1. **Admin UI interaction patterns undefined** — FR31–FR35 describe capabilities (list, enable/disable, configure, view) but don't define the admin workflow, navigation structure, or form layouts. The FR35 requirement to integrate into the existing Document Management tab provides an anchor point but no wireframe or interaction specification.

2. **Citation rendering UX undefined** — FR37/FR38 require citations with provenance labels on both Vue 3 and Flutter, but the visual treatment (inline, collapsible, card-based), interaction behavior (click to expand, hover for preview), and information hierarchy are not specified.

3. **Graceful degradation UX undefined** — FR39 requires transparent messages, but the tone, format, and recovery options presented to citizens are not specified.

4. **WCAG 2.1 AA compliance path undefined** — FR40 mandates compliance, but no accessibility audit plan, keyboard navigation spec, or screen reader behavior is defined.

### Recommendations

- A UX design specification is recommended before epic breakdown, particularly for the Vue 3 admin views (FR31–FR35) where integration into the existing Document Management tab requires understanding the current UI patterns
- The user interaction surfaces (citations, degradation messages) have lower UX design urgency since they follow existing chat response rendering patterns — these can be specified during epic/story creation
- Flutter citation parity (FR38) should reference the Vue 3 implementation as the design source of truth

## Epic Quality Review

### Status

**No epics exist to review.** This assessment evaluates the PRD's implementation sequence (4 waves) against epic quality best practices to identify potential issues before epic creation.

### Wave Structure Assessment (Proto-Epic Quality)

The PRD defines 4 implementation waves. Evaluating each against BMAD epic quality standards:

#### Wave 1 — Tool Registry & Executor Foundation

| Criterion | Assessment | Notes |
|-----------|------------|-------|
| User value focus | **ORANGE FLAG** | This wave is primarily infrastructure (registry, executor contract, PII redaction interface, admin API). No direct user-facing value until Wave 2 integrates it into the RAG pipeline. Consider whether Wave 1 and Wave 2 should be combined into a single epic, or whether Wave 1 stories can each deliver incremental value. |
| Independence | Pass | Foundation wave, no dependencies on later waves. |
| Story sizing risk | Low risk | Well-scoped: schema, registry service, executor contract, PII interface, admin API, config validation, tests. |
| Forward dependencies | None | Clean foundation. |

#### Wave 2 — Web Search (Highest User Value)

| Criterion | Assessment | Notes |
|-----------|------------|-------|
| User value focus | Pass | Direct citizen value: current, sourced answers. This is the wave that justifies the entire initiative. |
| Independence | Pass | Depends on Wave 1 (registry, executor) but not on Wave 3 or 4. |
| Story sizing risk | Medium risk | 8 items including ChatQnA integration — the ChatQnA monolith integration (FR47) is complex and may need decomposition. |
| Forward dependencies | None | Self-contained capability. |

#### Wave 3 — Stream Ingestion

| Criterion | Assessment | Notes |
|-----------|------------|-------|
| User value focus | Pass | Keeps knowledge bases current — indirect user value (better answers) but no direct user interaction. |
| Independence | Pass | Depends on Wave 1 (registry) but not on Wave 2. |
| Story sizing risk | Medium risk | 7 items spanning 3 ingestion patterns (RSS, JSON API, webhook) plus lifecycle management and resilience. |
| Forward dependencies | None | Self-contained capability. |

#### Wave 4 — UI Surfaces

| Criterion | Assessment | Notes |
|-----------|------------|-------|
| User value focus | **ORANGE FLAG** | Admin UI delivers value to administrators (FR31–FR35). User interaction surfaces (FR37–FR40) deliver value to citizens. However, user interaction surfaces depend on Waves 1–3 being functional. Consider whether admin UI can be delivered incrementally alongside earlier waves rather than as a separate wave. |
| Independence | **ORANGE FLAG** | Depends on Waves 1–3 for all functionality. If earlier waves slip, this wave is entirely blocked. |
| Story sizing risk | Low risk | UI work is generally well-scoped. |
| Forward dependencies | None (last wave) | Terminal wave, no forward dependencies. |

### Recommendations for Epic Creation

1. **Consider merging Wave 1 and Wave 2** into a single epic. The tool registry without web search has no user-facing value — combining them ensures the first epic delivers a complete, valuable capability (citizens get current, sourced answers). The risk is a larger epic, but the reward is immediate value delivery.

2. **Consider parallelizing Wave 4 (admin UI) with earlier waves**. The Vue 3 admin views for tool management (FR31–FR32) could be developed alongside Wave 1, using mock API responses. This avoids the Wave 4 bottleneck and delivers admin value earlier.

3. **Wave 3 (Stream Ingestion) is the best candidate for post-MVP deferral** if resources are constrained. The registry + web search combination delivers the core value proposition; stream ingestion is valuable but not essential for the first release.

4. **The ChatQnA monolith integration (FR47) needs careful epic decomposition**. This is the highest-risk story across all waves — integrating into a 1,599-line Python monolith that will be refactored during the same sprint. Consider a dedicated story for defining the integration contract and a separate story for the actual implementation, with the contract validated by integration tests before implementation begins.

## Summary and Recommendations

### Overall Readiness Status

**READY FOR ARCHITECTURE** — with noted gaps to address during downstream workflows.

The PRD is comprehensive and well-structured. It provides a solid foundation for architecture, epic, and implementation work. No critical blockers exist.

### Issues Summary

| Severity | Category | Issue | Action |
|----------|----------|-------|--------|
| Expected | Epic Coverage | 0/48 FRs covered — no epics exist | Create epics (next workflow) |
| Warning | UX Alignment | UX design spec not documented; 10 UI FRs defined in PRD | Create UX spec or incorporate into epic stories |
| Advisory | Epic Quality | Wave 1 (registry) has no direct user value | Consider merging Wave 1+2 or parallelizing admin UI |
| Advisory | Epic Quality | Wave 4 depends on all prior waves | Consider parallelizing admin UI with earlier waves |
| Advisory | Epic Quality | ChatQnA monolith integration (FR47) is high risk | Dedicated contract-first story before implementation |

### Critical Issues Requiring Immediate Action

None. The PRD is complete and implementation-ready at the architecture level.

### Recommended Next Steps

1. **Create architecture document** — The PRD provides detailed technical requirements (service decomposition, API specs, data schemas, auth model, error handling). Architecture should address: service deployment topology, Redis Streams configuration for ingestion, PII redaction service selection, ChatQnA integration contract, and the tool executor's position relative to the planned ChatQnA modular refactoring (#604).

2. **Create UX design specification** (recommended before epics) — At minimum, define the Vue 3 admin interaction patterns for the tool management views being integrated into the existing Document Management tab. User interaction surfaces (citations, degradation messages) can be specified during epic creation since they follow existing chat response patterns.

3. **Create epics with wave structure awareness** — Use the PRD's 4-wave implementation sequence as the epic boundary guide, but consider the recommendations: merge Wave 1+2 for immediate user value delivery, parallelize admin UI with earlier waves, and dedicate a story to the ChatQnA integration contract before the implementation story.

4. **Validate against Sprint 22/23 prerequisites** — Before starting implementation, confirm the Sprint 22 test framework is merged and the Sprint 23 observability platform is available. These are hard prerequisites documented in the PRD.

### Final Note

This assessment found 5 issues across 3 categories (1 expected, 1 warning, 3 advisory). No critical blockers exist. The PRD is thorough — 48 FRs with full traceability, 27 measurable NFRs, 5 user journeys, detailed technical specifications, and a risk mitigation strategy. The recommended next step is the architecture workflow.
