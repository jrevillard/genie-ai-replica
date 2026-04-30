---
prd_key: server-side-tools
stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-02b-vision', 'step-02c-executive-summary', 'step-03-success', 'step-04-journeys', 'step-05-domain', 'step-06-innovation', 'step-07-project-type', 'step-08-scoping', 'step-09-functional', 'step-10-nonfunctional', 'step-11-polish']
inputDocuments:
  - "_bmad-output/planning-artifacts/product-brief-server-side-tools.md"
  - "_bmad-output/planning-artifacts/product-brief-server-side-tools-distillate.md"
  - "docs/architecture.md"
  - "docs/roadmap-sprint-20-to-25.md"
  - "_bmad-output/project-context.md"
documentCounts:
  briefs: 2
  research: 0
  brainstorming: 0
  projectDocs: 2
workflowType: 'prd'
classification:
  projectType: 'api_backend'
  projectSubtype: 'agent_infrastructure'
  domain: 'govtech'
  complexity: 'high'
  projectContext: 'brownfield'
---

# Product Requirements Document - Server-Side Tools for GENIE.AI

**Author:** God
**Date:** 2026-04-29

## Executive Summary

GENIE.AI is an open-source, sovereign RAG framework for government services, built on OPEA and designed for DPG (Digital Public Goods) compliance under the Digital Public Goods Alliance guidelines. Today it answers citizen queries exclusively from manually ingested documents — a knowledge base that is perpetually stale, bounded by what has been uploaded, and unable to reach live data sources. Every major AI assistant (ChatGPT, Gemini, Grok, Perplexity) has evolved past pure retrieval to include real-time tool use. Sovereignty means nothing if the AI gives wrong answers about current policy.

This PRD defines the **Server-Side Tools Layer** — an agent infrastructure capability implemented in the Python/OPEA tier that extends the RAG pipeline beyond static document retrieval. The initiative delivers three integrated capabilities:

1. **In-Flight Web Search** — triggers real-time search when the knowledge base lacks sufficient context, using a hybrid execution model (rule-based triggers with LLM-driven selection as fallback). Results are fused with retrieved documents before reaching the LLM, with configurable source citations and graceful degradation on failure.

2. **Configurable Tool Registry** — a JSON Schema/OpenAPI-based registry where framework-shipped tools (web search, future: calculator, code execution, GIS) and deployment-specific custom tools are defined, enabled, rate-limited, and audit-logged. Every deployment controls its own tool ecosystem without modifying core code.

3. **Stream Ingestion System** — continuous data ingestion from RSS/Atom feeds, JSON API polling, and webhook endpoints, using existing Redis Streams and TEI embedding infrastructure. Keeps knowledge bases current with configurable retention policies and data lifecycle management.

All external tool invocations pass through a mandatory PII redaction guardrail (pluggable interface with reference implementation) before leaving the sovereign boundary. Every tool invocation is audit-logged with user identity, timestamp, parameters, and results. Domain whitelisting, per-tool enable/disable controls, and role-based governance ensure deployments maintain full sovereignty compliance.

**Open Source Licensing:** All open-source projects and tools incorporated into GENIE.AI must follow DPG (Digital Public Goods) guidelines for permissive open-source licensing (MIT, Apache 2.0, BSD). Affero licenses (GPL, AGPL) are tolerated only for components that will never be modified — specifically, self-hosted services consumed via their API (e.g., SearXNG as a search backend). Any component that requires forking or modification to integrate must use a permissive license.

This initiative is the foundational capability layer for Sprint 24's LangGraph agentic workflows and Sprint 25's GovStack Building Block integrations. The tool registry becomes the standard interface for how AI agents interact with GovStack services: every BB API registers as a tool, every LangGraph workflow node invokes tools through the registry, and the entire ecosystem is governed by the same configurable compliance model. The existing OPEA API protocol already includes unused `tools` and `tool_choice` fields, providing a partial integration surface. Implementation targets Sprint 24, following the Sprint 22 test framework and Sprint 23 observability platform prerequisites.

### What Makes This Special

GENIE.AI is the only open-source RAG framework that gives government deployments ChatGPT/Perplexity-level capabilities without surrendering data sovereignty. The combination of mandatory PII redaction (compliant by default, no configuration needed), zero new infrastructure dependencies (Redis Streams, TEI, and ArangoDB already in the stack), and a tool registry that transforms GovStack BB APIs into agent actions is something no commercial assistant can offer — because commercial assistants cannot run inside your national boundary.

The core insight is that this is not a feature bolted onto RAG — it is the **capability surface** that makes agentic workflows useful. Without tools, LangGraph agents can only orchestrate internal RAG queries. With tools, every external API becomes an agent action, every data feed becomes a knowledge source, and every GovStack Building Block becomes consumable by AI. The tool registry is the bridge between Sprint 24 and Sprint 25.

## Project Classification

| Dimension | Value | Rationale |
|-----------|-------|-----------|
| Project Type | `api_backend` (agent infrastructure) | Python/OPEA tier microservices exposing standardized tool execution interfaces consumed by ChatQnA and future LangGraph orchestrators |
| Domain | `govtech` (government/public sector) | Sovereign RAG for citizen-facing services; PII redaction, audit logging, domain whitelisting are non-negotiable compliance requirements |
| Complexity | `high` (borderline critical) | Three independent capability surfaces (search, registry, ingestion), each with its own security model, data lifecycle, and integration points. Sprint 24/25 cascade dependency — a slip here delays two downstream sprints |
| Project Context | `brownfield` | Extending existing RAG pipeline (Embedding → Retrieval → Reranking → LLM → Translation) with established architecture, auth patterns, Docker Swarm deployment, and defined Sprint 20-25 roadmap |

## Success Criteria

### User Success

- **Government IT administrators** can configure, enable/disable, and govern all tools through YAML configuration files without modifying core GENIE.AI code — achieving a fully operational tool deployment within 2 hours of receiving the framework.
- **Government department stakeholders** (health, transport, tax) can register their department's REST API as a custom tool by providing an OpenAPI spec, without requiring GENIE.AI source code changes or developer intervention.
- **Citizens** receive answers that cite current, live sources alongside knowledge base documents — with visible provenance distinguishing internal documents from external web sources. Citizens experience transparent "I don't have current information" responses rather than hallucinated answers when neither the knowledge base nor web search provides sufficient context.
- **Citizens** never have their PII exposed to external search engines — the mandatory PII redaction guardrail operates transparently with zero user-visible configuration required.

### Business Success

- **Knowledge base freshness**: <4 hours lag from feed publication to RAG availability, measured end-to-end (feed poll → content extraction → TEI embedding → ArangoDB insertion → index propagation).
- **Tool adoption**: 3+ custom tools registered in the first pilot deployment within 30 days of deployment.
- **Sovereignty compliance**: Zero PII leakage events across all deployments, measured via PII redaction service audit logs.
- **Agentic workflow readiness**: Tools layer consumed by Sprint 24 LangGraph orchestrator via standardized `ToolExecutor` interface — validated by integration test suite.
- **Sprint 24 dependency met**: Tools layer merged and integrated before Sprint 24 agentic workflow development begins (Sprint 22 test framework is a hard prerequisite).

### Technical Success

- **Zero new infrastructure dependencies**: Web search, tool registry, and stream ingestion all operate on existing Redis, TEI, and ArangoDB infrastructure without additional services beyond SearXNG (CPU) and the PII redaction service (CPU).
- **Search result quality**: >80% relevant results for government domain queries, measured against a labeled test set.
- **Graceful degradation**: Zero hallucinated answers from failed tool invocations — all tool failures produce transparent fallback responses.
- **Citation accuracy**: >90% of cited URLs valid at query time.
- **DPG licensing compliance**: All incorporated open-source tools follow permissive licensing (MIT, Apache 2.0, BSD). Affero licenses (GPL, AGPL) used only for unmodified API-consumed services.
- **Redis Streams as general-purpose event backbone**: Ingestion system uses Redis Streams as a reusable event transport, not a single-purpose tool channel — enabling future event-driven capabilities without re-architecting.
- **ChatQnA refactoring alignment**: Tools integration interface is designed to survive Sprint 24's modular refactoring without rework — the `ToolExecutor` contract is defined before refactoring begins.

### Measurable Outcomes

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Knowledge base freshness | <4 hours from publication to RAG | End-to-end pipeline latency monitoring |
| Web search accuracy | >80% relevant results for gov queries | Labeled test set with automated scoring |
| Custom tool registration | 3+ tools in first pilot | Registry audit log |
| PII leakage events | Zero across all deployments | PII redaction service audit logs |
| LangGraph ToolNode integration | Tools consumable by Sprint 24 orchestrator | Integration test suite |
| Citation validity | >90% URLs valid at query time | Automated link validation |
| Graceful degradation incidents | Zero hallucinated answers from tool failures | Adversarial test suite + audit log |
| Deployment configuration time | <2 hours for full tool setup | Deployment playbook time trial |
| DPG license compliance | 100% of incorporated tools compliant | License audit of dependencies |

## Product Scope

### MVP - Minimum Viable Product

- Web search tool with SearXNG default backend and pluggable interface
- PII redaction guardrail service (pluggable interface with reference implementation, mandatory for external tool invocations)
- Tool registry with JSON Schema definitions, OpenAPI import, enable/disable controls, per-tool audit logging
- Hybrid tool execution model (rule-based triggers + LLM-driven selection, rules take precedence)
- Result fusion: scoring, deduplication, context window budget allocation, graceful degradation
- Configurable source citations (on by default, disableable per deployment)
- Domain whitelisting for web search
- Stream ingestion: RSS/Atom polling and JSON API polling (webhook endpoint)
- Data lifecycle management: retention policies, TTL, update-vs-append behavior
- Health checks, circuit breakers, and dead letter queues for tool/feed failures
- Admin API for tool configuration, with Vue 3 admin UI (tool management, feed management, domain whitelist editor, audit log viewer, health status)
- User interaction surfaces: citation rendering and graceful degradation messages in both Vue 3 (web) and Flutter (mobile) chat interfaces
- LangGraph ToolNode integration contract (preliminary, for Sprint 24 readiness)
- Containerized deployment (Docker Swarm and K8s compatible)
- Full integration with existing ArangoDB, Redis, and TEI infrastructure
- DPG licensing compliance audit

### Growth Features (Post-MVP)

- Additional framework-shipped tools: calculator, code execution, GIS
- Role-based tool permissions (different tools available to different user roles)
- Per-tool rate limiting and usage quotas
- Tool execution analytics dashboard (knowledge gap identification)
- Dynamic tool registration via admin API (add tools at runtime without redeployment)
- Tool result caching (Redis-backed, configurable TTL)
- Search backend performance optimization (result caching, query batching)
- Advanced PII redaction strictness levels (configurable per deployment)

### Vision (Future)

- Cross-deployment tool sharing marketplace (government departments sharing tool definitions)
- Real-time data source integration (live government service status, policy change notifications)
- MCP (Model Context Protocol) tool server support (when Sprint 24 agentic workflows mature)
- Multi-tool orchestration (LLM composes workflows that chain multiple tools in sequence)
- GovStack BB API tool templates (pre-configured tool definitions for each Building Block)
- Proactive intelligence mode (system detects knowledge gaps from tool invocation patterns and recommends document ingestion priorities)

## User Journeys

### Journey 1: Amina's Tax Question — Citizen Success Path

**Amina** runs a small textile business in Dar es Salaam. It's April, and she's heard rumors that the tax filing deadline for small businesses changed this year. She opens the GENIE.AI government portal on her phone and asks: "What is the current tax filing deadline for small businesses?"

The RAG pipeline begins. The query is embedded and matched against ArangoDB vectors. The best match is a document from the Tanzania Revenue Authority — but it's from last year, and the similarity score sits at 0.62, below the configured confidence threshold of 0.70. The rule-based trigger fires: retrieval confidence is insufficient. The system routes the query to the web search tool.

Before the query leaves the sovereign boundary, it passes through the PII redaction service. "Amina" is not in the query — there's no PII to strip. The sanitized query reaches SearXNG, which aggregates results from multiple search engines. Within 1.2 seconds, five relevant results return — including a March press release from the Revenue Authority announcing the new May 15 deadline.

The result fusion engine scores and ranks the search results, deduplicates them against the existing RAG results (one document overlaps), and merges the top results into the context window alongside the knowledge base documents. The LLM receives both the stale knowledge base document (clearly labeled with its ingestion date) and the fresh web search results (with URLs and source metadata).

Amina receives her answer: "The tax filing deadline for small businesses has been extended to **May 15, 2026**, as announced by the Tanzania Revenue Authority on March 28, 2026. This is a change from the previous deadline of April 30." Two citations appear below the answer: one linking to the knowledge base document showing the old deadline, and one linking to the live Revenue Authority press release.

Amina breathes a sigh of relief. She has two extra weeks. She didn't have to navigate a government website, wait on hold, or visit an office. The AI gave her a current, sourced answer — and told her what changed from last year.

### Journey 2: Joseph's Missing Permit — Graceful Degradation Edge Case

**Joseph** is a contractor in Nairobi. He needs to know whether a specific construction permit type — "Class B Excavation in Heritage Zones" — is currently being issued. He asks GENIE.AI.

The retrieval engine finds nothing relevant — no documents about this specific permit type exist in the knowledge base. The confidence score is 0.31, well below threshold. The web search tool fires. SearXNG returns results, but they're all about different permit types or outdated regulations. The result fusion engine assigns low relevance scores across the board — nothing clears the minimum quality bar.

The circuit breaker does not trip (SearXNG responded fine), but the result quality check determines that no external results are good enough to include in the LLM context. The system gracefully degrades.

Joseph receives: "I don't have current information about Class B Excavation permits in Heritage Zones. This specific permit type may not be documented in our system, or the information may not be available from online sources. I recommend contacting the Nairobi County Building Inspectorate directly at [phone/email] for the most accurate information."

Joseph doesn't get a hallucinated answer. He doesn't get a confident but wrong answer pulled from a tangentially related web page. He gets a transparent response that tells him exactly why the system can't answer and where he can find the information. The tool invocation is logged in the audit trail — flagged as a knowledge gap. When the DevOps team reviews tool analytics, this query type appears in the "unanswered questions" report, signaling to the relevant department that citizens need this information ingested.

### Journey 3: Fatima's Deployment — IT Administrator Configuration

**Fatima** is a senior systems administrator responsible for GENIE.AI at a national government deployment in West Africa. She's been notified that the server-side tools update is ready to deploy. She has a YAML configuration file and a deployment checklist.

She opens the tools configuration file. Web search is enabled by default with SearXNG as the backend — good. She reviews the domain whitelist and restricts search to `.gov`, `.go.`, and three approved news domains relevant to her country. She disables the webhook ingestion endpoint — her deployment isn't ready for push-based ingestion yet. She enables two RSS feeds: the national gazette and the health ministry's press release feed, both on 2-hour polling intervals. She sets retention to 90 days for feed content and 30 days for search result cache.

She runs the configuration validator (`genie-tools validate-config`), which confirms the YAML is syntactically valid, all tool definitions match their JSON Schema, and the SearXNG backend is reachable. She deploys the updated stack with `ansible-playbook deploy.yml --tags tools`. The deployment takes 8 minutes. SearXNG spins up on CPU, Presidio starts alongside it, and the tool registry loads all definitions.

Fatima runs the health check endpoint. All tools report green. She runs the integration test suite — 47 tests pass, 0 failures. She checks the PII redaction audit log: the mandatory guardrail is active and has processed 3 test queries, correctly identifying and redacting a test name. She logs the deployment in the change management system.

Total time: 2 hours from receiving the update to a fully operational tools deployment. No developer intervention required. No core code modified.

### Journey 4: Dr. Kofi's Department API — Stakeholder Tool Registration

**Dr. Kofi** is the head of IT for the Ministry of Health. He manages the ministry's public health dashboard API, which publishes real-time disease outbreak alerts, vaccination availability, and hospital bed capacity across the country. He wants this data available through GENIE.AI so citizens can ask health-related questions and get current answers.

He doesn't have access to GENIE.AI source code, and he doesn't need it. The IT administrator (Fatima, from Journey 3) has given him the OpenAPI specification template and the tool registration YAML format. Dr. Kofi writes a tool definition: name "health-dashboard", description "Real-time public health data from the Ministry of Health", endpoints for outbreak alerts and vaccination availability, field mappings from the API response to a format the RAG system can ingest, and the API key for authentication.

He submits the YAML file to Fatima. She reviews it, validates it against the JSON Schema, and places it in the tools configuration directory. On next deployment, the health dashboard tool appears in the registry — enabled, rate-limited to 100 requests per hour, and audit-logged.

A citizen now asks: "Is there a malaria outbreak alert in my region?" The RAG pipeline retrieves general malaria information from the knowledge base, but the tool registry detects that the "health-dashboard" tool is relevant to the query. The tool executes against the live API, returns current outbreak data, and the result fusion engine merges it with the RAG results. The citizen gets an answer grounded in both the knowledge base and live ministry data — with citations to both sources.

Dr. Kofi didn't write a single line of Python. He didn't modify GENIE.AI. He provided an API spec and a YAML file.

### Journey 5: Samuel's Midnight Alert — DevOps Troubleshooting

**Samuel** is the on-call SRE for the national GENIE.AI deployment. At 2 AM, his monitoring dashboard lights up: the RSS ingestion feed for the national gazette has failed three consecutive polls. The circuit breaker has opened — the feed is now in a "degraded" state, and ingestion attempts are being routed to the dead letter queue.

He checks the tool health endpoint. Web search: green. Health dashboard API: green. Gazette RSS feed: red. The error log shows HTTP 503 from the gazette's web server — the publisher's site is down, not GENIE.AI's fault. The dead letter queue has 14 unprocessed entries.

Samuel has three options. He could wait for the gazette server to recover — the circuit breaker will automatically retry with exponential backoff. He could temporarily switch to an alternate source. Or he could flush the dead letter queue once the source recovers. He checks the gazette's status page — they're doing scheduled maintenance, ETA 6 AM.

He decides to wait. The circuit breaker's backoff policy means the feed will automatically resume polling at 6 AM with a full sync. The dead letter queue entries will be reprocessed in chronological order. Citizens asking about gazette content will still get answers from the existing knowledge base — just without the very latest publications. No hallucinations, no broken queries, no user-visible impact beyond slightly stale data from one source.

Samuel updates the incident ticket with his assessment and goes back to sleep. The system heals itself.

### Journey Requirements Summary

| Journey | Key Capabilities Revealed |
|---------|--------------------------|
| Amina's Tax Question | Rule-based trigger on low confidence, PII redaction, SearXNG search, result fusion with scoring/deduplication, source citations with provenance labels (KB vs web), context window budget allocation |
| Joseph's Missing Permit | Result quality threshold enforcement, graceful degradation response, knowledge gap flagging, audit trail for unanswered queries, tool analytics for content gap identification |
| Fatima's Deployment | YAML-based configuration, domain whitelisting, feed scheduling, retention policies, config validation tooling, health check endpoints, Ansible deployment integration, PII redaction audit verification |
| Dr. Kofi's API Registration | OpenAPI spec import, YAML tool definition format, field mapping for API responses, tool registry auto-discovery, rate limiting, audit logging, no-code tool registration workflow |
| Samuel's Midnight Alert | Circuit breaker pattern, dead letter queue, health check endpoints, exponential backoff recovery, monitoring integration, automatic self-healing, graceful single-source degradation without user impact |

## Domain-Specific Requirements

The govtech (government/public sector) domain introduces compliance and sovereignty constraints that are already addressed throughout this PRD (DPG licensing, mandatory PII redaction, domain whitelisting, full audit logging, sovereignty-by-design). The following supplementary govtech domain considerations apply:

### Freedom of Information Readiness

Tool invocation audit logs (user identity, timestamp, tool name, parameters, result metadata) must be structured and queryable to support Freedom of Information requests. Government deployments may be legally required to disclose AI decision-making records. The audit log format should support direct export without transformation.

### Public Records Compliance

Government AI interactions may constitute public records under national archival legislation. Tool invocation logs, configuration history, and retention policy enforcement records should meet national archival standards where applicable. This is a deployment-level concern — the tools layer provides the audit infrastructure; the deployment configures retention to match local legal requirements.

### Accessibility

Source citations, provenance labels (knowledge base vs web source), and tool-augmented response elements must comply with government accessibility mandates (WCAG 2.1 AA or local equivalents). Citation rendering in LLM responses must be screen-reader compatible and must not rely on visual-only cues (e.g., color-coded source labels).

### Interoperability

The tool registry's use of JSON Schema and OpenAPI aligns with government interoperability frameworks that mandate open standards for API definitions. The standardized `ToolExecutor` interface ensures tools are consumable by both the current ChatQnA pipeline and future LangGraph orchestrators without adapter layers — satisfying government IT mandates for vendor-neutral integration.

### Content Neutrality

When web search augments RAG responses, the system must not introduce political or editorial bias through search engine result ranking. Domain whitelisting provides the primary mitigation by restricting results to approved government and institutional sources. Additional mitigations include: configurable result source labeling that distinguishes government sources from news/media sources, and the ability for deployments to weight government sources higher in result fusion scoring.

## Innovation & Novel Patterns

### Detected Innovation Areas

**Sovereign Tool Execution Layer.** The core innovation is not any single capability — it is the combination of real-time tool use with mandatory sovereignty compliance, delivered on existing infrastructure. Commercial AI assistants (ChatGPT, Gemini, Perplexity) achieve real-time tool use by routing queries through centralized infrastructure that processes user data externally. GENIE.AI achieves the same capability while keeping all processing inside the national boundary. This is not incremental — it is the first open-source RAG framework to offer sovereign real-time tool use as a built-in capability rather than a post-deployment integration project.

**Tool Registry as Agentic Capability Surface.** The tool registry is architecturally novel: it serves simultaneously as a plugin system (tools are defined and loaded without core code changes), an API gateway (external APIs become invocable tools through OpenAPI import), and an agentic workflow interface (the standardized `ToolExecutor` contract makes every tool consumable by LangGraph `ToolNode` without adapter layers). This triple-purpose design means the registry is not just a configuration mechanism — it is the standard interface through which the entire GENIE.AI ecosystem interacts with external capabilities. No existing open-source RAG framework provides this abstraction layer.

**Knowledge Gap Intelligence.** Every tool invocation generates structured data about what the knowledge base lacks: which queries triggered web search, which searches returned insufficient results, which feeds are filling gaps that documents don't cover. Mining this data transforms the tools layer from a retrieval enhancement into a continuous improvement engine — government departments can see exactly what information citizens need that isn't in the system. This feedback loop between tool usage and content strategy is novel in government RAG deployments.

**Zero-Infrastructure Real-Time Capability.** Delivering web search, stream ingestion, and tool execution without adding any new infrastructure services (beyond CPU-only SearXNG and PII redaction containers) removes the primary adoption barrier for government IT departments: infrastructure procurement. The entire tools layer operates on Redis Streams (already in the stack for caching), TEI (already in the stack for embedding), and ArangoDB (already in the stack for storage). This is not a design optimization — it is a deliberate architectural decision that makes the difference between a 6-month procurement cycle and a 2-hour deployment.

### Market Context & Competitive Landscape

The competitive landscape in sovereign AI tool use is nearly empty. Commercial offerings (ChatGPT, Perplexity, Gemini) provide superior tool use capabilities but cannot operate inside a sovereign boundary. Open-source RAG frameworks (LangChain, LlamaIndex) provide tool abstractions but require significant custom development to achieve government-grade compliance (PII redaction, audit logging, domain whitelisting). No existing solution combines real-time tool use, mandatory sovereignty compliance, and zero new infrastructure in a single deployable framework.

The closest comparable is Perplexity's move away from MCP toward direct API integration — validating GENIE.AI's choice of JSON Schema/OpenAPI as the primary tool definition standard. Perplexity's direction confirms that API-native tool definitions are the industry trajectory, and GENIE.AI is positioned ahead of the open-source curve by adopting this approach from the start.

### Validation Approach

- **Sovereignty claim validation**: Automated PII injection test suite that sends queries containing synthetic PII through the tool pipeline and verifies no PII appears in external requests (monitored via search backend query logs)
- **Zero-infrastructure claim validation**: Deployment playbook time trial — measure total deployment time on a clean environment with only existing infrastructure; target <2 hours
- **Tool registry extensibility validation**: Register 3+ custom tools from different government departments using only YAML/OpenAPI definitions, no code changes
- **Knowledge gap intelligence validation**: Run tool analytics after a pilot period and verify that identified knowledge gaps correlate with citizen query patterns from existing chat logs

### Risk Mitigation

- **Innovation risk — sovereignty claims don't hold**: PII redaction services have known false-negative rates. Mitigation: the PII redaction component is designed behind a pluggable interface — the initial implementation uses Microsoft Presidio, but alternative PII detection/redaction services can be substituted without architectural changes. Configurable redaction strictness levels, audit logging of all redacted queries, and transparent documentation of the redaction service's limitations support deployment security reviews.
- **Innovation risk — tool registry abstraction is wrong level**: If the JSON Schema/OpenAPI approach proves insufficient for Sprint 24's LangGraph needs, the registry may require rework. Mitigation: the `ToolExecutor` contract is defined as a preliminary interface validated by integration tests — it can evolve before Sprint 24 development begins.
- **Innovation risk — zero-infrastructure constraint limits capability**: Running SearXNG and the PII redaction service on CPU may not meet performance requirements for high-traffic deployments. Mitigation: both services support horizontal scaling; the CPU-only constraint is a deployment default, not an architectural limit.

## Agent Infrastructure Specific Requirements

### Project-Type Overview

The server-side tools layer is implemented as agent infrastructure in the Python/OPEA tier — a set of microservices that expose standardized tool execution interfaces consumed by ChatQnA and future LangGraph orchestrators. This is not a user-facing API; it is an internal capability layer with an admin configuration API. The primary consumers are the RAG pipeline (automatic tool invocation during query processing) and IT administrators (tool configuration and monitoring via admin API).

### Technical Architecture Considerations

**Service Decomposition.** The tools layer consists of three logical services, each independently deployable:

| Service | Responsibility | Protocol |
|---------|---------------|----------|
| Tool Registry | Tool definition storage, validation, enable/disable, lookup | Internal gRPC/REST |
| Tool Executor | Tool invocation, PII redaction guardrail, result capture | Internal (called by ChatQnA) |
| Stream Ingestor | Feed polling, webhook intake, content extraction, routing to Redis Streams | Internal (scheduled + webhook) |

All three services share the existing Redis instance for caching, stream transport, and dead letter queues. The tool registry is the single source of truth for tool definitions — both the executor and the ingestor read from it.

**Integration with ChatQnA Pipeline.** The tool executor integrates into the existing RAG pipeline at the retrieval stage (after ArangoDB retrieval, before LLM prompt construction). The integration point is in `genieai_chatqna.py`, where retrieval results are evaluated for confidence. When the confidence threshold is not met or time-sensitive patterns are detected, the tool executor is invoked. Results are fused with retrieval results before prompt assembly.

**Sprint 24 Forward Compatibility.** The `ToolExecutor` contract is defined as a Python abstract class with `execute(tool_name: str, parameters: dict) -> ToolResult` where `ToolResult` contains structured output, source citations, confidence score, and execution metadata. This contract is designed to be consumable by LangGraph `ToolNode` without adapter layers — both ChatQnA and LangGraph call the same interface.

### API Endpoint Specifications

**Admin API** (internal, Keycloak-authenticated):

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/tools` | List all registered tools with status |
| GET | `/api/tools/{name}` | Get tool definition and configuration |
| PUT | `/api/tools/{name}` | Update tool configuration (enable/disable, rate limits, etc.) |
| POST | `/api/tools/validate` | Validate a tool definition against JSON Schema |
| GET | `/api/tools/{name}/audit` | Get audit log entries for a specific tool |
| GET | `/api/feeds` | List all ingestion feeds with status |
| PUT | `/api/feeds/{name}` | Update feed configuration (schedule, retention, etc.) |
| GET | `/api/feeds/{name}/health` | Get feed health status and recent errors |
| GET | `/api/tools/health` | Health check for all tools and feeds |
| POST | `/api/webhook/{feed_name}` | Webhook endpoint for push-based ingestion |

**Internal Interfaces** (not exposed via API gateway):

| Interface | Consumer | Purpose |
|-----------|----------|---------|
| `ToolExecutor.execute()` | ChatQnA, future LangGraph | Execute a tool and return structured results |
| `ToolRegistry.get_tool()` | ToolExecutor, StreamIngestor | Look up tool definition by name |
| `ToolRegistry.list_tools()` | ChatQnA (for LLM tool selection) | List available tools with descriptions |
| `PIIRedactor.redact()` | ToolExecutor | Redact PII from tool parameters before external execution |
| `ResultFusion.merge()` | ChatQnA | Merge tool results with RAG retrieval results |

### Authentication Model

The tools layer uses the existing Keycloak OIDC authentication infrastructure:

- **Admin API**: Protected by Keycloak realm tokens. Only users with the `tools-admin` role can modify tool configurations. Read access requires `tools-reader` role.
- **Webhook endpoint**: Authenticated via API key (rotation-supported) or JWT Bearer token. The API key is stored in the tool registry configuration for the specific feed.
- **Inter-service calls**: The tool executor is called internally by ChatQnA — no authentication boundary between OPEA services. This is consistent with the existing OPEA architecture where ChatQnA, Retriever, and Reranker communicate without inter-service auth.
- **Future LangGraph integration**: The `ToolExecutor` interface will be consumed by the LangGraph orchestrator running in the same OPEA tier, maintaining the same no-auth inter-service pattern.

### Data Schemas

**Tool Definition Schema** (JSON Schema, canonical format):

```json
{
  "name": "web-search",
  "description": "Search the web for current information",
  "version": "1.0.0",
  "type": "framework",
  "enabled": true,
  "parameters": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Search query" },
      "max_results": { "type": "integer", "default": 5 }
    },
    "required": ["query"]
  },
  "execution": {
    "backend": "searxng",
    "endpoint": "${SEARXNG_URL}/search",
    "method": "GET",
    "timeout_ms": 5000
  },
  "security": {
    "pii_redaction_required": true,
    "domain_whitelist": [".gov", ".go."],
    "rate_limit": { "requests_per_hour": 100 }
  },
  "citations": {
    "enabled": true,
    "include_url": true,
    "label_source": true
  }
}
```

**Tool Result Schema**:

```json
{
  "tool_name": "web-search",
  "status": "success",
  "results": [
    {
      "content": "Result text...",
      "url": "https://example.gov/press-release",
      "score": 0.89,
      "source_type": "web",
      "retrieved_at": "2026-04-30T10:15:00Z"
    }
  ],
  "metadata": {
    "execution_time_ms": 1234,
    "results_count": 5,
    "pii_redacted": false
  }
}
```

**Feed Definition Schema**:

```json
{
  "name": "national-gazette",
  "type": "rss",
  "url": "https://gazette.gov.example/feed.xml",
  "schedule": "0 */2 * * *",
  "retention_days": 90,
  "update_behavior": "replace",
  "content_mapping": {
    "title_field": "title",
    "body_field": "description",
    "date_field": "pubDate"
  },
  "processing": {
    "chunking": true,
    "embedding": true,
    "collection": "gazette_documents"
  }
}
```

### Error Handling

Tool execution follows a structured error model with graceful degradation:

| Error Category | HTTP Code | Tool Status | Behavior |
|---------------|-----------|-------------|----------|
| Tool disabled | N/A (internal) | `disabled` | Tool not invoked; query proceeds without tool results |
| PII redaction failure | N/A (internal) | `error` | Tool not invoked; query proceeds without tool results; error logged |
| Backend timeout | N/A (internal) | `timeout` | Circuit breaker increments; cached results used if available; otherwise graceful degradation |
| Backend unreachable | N/A (internal) | `unreachable` | Circuit breaker opens after threshold; graceful degradation until health check passes |
| Invalid parameters | N/A (internal) | `validation_error` | Tool not invoked; validation error logged |
| Rate limit exceeded | N/A (internal) | `rate_limited` | Tool not invoked; rate limit event logged |
| Search results below quality | N/A (internal) | `low_quality` | Results discarded; graceful degradation response |
| Feed parse failure | N/A (internal) | `parse_error` | Entry routed to dead letter queue; feed health degraded |

All errors are audit-logged with timestamp, tool name, error category, and relevant context. The admin API exposes error summaries and trend data per tool and per feed.

### Rate Limiting

Rate limiting is per-tool, configurable in the tool definition:

- **Default**: 100 requests/hour per tool
- **Configuration**: `rate_limit.requests_per_hour` in tool definition YAML
- **Scope**: Per-tool (not per-user) — limits apply to the tool backend, protecting external services from overload
- **Enforcement**: Redis-backed sliding window counter
- **Behavior on limit**: Tool returns `rate_limited` status; query proceeds without tool results; event logged

### API Documentation

Tool definitions serve as their own documentation. The tool registry's `GET /api/tools` endpoint returns all registered tools with their full JSON Schema definitions, descriptions, and configuration. This is the single source of truth for what tools are available, what parameters they accept, and what they return.

Additionally:
- The admin API follows the existing OpenAPI/Swagger documentation pattern used by the GENIE.AI backend (`swagger-jsdoc` served at `/api-docs`)
- Tool definition YAML files include `description` fields that are surfaced to the LLM during tool selection — these descriptions function as both developer documentation and LLM-facing tool descriptions
- Feed definitions include `description` fields visible in the admin API

### Implementation Considerations

**Python/OPEA Tier Placement.** All three services are implemented in Python, sharing the OPEA tier's runtime environment. This ensures language compatibility with the Sprint 24 LangGraph orchestrator and access to the existing `comps` library (custom logger, telemetry). The services use FastAPI (consistent with ChatQnA) and follow the existing OPEA service patterns.

**Configuration-Driven, Not Code-Driven.** Tools and feeds are defined in YAML files, validated against JSON Schema at startup, and loaded into the registry. Adding a tool or feed requires a YAML file and a deployment restart — no code changes. The admin API supports runtime configuration updates (enable/disable, rate limit changes) without restart.

**Admin UI in Vue 3.** Tool configuration and management requires admin-facing UI surfaces in the Vue 3 web application. The Vue 3 frontend is the admin tier — all tool administration (enable/disable, domain whitelisting, feed configuration, audit log review, health monitoring) is exposed through Vue 3 admin views backed by the admin API. Admin features are Vue 3 only; Flutter does not include admin capabilities.

**User Interaction Surfaces.** Both Vue 3 and Flutter serve user-facing tiers — citizens interact with tool-augmented responses through either the web or mobile chat interface. Tool use instances that require user interaction (e.g., confirmation prompts, tool result display with citations, source provenance labels, graceful degradation messages) must render correctly across both Vue 3 (web users) and Flutter (mobile users). In Sprint 24's agentic workflows, these surfaces extend to the agentic workflow UI toolkit.

## Project Scoping & Phased Development

### MVP Strategy & Philosophy

**MVP Approach:** Platform MVP — the tools layer is a capability surface, not a user-facing product. The MVP delivers the foundational infrastructure (tool registry, execution engine, PII guardrail) and the admin and user-facing UI surfaces needed to configure and interact with tools. Without the registry and executor, nothing else works. With them, web search and stream ingestion become configuration exercises rather than development projects.

**Resource Requirements:** 2-3 Python/OPEA developers, 1 Vue 3 frontend developer (admin UI + user interaction surfaces), 1 DevOps engineer (deployment configuration), 1 QA engineer (integration testing across Vue 3 and Flutter). The team must have familiarity with FastAPI, Redis Streams, Vue 3 (Options API, Vuex), and the existing OPEA service patterns.

### MVP Implementation Sequence

Within the single MVP release, capabilities are implemented in dependency order:

**Wave 1 — Tool Registry & Executor Foundation**
- Tool definition schema (JSON Schema canonical format, YAML authoring surface)
- Tool registry service (load, validate, enable/disable, lookup)
- `ToolExecutor` abstract contract (`execute(tool_name, parameters) -> ToolResult`)
- PII redaction pluggable interface with reference implementation
- Admin API endpoints (tool CRUD, validation, health checks)
- Configuration validation tooling (`genie-tools validate-config`)
- Unit and integration test framework

**Wave 2 — Web Search (Highest User Value)**
- SearXNG integration (Docker service, default backend)
- Rule-based trigger logic (retrieval confidence threshold, time-sensitive patterns)
- LLM-driven tool selection fallback
- Result fusion engine (scoring, deduplication, context window budget)
- Source citations (configurable, on by default)
- Domain whitelisting
- Integration into ChatQnA pipeline (`genieai_chatqna.py`)
- Graceful degradation (quality threshold, transparent fallback responses)

**Wave 3 — Stream Ingestion**
- Redis Streams event transport (publisher/consumer patterns)
- RSS/Atom feed polling (scheduled, configurable intervals)
- JSON API polling (scheduled, field mapping, schema validation)
- Webhook endpoint (push-based intake, API key / JWT auth)
- Content extraction → TEI embedding → ArangoDB insertion pipeline
- Data lifecycle management (retention policies, TTL, update-vs-append)
- Health checks, circuit breakers, dead letter queues

**Wave 4 — UI Surfaces**
- Vue 3 admin views: tool management dashboard (list, enable/disable, configure), feed management (add/edit feeds, schedule, retention), domain whitelist editor, audit log viewer, health status overview
- Vue 3 user interaction: citation rendering in chat responses (source URL, provenance label, government vs media source distinction), graceful degradation message display
- Flutter user interaction: citation rendering in mobile chat (matching Vue 3 behavior), graceful degradation message display, source provenance labels
- Sprint 24 agentic workflow UI: tool confirmation prompts, multi-tool result display, tool status indicators (designed for compatibility with the agentic workflow UI toolkit)

**Cross-Cutting (All Waves)**
- Per-tool audit logging (user identity, timestamp, parameters, results)
- Circuit breaker pattern for all external service calls
- Docker Swarm / K8s deployment configuration
- Ansible playbook integration (`--tags tools`)
- LangGraph `ToolNode` integration contract (preliminary)
- DPG licensing compliance audit

### Post-MVP Features (Growth Phase)

- Additional framework-shipped tools: calculator, code execution, GIS
- Role-based tool permissions (different tools available to different user roles)
- Per-tool usage quotas (beyond rate limiting)
- Tool execution analytics dashboard (knowledge gap identification)
- Dynamic tool registration via admin API (add tools at runtime without redeployment)
- Tool result caching (Redis-backed, configurable TTL)
- Search backend performance optimization (result caching, query batching)
- Advanced PII redaction strictness levels (configurable per deployment)
- Alternative PII redaction service implementations

### Vision Features (Expansion Phase)

- Cross-deployment tool sharing marketplace (government departments sharing tool definitions)
- Real-time data source integration (live government service status, policy change notifications)
- MCP (Model Context Protocol) tool server support (when Sprint 24 agentic workflows mature)
- Multi-tool orchestration (LLM composes workflows that chain multiple tools in sequence)
- GovStack BB API tool templates (pre-configured tool definitions for each Building Block)
- Proactive intelligence mode (system detects knowledge gaps from tool invocation patterns and recommends document ingestion priorities)

### Risk Mitigation Strategy

**Technical Risks:**
- **ChatQnA refactoring overlap**: The tool executor integration point will change during Sprint 24's ChatQnA modular decomposition. Mitigation: Define the `ToolExecutor` contract before refactoring begins; implement the integration against the current monolith first, then migrate to the refactored modules as they become available. The contract is the stable interface.
- **PII redaction false negatives**: No PII detection service is perfect. Mitigation: Pluggable interface allows swapping implementations; configurable strictness levels; audit logging of all redacted queries for security review; documented limitations for deployment risk assessments.
- **Redis Streams performance**: Redis Streams on a cache-only Redis instance may have performance characteristics that differ from a dedicated streams deployment. Mitigation: Benchmark with expected feed volumes; document scaling guidance; Redis clustering is a supported deployment option.
- **Cross-platform UI parity**: Tool-augmented responses (citations, graceful degradation messages) must render consistently across Vue 3 and Flutter. Mitigation: Define shared response schema and rendering specifications early; both platforms consume the same backend response format.

**Market Risks:**
- **Adoption barrier**: Government IT departments may be reluctant to enable external tool use. Mitigation: Web search is disabled by default (opt-in); all security controls are mandatory defaults, not configuration exercises; domain whitelisting restricts search to approved sources; admin UI makes security controls visible and auditable.
- **Sprint 24/25 dependency cascade**: A slip in this initiative delays two downstream sprints. Mitigation: The four-wave implementation sequence allows partial delivery — if Wave 3 (stream ingestion) or Wave 4 (UI) slips, Waves 1 and 2 still deliver the highest-value capability (web search with registry).

**Resource Risks:**
- **Team availability**: If fewer developers are available than planned, Wave 3 (stream ingestion) and Wave 4 (UI polish) can be partially deferred to post-MVP without breaking the core value proposition. The registry and web search are the minimum viable capability surface.
- **Sprint 22 test framework dependency**: If the test framework slips, tools integration testing is blocked. Mitigation: The tools layer includes its own unit test suite; integration tests depend on the Sprint 22 framework but unit tests can proceed independently.

## Functional Requirements

### Tool Registry & Management

- FR1: System administrators can define tools using JSON Schema with YAML as an authoring surface
- FR2: System administrators can import tool definitions from OpenAPI specifications
- FR3: System administrators can enable and disable individual tools without code changes or redeployment
- FR4: System administrators can configure per-tool security settings including PII redaction requirements and domain whitelists
- FR5: System administrators can register custom tools by providing a tool definition file — no core code modification required
- FR6: The tool registry validates all tool definitions against their JSON Schema at startup and rejects invalid definitions
- FR7: The tool registry serves as the single source of truth for all tool definitions, consumed by both the executor and the ingestor

### Tool Execution

- FR8: The system invokes tools automatically when retrieval confidence falls below a configurable threshold (rule-based trigger)
- FR9: The system invokes tools automatically when time-sensitive query patterns are detected (rule-based trigger)
- FR10: The system can invoke tools when the LLM determines the knowledge base is insufficient (LLM-driven selection, fallback to rule-based)
- FR11: Tools that are disabled or unauthorized cannot be invoked by either rule-based or LLM-driven paths
- FR12: The system redacts personally identifiable information from all tool parameters before external execution (mandatory guardrail)
- FR13: The PII redaction component is pluggable — alternative implementations can be substituted without architectural changes
- FR14: The system captures structured output from tool executions including results, source citations, confidence scores, and execution metadata
- FR15: The system enforces per-tool rate limits to protect external service backends from overload

### Web Search

- FR16: The system executes web searches through a configurable search backend (default: SearXNG)
- FR17: System administrators can restrict web search to approved domains via domain whitelisting
- FR18: The system can route search queries to alternative search backends through a pluggable interface

### Result Fusion & Response

- FR19: The system merges tool execution results with RAG retrieval results, scoring and deduplicating across both sources
- FR20: The system allocates context window budget between retrieved documents and tool results according to configurable ratios
- FR21: The system includes source citations with tool-augmented responses, showing URLs and distinguishing knowledge base sources from external sources
- FR22: System administrators can configure citation behavior (enabled/disabled) per deployment
- FR23: The system returns a transparent "insufficient information" response when neither the knowledge base nor tool execution provides sufficient context, rather than fabricating an answer
- FR24: The system discards tool results that fall below a minimum quality threshold before including them in the LLM context

### Stream Ingestion

- FR25: The system ingests content from RSS/Atom feeds on configurable polling schedules
- FR26: The system ingests content from JSON API endpoints on configurable polling schedules with field mapping
- FR27: The system receives push-based content via webhook endpoints with authentication (API key or JWT)
- FR28: The system routes ingested content through the existing TEI embedding service and stores it in ArangoDB
- FR29: System administrators can configure data lifecycle policies including retention periods (TTL) and update-vs-append behavior per feed
- FR30: Feed definitions are managed through the tool registry, subject to the same enable/disable and audit controls as other tools

### Admin Configuration & Monitoring

- FR31: System administrators can view and manage all tools through the Vue 3 admin UI (tool list, enable/disable, configuration editing)
- FR32: System administrators can manage domain whitelists through the Vue 3 admin UI
- FR33: System administrators can view tool and feed health status through the Vue 3 admin UI
- FR34: System administrators can review audit logs for all tool invocations through the Vue 3 admin UI
- FR35: System administrators can manage ingestion feeds (add, edit, schedule, configure retention) through the Vue 3 admin UI, integrated into the existing Document Management tab alongside current ingestion features
- FR36: The system validates tool configuration changes before applying them and reports validation errors to the administrator

### User Interaction

- FR37: Citizens using the Vue 3 web interface can see source citations on tool-augmented responses, with provenance labels distinguishing knowledge base documents from external web sources
- FR38: Citizens using the Flutter mobile interface can see source citations on tool-augmented responses, with provenance labels matching the Vue 3 behavior
- FR39: Citizens see transparent graceful degradation messages when the system cannot provide a sufficient answer, with guidance on alternative information sources
- FR40: The system renders citation and graceful degradation elements in a manner compliant with government accessibility mandates (WCAG 2.1 AA)

### Resilience & Operations

- FR41: The system applies circuit breaker patterns to all external service calls, halting invocations to unhealthy backends
- FR42: The system routes failed ingestion entries to dead letter queues for later reprocessing
- FR43: The system automatically retries failed operations with exponential backoff when the backend recovers
- FR44: The system logs all tool invocations with user identity, timestamp, tool name, parameters, and result metadata for audit and compliance purposes
- FR45: The system provides health check endpoints for all tools and feeds, consumable by monitoring infrastructure

### Integration Contracts

- FR46: The tool executor exposes a standardized `ToolExecutor` interface consumable by both the current ChatQnA pipeline and future LangGraph orchestrators
- FR47: The system integrates into the existing RAG pipeline at the retrieval stage, after ArangoDB retrieval and before LLM prompt construction
- FR48: The system deploys as containerized services compatible with Docker Swarm and Kubernetes, integrated with the existing Ansible deployment playbooks

## Non-Functional Requirements

### Performance

- NFR1: Web search tool invocation adds no more than 2 seconds of additional latency to the RAG pipeline (P95), measured from trigger decision to result fusion completion
- NFR2: Stream ingestion delivers content from feed publication to RAG availability within 4 hours end-to-end (feed poll → content extraction → TEI embedding → ArangoDB insertion → index propagation)
- NFR3: Tool registry lookup (read a tool definition by name) completes within 50ms
- NFR4: Admin API responses return within 500ms for standard CRUD operations
- NFR5: The PII redaction service processes tool parameters within 100ms per invocation

### Security

- NFR6: Zero PII leakage events across all deployments — all external tool invocations pass through the mandatory PII redaction guardrail, verified via audit logs
- NFR7: Every tool invocation is audit-logged with user identity, timestamp, tool name, input parameters, and result metadata
- NFR8: Audit logs are structured, queryable, and exportable to support Freedom of Information requests without transformation
- NFR9: Webhook endpoints authenticate every request via API key or JWT Bearer token — unauthenticated requests are rejected
- NFR10: The admin API enforces role-based access control — only users with `tools-admin` role can modify tool configurations
- NFR11: Domain whitelisting restrictions are enforced at the tool executor level, not at the search backend level — whitelisted domains cannot be bypassed by modifying the search backend configuration

### Reliability

- NFR12: Zero hallucinated answers from failed tool invocations — all tool failures produce transparent fallback responses or graceful degradation messages
- NFR13: Circuit breakers open after 3 consecutive failures to an external backend and automatically close after successful health check
- NFR14: Failed ingestion entries are routed to dead letter queues and automatically reprocessed when the source backend recovers
- NFR15: The tools layer degrades gracefully when individual components fail — a SearXNG outage does not affect tool registry operations; a feed failure does not affect web search
- NFR16: >90% of cited URLs in tool-augmented responses are valid at query time

### Scalability

- NFR17: The tools layer operates on existing infrastructure (Redis, TEI, ArangoDB) without requiring additional services beyond CPU-only containers (SearXNG, PII redaction)
- NFR18: Redis-backed rate limiting and circuit breaker state support horizontal scaling across multiple service replicas
- NFR19: SearXNG and the PII redaction service support horizontal scaling for high-traffic deployments

### Accessibility

- NFR20: Source citations, provenance labels, and graceful degradation messages comply with WCAG 2.1 AA — screen-reader compatible, no visual-only cues
- NFR21: Citation rendering is consistent across Vue 3 (web) and Flutter (mobile) platforms

### Integration

- NFR22: The `ToolExecutor` interface is consumable by the current ChatQnA pipeline and the Sprint 24 LangGraph orchestrator without adapter layers
- NFR23: The tool registry loads tool definitions from YAML/JSON files at startup without requiring network connectivity to external services
- NFR24: The tools layer deploys via the existing Ansible playbook with `--tags tools`, integrating with the current Docker Swarm and planned Kubernetes deployment workflows
- NFR25: Stream ingestion uses the existing TEI embedding service and ArangoDB storage without requiring schema modifications to the current vector store

### Compliance

- NFR26: All incorporated open-source tools follow DPG (Digital Public Goods Alliance) guidelines for permissive licensing (MIT, Apache 2.0, BSD) — Affero licenses (GPL, AGPL) used only for unmodified API-consumed services
- NFR27: Tool invocation audit logs meet national archival standards where applicable — retention periods are configurable per deployment
