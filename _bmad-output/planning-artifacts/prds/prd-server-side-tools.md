---
title: PRD — GENIE.AI Server-Side Tools (SST)
status: draft
created: 2026-08-07
updated: 2026-08-07
prd_key: server-side-tools
initiative: agentic-enablement
branch: feat/sst
parent_prd: ./prd-agentic-enablement.md
builds_on:
  - "git feat/server-side-tools/prd: _bmad-output/planning-artifacts/prd.md (725 lines)"
  - "git feat/server-side-tools/prd: _bmad-output/planning-artifacts/architecture.md (1015 lines, Decisions 1–17)"
  - "git feat/server-side-tools/prd: _bmad-output/planning-artifacts/epics.md (758 lines, Epics 1–4)"
  - ../team-briefing-agentic-enablement.md
  - ../OPEA-1.5-upgrade-analysis.md
architecture: ../architecture.md
depends_on:
  - OPEA 1.3 → 1.5 overlay bump (foundational, ~3–5 engineer-days) — SST's Python tool implementations land on the bumped `genie-ai-overlay` base; the bump is a prerequisite, not a co-dependency.
  - GENIE workflows service (Sprint 24 #603 — custom LangChain Deep Agents on the OPEA `MicroService` harness) — SST's surviving value is delivered AS LangGraph tools consumed by this orchestrator; the workflows service is the host, SST is the payload.
  - Existing ChatQnA / dataprep / TEI / ArangoDB / Redis (reused additively — no new infra beyond CPU-only SearXNG + the PII-redactor container).
authors: Genie.ai Dev
---

# PRD: GENIE.AI Server-Side Tools (SST)

> **Pillar spec of the [agentic-enablement initiative](./prd-agentic-enablement.md)** — SST delivers the agent's TOOLS + GOVERNANCE (web search, stream ingestor, governance), wired as LangGraph tools into the GENIE workflows service. The original Tool Registry/Executor/MCP-transport are subsumed by LangChain Deep Agents + the `mcp` SDK; see the umbrella PRD.

> **Reduced-scope rewrite.** The original SST spec lived on `feat/server-side-tools/prd` as a four-epic, 17-ADR design centered on a standalone YAML Tool Registry + Tool Executor + `mcpo` transport. The August-2026 decision (see [decision doc](../OPEA-1.5-upgrade-analysis.md) + [team briefing](../team-briefing-agentic-enablement.md)) subsumed that foundation into LangGraph. This PRD supersedes the original's scope framing; it is the authoritative SST surface for the `feat/agentic-enablement` branch. The original spec is retained on its branch as a historical/auditable design record and is referenced, not duplicated, here. FR/NFR IDs below preserve the original spec's numbering for traceability to GitLab issues #696–#725 (to be re-baselined per §7).

> **Read [§10 Errata](#10-errata--spec-vs-implemented-reality-2026-08-17) before implementing.** A code audit found that several surfaces this PRD says it extends do not exist in the codebase. §10 records the corrections; it is authoritative where it conflicts with §3/§4.

## 0. Document Purpose

This PRD defines the **reduced-scope Server-Side Tools (SST)** pillar for product management, architects, and the engineering team. It is built on — and does not duplicate — the original SST artifacts on `feat/server-side-tools/prd` (PRD + architecture + 17 ADRs + epics/stories) and the August-2026 agentic-enablement decision. It is one of four pillars of the [agentic-enablement umbrella](./prd-agentic-enablement.md) (OPEA 1.5 bump · agentic layer · SST · OKF). Audience: product, architects, downstream BMAD workflow owners (architecture, epics/stories, QA), and the engineer owning the workflows-service tool layer.

This document is capability-level: it specifies **what SST ships** (two LangGraph tools, a governance wrapper, a Vue admin surface) and **what it no longer ships** (registry, executor, `mcpo`, canonical contract, progressive disclosure, agent-orchestrator contract — all subsumed). Implementation detail (file layout under `genie-ai-overlay/workflows/tools/`, deployment manifests) lives in the architecture companion and the decision doc.

## 1. Vision & Goal

GENIE.AI is moving from a RAG chat system to one where **AI agents orchestrate multi-step government workflows** (roadmap Sprint 24, #603). An agent that can only read the knowledge base cannot *act on the world*. SST is **the tools/actions layer that lets the agent act** — and the **governance layer that makes those actions sovereign, auditable, and safe**.

Concretely, SST delivers **four surviving capabilities** — three LangGraph tool capabilities (web search, stream ingestor, governance) wired into `genie-ai-overlay/workflows/tools/`, plus the Vue/Flutter admin surface that manages them:

1. **Web Search** (SearXNG) — let the agent reach beyond the knowledge base when retrieval is low-confidence or time-sensitive, with fused, cited, budget-bounded results and graceful degradation.
2. **Stream Ingestor** — let the corpus stay current by polling RSS/Atom/JSON-API feeds and receiving webhooks, routing content through the **existing** TEI embedding pipeline into the **shared** ArangoDB chunks (no parallel corpus), with per-feed retention/TTL.
3. **Governance** — wrap *every* tool invocation (including future MCP-wrapped GovStack Building Block tools) in a runtime pipeline of PII redaction (Presidio, **BLOCK on failure**), circuit breaking, per-tool rate limiting, and tamper-evident audit. This is the single non-negotiable sovereignty guarantee and the only piece of the original "foundation" Epic 1 that survives.

**Goal:** ship the agent's tools + governance as a first-class, sovereign, air-gappable layer — with **zero new infrastructure** beyond a CPU-only SearXNG container and the PII-redactor container (everything else reuses Redis, TEI, ArangoDB, Keycloak, Kong, OTel). Everything else in the original SST spec is consumed by LangGraph.

## 2. Scope

### 2.1 In Scope (production)

- **Web Search tool** (SearXNG): rule-based triggers (low-confidence + time-sensitive + LLM fallback), result fusion + context-window budget, source-citation schema (shared Vue/Flutter), graceful degradation. Delivered as `genie-ai-overlay/workflows/tools/web_search.py`.
- **Stream Ingestor tool**: RSS/Atom polling, JSON-API polling with field mapping, webhook push ingestion → existing TEI embeddings → shared ArangoDB chunks (`source_type:"feed"`); per-feed retention/TTL/update-vs-append; DLQ + health monitoring. Delivered as the stream-ingestor service + a LangGraph tool surface.
- **Governance wrapper** (Decision 16, REFRAMED): a unified pipeline wrapping every LangGraph tool invocation — PII redaction, parameter validation, RBAC authorization, rate limiting, circuit breaking, timeout budget, provenance check, audit enrichment. Delivered as `genie-ai-overlay/workflows/tools/governance.py`.
- **Vue 3 admin surface**: tool + feed management (in the existing Document Management tab), list-and-grant RBAC (Decision 9), citation + degradation rendering, audit-log viewer, health overview, config validation.
- **Citation shared schema** (Decision 10): one JSON contract consumed identically by Vue 3 and Flutter.

### 2.2 OUT of Scope — SUBSUMED by LangGraph (do NOT re-spec as SST)

These were the load-bearing foundation of the original SST spec (Epic 1) and are **explicitly dropped** from SST scope. Each is now the workflows service's job (custom LangChain Deep Agents on the OPEA `MicroService` harness):

| Dropped capability | Original anchor | Why subsumed (one line) |
|---|---|---|
| **YAML Tool Registry** (standalone service) | Epic 1, Stories 1.1/1.2; Decisions 1, 11, 13; FR1, FR2, FR5–FR7 | Tool definitions are now native LangGraph tool declarations (`@tool` / `StructuredTool`) inside `genie-ai-overlay/workflows/` — no YAML registry, no `/v1/tools/definitions` CRUD, no startup JSON-Schema validation service. |
| **Tool Executor / `ToolOrchestratorContract`** | Epic 1; Decisions 14, 17; FR46, FR49, FR51–FR53 | LangGraph's runtime owns invocation, argument validation, retries, and the agent loop — the workflows service *is* the executor; there is no cross-service contract to standardize. |
| **`mcpo` (MCP-over-OpenAPI proxy)** | team-briefing §6; original SST vision | MCP integration survives only as the **`mcp` SDK client + `langchain-mcp-adapters`** inside the workflows service — SST does not host/operate an `mcpo` HTTP bridge. |
| **Canonical Tool Contract** (Decision 14) | `genieai_tool_contract.py` (`ToolDescriptor`/`ToolSchema`/…) | Redundant — LangGraph tools already conform to a typed schema (Pydantic args + return type) enforced by the framework. |
| **Progressive Disclosure** (Decision 15) | FR49 (L0 <150-token descriptor vs L1 hydration) | Tool-capability surfacing is handled by the LangGraph agent graph / Deep Agents tool selection, not an SST-owned disclosure layer. |
| **Agent-Orchestrator Contract** (Decision 17) | two-method ABC, HITL `pending_input`/`pending_review`, SSE status streaming, fire-and-forget | N/A — the workflows service owns the agent loop; the orchestrator↔executor seam the SST contract defined no longer exists as a cross-component boundary. |

> **Decision 11 & 13 are cross-cutting, not fully dropped** — they appear in the §2.2 "dropped anchor" column only as anchors of the *YAML Tool Registry's* env/placement (which drops). Their *general* provisions survive: Decision 11 (CPU-only `genieai=true` placement) and Decision 13 (`PII_REDACTOR_IMPL`/`SEARXNG_URL` env config, Ansible `--tags tools`) are retained across §3.1/§3.2/§4/§6.

> **Carve-out to resolve in the umbrella PRD (Open Question OQ-SST-1):** FR30 ("feed definitions are managed through the tool registry") is tagged to the now-dropped registry, but the Stream Ingestor still needs per-feed YAML persistence (URL, schedule, retention, content mapping, processing) synced to ArangoDB. Recommendation: treat feed-config storage as **ingestor config (KEEP)**, not registry. The Stream Ingestor cannot function without it. See §3.2 FR30.

## 3. The Three Surviving Capabilities

### 3.1 Web Search (SearXNG)

**Description.** A web-search tool that lets the agent reach beyond the knowledge base. Two deterministic rule-based triggers (low retrieval confidence; time-sensitive query patterns) plus an LLM-driven fallback decide *when* to search; SearXNG executes the search; a result-fusion engine merges web results with RAG retrieval under a configurable context-window budget; results carry provenance labels that render as citations in both Vue 3 and Flutter; failures degrade gracefully to RAG-only with a visible notice rather than a hard fail or a fabricated answer. SearXNG is the default backend behind a pluggable interface.

SearXNG is deployed as a **CPU-only container on a `genieai=true` node** (Decision 11). The search call is **synchronous HTTP on the request path** (Decision 6): `httpx.AsyncClient` with circuit-breaker protection, results returned within the 2-second P95 budget *including* mandatory PII redaction (NFR1). Results are parsed into the standard `ToolResult` format (`content`, `url`, `score`, `source_type="web_search"`, `retrieved_at`) and filtered through the domain whitelist configured in `web-search.yaml`. Each URL is validated as reachable and well-formed (NFR16).

**Licensing (load-bearing).** SearXNG is **AGPL-3.0**. NFR26 permits AGPL *solely* for "unmodified API-consumed services." SearXNG is consumed **purely via its HTTP API as an unmodified upstream Docker image** — no code modification, no derivative work. This exception survives the scope cut and is the only AGPL component in SST.

**Functional Requirements:**

- **FR8 — Low-confidence trigger.** When ArangoDB retrieval completes with a confidence score below the configured threshold (default **0.70**), the trigger fires and routes the query to web search.
- **FR9 — Time-sensitive trigger.** A query containing time-sensitive patterns (e.g. "current", "latest", "today", "deadline") fires the trigger **regardless of retrieval confidence**.
- **FR10 — LLM-driven fallback.** The system can invoke web search when the LLM determines the knowledge base is insufficient (LLM-driven selection, falling back to the rule-based path above).
- **FR11 — Disabled/unauthorized tools cannot fire (hard guard, survives).** Tools that are disabled or unauthorized cannot be invoked by *either* the rule-based or the LLM-driven path. This is the cross-cutting guard that ties web search to the governance layer (§3.3).
- **FR16 — Configurable backend, default SearXNG.** The search backend is configurable; SearXNG is the default.
- **FR17 — Domain whitelisting.** Results are filtered through a configurable domain whitelist (`web-search.yaml`), enforced at the executor level (NFR11 — not bypassable via backend config).
- **FR18 — Pluggable search backend interface.** The backend is behind an interface so an alternate search provider can be substituted without changing the tool surface.
- **FR19 — Result fusion (merge + score + dedupe).** Tool-execution results (web search) and RAG-retrieval results (ArangoDB) are processed by a fusion engine: scored, deduplicated by URL/content similarity, and ranked by relevance. Each result carries a `source_type` label (`"document"` or `"web_search"`) for citation rendering; the LLM prompt includes provenance (source, date, URL).
- **FR20 — Context-window budget.** The budget is allocated by configurable ratio (e.g. 60% RAG / 40% tools); when total context exceeds the window, lower-scoring results are trimmed to fit.
- **FR21 — Citations with provenance labels (KB vs external).** The system distinguishes knowledge-base sources from external web sources in every cited result.
- **FR22 — Per-deployment citation toggle.** Administrators can enable/disable citation rendering per deployment; when disabled, the response omits citation metadata.
- **FR23 — Transparent "insufficient information" response.** When neither the KB nor tool execution provides sufficient context, the system returns a transparent "insufficient information" response with guidance on alternative sources — **rather than fabricating an answer**. The canonical journey (Joseph's Missing Permit): *"I don't have current information about Class B Excavation permits… I recommend contacting the Nairobi County Building Inspectorate directly at [phone/email]."*
- **FR24 — Quality threshold.** Tool results below a minimum quality threshold are discarded before entering the LLM context. (Joseph's journey canonicalizes this: SearXNG returns results, but nothing clears the minimum quality bar → graceful degradation.)
- **FR47 — ChatQnA integration at the retrieval stage.** Web search integrates into the existing RAG pipeline **after ArangoDB retrieval and before LLM prompt construction** (in `genieai_chatqna.py`).

**Degradation path (binding).** If the trigger fires but the tool is unavailable (circuit breaker open), no tool results are available — the query proceeds with **RAG-only results and no degradation message** (the system still has KB results). If results return but fall below quality (FR24), the response carries a degradation object with `reason:"LOW_QUALITY"`, `fallback_applied:"none"`, and alternative-source guidance (FR23). See §3.1 NFR12 and Decision 7.

**Feature-specific NFRs:** NFR1 (web search ≤ **2 s P95** added latency, measured from trigger decision to result-fusion completion); NFR12 (zero hallucinated answers from tool failures — discarded/failed results must not be fabricated); NFR15 (component isolation — a SearXNG outage does not affect the Stream Ingestor or feeds); NFR16 (**>90% of cited URLs valid** and reachable at query time).

**ADRs (retained):** Decision 6 (sync HTTP on the request path), Decision 7 (degradation metadata schema + format), Decision 10 (shared citation JSON schema — the canonical citation decision), Decision 11 (CPU-only placement on `genieai=true` nodes), Decision 13 (`PII_REDACTOR_IMPL` / `SEARXNG_URL` env config).

---

### 3.2 Stream Ingestor

**Description.** A background ingestion path that keeps the corpus current by pulling from external feeds and receiving webhooks. Three source types — **RSS/Atom polling, JSON-API polling with field mapping, webhook push** — all funnel into the **existing TEI embedding pipeline**, which writes chunks into the **shared ArangoDB chunks collection** with a `source_type:"feed"` discriminator (Decision 3, load-bearing ADR). The pipeline is **source-agnostic**: the downstream embed/store path is identical regardless of source. Per-feed resilience (circuit breaker, DLQ, exponential backoff) and per-feed lifecycle (retention/TTL, update-vs-append) are first-class. The Ingestor is a producer into the current RAG corpus, **not** a parallel one.

**Shared storage rationale (Decision 3, quoted).** *"The existing graph system with ingestion and retraction is well-tested… Creating a parallel collection would duplicate graph structure, reindexing, and retrieval paths. Instead, feed-sourced chunks share the existing chunks graph vertex collection with optional metadata fields and an extended retraction service."*

**Schema extension (additive, nullable, non-breaking).** Feed chunk documents add: `source_type` (`"file"` default on existing chunks | `"feed"` new), `source_url`, `feed_id`, `expires_at` (null on file chunks). No structural change to the vector store (NFR25).

**Functional Requirements:**

- **FR25 — RSS/Atom polling.** A feed definition (type `"rss"`, URL, cron schedule, content mapping: `title_field`/`body_field`/`date_field`) is polled at the configured interval; entries are parsed and content extracted via the field mappings. On completion a `feed-ingestion-events` event is published to Redis Stream with `event_type:"poll_complete"`. (Fatima's deployment journey: national gazette + health-ministry press feeds, 2-hour polling, 90-day retention.)
- **FR26 — JSON-API polling with field mapping.** A feed definition (type `"json_api"`, URL, schedule, `content_mapping`) is polled; the JSON response is parsed and fields are mapped to the standard content model. Schema validation gate: when the response doesn't match the expected structure, the entry is routed to the dead-letter queue with `parse_error` status (FR42).
- **FR27 — Webhook push ingestion.** A POST to `/v1/tools/webhook/{feed_name}` is authenticated via **API key or JWT Bearer token** (NFR9); unauthenticated requests are rejected with **HTTP 401**. On authenticated receipt, content is extracted and routed to the TEI embedding pipeline; a `feed-ingestion-events` event with `event_type:"webhook_received"` is published. Per-feed flood protection: requests exceeding the per-feed rate limit are rejected with **HTTP 429 + `Retry-After`** (Decision 8, Redis sliding window). **Webhook ingestion is disableable per deployment** (Fatima's journey: she disables it until her deployment is ready for push-based ingestion).
- **FR28 — Route through existing TEI + ArangoDB.** Extracted feed content from any source is sent to the **existing TEI embedding service** via HTTP for vector embedding; the embedded chunk is stored in the **shared chunks collection** with `source_type:"feed"`, `source_url`, `feed_id`, `expires_at`. The embedding pipeline is source-agnostic. Embedding **must complete before storage** (Decision 6, sync HTTP).
- **FR29 — Per-feed retention / TTL / update-vs-append.** Administrators configure lifecycle policies per feed: retention period (TTL, via the nullable `expires_at` field purged by the background `retract_expired_feed_chunks` cron on a configurable interval) and `update_behavior` (`replace` | `append`) in the Feed Definition Schema.
- **FR30 — Feed-definition management (CARVE-OUT — see OQ-SST-1).** Feed definitions (YAML source-of-truth + ArangoDB sync) are managed with the same enable/disable and audit controls as other tool configurations. **Note:** the original spec tied this to the now-dropped registry; under reduced scope it is re-homed as **ingestor configuration** (KEEP) — the Stream Ingestor cannot function without per-feed persistence. Flagged for the umbrella PRD to confirm.
- **FR41 — Circuit breaker on all external calls.** Opens after **3 consecutive failures** to an external backend and auto-closes after a successful health check (states CLOSED → OPEN → HALF_OPEN → CLOSED). Per-feed: 3 consecutive poll failures open the breaker for *that feed only*; health is reported `"degraded"`; subsequent polls route to DLQ until recovery (NFR15).
- **FR42 — Failed entries → DLQ.** Failed ingestion entries are routed to a dedicated dead-letter queue (`feed-ingestion-events-dlq`) with original message + error metadata + timestamp; DLQ entries are queryable for audit.
- **FR43 — Exponential-backoff retry on recovery.** A `dlq-reprocessor` cron job drains DLQs with exponential backoff; entries failing after max retries are logged for manual review. (Samuel's Midnight Alert journey: gazette HTTP 503 → circuit opens → source recovers at 6am → breaker auto-closes → DLQ entries reprocessed chronologically.)
- **FR45 — Health endpoints consumable by monitoring.** `/health` (200 if the process is running — Docker Swarm liveness probe) and `/ready` (200 only if ArangoDB + Redis + TEI are reachable — readiness probe). Feed-level health (poll status, error count, circuit-breaker state) is queryable.

**Retraction extension (Decision 3, binding).** The existing `retract_file` handles file-scoped cleanup by `file_id` (**unchanged** — no regression). A **new** `retract_expired_feed_chunks` method purges feed chunks where `expires_at < now()` on a configurable interval (background cron, **not** inline). Both methods operate on the same chunks collection; the retraction service gets a **new method, not a new class**. It is idempotent and safe to run concurrently with file-based retraction.

**Regression guard (binding).** File-sourced chunks are unaffected by feed retraction (test-verified); mixed vector-search relevance is validated against a curated-only baseline before production.

**Feature-specific NFRs:** NFR2 (publication-to-RAG end-to-end **≤ 4 h**: feed poll → content extraction → TEI embedding → ArangoDB insertion → index propagation); NFR9 (webhook endpoints authenticate every request — unauthenticated → 401); NFR13 (breaker opens after 3 consecutive failures); NFR14 (failed entries routed to DLQ and auto-reprocessed when the source recovers); NFR15 (one feed's failure does not block others); NFR25 (stream ingestion uses the existing TEI embedding service and ArangoDB storage **without requiring schema modifications to the current vector store** — optional fields are additive, not structural); NFR27 (configurable audit/feed retention — expired entries purged per policy).

**ADRs (retained):** Decision 2 (Redis Streams topology — `feed-ingestion-events` stream + `-dlq`, with `MAXLEN` budgets ~10,000 / ~5,000; `dlq-reprocessor` cron), Decision 3 (shared chunks + `source_type` + `retract_expired_feed_chunks` — the central decision), Decision 6 (sync HTTP poll + sync embed-before-store), Decision 8 (per-feed Redis sliding-window rate limiting), Decision 12 (`/health` + `/ready`), Decision 13 (Ansible `--tags tools` deployment).

---

### 3.3 Governance (Decision 16 — REFRAMED)

**Description.** This is SST's single most important surviving capability and the **only piece of the original "foundation" Epic 1 that survives**. It is the cross-cutting layer that makes web search (and every future tool, including MCP-wrapped GovStack Building Blocks) sovereign.

**REFRAME (binding).** Under the August-2026 decision the `GovernancePipeline` (Decision 16) is **no longer wrapped around an SST-owned Tool Executor**. It is middleware wrapped around **every LangGraph tool invocation** in the GENIE workflows service (`genie-ai-overlay/workflows/tools/governance.py`). The governance substance is unchanged and binding; only the host moved. There is **no bypass path** — every tool call goes through the pipeline (NFR11).

**The pipeline (three phases, quoted from Decision 16):**

1. **PRE-EXECUTION (< 50 ms, in-process, NFR28):**
   1. **Tool Authorization** — enabled? caller's RBAC role permitted?
   2. **Parameter Validation** — args conform to the tool's schema.
   3. **PII Redaction** (mandatory guardrail) — see Decision 5 below. On failure → `ToolExecutionResult(status=denied)` (BLOCK, not log-and-continue).
2. **RUNTIME:**
   4. **Rate-limit check** — Redis sliding window (Decision 8), per-user and per-feed.
   5. **Circuit breaker** — state check pre-call (open → short-circuit to degradation).
   6. **Timeout budget** — `execution_budget_ms` per tool.
3. **POST-EXECUTION (budgeted 200 ms, async, NFR29):**
   7. **Provenance check** — result domains whitelisted? (ties to FR17.)
   8. **Audit enrichment** — `correlation_id`, governance decisions → Redis `tool-invocation-audit` stream.

**PII redaction (Decision 5 — load-bearing, non-negotiable).** A Python ABC with `async redact(text) -> str` and `detect(text) -> list[PIIEntity]`, **pluggable** via `PII_REDACTOR_IMPL=regex|presidio|http://...`. The reference implementation is **Microsoft Presidio** (library mode). Failure mode is **BLOCK** (refuse to forward unredacted content), enforcing NFR6 (zero PII leakage). This is the sovereignty guarantee that must survive every scope reduction.

**Rate limiting (Decision 8).** Redis-backed sliding-window counter with per-user and per-feed limits (also backs the webhook 429 path in §3.2 FR27).

**Functional Requirements:**

- **FR12 — PII redaction is a mandatory guardrail.** Every tool invocation's parameters and results pass through PII redaction; failure is blocking.
- **FR13 — Pluggable `PIIRedactor` interface.** The redactor is behind an ABC with a configurable implementation (`PII_REDACTOR_IMPL`); Presidio is the reference.
- **FR15 — Per-tool rate limits.** Each tool has a configurable rate limit enforced via Redis sliding window.
- **FR44 — Audit log for every invocation.** Every tool invocation records user, timestamp, tool, params (redacted), and results to the `tool-invocation-audit` stream (Decision 2).
- **FR50 — Unified governance pipeline (single insertion point).** One pipeline wraps every tool call — no per-tool ad-hoc guards, no bypass.

**Feature-specific NFRs:** NFR5 (PII redaction **≤ 100 ms P99**); NFR6 (**zero PII leakage**, verified by a PII-injection test suite); NFR7 (every invocation audit-logged); NFR10 (RBAC enforcement — only `tools-admin` may modify tool configurations); NFR11 (**domain whitelist enforced at the executor level, NOT bypassable via backend config**); NFR28 (pre-execution checks **< 50 ms**); NFR29 (post-execution checks **< 200 ms**).

**ADRs (retained, REFRAMED host):** Decision 16 (the surviving governance pipeline — REFRAMED to wrap LangGraph tools), Decision 5 (PII-redaction ABC + BLOCK-on-failure), Decision 8 (Redis sliding-window rate limiting).

## 4. Admin/UI (Vue 3 + Flutter citation parity)

**Description.** Two tiers. (1) A **Vue 3 admin** surface — integrated into the **existing** `DocumentManagement.vue` / `AdminDashboard.vue` — for tool + feed management, list-and-grant RBAC, citation + degradation rendering, audit-log viewing, and health overview. (2) A **shared citation schema** (Decision 10) consumed identically by Vue 3 (citizen + admin) and Flutter (citizen-only), so both platforms render from the same JSON with no platform-specific endpoints.

**Backend pattern (unchanged from original spec, re-targeted).** `toolsController.js` in the Node.js BFF proxies authenticated requests at `/api/tools/*` to the tool/feed config store. Under reduced scope the proxy target is the **workflows-service-owned** tool/feed config store (not an SST-owned Tool Registry), but the BFF proxy pattern and admin surface are unchanged. Only users with the `tools-admin` or `tools-reader` Keycloak role are authorized (NFR10).

**Functional Requirements:**

- **FR31 — Vue admin tool management.** List tools (name, type, status enabled/disabled, last-invocation count) with enable/disable toggles that take effect **immediately (no redeployment)**.
- **FR32 — Domain whitelist editor.** Edits are persisted to the tool-definition YAML and synced to ArangoDB (ties to FR17).
- **FR33 — Health status overview.** Each tool and feed shows green/yellow/red health with error summaries.
- **FR34 — Audit log viewer** with filtering and export (ties to FR44; backs FOI access — NFR8).
- **FR35 — Feed management in the Document Management tab.** Feed form fields (name, type `rss`/`json_api`/`webhook`, URL, schedule, retention days, content mapping), validated against the JSON Schema before submission. All ingestion management in one place (UX-DR1).
- **FR36 — Config validation with error reporting.** Submit-time JSON-Schema validation surfaces specific errors before persistence.
- **FR37 — Vue 3 citation rendering with provenance.** Each citation shows source-type icon (document vs `web_search`), title, truncated URL, and confidence indicator; provenance labels distinguish KB documents ("Uploaded document — Jan 2026") from external web sources ("Web search — retrieved today").
- **FR38 — Flutter citation rendering matching Vue 3.** Same fields (icon, title, URL, confidence); tapping opens the URL in the device browser (NFR21).
- **FR39 — Graceful-degradation messages with alternative-source guidance.** A response carrying a degradation object renders a visible, screen-reader-compatible message with `tool_id`, `reason`, and guidance text (ARIA labels on web, `Semantics` widgets on Flutter).
- **FR40 — WCAG 2.1 AA compliance**, verified by automated accessibility scan with **zero AA-level violations**.

**Shared citation schema (Decision 10, canonical — quoted).** A single JSON structure consumed identically by Vue 3 and Flutter:

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

`source_type` enables platform-specific rendering (document icon vs web-search icon vs feed icon); a confidence threshold controls display (low-confidence results hidden or marked unverified). **Both platforms render from the same schema; no platform-specific API endpoints** (NFR21). The shared degradation object (Decision 7):

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

**RBAC — two roles + list-and-grant (Decisions 4 + 9, binding).** Two Keycloak roles: **`tools-admin`** (full CRUD on tools, feeds, domain whitelist) and **`tools-reader`** (read-only access to tool/feed configs and audit logs — serves FOI auditors who need audit-log access without modification rights, NFR8). The Vue admin user-management shifts from static role checkboxes to a **list-and-grant paradigm** (Decision 9, UX-DR2): admins search users by name/email and grant/revoke individual capabilities per user, persisted to Keycloak realm roles, taking effect on next login. A `tools-reader` attempting a write is rejected with an authorization error.

**Platform split (load-bearing).** **Flutter is citizen-facing ONLY** — no admin views (tool management, feed management, user-role grants, audit-log viewer) are available. Flutter renders citations + degradation messages matching Vue 3 (FR38/FR39) and nothing more. Vue 3 serves **both** citizen and admin roles.

**Feature-specific NFRs:** NFR4 (admin API CRUD **≤ 500 ms P95**); NFR8 (FOI-accessible audit logs via `tools-reader`); NFR10 (RBAC enforcement); NFR20 (**WCAG 2.1 AA** — ARIA on web, `Semantics` on Flutter, no visual-only cues); NFR21 (Vue 3 / Flutter rendering parity).

**ADRs (retained):** Decision 4 (two-role model), Decision 9 (list-and-grant UI paradigm), Decision 10 (shared citation schema — makes parity possible), Decision 13 (Ansible `--tags tools`; YAML tool/feed config).

**Post-MVP (growth, explicitly non-blocking):** the **tool-invocation analytics dashboard** (Epic 4, Story 4.6) — aggregated metrics (invocations per tool, success/failure rates, average latency, PII-redaction hit rate), knowledge-gap intelligence (queries that triggered web search but returned low-quality results → flagged as content gaps), and per-feed ingestion analytics. Classified under Growth Features in the original spec; consumes the audit stream (NFR7/NFR8) but does not block the SST minimum viable surface.

## 5. Integration & Dependencies

**Delivered as LangGraph tools in the GENIE workflows service.** The surviving capabilities live under `genie-ai-overlay/workflows/tools/`:

- `web_search.py` — the SearXNG-backed web-search tool (§3.1).
- the **stream-ingestor service** (background poller/scheduler + webhook receiver) plus its LangGraph tool surface (§3.2). Note: the Stream Ingestor is a long-running background service *and* a tool the agent can reflect on (e.g. "list feeds", "check feed health").
- `governance.py` — the Decision-16 pipeline wrapping **every** tool call (§3.3).

**Consumed by the LangChain Deep Agents orchestrator** (`genie-ai-overlay/workflows/`) running on the OPEA `MicroService` harness (Sprint 24 #603). The orchestrator — not SST — owns the agent loop, tool selection, retries, HITL, and pause/resume.

**Reuse — no new infra (binding).** Web search and the Stream Ingestor integrate with the **existing** stack:

- **ChatQnA** — web search inserts at the retrieval stage, after ArangoDB retrieval, before LLM prompt construction (FR47, in `genieai_chatqna.py`).
- **dataprep / TEI embedding** — the Stream Ingestor routes content through the same embedding pipeline as file uploads (FR28); the pipeline is source-agnostic.
- **ArangoDB** — feed chunks share the existing chunks collection with a `source_type` discriminator (Decision 3); no new vector store, no parallel corpus.
- **Redis** — `feed-ingestion-events` + `tool-invocation-audit` streams + DLQs + sliding-window rate-limit counters (Decision 2/8).
- **Keycloak / Kong** — OIDC auth, `tools-admin`/`tools-reader` roles (Decision 4), webhook JWT/API-key auth (NFR9).

**New components (the only new infra):** a **CPU-only SearXNG container** (unmodified upstream image, AGPL exception — §3.1) and the **PII-redactor container** (Presidio reference). Both horizontally scalable (NFR19), placed on `genieai=true` nodes (Decision 11).

**Dependencies (gating):**

- **OPEA 1.5 overlay bump** — foundational; SST's Python tools land on the bumped base. Every `comps` API SST's host depends on is byte-identical/additive per the verified v1.3↔v1.5 diff, so the bump is a prerequisite, not a co-design.
- **GENIE workflows service (#603)** — SST's value is delivered *as* LangGraph tools consumed by this orchestrator. The workflows service is the host; SST is the payload. Governance (§3.3) wraps tool calls *inside* the workflows service.
- **OKF** (sibling pillar) — independent; the Stream Ingestor and OKF both extend the shared ArangoDB corpus additively and must not collide (both use additive `source_type` discriminators).

## 6. Cross-Cutting Non-Functional Requirements

These bind all three surviving capabilities (consolidated from the original SST NFR set; SST-internal IDs preserved).

**Performance:**
- **NFR1** — Web search adds **≤ 2 s P95** latency (trigger decision → result-fusion completion, including PII redaction).
- **NFR2** — Stream ingestion publication-to-RAG **≤ 4 h** end-to-end.
- **NFR4** — Admin API CRUD **≤ 500 ms P95**.
- **NFR5** — PII redaction **≤ 100 ms P99**.
- **NFR28 / NFR29** — Governance pre-execution checks **< 50 ms**; post-execution **< 200 ms**.

**Reliability:**
- **NFR12** — Zero hallucinations from tool failures (degrade to RAG-only with a visible notice; never fabricate).
- **NFR13** — Circuit breaker opens after **3 consecutive failures**, auto-closes on successful health check.
- **NFR14** — Failed ingestion entries routed to DLQ and auto-reprocessed on source recovery.
- **NFR15** — Component isolation — one pillar's failure (e.g. SearXNG outage) does not affect the others.
- **NFR16** — **> 90% of cited URLs valid** and reachable at query time.

**Scalability:**
- **NFR17** — Zero new infrastructure beyond CPU-only SearXNG + PII containers; reuses existing Redis / TEI / ArangoDB.
- **NFR18** — Redis-backed state supports horizontal scaling.
- **NFR19** — SearXNG + PII redaction horizontally scalable.

**Accessibility:**
- **NFR20** — **WCAG 2.1 AA** (ARIA on web, `Semantics` on Flutter; no visual-only cues).
- **NFR21** — Vue 3 / Flutter rendering parity from the shared citation schema.

**Compliance / Sovereignty:**
- **NFR6** — Zero PII leakage (verified by PII-injection test suite; BLOCK-on-failure redaction).
- **NFR7** — Every tool invocation audit-logged.
- **NFR8** — FOI-accessible audit logs (via `tools-reader`).
- **NFR9** — Webhook endpoints authenticate every request (API key / JWT Bearer); unauthenticated → 401.
- **NFR10** — RBAC enforcement (`tools-admin` for mutation).
- **NFR11** — Domain whitelist enforced at the executor level, **NOT bypassable** via backend config.
- **NFR25** — Stream ingestion reuses existing TEI + ArangoDB storage without schema modification (additive fields only).
- **NFR26** — DPG permissive licensing; **AGPL tolerated solely for unmodified API-consumed services** (the SearXNG exception — §3.1).
- **NFR27** — Configurable audit/feed retention; expired entries purged per policy.
- **NFR30 (i18n)** — Every admin-surface string, citation-rendering field, and graceful-degradation message is **internationalized** (English = source of truth; `vue-i18n` keys across all active locales) — Genie's multilingual mandate, parity with OKF FR-26.
- **NFR31 (observability)** — Tool invocations + the governance pipeline (pre/intra/post-execution phases) emit **OTel spans** with W3C `traceparent` propagation into the workflows-service tracing — do NOT assume inheritance; the three governance phases are the natural span boundaries (umbrella PRD §4).
- *(Traceability: NFR3 / NFR22–24 were registry/executor-scoped and drop with Epic 1 — not omitted in error.)*

**ADRs that bind across pillars:** Decision 2 (Redis Streams topology — `tool-invocation-audit`, `feed-ingestion-events` + DLQs, with `MAXLEN` budgets), Decision 11 (CPU-only `genieai=true` placement), Decision 12 (`/health` + `/ready` endpoints), Decision 13 (Ansible `--tags tools` deployment).

## 7. Sequencing & Dependencies

SST lands **after** the OPEA 1.5 bump and **in parallel** with the agentic layer and OKF (it is the agentic layer's tool payload):

```
0. OPEA 1.5 overlay bump (~3–5 days; foundational, gates the Python surface)
   ├─ 1. Agentic layer — Deep Agents on the OPEA MicroService harness      ┐ parallel
   ├─ 2. SST tools — web search + stream ingestor + governance             ┘ (this PRD)
   └─ 3. OKF Phase 1 — multi-graph fan-out + graph_name (greenfield)
        → #604 ChatQnA refactor
        → #603 agentic on the custom LangChain Deep Agents layer
        → Sprint 25: #606 GovStack BB integrations (real MCP servers)
```

**Critical sequencing constraints:**

- **Governance (§3.3) + web search (§3.1) must land before #603** — the agentic layer cannot go live without the PII/circuit-breaker/rate-limit/audit wrapper around tool calls (NFR6 is non-negotiable) and without the web-search tool wired into the retrieval stage (FR47).
- The Stream Ingestor may land slightly later than web search (it has no synchronous dependency on #603 — it is a background producer into the shared corpus) but must clear the regression guard (file-chunk isolation; mixed vector-search relevance baseline) before production.
- The OPEA 1.5 bump, OKF Phase 1, and #604 all touch `genieai_chatqna.py` / retriever / dataprep; sequence them in that order and align with jrevillard (his modules).

**Issue re-baselining (GitLab #696–#725).** Per the August-2026 decision, the SST issue graph is re-baselined to the reduced scope:

- **Epic 1 issues (registry, executor, orchestrator contract, progressive disclosure, `mcpo`)** → **close as "subsumed by LangGraph in the workflows service."** Dependency edges pointing at Decisions 14/15/17 and the registry are voided.
- **Epic 2/3/4 issues (web search, stream ingestor, admin/UI)** → **retain**, with the Decision-16 governance middleware added as a cross-cutting dependency on every tool-call issue.
- **OQ-SST-1 (FR30 carve-out)** must be resolved in the umbrella PRD before the feed-config issue is re-pointed (registry-drop vs ingestor-config-keep).

## 8. References

- **Umbrella PRD** — [`./prd-agentic-enablement.md`](./prd-agentic-enablement.md)
- **Decision doc (OPEA 1.5 bump + agentic layer)** — [`../OPEA-1.5-upgrade-analysis.md`](../OPEA-1.5-upgrade-analysis.md)
- **Team briefing** — [`../team-briefing-agentic-enablement.md`](../team-briefing-agentic-enablement.md)
- **OKF PRD (sibling pillar)** — [`./prd-okf-server-2026-07-15/prd.md`](./prd-okf-server-2026-07-15/prd.md)
- **Original SST spec (historical, retained on branch)** — `feat/server-side-tools/prd`: `_bmad-output/planning-artifacts/{prd.md, architecture.md, epics.md}` + `team-briefing-server-side-tools-roadmap.md` (PRD + 17 ADRs + Epics 1–4; the auditable design record this PRD reduces)
- **GitLab issues** — #696–#725 (to be re-baselined per §7)
- **Workflows-service tool paths** — `genie-ai-overlay/workflows/tools/{web_search,governance}.py` + the stream-ingestor service (structure per decision doc §3)

## 9. Open Questions

1. **OQ-SST-1 — FR30 feed-config storage carve-out.** Is feed-config persistence "registry" (drops with Epic 1) or "ingestor config" (keeps with §3.2)? Recommendation: **KEEP as ingestor config** — the Stream Ingestor cannot function without per-feed YAML persistence, retention config, and the `feed-ingestion-events` stream. Resolve in the umbrella PRD.
2. **Branch location of the original SST spec.** Leave on `feat/server-side-tools/prd` as historical record + cross-reference (recommended — preserves the reviewed 17-ADR design tied to #696–#725), or port/reduce in-tree on `feat/agentic-enablement`? This PRD is written to be authoritative either way.
3. **Web search + #603 ordering.** Confirm governance + web search are hard blockers for #603 go-live (assumed yes — NFR6).
4. **Mixed vector-search relevance baseline.** What curated-only baseline validates feed-chunk relevance before production? (Regression guard, §3.2.)
5. **SearXNG AGPL review.** Confirm the legal sign-off that NFR26's "unmodified API-consumed" exception covers the SearXNG upstream image is recorded (it is the only AGPL component in SST).
6. **OQ-SST-6 — `source_type` enum ownership (cross-pillar).** SST writes `source_type:"feed"` (Decision 3) and OKF writes `source_type:"okf"` (OKF FR-6 / ADR-okf-010) into the **same** chunk-metadata field, which does not exist yet in either codebase. One agreed enum with one owner is required, or the two pillars will ship divergent vocabularies into a shared collection. Recommendation: whichever pillar lands first declares the enum in `genie-ai-overlay/core/`; the other extends it. **Gate:** Stream Ingestor start (§3.2).
7. **OQ-SST-7 — SSE metadata contract ownership.** Citations (FR21/22/37/38), the degradation object (FR39), and `source_type` all have to cross a hardcoded field whitelist in the BFF (`components/gov-chat-backend/routes/query-routes.js:322-327`) that today forwards only `source_documents`, `confidence_score`, `is_grounded` — see E3. Extend it ad-hoc per field, or promote it to a declared contract shared by Vue and Flutter? **Gate:** Web Search start (§3.1).
8. **OQ-SST-8 — tool-host boundary.** Confirm SST builds only the minimum `MicroService` shell needed to host and invoke governed tools, and that the LangGraph graphs, MCP client, ArangoDB checkpointer, and HITL gates remain #603's scope (decision doc Part B). **Gate:** Governance start (§3.3).

## 10. Errata — spec vs. implemented reality (2026-08-17)

Recorded after a code audit of `feat/sst`. Each item invalidates an FR or Decision **as literally written**; the capability intent is unchanged in every case. Where this section conflicts with §3/§4, this section is authoritative.

### E1 — `DocumentManagement.vue` does not exist (affects FR35, §4)

§4 says the admin surface integrates into "the existing `DocumentManagement.vue` / `AdminDashboard.vue`". There is no `DocumentManagement.vue`. Document Management is the `documents` tab **inside** `components/gov-chat-frontend/src/components/AdminDashboard.vue` — a single 4446-line Options-API component (tab list at `:1623-1632`, panel markup at `:389-572`).

**Correction:** FR35 targets a new tab in `AdminDashboard.vue`. Follow the `components/gov-chat-frontend/src/components/admin/QueryInspector/` sub-tree pattern (the only precedent for extracting from the monolith) and create `components/admin/Tools/` rather than growing the 4446-line file. Note the design system (`components/ds/`) has no Checkbox, Toggle, or Table primitive.

### E2 — there are no "static role checkboxes" to replace (affects Decision 9, §4)

Decision 9 frames list-and-grant as replacing "static role checkboxes" in user management. No such control exists. Today `AdminDashboard.vue` renders roles as **read-only text** (`:1437`) and the Actions column is a **deep link out to the Keycloak admin console** (`:1440-1449`, `getUserManageUrl` `:2463-2468`).

**Correction:** Decision 9 replaces the read-only role column plus external deep link with in-app grant/revoke. The search half already exists and is reusable (`services/admin-dashboard-service.js:1050-1173` → `GET admin/users/search`); only the grant/revoke half is net-new. Write to Keycloak via `services/keycloak-proxy-service.js:105` `_adminApiCall` — the `genie-proxy-client` service account **already holds `manage-users`** (`configs/keycloak/genie-realm.yaml:87-98`). Never write `roles` into ArangoDB: it is JIT-protected (`constants/jit-fields.js:19-36`), so grants take effect on next login, as Decision 9 already assumes.

### E3 — citations and degradation cannot reach either client (affects FR21, FR22, FR37, FR38, FR39, NFR21)

The BFF's SSE relay whitelists metadata fields by name at `components/gov-chat-backend/routes/query-routes.js:322-327`, forwarding exactly `source_documents`, `confidence_score`, `is_grounded`. Anything else the ChatQnA emits is silently dropped — `retrieval_confidence_score` is **already being lost this way today**. Vue and Flutter therefore cannot receive `source_type`, `retrieved_at`, or the degradation object no matter what §4's shared schema specifies.

**Correction:** the whitelist is the single insertion point and must be extended **once**, not per consumer. Downstream, add the fields to the Vue SSE demux (`src/services/chatbotService.js:101-120`) and the Flutter parser (`lib/components/chat/chatbot_component.dart`, non-stream `:686-701`, stream `:474-607`). A new SSE *event type* (as opposed to a new metadata field) additionally needs a `case` in both demuxers. See OQ-SST-7.

### E4 — `source_type` does not exist on chunks (affects Decision 3, FR28, NFR25)

Decision 3 describes the feed-chunk fields as an additive extension of existing chunk metadata. The field set today is `{file_id, file_path, chunk_index, chunk_labels}` (plus `chunk_text` when `CONTEXTUAL_RETRIEVAL_ENABLED`), built at `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py:1296-1307`. **There is no `source_type` anywhere in the repository**, so the "`"file"` default on existing chunks" in §3.2 has no current writer.

**Correction:** the extension is still additive and non-breaking, but it is net-new on three surfaces — the dataprep writer, the retriever passthrough (`genie-ai-overlay/retriever/genieai_retriever_arangodb.py`), and backfill/default semantics for chunks already in the collection. Chunks are written indirectly via `langchain-arangodb`'s `add_graph_documents` (`:1176-1188`), so only the langchain `Document.metadata` payload is under our control. Cross-pillar collision with OKF: see OQ-SST-6.

### E5 — rate limiting, circuit breaking, and Redis Streams are greenfield (affects Decisions 2 and 8, FR15, FR41, FR42, FR43, FR44)

Decisions 2 and 8 read as configuration of existing infrastructure. None of it exists: no `XADD`/`XREADGROUP`/consumer groups anywhere, no `express-rate-limit`, no Kong `rate-limiting` plugin, no `opossum` or any circuit-breaker implementation in Python or Node. The only real Redis client in the repo is `components/gov-chat-backend/services/translation-service.js:3` (`ioredis`, plain get/setEx cache).

**Correction:** treat all three as primitives to build, not integrations to configure. Useful prior art: `translation-service.js` for Redis client wiring and degrade-gracefully-when-Redis-is-down behaviour; `_run_guardrail` (`genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py:446-455`) for a fail-closed external call with an explicit timeout — the exact shape the governance BLOCK path needs. `genie-ai-overlay/tests/conftest.py:254` already provides an unused `mock_redis` factory fixture; reuse it rather than adding another.

### E6 — FR47 has two insertion seams, not one (affects FR47, FR19, FR23, FR24)

FR47 specifies one integration point "after ArangoDB retrieval and before LLM prompt construction". `genieai_chatqna.py` has **two** such seams, because five `add_remote_service*` pipeline shapes exist:

- `:1307-1309` — the RERANK branch of `align_outputs`, where reranked docs become the LLM input string. The primary seam.
- `:1183-1223` — the no-rerank mirror, used by `add_remote_service_without_rerank` (`:1840`).

**Correction:** patching only `:1307` leaves a live pipeline shape without web search. Two further hazards in the same path: the abstention fork at `:1296` currently keys off `not docs` and must account for web results before abstaining (FR23); and `_assemble_source_documents` (`:1512-1660`) has an unconditional `continue` at `:1575-1582` for any document absent from `file_id_pairs`, which would **silently drop every web result** from the citation payload (FR21). The per-document dict is built at `:1629-1638`.

### E7 — file and reference hygiene

- This PRD was committed with an assistant's chat wrapper intact: a preamble line, a ` ```markdown ` fence wrapping the entire document, and trailing meta-commentary. Frontmatter began at line 4, so no tool could parse `prd_key`/`initiative`. **Fixed 2026-08-17.**
- Frontmatter `branch:` said `feat/agentic-enablement`, which exists on no remote. **Corrected to `feat/sst`** (see commit `d6d6f934a` for why the pillar branch is not `feat/server-side-tools`). The umbrella PRD carries the same stale value.
- The umbrella PRD's links to the OKF PRD and to `docs/adr/okf-001..016` are **broken on `feat/sst`** — those artifacts live on `origin/feat/okf-server`. Reading the initiative end-to-end requires both branches or a worktree.
- The OKF PRD's `depends_on` and glossary still describe SST as providing "Registry / ToolExecutor / Stream-Ingestor / mcpo". It predates the August-2026 decision (§2.2) and needs reconciling by the OKF owner.

### Confirmed-as-specified (audited, no correction needed)

- `ServiceType.WEB_RETRIEVER = 14` already exists (`genie-ai-overlay/core/constants.py:31`) — available if web search ever becomes a graph node rather than an inline call.
- Placement on CPU `genieai=true` nodes (Decision 11) matches the existing convention (`docker-compose.yaml`: frontend, redis-cache, backend, document-repository, arango all constrained there). Note the OPEA services currently sit on `gpu`, not `genieai`.
- Flutter has no admin surface to remove — component directories are exactly `auth/`, `chat/`, `settings/`, `shared/`, `sidebar/`, `user/`. The §4 platform split holds as written.
- Two PII-redaction key sets already exist for telemetry scrubbing (`components/gov-chat-backend/tracing-pii.js:4-6`, `genie-ai-overlay/tracing.py:39`). Decision 5's request-path redactor is correctly net-new, but should extend these rather than define a third vocabulary.

### Implementation gates this errata adds

| Item | Blocks | Owner |
|---|---|---|
| E3 whitelist extension | any citation or degradation FR reaching a client | BFF owner |
| E4 `source_type` enum agreed with OKF | Stream Ingestor ingestion path | SST + OKF |
| E6 both seams patched + abstention + `file_id` gap | Web Search production | ChatQnA owner (jrevillard) |
| `ServiceType.WORKFLOW=101` from the OPEA 1.5 bump | tool-host shell only | jrevillard |