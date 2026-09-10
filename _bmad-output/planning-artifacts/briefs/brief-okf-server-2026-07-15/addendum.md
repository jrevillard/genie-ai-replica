# Addendum — OKF Server (Research & Downstream Depth)

Depth that belongs in the PRD / Architecture, preserved here as the durable research base. Compressed to decision-relevant facts; sources cited inline. All candidate OSS verified permissive (MIT/Apache-2.0/BSD) unless flagged.

---

## A. OKF v0.1 — what we conform to

- **Bundle** = directory tree of Markdown files; unit of distribution (git repo recommended, or tarball/subdir).
- **Concept** = one `.md`; **Concept ID** = file path minus `.md`.
- **Frontmatter** (YAML): only `type` **required**. Recommended: `title`, `description`, `resource` (URI), `tags`, `timestamp`. Extensible; consumers MUST tolerate unknown keys/types.
- **Body** = structural Markdown; conventional headings `# Schema`, `# Examples`, `# Citations`.
- **Graph-shaped**: concepts cross-link via Markdown links (absolute `/path.md` recommended); links are untyped directed edges.
- **Reserved files**: `index.md` (progressive-disclosure directory listing), `log.md` (ISO-8601 dated history). Root `index.md` may carry `okf_version: "0.1"`.
- **Conformance (§9)**: (1) every non-reserved `.md` has parseable YAML frontmatter; (2) every frontmatter has non-empty `type`; (3) reserved files follow structure. **Permissive consumption** — MUST NOT reject on missing optional fields, unknown types, unknown keys, broken links, missing index.
- **Versioning**: `MAJOR.MINOR`; minor = backward-compatible; major = breaking. Declared via `okf_version` in root `index.md`.
- **Implication for us**: our server must be a *permissive* consumer (best-effort on partial/broken bundles) and SHOULD run a §9 conformance check on ingest as a *quality gate* (non-blocking), surfacing issues to stewards.

---

## B. Genie integration map (verified against current `main` @ `0b6189b0b`)

### B1. dataprep + retriever — the OKF index is near-zero-code
- `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py`: `class GenieArangoDataprep(OpeaArangoDataprep)` (L229); `_load_and_chunk` (L400, uses `RecursiveCharacterTextSplitter`+`HTMLHeaderTextSplitter` L420 — **no markdown-header splitter, no frontmatter handling** ← our extension point); `ingest_file_with_guardrail` (L1226); `ArangoGraph` (L1312); `retract_file` (L1385, cascade by `file_id` over `{graph}_SOURCE/_ENTITY/_HAS_SOURCE/_LINKS_TO`).
- `langchain_text_splitters` **already imported** → `MarkdownHeaderTextSplitter` is a drop-in.
- `genie-ai-overlay/retriever/genieai_retriever_arangodb.py`: `GenieaiArangoRetriever` (L162); `invoke()` (L722) reads `graph_name` from request body (L766); hybrid dense (COSINE) + BM25 + RRF fusion (L118) + optional graph traversal `fetch_neighborhoods` (L195); TEI query embed (L941).
- **Key finding**: indexing under `graph_name="OKF"` auto-creates `OKF_SOURCE/_ENTITY/_HAS_SOURCE/_LINKS_TO` and is queryable via existing `POST /v1/retrieval` `{"input":"...","graph_name":"OKF","search_start":"chunk"}`. **No new storage/search code required for the index.**
- Net-new ingest code: OKF frontmatter→metadata, Markdown-header chunking, structural link-edge emitter into `OKF_LINKS_TO`, OKF §9 conformance check, git/S3 source sync.

### B2. document-repository — archives blocked → new route
- `components/document-repository/`: Express :3001; MIME/magic-byte validation → optional ClamAV (`securityService.scanBuffer`, gated `VIRUS_SCANNING`) → text extraction → mandatory English langdetect → ArangoDB `files` → base64 single-file handoff to dataprep `http://dataprep-arango-service:5000/v1/dataprep/ingest_file`.
- **Blockers for archives**: extension allowlist (`appConfig.js:45` = pdf/docx/xlsx/md/html/txt), magic-byte validator (`mimeTypeValidator.js:40-51`), langdetect (`fileService.js:159-164`), single-base64 dataprep contract.
- **Path**: new `/api/files/ingest-bundle` route + controller; reuse `securityService.scanBuffer`; unpack + write pre-computed concept docs; bypass `_extractText`/langdetect; call a new OKF-aware ingest path (not the single-file base64 contract).

### B3. gov-chat-backend (BFF) — auth pattern to mirror / extend
- `createApp({services})` factory (L508); `ROUTE_CONFIGS` array (L462-496) drives per-route `keycloakAuth` mounting (L923).
- Auth = **manual OIDC via `jose` v6.2.2** (`jwtVerify`+`createRemoteJWKSet`, JWKS via OIDC discovery, 5-min cache). **NOT** `keycloak-connect`/`express-openid-connect`/`jwks-rsa`. Canonical key `iss_sub`.
- `middleware/keycloak-auth-middleware.js` (`.authenticate` L65, `.requireAdmin` L178); `services/keycloak-auth-service.js` (`verifyToken`, multi-issuer whitelist).
- **Option A (recommended)**: if OKF serving lives in/behind the BFF, add `routes/okf-routes.js` + one `ROUTE_CONFIGS` entry `{file:'okf-routes', paths:['/api/okf'], serviceName:'okfService', keycloakAuth:true}`; identity via `req.user.iss_sub`/`req.claims`.
- **Option B**: standalone OKF service mirrors the two auth files (drop `provisionUser` if no user persistence); keep `jose`; depends on `../shared-lib` (logger).

### B4. api-gateway-solution (Kong + NGINX)
- Layered: Client → NGINX (:443 TLS, CSP, CORS) → Kong (:8000 internal, **DB-backed via Postgres**, JSON config applied by one-shot `kong-config` init via Admin API) → upstream.
- `new-config/kong_config.json`: services (L3-76), routes (L77-694), plugins (L695-871); `restore-kong-config.sh` iterates generically (PUT by name).
- **Registration**: add Kong `service` (`name:"okf-server"`, host, port, `tags:["new"]`) + `route` (`paths:["/api/okf"]`, `strip_path:false`, `preserve_host:true`) to the JSON; add `okf-server` to `docker-compose.yaml` on `genieai_network`. No script change. NGINX block only if non-`/api` prefix, SSE/WebSocket, or distinct CSP (mirror `/api/queries/stream` for SSE).
- **MCP auth at gateway**: Kong **AI MCP Proxy** + **AI MCP OAuth2** plugins enforce the MCP OAuth 2.1 profile; pair with Kong OIDC/JWT validating Keycloak tokens; rate-limit per consumer/credential (per-tenant quota).

### B5. Today's agent knowledge access (single path, no direct surface)
- Agent/User → NGINX → Kong (`/api/queries`|`/api/queries/stream`) → BFF (`express-api:3000`) → ChatQnA `http://chatqna-...:8888/v1/chatqna` (Bearer forwarded verbatim) → TEI → retriever `:7000` (internal-only, no Kong route) → reranker → LLM → ArangoDB.
- **No** OpenAI `/v1/chat/completions`, **no** tool-bearing surface, **no** MCP, **no** tool registry on `main` (exists only as planning content in `feat/server-side-tools/prd` worktree). → OKF agent surface is greenfield.

---

## C. Reuse vs Build (per stage)

| Stage | Reuse (recommended) | Build (net-new) |
|---|---|---|
| Git source sync | native `git` (diff `OLD..NEW --name-only`) | source-sync adapter + webhook/poll worker |
| S3 source sync | `rclone sync` (ops) or `boto3`/`minio` (in-app) | manifest/delta tracker |
| Frontmatter parse | `python-frontmatter` (MIT) | — |
| Markdown→structure | `markdown-it-py` or LangChain `MarkdownHeaderTextSplitter` (already a dep) | OKF concept loader in `_load_and_chunk` |
| Embedding | OPEA TEI (already wired) | — |
| LLM entity graph | dataprep `llm_transformer` (exists) | — |
| Structural link graph | parser edges → existing `{graph}_LINKS_TO` | link-edge emitter (~1 day) |
| Vector + BM25 + graph retrieval | retriever hybrid + RRF (exists, `graph_name`-param) | BM25 view over OKF corpus (config) |
| Delete cascade | `retract_file` (exists) | bundle-level retract |
| Conformance validation | `Sudhakaran88/okf-conformance` (MIT) as reference | wire as quality gate |
| Auth | Keycloak OIDC + Kong AI MCP plugins; `jose` | per-bundle/per-tenant scope mapping |
| Observability | OTel + Victoria* + Grafana (exists) | OKF spans |
| MCP surface (later) | `FastMCP` (Apache-2.0) + official MCP SDKs (MIT) | OKF tools/resources |
| CI/deploy | ADR-0001 pipeline + Ansible + docker-compose | OKF service Dockerfile/compose entry |

**Bottom line**: ~80% reuse; net-new is the bundle manager, OKF loader, link emitter, curation/governance, and serving API.

---

## D. Recommended OSS (all permissive) — and what to avoid

**Adopt:** `python-frontmatter` (MIT), `markdown-it-py` (MIT) / LangChain splitters (MIT), OPEA (Apache-2.0), `langchain-arangodb` (MIT), `FastMCP` (Apache-2.0), MCP Python/TS SDKs (MIT/Apache), `rclone` (MIT), `boto3`/`minio` client (Apache), `jose` (MIT), Presidio for PII (MIT), `Sudhakaran88/okf-conformance` as conformance reference (MIT), Context7/GitMCP patterns (Apache) for search-then-fetch.
**Avoid:** Graphlit (proprietary, winding down), KùzuDB (archived Oct 2025), AGNTCY ACP (archived/merged into A2A), any GPL/AGPL core dependency (only unmodified-upstream-via-API tolerated per NFR26).

---

## E. Competitive landscape (positioning)

| Player | Type | Agent surface | Governance/multi-tenancy | Takeaway |
|---|---|---|---|---|
| Google Knowledge Catalog/Dataplex | Commercial | Remote MCP (`dataplex…/mcp`), IAM-scoped | RBAC+ABAC(tags), audit, residency | Closed core; OKF is ingest layer only; GCP-locked serving |
| Databricks Unity Catalog | Commercial + OSS (Apache) | Managed MCP (Genie/AI-Search/UC-fn) | ABAC, lineage, audit, cost | Strongest governed agent catalog; OSS variant narrower |
| Atlan / Collibra | Commercial (OSS MCP edges) | Remote + local MCP | RBAC+ABAC, audit | Enterprise metadata/context layer; closed core |
| Microsoft Fabric/Purview | Commercial | Fabric MCP (3 surfaces) | RBAC→ABAC, Purview audit, labels | Purview has no dedicated MCP; closed core |
| Microsoft GraphRAG / LightRAG / LlamaIndex / nano-graphrag | OSS (MIT) | Library / REST; MCP mostly via wrappers | **None** | Great algorithms, zero governance — our gap |
| Graphiti(Zep)/Letta/Cognee/mem0 | OSS (Apache/MIT) | MCP servers | Partial/none | Agent *memory*, not curated bundle hosting — complementary |

**White space we own**: open-source, sovereign, multi-tenant, governed, ArangoDB-native, dataprep-complementary **hosted OKF serving**. No OSS project provides this; commercial ones do but are closed/locked.

---

## F. MCP / protocol / auth design (for Architecture)

- **MCP spec 2025-11-25** (design target); track `2026-07-28` RC. Transports: stdio + **Streamable HTTP** (single `/mcp` endpoint, `MCP-Session-Id`, `MCP-Protocol-Version` header, Origin validation). HTTP+SSE deprecated.
- Primitives: **Resources** (read-only, app-controlled — home for bundle index/manifest), **Resource Templates** (`okf://{tenant}/{bundle}/{path}{?version,lang}`), **Tools** (model-controlled — `okf_search`, `okf_get_doc`, `okf_list_bundles`, `okf_outline`), Prompts, Sampling.
- **Progressive disclosure**: 1 static resource (index/manifest) + 2 tools (search-then-fetch, à la Context7). Naive 400-tool servers burn >400k tokens before first query; dynamic/progressive cuts ~100×.
- **Auth (OAuth 2.1)**: MCP server = resource server; PKCE S256 mandatory; **RFC 9728** Protected Resource Metadata (`.well-known/oauth-protected-resource`); **RFC 8707** resource indicator + audience binding; **no token passthrough**. Client registration priority: pre-registered → Client ID Metadata Doc → RFC 7591 DCR. AS = Keycloak (OIDC Discovery; note Keycloak RFC 8414 gaps → use OIDC discovery; add **Audience mapper**; enable **token-exchange** for service-to-service to avoid confused-deputy).
- **Multi-tenancy**: Keycloak realm-per-agency (hard isolation) vs single-realm+claim (scalable); encode access as `okf:{tenant}:{bundle}:{read|admin}`; **dynamic `tools/list`** filtered by principal; never trust tenant from tool args. Per-tenant resource URIs become isolation boundaries under RFC 8707.
- **Build on**: `FastMCP` (Apache-2.0, Python, matches OPEA tier); Kong AI MCP Proxy+OAuth2 plugins for gateway-terminated OIDC.
- **Protocols**: MCP (agent) + REST (human/OpenAI-function-calling, one core handler serves both via MCP-over-HTTP) primary; gRPC internal-only/optional; **A2A** only if external agents must discover/orchestrate OKF agents (publish `/.well-known/agent.json`); **skip ACP**.

---

## G. Enterprise & public-sector / data-curation requirements (NFR seeds for PRD)

**Privacy:** mandatory PII redaction on ingest (BLOCK on failure, Presidio); data minimization; GDPR/FOI right-to-erasure (bundle/tenant deletion cascade incl. vectors+audit); no third-party analytics egress; field- and bundle-level sensitivity classification.
**Security:** per-tenant + per-bundle RBAC/ABAC via Keycloak; encryption in transit (TLS) and at rest; secrets via the deployment's secret store (never in images); supply-chain integrity — CycloneDX SBOM (retain 1 yr), signed images, container scanning as blocking MR gate (ADR-0001); non-root containers; `/health`+`/ready`; rate limiting / abuse protection at Kong.
**Data curation:** bundle lifecycle (register→validate(§9)→review/approve→publish→version→deprecate→retire); provenance & lineage (source ref, commit SHA, curator, timestamps); citation/version pinning for agent answers; retention/TTL with retract cascade; conformance + quality metrics surfaced to stewards; human review/approval gate (governed curation, not free-for-all).
**Sovereignty / government fit:** runs inside a national boundary; **air-gap deployable** (no outbound calls, local models/TEI); data residency guarantees; multi-agency tenancy; FOI-exportable audit logs; accessibility (WCAG) and **multilingual** (inherit Genie i18n) for diverse populations; DPG compliance.
**Reliability/availability/scalability:** stateless service tier horizontally scalable on `genieai=true` CPU nodes (no new GPU — NFR17); Redis Streams + DLQ for ingest resilience (SST Decision 2); idempotent, change-driven incremental re-indexing (git diff / S3 ETag / content SHA-256); graceful degradation (serve last-good index if re-index fails).
**Traceability:** every agent query → OTel span with W3C `traceparent` across the OKF→retriever→LLM boundary; per-request correlation/audit IDs; PII filtered from spans (mandatory).

---

## H. Assumptions ([ASSUMPTION] — confirm in PRD review)

- [ASSUMPTION] OKF MVP runs as a **new Python/FastAPI OPEA service** `genie-ai-overlay/okf/` that *calls* dataprep's ingest (or extends its loader), rather than modifying dataprep in place. (Open: extend-in-place vs sibling-service — Architecture decision.)
- [ASSUMPTION] One shared `OKF` graph with tenant-tagged chunks + ACL filters (vs `graph_name`-per-tenant). (Multi-tenancy ADR.)
- [ASSUMPTION] REST MVP ships before MCP; MCP gated on SST + #603.
- [ASSUMPTION] Read-only serving in v1 (no agent write/propose loop).
- [ASSUMPTION] PII redaction on markdown bodies uses Presidio at ingest, non-blocking for conformance but blocking for PII policy.
