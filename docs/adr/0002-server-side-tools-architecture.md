# ADR 0002: Server-Side Tools (SST) — Architecture and Integration Strategy

- **Status**: Proposed
- **Date**: 2026-08-18
- **Decision owners**: Adem (implementer), Jerome Revillard (architect)
- **PRD reference**: `_bmad-output/planning-artifacts/prds/prd-server-side-tools.md`

## Context

GENIE.AI's RAG pipeline (query → embedding → retrieval → reranking → LLM) is a fixed linear chain. Users and administrators need the system to perform **additional actions** beyond document retrieval: searching the live web, ingesting streaming content (RSS feeds), and governing tool execution with audit trails and access controls.

The upstream OPEA framework (v1.3, currently deployed) does not provide a native tool-calling or agent-loop abstraction. An upgrade to OPEA 1.5 (which introduces `AgentQnA`) is a separate initiative. SST must therefore integrate **within the current architecture** without waiting for that upgrade.

### Key constraints

1. **No agent loop yet** — tools run as pipeline-fused augmentations, not autonomous LLM-decided tool calls.
2. **Sovereign deployment** — all tool backends (SearXNG, stream ingestor) run within the same Docker Swarm; no external SaaS dependencies.
3. **DPG compliance** — tool outputs must be auditable; PII must not leak through tool invocations.
4. **Existing auth model** — Keycloak OIDC with realm roles; new capabilities must integrate via the same mechanism.

## Decisions

### Decision 1: Tool execution model — pipeline fusion, not agent loop

Tools are invoked **deterministically by the pipeline**, not by the LLM deciding to call them. The ChatQnA orchestrator (`genieai_chatqna.py`) receives a `tools` list in the query payload and runs each tool's output as additional context injected before the LLM prompt.

**Rationale**: An LLM-driven agent loop (ReAct / tool-use) requires OPEA 1.5's `AgentQnA` or a custom loop. This is deferred. Pipeline fusion is simpler, predictable, and auditable — the admin controls which tools are active, not the LLM.

**Future path**: When OPEA 1.5 lands, tools registered here become available to the agent loop via a thin adapter (the tool schemas are already designed with `name`, `description`, `parameters` — compatible with OpenAI function- calling format).

### Decision 2: SearXNG as the web search backend

Web search uses **SearXNG** (self-hosted metasearch engine) rather than commercial APIs (Google, Bing, Brave).

**Rationale**:

- Sovereign: runs inside the Swarm, no API keys or billing.
- DPG-aligned: open-source (AGPL-3.0), no data exfiltration.
- Aggregates multiple upstream engines; result quality is comparable.
- Already containerized; configuration via `configs/searxng/settings.yml`.

**Integration point**: `genie-ai-overlay/workflows/tools/web_search.py`wraps the SearXNG `/search` JSON API. Results are formatted as context chunks and injected into the LLM prompt by `fusion.py`.

### Decision 3: Stream Ingestor — polling-based RSS service

A new background microservice (`genieai_stream_ingestor.py`) continuously polls RSS/Atom feeds defined in an ArangoDB `feeds` collection, converts entries to base64 content, and pushes them through the existing Dataprep ingestion endpoint (`/v1/dataprep/ingest_file`).

**Key design choices**:

| Aspect | Decision | Rationale |
| --- | --- | --- |
| Trigger model | Polling with per-feed intervals | Simpler than webhooks; RSS is pull-based by nature |
| Failure handling | Exponential backoff circuit breaker per feed | Prevents a broken feed from blocking others |
| Content expiry | `expiresAt` field on chunks + periodic retraction AQL | Streaming content is ephemeral; stale chunks must be pruned |
| Deduplication | `feedparser.entry.id` + SHA256 content hash | Avoids re-ingesting identical entries across polls |
| Containerization | Standalone Python service, own Dockerfile | Isolated lifecycle; can scale independently |

**Retraction loop**: The ingestor periodically runs an AQL query to find chunks where `expiresAt < NOW()` and deletes them via Dataprep's retract endpoint. This keeps the vector store fresh without manual intervention.

### Decision 4: Admin governance via Node.js BFF (not direct OPEA access)

Tool configuration (feeds CRUD, SearXNG connection testing) is managed through the existing **Node.js backend** (`gov-chat-backend`), not by exposing OPEA Python services directly to the admin UI.

**Rationale**:

- Consistent auth: admin routes are already gated by Keycloak + `requireAdmin`.
- Audit trail: all mutations flow through the BFF's logging/tracing.
- Decoupling: the Vue frontend only talks to one API surface.

**New backend components**:

- `services/tools-service.js` — CRUD for the `feeds` ArangoDB collection.
- `routes/tools-routes.js` — REST endpoints for feed management + SearXNG proxy test endpoint.
- DB migration `005-create-feeds-collection.js` — creates the `feeds`collection with schema validation.

### Decision 5: Role-based access — `tools-admin` and `tools-reader`

Two new Keycloak realm roles control tool management access:

| Role | Capabilities |
| --- | --- |
| `tools-admin` | Full CRUD on feeds, configure SearXNG, manage tool settings |
| `tools-reader` | View-only access to tool configuration and status |

These roles are defined in `configs/keycloak/genie-realm.yaml` and can be assigned from the Admin Dashboard UI via the Keycloak Admin API proxy (`keycloak-proxy-service.js`).

**Rationale**: Separating tool management from the existing `admin` role allows delegated administration — a team lead can manage feeds without having full system admin access.

### Decision 6: Citation rendering — frontend parsing, not backend annotation

Inline citations in LLM responses (e.g., `[1]`, `[2, 3]`) are parsed and rendered as clickable superscript links **in the Vue frontend**(`ChatBotComponent.vue`), not annotated by the backend or LLM.

**Rationale**:

- The LLM already emits bracket-number citations naturally when given numbered context chunks.
- Frontend regex parsing (`/\[((?:\d+)(?:,\s*(?:\d+))*)\]/g`) is simpler and more robust than post-processing the LLM stream server-side.
- Citations link to the `source_documents` metadata already returned in the SSE stream's `onMetadata` event.

### Decision 7: CI/CD — stream ingestor follows the existing build/scan/promote pattern

The new `stream-ingestor` service is integrated into the GitLab CI pipeline using the same 3-stage pattern established in ADR 0001:

```
build:stream-ingestor → scan:stream-ingestor → promote:stream-ingestor
```

No new CI patterns were introduced. The service uses the existing `build_template`, `scan_template`, and `promote_template` anchors.

## Alternatives Considered

| Alternative | Status |
| --- | --- |
| LLM-driven tool calling (ReAct loop) | Deferred to OPEA 1.5 upgrade |
| Commercial search APIs (Google/Bing) | Rejected — sovereignty violation, recurring costs |
| Webhook-triggered ingestion (vs polling) | Rejected — RSS is inherently pull-based; webhooks add complexity |
| Tool config via OPEA Python admin API | Rejected — bypasses BFF auth/audit, fragments API surface |
| Backend-side citation annotation | Rejected — adds latency to streaming; LLM output is already citation-formatted |
| Single `admin` role for tools | Rejected — violates least-privilege; not all admins need tool config access |

## Consequences

### Positive

- Tools are usable **today** without waiting for OPEA 1.5.
- SearXNG and stream ingestor are fully sovereign (no external dependencies).
- Role separation enables delegated tool administration.
- Citation UX improves chat trustworthiness without backend changes.
- All new services follow established CI/CD patterns (ADR 0001).

### Negative

- Pipeline-fused tools are less flexible than LLM-driven tool calling.
- SearXNG result quality depends on upstream engine availability.
- Polling-based ingestion has inherent latency (bounded by poll interval).
- Two new roles add Keycloak configuration complexity.

### Mitigations

- Tool schemas are forward-compatible with OpenAI function-calling format.
- SearXNG is configured with multiple fallback engines.
- Default poll interval is 3600s; admins can tune per feed.
- Role assignment is integrated into the existing Admin Dashboard UI.

## File Manifest

### New files

| File | Purpose |
| --- | --- |
| `genie-ai-overlay/workflows/tools/web_search.py` | SearXNG search wrapper |
| `genie-ai-overlay/workflows/tools/fusion.py` | Tool output fusion into RAG context |
| `genie-ai-overlay/workflows/tools/governance.py` | Tool execution governance/audit |
| `genie-ai-overlay/workflows/tools/pii_redactor.py` | PII filtering for tool outputs |
| `genie-ai-overlay/workflows/tools/redis_primitives.py` | Redis caching for tool results |
| `genie-ai-overlay/stream_ingestor/` | Stream ingestor service (Python + Dockerfile) |
| `genie-ai-overlay/core/source_type.py` | Source type enum (file, rss, web) |
| `configs/searxng/settings.yml` | SearXNG instance configuration |
| `components/gov-chat-backend/services/tools-service.js` | Feed CRUD service |
| `components/gov-chat-backend/routes/tools-routes.js` | Feed + SearXNG REST endpoints |
| `components/gov-chat-backend/scripts/migrations/005-create-feeds-collection.js` | DB migration |
| `components/gov-chat-frontend/src/views/AdminToolsView.vue` | Tools admin UI |
| `components/gov-chat-frontend/src/store/modules/tools.js` | Vuex tools state |

### Modified files

| File | Change |
| --- | --- |
| `genie-ai-overlay/chatqna/genieai_chatqna.py` | Tool dispatch in ChatQnA orchestrator |
| `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py` | Accept `sourceType`/`feedId`/`expiresAt` metadata |
| `genie-ai-overlay/dataprep/genieai_dataprep_microservice.py` | Pass-through feed metadata to ingestion |
| `components/gov-chat-backend/index.js` | Register tools-service and tools-routes |
| `components/gov-chat-backend/routes/admin-routes.js` | User role assignment endpoints |
| `components/gov-chat-backend/services/keycloak-proxy-service.js` | `assignRealmRole` / `removeRealmRole` |
| `components/gov-chat-backend/services/admin-dashboard-service.js` | Role assignment service methods |
| `components/gov-chat-frontend/src/components/AdminDashboard.vue` | Tools sidebar link + role modal |
| `components/gov-chat-frontend/src/components/ChatBotComponent.vue` | Citation rendering in markdown |
| `components/gov-chat-frontend/src/router.js` | `/admin/tools` route |
| `components/gov-chat-frontend/src/store/index.js` | Register tools Vuex module |
| `configs/keycloak/genie-realm.yaml` | `tools-admin` / `tools-reader` roles |
| `docker-compose.yaml` | Stream ingestor + SearXNG service definitions |
| `.gitlab-ci.yml` | Stream ingestor build/scan/promote jobs |
| `deploy/ansible/deploy.yml` | Stream ingestor deployment task |

## References

- PRD: `_bmad-output/planning-artifacts/prds/prd-server-side-tools.md`
- ADR 0001: `docs/adr/0001-gitlab-registry-build-scan-pipeline.md` (CI pattern)
- SearXNG docs: https://docs.searxng.org/