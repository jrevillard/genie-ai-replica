---
title: Architecture — GENIE.AI Server-Side Tools (SST)
status: draft
created: 2026-08-17
updated: 2026-08-17
prd: ./prds/prd-server-side-tools.md
initiative: agentic-enablement
branch: feat/sst
authors: Genie.ai Dev
---

# Architecture: GENIE.AI Server-Side Tools (SST)

> Companion to the [SST PRD](./prds/prd-server-side-tools.md). The PRD says *what* SST ships; this document says *where the code lives, which container runs it, and which decisions are binding*. It supersedes the PRD frontmatter's earlier claim that architecture was "consolidated into this PRD".
>
> Decisions **1–17** are the original SST ADRs on `feat/server-side-tools/prd`. Of those, **2, 3, 5–13, 16** survive the August-2026 scope reduction and are restated here as binding constraints (§3). Decisions **18–26** are new, forced by the code audit recorded in [PRD §10 Errata](./prds/prd-server-side-tools.md).

## 1. Scope of this document

Covers SST's three capabilities (web search, stream ingestor, governance), the admin surface, and the **minimum tool host** they run inside. Does **not** cover the agent loop — LangGraph graphs, the MCP client, the ArangoDB checkpointer, and HITL gates belong to the agentic layer (#603, decision doc Part B).

Assumes the **OPEA 1.5 overlay bump** lands separately (jrevillard's modules). One hard coupling: `ServiceType.WORKFLOW = 101` (§6).

## 2. Component map

### 2.1 The container problem, and how it is resolved

The PRD asserts two things that cannot both be literally true:

- Web search is delivered as `genie-ai-overlay/workflows/tools/web_search.py` (§3.1, §5).
- Web search integrates **inside `genieai_chatqna.py`**, after retrieval and before prompt construction (FR47).

`chatqna` and `workflows` are separate containers. Making chatqna reach a workflows-hosted tool means an extra network hop inside a 2-second P95 budget (NFR1) that already has to absorb PII redaction. **Decision 26 (§4)** resolves this: the implementation lives in a new shared package `genie-ai-overlay/tools/`, COPY'd into both images the way `core/` and `tracing.py` already are; `workflows/tools/web_search.py` is a thin `@tool` wrapper over it. One implementation, two call sites, no extra hop.

### 2.2 New code

| Path | Purpose | Runs in |
|---|---|---|
| `genie-ai-overlay/tools/schemas.py` | Pydantic `Citation`, `Degradation`, `ToolResult`, `ChunkSourceType` — the repo's first declared citation contract (D24, D21) | chatqna + workflows |
| `genie-ai-overlay/tools/governance.py` | The three-phase pipeline (D16, reframed) | chatqna + workflows |
| `genie-ai-overlay/tools/pii.py` | `PIIRedactor` ABC + regex, Presidio, and HTTP implementations (D5) | chatqna + workflows |
| `genie-ai-overlay/tools/redis_primitives.py` | Sliding-window rate limiter, circuit breaker, audit-stream writer (D2, D8) | chatqna + workflows |
| `genie-ai-overlay/tools/searxng_client.py` | SearXNG HTTP client behind a pluggable backend interface (FR16, FR18) | chatqna + workflows |
| `genie-ai-overlay/tools/fusion.py` | Result fusion, dedupe, context-window budget, quality threshold (FR19, FR20, FR24) | chatqna |
| `genie-ai-overlay/workflows/__init__.py` | Package marker | workflows |
| `genie-ai-overlay/workflows/genieai_workflows_microservice.py` | comps `MicroService` shell — `/health`, `/ready`, OTel init (D12, D18) | workflows |
| `genie-ai-overlay/workflows/config.py` | env-driven config | workflows |
| `genie-ai-overlay/workflows/tools/web_search.py` | `@tool` wrapper over `tools/searxng_client.py` | workflows |
| `genie-ai-overlay/workflows/Dockerfile-workflows_genie-ai` | 7th copy of the overlay vendoring pattern | build |
| `genie-ai-overlay/stream_ingestor/` | Poller/scheduler, webhook receiver, DLQ reprocessor (§3.2) | stream-ingestor |
| `components/gov-chat-backend/routes/tools-routes.js` | `/api/tools/*` BFF proxy | backend |
| `components/gov-chat-backend/services/tools-service.js` | Tool/feed config access + audit queries | backend |
| `components/gov-chat-frontend/src/components/admin/Tools/` | Admin sub-tree (E1: QueryInspector pattern, **not** the monolith) | frontend |

### 2.3 Extended code

| Path | Change | Ref |
|---|---|---|
| `genie-ai-overlay/chatqna/genieai_chatqna.py` | Web-search hook at **both** `align_outputs` seams via one helper; abstention fork; citation assembly | D22, E6 |
| `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py` | `source_type`/`source_url`/`feed_id`/`expires_at` on the chunk payload; new `retract_expired_feed_chunks` **method** (not a new class) | D3, D21, E4 |
| `genie-ai-overlay/retriever/genieai_retriever_arangodb.py` | Pass the new chunk metadata through to results | E4 |
| `genie-ai-overlay/core/constants.py` | `ServiceType.WORKFLOW = 101` (arrives with the bump) | §6 |
| `components/gov-chat-backend/routes/query-routes.js` | **Extend the SSE metadata whitelist at `:322-327`** | D20, E3 |
| `components/gov-chat-backend/middleware/keycloak-auth-middleware.js` | Add parameterised `requireRole(...)` | D4, E2 |
| `components/gov-chat-backend/services/keycloak-proxy-service.js` | Realm-role grant/revoke over `_adminApiCall` | D9, E2 |
| `components/gov-chat-backend/index.js` | One `ROUTE_CONFIGS` entry at `:462-496` | E7 |
| `components/gov-chat-frontend/src/services/chatbotService.js` | SSE demux for the new metadata | D20 |
| `components/gov-chat-frontend/src/components/AdminDashboard.vue` | One new tab entry + panel delegating to `admin/Tools/` | E1 |
| `mobile/genie_ai_mobile/lib/components/chat/` | Citation + degradation rendering parity | FR38, FR39 |
| `configs/keycloak/genie-realm.yaml` | `tools-admin`, `tools-reader` realm roles | D4 |
| `api-gateway-solution/new-config/kong_config.json` | `/api/tools` route | E7 |
| `docker-compose.yaml`, `env`, `deploy/ansible/templates/env.j2`, `deploy/ansible/deploy.yml` | SearXNG + Presidio + stream-ingestor services; SST env section; `--profile tools`; `--tags tools` | D11, D13 |
| `tests/config-validator/` | New env vars accounted for | E7 |

### 2.4 Reused unchanged (binding — no new infrastructure, NFR17)

Redis (`redis-cache`), TEI embedding, ArangoDB, Keycloak, Kong, the OTel/Victoria/Grafana stack, and the existing `dataprep` ingestion pipeline. The **only** new containers are CPU-only SearXNG, the Presidio redactor, and the stream-ingestor.

## 3. Retained ADRs (binding constraints)

| ADR | Constraint |
|---|---|
| **D2** — Redis Streams topology | `feed-ingestion-events` (+`-dlq`) and `tool-invocation-audit` streams with `MAXLEN` budgets ~10,000 / ~5,000; a `dlq-reprocessor` cron drains DLQs. **All greenfield** — see E5. |
| **D3** — shared chunks collection | Feed chunks share the existing chunks vertex collection with a `source_type` discriminator. No parallel corpus, no new vector store. Retraction gains a **method**, not a class. |
| **D4** — two-role model | `tools-admin` (full CRUD) and `tools-reader` (read-only, serves FOI auditors per NFR8). |
| **D5** — PII redaction | ABC with `async redact(text)` / `detect(text)`, pluggable via `PII_REDACTOR_IMPL=regex\|presidio\|http://...`. Presidio is the reference. **Failure mode is BLOCK**, never log-and-continue. Non-negotiable (NFR6). |
| **D6** — synchronous HTTP on the request path | Web search is a sync call inside the 2s budget; feed embedding completes **before** storage. |
| **D7** — degradation metadata schema | The `degradation` object (`tool_id`, `reason`, `fallback_applied`, `message`) travels with the response. |
| **D8** — Redis sliding-window rate limiting | Per-user and per-feed; also backs the webhook 429 + `Retry-After` path. Greenfield — E5. |
| **D9** — list-and-grant admin UI | Search users, grant/revoke individual capabilities, persisted to Keycloak realm roles, effective next login. **Reframed by E2.** |
| **D10** — shared citation JSON schema | One contract rendered identically by Vue 3 and Flutter. No platform-specific endpoints (NFR21). |
| **D11** — CPU-only placement | SearXNG and Presidio on `node.labels.genieai == true`. |
| **D12** — health endpoints | `/health` (liveness: process up) and `/ready` (readiness: ArangoDB + Redis + TEI reachable). |
| **D13** — config + deployment | YAML tool/feed config, `PII_REDACTOR_IMPL` / `SEARXNG_URL` env, Ansible `--tags tools`. |
| **D16** — unified governance pipeline | One insertion point wrapping every tool call. **No bypass path** (NFR11). Reframed to wrap LangGraph tools instead of an SST-owned executor. |

Dropped with Epic 1 and **not to be re-specified**: D1, D14 (canonical tool contract), D15 (progressive disclosure), D17 (agent-orchestrator contract). See PRD §2.2.

## 4. New decisions (code-forced)

### D18 — SST builds the tool host shell only

`genie-ai-overlay/workflows/` gets the comps `MicroService` shell, `config.py`, and the `tools/` wrappers. It does **not** get `orchestrator.py`, `state.py`, `nodes.py`, `graphs/`, `mcp_tools.py`, or `checkpoint_arango.py` — those are #603.

*Why:* governance is a hard gate **for** #603. Building the agent loop in order to test governance inverts the dependency and blocks the gate on the thing it gates. Gated by OQ-SST-8.

### D19 — Governance is an in-process library, not a service

`tools/governance.py` is imported by tool modules. The PII redactor may be remote (`PII_REDACTOR_IMPL=http://...`), but the pipeline itself never crosses a network boundary.

*Why:* NFR28 budgets pre-execution checks at **< 50 ms**. A service hop plus the mandatory redaction call does not fit alongside NFR1's 2-second end-to-end web-search budget. This is the load-bearing performance decision; if it is relaxed, NFR1 and NFR28 both need renegotiating.

### D20 — The SSE metadata whitelist becomes a declared contract

Extend `components/gov-chat-backend/routes/query-routes.js:322-327` to forward a **named, declared** field set, and log anything dropped.

*Why:* E3 — the current name-by-name whitelist already loses `retrieval_confidence_score` silently, and every citation/degradation FR has to cross it. Extending it once, explicitly, is a smaller diff than adding a field per FR and cheaper than debugging a silent drop later. Gated by OQ-SST-7.

### D21 — `ChunkSourceType` enum lives in the shared overlay package

A single Python enum — `file` (default for existing chunks), `feed`, `okf` — declared once in `genie-ai-overlay/tools/schemas.py` and imported by dataprep, the retriever, and the stream ingestor.

*Why:* E4 + OQ-SST-6 — SST and OKF both write this field into the same collection and neither exists yet. `core/` already sets the precedent for shared contracts (`label_contract.py`, `constants.py`). Whichever pillar lands first declares it; the other extends.

### D22 — One web-search helper, called from both `align_outputs` seams

A single function in `tools/fusion.py`, invoked from `genieai_chatqna.py:1307-1309` (rerank branch) **and** `:1183-1223` (no-rerank branch). It also owns the abstention decision (`:1296`) and emitting web results into `_assemble_source_documents` past the `file_id` gate (`:1575-1582`).

*Why:* E6 — five `add_remote_service*` pipeline shapes exist. Patching one seam ships a pipeline shape with no web search and a citation path that silently drops every web result. One shared helper is a smaller diff than two divergent copies, and fixes all three hazards at their common point.

### D23 — Feed config: YAML source-of-truth synced to ArangoDB, owned by the ingestor

*Provisional pending OQ-SST-1.* The architecture assumes feed-config persistence is **ingestor configuration (KEEP)**, not the dropped registry — the ingestor cannot poll without per-feed URL, schedule, retention, and content mapping. Swap-out cost is low if the decision goes the other way: it is one module and one collection.

### D24 — Citation and degradation are declared Pydantic models

Replace the inline dict at `genieai_chatqna.py:1629-1638` with models in `tools/schemas.py`, plus a schema test asserting the JSON shape Vue and Flutter consume.

*Why:* D10 promises rendering parity across three consumers from one contract. An undeclared inline dict cannot be tested against, which is how `source_type` would drift between platforms.

### D25 — Extend the existing PII vocabularies, do not add a third

`tools/pii.py` imports and extends the key sets in `genie-ai-overlay/tracing.py:39` (`_PII_KEYS`) and mirrors `components/gov-chat-backend/tracing-pii.js:4-6`.

*Why:* two telemetry-scoped redaction vocabularies already exist. A third, request-path-scoped one guarantees they diverge, and the gap becomes a leak (NFR6).

### D26 — Shared implementation in `genie-ai-overlay/tools/`, thin wrappers in `workflows/tools/`

Resolves the §2.1 container problem. Both the chatqna and workflows Dockerfiles gain a `COPY genie-ai-overlay/tools/ /app/tools/` step alongside the existing `core/` and `tracing.py` copies.

*Why:* satisfies FR47 (inline in chatqna) and §5 (a LangGraph tool) with one implementation, no extra network hop inside the 2s budget, and no code duplication between images.

## 5. Data flows

### 5.1 Web search (synchronous, on the request path)

```
chatqna align_outputs (RERANK @1307  |  no-rerank @1183)
  └─ tools/fusion.should_search(confidence, query)     FR8/FR9/FR10
       └─ [trigger fires] governance.pre_execute()      < 50 ms  — authz, param validation, PII redact (BLOCK on fail)
            └─ redis_primitives: rate limit + breaker state    FR15/FR41
                 └─ searxng_client.search()             httpx, timeout inside 2s P95
                      └─ domain whitelist filter        NFR11 — executor level, not backend config
                           └─ fusion: score + dedupe + budget + quality threshold   FR19/FR20/FR24
                                └─ governance.post_execute()   200 ms async — provenance, audit stream
                                     └─ append to LLM input string + Citation[] to _assemble_source_documents
```

Failure paths: breaker open → RAG-only, **no** degradation message (KB results still exist). Results returned but below quality → `Degradation(reason="LOW_QUALITY", fallback_applied="none")` + alternative-source guidance (FR23/FR24). PII redaction failure → denied, nothing forwarded.

**No `label_contract` hack needed.** Web search runs entirely inside `align_outputs`, so results never cross a megaservice node boundary — the "custom fields are silently dropped" constraint (`core/label_contract.py`) does not apply here. It *would* apply if web search became a graph node using `ServiceType.WEB_RETRIEVER`.

### 5.2 Feed ingestion (background, source-agnostic)

```
poller (rss | json_api)  ─┐
webhook POST /v1/tools/webhook/{feed}  ─┤   auth: API key | JWT, else 401 (NFR9); per-feed 429 + Retry-After (D8)
                          └─► content extraction via content_mapping
                                └─ governance.pre_execute()  — PII redact, BLOCK on fail
                                     └─ existing TEI embedding service  (embed BEFORE store, D6)
                                          └─ shared chunks collection
                                             + source_type="feed", source_url, feed_id, expires_at
                                                └─ XADD feed-ingestion-events  (poll_complete | webhook_received)

failure ─► XADD feed-ingestion-events-dlq  ─► dlq-reprocessor cron (exponential backoff)  FR42/FR43
3 consecutive poll failures ─► per-feed breaker OPEN, health "degraded", isolated (NFR15)
expires_at < now() ─► retract_expired_feed_chunks cron  (idempotent, concurrent-safe with retract_file)
```

### 5.3 Governance pipeline (D16 — three phases, three OTel spans)

| Phase | Budget | Steps | Span |
|---|---|---|---|
| PRE | < 50 ms in-process (NFR28) | tool authorization → parameter validation → **PII redaction (BLOCK on failure)** | `sst.governance.pre` |
| RUNTIME | per-tool `execution_budget_ms` | rate-limit check → breaker state → timeout | `sst.governance.runtime` |
| POST | 200 ms async (NFR29) | provenance/domain check → audit enrichment → `tool-invocation-audit` | `sst.governance.post` |

Spans use `tracing.with_span(...)` (`genie-ai-overlay/tracing.py:250-268`). **Not** `@tracing.trace_span` — that decorator does not exist; CLAUDE.md documents it in error.

## 6. Dependencies and gates

| Gate | Blocks | Owner |
|---|---|---|
| OPEA 1.5 bump delivers `ServiceType.WORKFLOW = 101` (bump task A1) | the tool-host shell **only** — governance, PII, Redis primitives, SearXNG client, and fusion are all bump-independent | jrevillard |
| Governance + web search in production | #603 go-live (NFR6 is non-negotiable) | SST |
| Regression guard: file chunks unaffected by feed retraction; mixed relevance vs. a curated-only baseline | stream ingestor → production | SST + OQ-SST-4 |
| SearXNG AGPL sign-off recorded (NFR26 "unmodified API-consumed" exception) | SearXNG → production | legal / OQ-SST-5 |
| `ChunkSourceType` enum agreed with OKF | stream ingestor ingestion path | SST + OKF / OQ-SST-6 |

`langgraph`, `mcp`, and `presidio` are **absent from the repo today**. Only `presidio-analyzer` / `presidio-anonymizer` are SST's concern; `langgraph` and `mcp` arrive with #603. The workflows image is a separate container, so its pins do not conflict with the retriever's deliberate `langchain-core<1.0` ceiling.

## 7. Deployment topology

Three new services, all `node.labels.genieai == true` (D11), all profile-gated `tools`:

| Service | Image | Notes |
|---|---|---|
| `searxng` | unmodified upstream, pinned tag | CPU-only. The **only** AGPL component in SST (NFR26 exception). Horizontally scalable (NFR19) |
| `pii-redactor` | genie-built, Presidio | Only when `PII_REDACTOR_IMPL=http://...`; library mode needs no container |
| `stream-ingestor` | genie-built overlay image | Long-running poller + webhook receiver; `/health` + `/ready` (D12) |
| `genie-ai-workflows` | genie-built overlay image | The tool host shell (D18); shared with #603 |

Model the service blocks on `guardrail` (`docker-compose.yaml:774-803`) for the minimal shape, or `dataprep-arango-service` (`:951-1039`) for the build-context + registry-fallback + healthcheck shape. Pin every tag — no `:latest` (config-validator enforces this).

Env vars go in **both** root `env` (new `# ===== SECTION 15: SERVER-SIDE TOOLS =====`, which `parse-env.js:33` parses cleanly) **and** `deploy/ansible/templates/env.j2`, or they never reach production. Then satisfy `tests/config-validator` (`KNOWN_ORPHANS`, `OPEA_SERVICE_VARS`, `expectedSecrets`). Ansible: `--profile tools` gate at `deploy/ansible/deploy.yml:459-464`, new tagged play for `--tags tools`, and any required secret added to the vault assertions at `:423-447`.

## 8. Test strategy

| Layer | Where | Notes |
|---|---|---|
| Python unit | `genie-ai-overlay/tests/test_governance_*.py`, `test_web_search_*.py`, `test_stream_*.py` | Flat `tests/`, `asyncio_mode = auto`, plain classes, `unittest.mock` only. Add import-time `sys.modules.setdefault` entries for new deps in the `conftest.py:11-190` block and env vars to `set_env_vars` (`:195-206`). **Reuse the existing unused `mock_redis` fixture (`:254`)** |
| PII injection | `test_governance_pii.py` | NFR6 — proves zero leakage and BLOCK-on-failure. The gating suite |
| Tracing | pattern from `tests/test_dataprep_tracing.py:101-120` | Assert the three governance span names and `record_exception` |
| Schema parity | `test_schemas.py` + a frontend test | D24 — one JSON shape, three consumers |
| Node unit | `components/gov-chat-backend/__tests__/routes/tools-routes.test.js` | `createApp()` + supertest, no HTTP server |
| Frontend | `src/__tests__/` + `localeConsistency.test.js` | Locale suite is a **hard gate**: every new string in all 14 locale files or CI fails (`:82-99`) |
| Config | `tests/config-validator` | New env vars accounted for |
| Gateway | `api-gateway-solution/new-config/__tests__` | `/api/tools` route |
| Regression | new | File chunks unaffected by feed retraction; mixed vector-search relevance vs. curated-only baseline |
| Smoke | `.gitlab-ci.yml` | Boot the real vendored `comps` in each new image — the mocked suite is structurally blind to it |

## 9. Traceability

| Capability | FRs | Primary code |
|---|---|---|
| Web search | FR8–FR11, FR16–FR24, FR47 | `tools/searxng_client.py`, `tools/fusion.py`, `chatqna/genieai_chatqna.py` |
| Stream ingestor | FR25–FR30, FR41–FR43, FR45 | `stream_ingestor/`, `dataprep/genieai_dataprep_arangodb.py` |
| Governance | FR12, FR13, FR15, FR44, FR50 | `tools/governance.py`, `tools/pii.py`, `tools/redis_primitives.py` |
| Admin / UI | FR31–FR40 | `admin/Tools/`, `tools-routes.js`, `keycloak-auth-middleware.js`, Flutter chat components |

## 10. References

- [SST PRD](./prds/prd-server-side-tools.md) — capabilities, FRs/NFRs, §10 Errata
- [Umbrella PRD](./prds/prd-agentic-enablement.md) — the four pillars
- [OPEA 1.5 decision doc](./OPEA-1.5-upgrade-analysis.md) — Part A bump (§2), Part B agentic layer (§3)
- [Team briefing](./team-briefing-agentic-enablement.md)
- Original SST design record — `feat/server-side-tools/prd`: `_bmad-output/planning-artifacts/{prd.md, architecture.md, epics.md}` (PRD + 17 ADRs + Epics 1–4), retained not duplicated
- GitLab #696–#725 — to be re-baselined per PRD §7
