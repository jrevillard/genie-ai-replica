---
title: Epics & Stories — GENIE.AI Server-Side Tools (SST)
status: draft
created: 2026-08-17
updated: 2026-08-17
prd: ./prds/prd-server-side-tools.md
architecture: ./architecture.md
initiative: agentic-enablement
prd_key: server-side-tools
branch: feat/sst
authors: Genie.ai Dev
---

# Epics & Stories: SST

> Four epics. Sequenced so the two hard gates for #603 (governance, web search) land first, and so **nothing in Epic 1 except story 1.7 depends on the OPEA 1.5 bump**.
>
> Traceability: [PRD](./prds/prd-server-side-tools.md) FR/NFR IDs preserve the original spec's numbering for GitLab #696–#725. `E1`–`E7` refer to [PRD §10 Errata](./prds/prd-server-side-tools.md); `D2`–`D26` to [architecture.md](./architecture.md) §3–§4.
>
> Epic numbering restarts at 1 for the reduced scope. The original Epic 1 (registry/executor/`mcpo`) is **closed as subsumed** — see PRD §2.2. Original Epics 2/3/4 map to Epics 2/3/4 here.

## Epic ordering and rationale

| Epic | Name | Why here | Bump-dependent? |
|---|---|---|---|
| 1 | Governance & tool host | Hard gate for #603. Buildable as a pure module with zero host, so it starts immediately | Only story 1.7 |
| 2 | Web search | Second hard gate for #603. Needs Epic 1's governance wrapper | No |
| 3 | Stream ingestor | No synchronous #603 dependency — a background producer. Can run parallel to Epic 4 | No |
| 4 | Admin surface | Serves all three capabilities; its own tier. YAML config covers operability until it lands | No |

---

## Epic 1 — Governance & tool host

**Goal:** every tool invocation passes through one non-bypassable pipeline — PII redaction (BLOCK on failure), authorization, parameter validation, rate limiting, circuit breaking, timeout budget, provenance check, tamper-evident audit — and there is a minimal container to host it.

**Delivers:** NFR6 (zero PII leakage), NFR7 (every invocation audited), NFR10, NFR11 (no bypass), NFR28/NFR29 (latency budgets), NFR31 (spans).

**Why first:** this is the single non-negotiable sovereignty guarantee and a hard blocker for #603. Stories 1.1–1.6 need no running service, so the gate is not itself blocked on the tool host or the bump.

### Story 1.1 — Declared schemas package

Create `genie-ai-overlay/tools/schemas.py` with Pydantic `Citation`, `Degradation`, `ToolResult`, and the `ChunkSourceType` enum (`file` default, `feed`, `okf`).

- Citation fields exactly per D10: `url`, `title`, `source_type`, `retrieved_at`, `confidence`.
- Degradation fields exactly per D7: `tool_id`, `reason`, `fallback_applied`, `message`.
- A schema test asserts the emitted JSON shape, so Vue and Flutter can be verified against one contract.

*Refs:* D10, D21, D24, FR21, NFR21 · *AC:* schema test green; enum importable by dataprep, retriever, and ingestor without a circular import.

### Story 1.2 — `PIIRedactor` ABC + implementations

`genie-ai-overlay/tools/pii.py`: ABC with `async redact(text) -> str` and `detect(text) -> list[PIIEntity]`; implementations `regex`, `presidio` (library mode, reference), `http` (remote). Selected by `PII_REDACTOR_IMPL`.

- **Failure mode is BLOCK.** A redaction error returns denied; it never forwards unredacted content and never logs-and-continues.
- Extends the existing key vocabularies (`genie-ai-overlay/tracing.py:39`, mirroring `components/gov-chat-backend/tracing-pii.js:4-6`) rather than defining a third (D25).

*Refs:* D5, D25, FR12, FR13, NFR5, NFR6 · *AC:* PII-injection suite proves zero leakage; forced-error path returns denied; P99 ≤ 100 ms measured.

### Story 1.3 — Redis primitives: rate limiter, circuit breaker, audit stream

`genie-ai-overlay/tools/redis_primitives.py`. **All three are greenfield (E5)** — nothing comparable exists in the repo.

- Sliding-window counter, per-user and per-tool/per-feed keys.
- Circuit breaker: CLOSED → OPEN after 3 consecutive failures → HALF_OPEN → CLOSED on successful health check.
- `tool-invocation-audit` stream writer with a `MAXLEN` budget (~5,000).
- Degrades gracefully when Redis itself is unreachable — follow `components/gov-chat-backend/services/translation-service.js` for the wiring and fallback shape.

*Refs:* D2, D8, E5, FR15, FR41, FR44, NFR13, NFR18 · *AC:* breaker opens at exactly 3 failures and auto-closes; limiter rejects over-budget calls; audit entries readable back; reuses the existing unused `mock_redis` fixture (`conftest.py:254`).

### Story 1.4 — The governance pipeline

`genie-ai-overlay/tools/governance.py` — the three phases wired in order, as an **in-process library** (D19), not a service.

- PRE (< 50 ms): authorization → parameter validation → PII redaction (BLOCK).
- RUNTIME: rate-limit check → breaker state → `execution_budget_ms` timeout.
- POST (200 ms, async): provenance/domain check → audit enrichment with `correlation_id`.
- Single insertion point, **no bypass path**.

*Refs:* D16, D19, FR50, NFR11, NFR28, NFR29 · *AC:* a tool call cannot reach its backend without traversing the pipeline (test-enforced); pre < 50 ms and post < 200 ms measured.

### Story 1.5 — OTel spans on the governance phases

Three spans — `sst.governance.pre`, `sst.governance.runtime`, `sst.governance.post` — via `tracing.with_span(...)` (`genie-ai-overlay/tracing.py:250-268`). **Not** `@tracing.trace_span`, which does not exist.

*Refs:* NFR31 · *AC:* spans appear with W3C `traceparent` propagated; assertions follow `tests/test_dataprep_tracing.py:101-120`; no PII in span attributes.

### Story 1.6 — Presidio deployment + config plumbing

`pii-redactor` service (only needed for `PII_REDACTOR_IMPL=http://...`), `genieai=true` placement, `--profile tools`.

- New `# ===== SECTION 15: SERVER-SIDE TOOLS =====` in root `env`.
- **Same vars mirrored into `deploy/ansible/templates/env.j2`** or they never reach production (E7).
- `tests/config-validator` entries; pinned image tag.

*Refs:* D11, D13, E7, NFR17 · *AC:* `config:validate` green; deploy renders the vars; Presidio reachable from the overlay network.

### Story 1.7 — Minimum tool host shell ⚠ bump-gated

`genie-ai-overlay/workflows/` — package marker, `genieai_workflows_microservice.py` (comps `MicroService` shell, `/health` + `/ready`, OTel init), `config.py`, `Dockerfile-workflows_genie-ai`, profile-gated compose service.

- **Scope boundary (D18):** shell only. No `orchestrator.py`, `state.py`, `nodes.py`, `graphs/`, `mcp_tools.py`, `checkpoint_arango.py` — those are #603.
- Dockerfile repeats the 6-step overlay vendoring pattern, plus `COPY genie-ai-overlay/tools/` (D26).
- **Blocked on** `ServiceType.WORKFLOW = 101` from the OPEA 1.5 bump (task A1). Interim: define locally, reconcile at bump.

*Refs:* D12, D18, D26, OQ-SST-8 · *AC:* container boots, `/health` 200, `/ready` reflects real dependency state, smoke job boots the real vendored `comps`.

---

## Epic 2 — Web search (SearXNG)

**Goal:** when the knowledge base is insufficient or the query is time-sensitive, the agent reaches the web — with fused, cited, budget-bounded results, and graceful degradation instead of fabrication.

**Delivers:** NFR1 (≤ 2 s P95), NFR12 (zero hallucination from tool failure), NFR16 (> 90% URLs valid), NFR20/NFR21 (a11y + parity), NFR30 (i18n).

**Depends on:** Epic 1 stories 1.1–1.4.

### Story 2.1 — SearXNG deployment

CPU-only, unmodified upstream image, pinned tag, `genieai=true`, `--profile tools`. `SEARXNG_URL` in root `env` **and** `env.j2`.

- **The only AGPL component in SST.** NFR26 tolerates it solely as an unmodified, API-consumed service — do not patch the image.

*Refs:* D11, D13, NFR19, NFR26, OQ-SST-5 · *AC:* reachable from the overlay network; `config:validate` green; AGPL sign-off referenced.

### Story 2.2 — Pluggable search backend + SearXNG client

`genie-ai-overlay/tools/searxng_client.py` — `httpx.AsyncClient` behind a backend interface so a provider can be swapped without touching the tool surface. Results parsed into `ToolResult` (`content`, `url`, `score`, `source_type="web_search"`, `retrieved_at`). Wrapped by Epic 1 governance.

*Refs:* D6, FR16, FR18, NFR1 · *AC:* an alternate backend substitutes with no caller change; timeout stays inside the 2 s budget including redaction.

### Story 2.3 — Domain whitelist, enforced at the executor

Whitelist from `web-search.yaml`, applied **after** results return, in the executor path — **not** in backend config, so it cannot be bypassed. Each URL validated as well-formed and reachable.

*Refs:* FR17, NFR11, NFR16 · *AC:* a non-whitelisted domain is dropped even when the backend is configured to return it; > 90% of cited URLs reachable at query time.

### Story 2.4 — Triggers: low-confidence, time-sensitive, LLM fallback

Confidence below threshold (default 0.70) fires; time-sensitive patterns fire **regardless** of confidence; an LLM-driven path can also elect to search. Disabled or unauthorized tools **cannot** fire from either path.

*Refs:* FR8, FR9, FR10, FR11 · *AC:* each trigger fires independently; a disabled tool never invokes via rule-based *or* LLM path (the cross-cutting guard to Epic 1).

### Story 2.5 — Fusion, budget, quality threshold

`genie-ai-overlay/tools/fusion.py` — score, dedupe by URL/content similarity, rank; allocate the context window by configurable ratio (e.g. 60/40 RAG/tools) and trim lower-scoring results to fit; discard results below a minimum quality bar before they reach the LLM.

*Refs:* FR19, FR20, FR24 · *AC:* over-budget context trims deterministically; sub-threshold results never enter the prompt.

### Story 2.6 — ChatQnA integration at **both** seams

One helper called from `genieai_chatqna.py:1307-1309` (rerank branch) **and** `:1183-1223` (no-rerank branch, used by `add_remote_service_without_rerank` at `:1840`).

Three hazards handled at the shared point (E6):
1. The abstention fork at `:1296` keys off `not docs` — it must account for web results before abstaining.
2. `_assemble_source_documents` has an unconditional `continue` at `:1575-1582` for docs absent from `file_id_pairs`, which would **silently drop every web result** from citations.
3. The per-document dict at `:1629-1638` becomes the declared `Citation` model (story 1.1).

*Refs:* D22, E6, FR47, FR19 · *AC:* both pipeline shapes return web results; a web-only answer still yields citations; abstention only when neither KB nor web has usable content. **Coordinate with jrevillard** — this is his module.

### Story 2.7 — Degradation + transparent insufficiency

Breaker open → RAG-only, **no** degradation message (KB results exist). Results below quality → `Degradation(reason="LOW_QUALITY", fallback_applied="none")` plus alternative-source guidance. Neither KB nor web usable → transparent "insufficient information" with guidance, **never a fabricated answer**.

*Refs:* D7, FR23, FR24, NFR12, NFR15 · *AC:* SearXNG stopped mid-session → visible notice, zero fabrication; a SearXNG outage does not affect feeds.

### Story 2.8 — SSE metadata contract extension

Extend `components/gov-chat-backend/routes/query-routes.js:322-327` to forward a **declared** field set — citations with `source_type`, the degradation object — and log anything dropped. Fix the already-silently-lost `retrieval_confidence_score` while there.

Then the Vue demux (`src/services/chatbotService.js:101-120`) and the Flutter parser (`lib/components/chat/chatbot_component.dart`, non-stream `:686-701`, stream `:474-607`).

*Refs:* D20, E3, OQ-SST-7, FR21, FR22 · *AC:* a citation with `source_type` reaches both clients end to end; a dropped field emits a log line instead of vanishing. **This story gates every citation and degradation FR** — nothing renders without it.

### Story 2.9 — Vue 3 citation + degradation rendering

Source-type icon (document vs `web_search`), title, truncated URL, confidence indicator; provenance labels distinguishing KB documents from external web sources. Degradation messages screen-reader compatible with ARIA labels. Per-deployment citation toggle.

Extends `components/RightSideBarComponent.vue` (today a "Related Documents" panel with no provenance concept).

*Refs:* FR21, FR22, FR37, FR39, NFR20 · *AC:* a11y scan reports **zero** AA violations; all strings in **all 14** locale files or `localeConsistency.test.js:82-99` fails.

### Story 2.10 — Flutter citation + degradation parity

Same fields and icons as Vue; tap opens the URL in the device browser; degradation via `Semantics` widgets. Renders from the same schema — no platform-specific endpoint. Citizen-facing only; no admin views.

*Refs:* FR38, FR39, NFR20, NFR21 · *AC:* side-by-side parity with Vue for the same response payload.

---

## Epic 3 — Stream ingestor

**Goal:** the corpus stays current by polling feeds and receiving webhooks, routed through the **existing** TEI pipeline into the **shared** ArangoDB chunks — no parallel corpus — with per-feed lifecycle and resilience.

**Delivers:** NFR2 (≤ 4 h publication-to-RAG), NFR9, NFR13–NFR15, NFR25 (no schema modification), NFR27.

**Depends on:** Epic 1 stories 1.1–1.4. No #603 dependency — can run parallel to Epic 4.

### Story 3.1 — `ChunkSourceType` + additive chunk metadata ⚠ cross-pillar

Add `source_type`, `source_url`, `feed_id`, `expires_at` to the chunk payload at `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py:1296-1307`, and pass them through the retriever.

- **The field does not exist yet (E4)** — today's metadata is `{file_id, file_path, chunk_index, chunk_labels}` (+`chunk_text`). Existing chunks default to `file`.
- Chunks are written indirectly via `langchain-arangodb`'s `add_graph_documents` (`:1176-1188`), so only the `Document.metadata` payload is ours to control.
- **OKF writes `source_type:"okf"` into the same field.** Agree the enum first (OQ-SST-6).

*Refs:* D3, D21, E4, FR28, NFR25, OQ-SST-6 · *AC:* additive only, no structural vector-store change; existing chunks read back as `file`; enum agreed with OKF before merge.

### Story 3.2 — `retract_expired_feed_chunks`

A **new method** on the existing retraction service (`genieai_dataprep_arangodb.py:1385-1590`), **not** a new class. Purges chunks where `expires_at < now()` on a configurable interval via background cron — not inline. Idempotent and safe to run concurrently with `retract_file`.

*Refs:* D3, FR29, NFR27 · *AC:* `retract_file` behaviour unchanged (regression-tested); concurrent runs are safe; **file-sourced chunks provably unaffected**.

### Story 3.3 — RSS/Atom polling

Feed definition (type `rss`, URL, cron schedule, content mapping `title_field`/`body_field`/`date_field`), polled at interval, entries parsed via the mappings. Publishes `feed-ingestion-events` with `event_type:"poll_complete"`.

*Refs:* D2, FR25 · *AC:* a real gazette-style feed ingests end to end; event lands on the stream.

### Story 3.4 — JSON-API polling with field mapping

Type `json_api` with `content_mapping`. Schema-validation gate: a response not matching the expected structure routes to the DLQ with `parse_error` status rather than ingesting garbage.

*Refs:* FR26, FR42 · *AC:* a malformed response lands in the DLQ, never in the corpus.

### Story 3.5 — Webhook push ingestion

`POST /v1/tools/webhook/{feed_name}`, authenticated by **API key or JWT Bearer**; unauthenticated → **401**. Per-feed flood protection → **429 + `Retry-After`** via the Epic 1 sliding window. Publishes `event_type:"webhook_received"`. **Disableable per deployment.**

*Refs:* D8, FR27, NFR9 · *AC:* unauthenticated 401; over-limit 429 with `Retry-After`; disabled per deployment means the route rejects.

### Story 3.6 — Route through existing TEI + shared ArangoDB

Extracted content from **any** source type goes to the existing TEI embedding service, then to the shared chunks collection. Embedding **completes before** storage (D6). The path is source-agnostic — identical downstream of extraction.

*Refs:* D6, FR28, NFR2, NFR17 · *AC:* one downstream path verified from all three source types; publication-to-RAG ≤ 4 h end to end.

### Story 3.7 — Per-feed lifecycle: retention, TTL, update-vs-append

Per-feed retention days (driving `expires_at`) and `update_behavior` (`replace` | `append`) in the feed-definition schema.

*Refs:* FR29, NFR27 · *AC:* both behaviours verified; expired chunks purged per policy.

### Story 3.8 — Feed-definition persistence ⚠ decision-gated

YAML source-of-truth synced to ArangoDB, with the same enable/disable and audit controls as other tool config. Provisionally **ingestor configuration**, not the dropped registry (D23) — swap-out cost is one module and one collection.

*Refs:* D23, FR30, OQ-SST-1 · *AC:* OQ-SST-1 resolved before merge; feed CRUD audited.

### Story 3.9 — Per-feed resilience: breaker, DLQ, backoff

3 consecutive poll failures open the breaker **for that feed only**; health reports `degraded`; subsequent polls route to the DLQ (`feed-ingestion-events-dlq`) with original message + error + timestamp. A `dlq-reprocessor` cron drains with exponential backoff; entries exceeding max retries are logged for manual review.

*Refs:* D2, FR41, FR42, FR43, NFR13, NFR14, NFR15 · *AC:* one feed's outage does not block others; source recovery auto-closes the breaker and reprocesses DLQ entries chronologically.

### Story 3.10 — Health endpoints + per-feed health

`/health` (liveness: process up) and `/ready` (readiness: ArangoDB + Redis + TEI reachable). Per-feed poll status, error count, and breaker state queryable.

*Refs:* D12, FR45 · *AC:* Swarm probes bind correctly; `/ready` fails when a dependency is down.

### Story 3.11 — Regression guard ⚠ production gate

1. File-sourced chunks provably unaffected by feed retraction (test-verified).
2. Mixed vector-search relevance validated against a curated-only baseline.

*Refs:* PRD §3.2 regression guard, OQ-SST-4 · *AC:* both pass before the ingestor goes to production. Baseline choice resolved via OQ-SST-4.

---

## Epic 4 — Admin surface

**Goal:** administrators manage tools and feeds, grant capabilities per user, read the audit log, and see health — in one place, accessible, translated.

**Delivers:** NFR4 (≤ 500 ms P95 CRUD), NFR8 (FOI audit access), NFR10 (RBAC), NFR20, NFR30.

**Depends on:** Epics 1–3 for the things it manages. Can run parallel to Epic 3.

### Story 4.1 — Two Keycloak roles + `requireRole()`

Add `tools-admin` and `tools-reader` realm roles to `configs/keycloak/genie-realm.yaml` (today the realm has exactly two roles: `admin`, `dataprep-service`).

Add a **parameterised** `requireRole(...)` to `components/gov-chat-backend/middleware/keycloak-auth-middleware.js` — `requireAdmin` (`:178-194`) is hardcoded single-role. Mirror the generic `authorizeRole` in document-repository (`:173-198`), but note its `mapRole` (`:168-184`) would silently coin `'Tools-admin'`.

*Refs:* D4, E2, FR11, NFR8, NFR10 · *AC:* `tools-reader` write → authorization error; `tools-admin` write succeeds; existing `admin` behaviour unchanged.

### Story 4.2 — `/api/tools/*` BFF proxy

`routes/tools-routes.js` + `services/tools-service.js`, registered in **three** places (E7): `index.js` `ROUTE_CONFIGS` (`:462-496`), the Kong allowlist (`api-gateway-solution/new-config/kong_config.json`), and any new var in `env.j2`.

*Refs:* E7, NFR4, NFR10 · *AC:* route reachable through Kong in a real deployment (not just direct-to-backend); Kong config suite green; swagger JSDoc present; CRUD ≤ 500 ms P95.

### Story 4.3 — Admin Tools tab

`components/gov-chat-frontend/src/components/admin/Tools/` following the `admin/QueryInspector/` sub-tree pattern, surfaced as one new tab in `AdminDashboard.vue` (`tabs` at `:1623-1632`). **Do not grow the 4446-line monolith** (E1).

Note the design system (`components/ds/`) has no Checkbox, Toggle, or Table primitive — use the raw pattern the documents table already uses, or add a DS primitive.

*Refs:* E1, FR31 · *AC:* tab renders for `tools-admin` and read-only for `tools-reader`; monolith grows by only the tab entry and a delegating panel.

### Story 4.4 — Tool management + domain whitelist editor

List tools (name, type, enabled/disabled, last-invocation count) with toggles taking effect **immediately, no redeployment**. Whitelist edits persist to tool-definition YAML and sync to ArangoDB.

*Refs:* FR31, FR32, FR17 · *AC:* a disabled tool stops firing without restart; whitelist edit takes effect on the next query.

### Story 4.5 — Feed management form

Feed fields (name, type `rss`/`json_api`/`webhook`, URL, schedule, retention days, content mapping) validated against the JSON Schema **before** submission, with specific field-level errors. Lives with document management so all ingestion is in one place.

*Refs:* FR35, FR36, E1 · *AC:* invalid config is rejected with a specific message before persistence.

### Story 4.6 — Audit log viewer

Filterable, exportable view over the `tool-invocation-audit` stream. Accessible to `tools-reader` — this is the FOI access path.

*Refs:* FR34, FR44, NFR7, NFR8 · *AC:* `tools-reader` can read and export but not mutate.

### Story 4.7 — Health overview

Green/yellow/red per tool and per feed with error summaries, from the Epic 1 breaker state and Epic 3 per-feed health.

*Refs:* FR33, FR45, NFR15 · *AC:* a stopped SearXNG shows red for web search and leaves feeds green.

### Story 4.8 — List-and-grant user capabilities

Replace the read-only role column (`AdminDashboard.vue:1437`) and the external Keycloak-console deep link (`:1440-1449`, `:2463-2468`) with in-app grant/revoke (E2).

- **Reuse** the existing search half: `services/admin-dashboard-service.js:1050-1173` → `GET admin/users/search`.
- **New:** grant/revoke via `services/keycloak-proxy-service.js:105` `_adminApiCall` → `/users/{id}/role-mappings/realm`. The `genie-proxy-client` service account **already holds `manage-users`**.
- **Never** write `roles` into ArangoDB — JIT-protected (`constants/jit-fields.js:19-36`). Grants take effect on next login, as D9 assumes.

*Refs:* D9, E2, NFR10 · *AC:* grant round-trips to Keycloak and appears after re-login; ArangoDB `roles` untouched.

### Story 4.9 — i18n across all 14 locales ⚠ CI gate

Every admin string, citation field, and degradation message keyed and present in **all 14** Vue locale files. Each new admin component carries its own `translate(key, fallback)` method (the helper is per-component, not global).

*Refs:* NFR30 · *AC:* `localeConsistency.test.js:82-99` green — deep-key drift fails the build, so this ships in the same commit as each string.

### Story 4.10 — Ansible `--tags tools` + `--profile tools`

New tagged play for `--tags tools` (today's tag vocabulary is only `install|prepare|build|deploy`); `--profile tools` gate at `deploy/ansible/deploy.yml:459-464`; any required secret added to the vault assertions at `:423-447`.

*Refs:* D13, E7 · *AC:* a tools-only re-run deploys just the SST services.

---

## Post-MVP (explicitly non-blocking)

**Tool-invocation analytics dashboard** — invocations per tool, success/failure rates, average latency, PII-redaction hit rate; knowledge-gap intelligence (queries that triggered web search but returned low-quality results, flagged as content gaps); per-feed ingestion analytics. Consumes the audit stream (NFR7/NFR8). Classified as Growth in the original spec; does not block the SST minimum viable surface.

## Cross-epic decision gates

| ID | Question | Blocks |
|---|---|---|
| OQ-SST-1 | Feed-config persistence: registry (dropped) or ingestor config (keep)? | Story 3.8 |
| OQ-SST-2 | Original 17-ADR spec: leave on `feat/server-side-tools/prd` or port in-tree? | Issue re-baselining |
| OQ-SST-3 | Confirm governance + web search are hard blockers for #603 | Epic sequencing |
| OQ-SST-4 | Which curated-only baseline validates feed-chunk relevance? | Story 3.11 |
| OQ-SST-5 | SearXNG AGPL sign-off recorded? | Story 2.1 → production |
| OQ-SST-6 | `ChunkSourceType` enum ownership with OKF | Story 3.1 |
| OQ-SST-7 | SSE metadata: ad-hoc fields or declared contract? | Story 2.8 |
| OQ-SST-8 | Tool-host boundary: shell only vs. more | Story 1.7 |

## GitLab re-baselining (#696–#725)

- Original **Epic 1** issues (registry, executor, orchestrator contract, progressive disclosure, `mcpo`) → **close as "subsumed by LangGraph in the workflows service."** Dependency edges pointing at Decisions 14/15/17 and the registry are voided.
- Original **Epic 2/3/4** issues → **retain**, re-pointed at the stories above, with Epic 1 governance added as a cross-cutting dependency on every tool-call issue.
- Label per `project-context.md`: `prd::server-side-tools`, `server-side-tools::epic-N`, `status::*`, `type::*`. MRs include `Closes #IID`.
- **`glab` is not installed on this machine** — this is a GitLab UI task, or install the CLI first. `sprint-status.yaml` is the documented fallback source of truth meanwhile.
