# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **OPEA upgrade from v1.3 to v1.5:** All four OPEA overlay images (chatqna, dataprep, retriever, reranker) now build from OPEA v1.5. The upgrade absorbs 7.5 months of upstream bug fixes and dependency CVEs while preserving GENIE's RAG behavior (retrieval, reranking, labeling, contextual retrieval). Rollback: redeploy the previous v1.3-based image tags.
- **Python 3.11:** Replaces Python 3.10 in all OPEA overlay images (matching OPEA v1.5's base). The dataprep image base changed from `nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04` to `python:3.11-slim` to align with OPEA v1.5 upstream — GPU support is maintained via pip-installed CUDA libraries (`cuda-toolkit`, `nvidia-cuda-runtime`).
- **Mobile client ID placeholders:** `KC_MOBILE_CLIENT_ID` and `KC_MOBILE_REDIRECT_SCHEME` in the `env` template changed from ITU-specific values to generic institutional placeholders (`genie-mobile-<institution>`, `com.<institution>.genieai`). Existing deployments unaffected.

### Fixed

- **Query endpoint ownership validation:** Query-related endpoints now enforce userId ownership. A user can no longer access query data belonging to another user — the endpoint returns 404 for non-existent queries, 403 for queries owned by another user.
- **Backend input validation:** API endpoints now validate `limit` and `offset` query parameters with proper bounds checking (min/max constraints). Invalid values (negative, non-numeric) return the default instead of silently producing unexpected queries.
- **Analytics filters error handling:** The `filters` query parameter on the analytics endpoint now returns a proper 400 error with `INVALID_FILTERS_JSON` code when malformed JSON is provided, instead of crashing with an unhandled exception.
- **Reranker index bounds:** Reranker now handles out-of-range TEI indices defensively — a buggy TEI response that returns fewer scores than documents no longer crashes with `IndexError`; the affected entry is skipped and the partial result is preserved.
- **Docling device auto-detection:** When `DOCLING_DEVICE=cuda` is requested but no GPU is available (CPU-only deployment), the dataprep service now falls back to CPU with a visible warning instead of crashing at docling initialization.

### Security

- **Horizontal privilege escalation prevented:** Query message endpoints now validate that the requesting user owns the queried resource.
- **Dependency CVE remediation (GitLab Ultimate pipeline 6345, 2026-08-22):** Resolved 21 high-severity runtime CVEs across all JS components by bumping affected transitive and direct dependencies. Highlights: `protobufjs` 7.5.5 → 7.5.6 (5 CVEs including RCE via prototype pollution CVE-2026-44291, code injection CVE-2026-44293, DoS recursion CVE-2026-44289); `sharp` 0.32.6 → 0.35.0 (inherited libvips CVEs); `ip-address` 5.9.4 → 10.3.1 (SSRF via Address4 octal/decimal confusion CVE-2026-69192) via `geoip-lite` 1.4.10 → 2.0.3; `@opentelemetry/propagator-jaeger` 2.7.1 → 2.9.0 (DoS via malformed Jaeger header CVE-2026-59892); `js-yaml` → 4.3.1 across all manifests (quadratic CPU `!!omap` GHSA-5p4m-2wfm-xmqj); `dompurify` 3.2.6 → 3.4.14 (IN_PLACE hook XSS); `uuid`, `postcss`, `serialize-javascript`, `fast-uri` overrides; `@opentelemetry/core` 2.7.1 → 2.8.0 (unbounded memory W3C Baggage CVE-2026-54285).
- **Mobile AppAuth MITM vulnerability fixed:** The vendored `flutter_appauth` Android plugin previously wired an `InsecureConnectionBuilder` (which disables TLS certificate validation via a trust-everything `X509TrustManager`) into the `AuthorizationService` unconditionally at engine attach. Production now never instantiates an insecure service: `createAuthorizationServices()` lazy-instantiates the insecure service only when `allowInsecureConnections=true`, which only the dev and E2E configs set. Production flavors (`flavors/itu.dart`, `flavors/template.dart`) inherit `false` from `KeycloakConfig` and reach the secure path. An attacker on a hostile network (Wi-Fi, ISP proxy) can no longer MITM the Keycloak login flow on Android production builds.
- **SAST scan surface restricted:** `.gitlab-ci.yml` adds `SAST_EXCLUDED_PATHS` covering only dev/test-only paths (Windows desktop CMake runner, real-comps contract tests, jest test dirs, dev migration scripts, synthetic-data generators, coverage reports). The production Docker entrypoint `document-repository/scripts/clamav-node.sh` remains scanned. The previously advertised `SEARCH_IGNORED` variable was removed — it is not honored by any official GitLab SAST template.

## [2.0.1] - 2026-08-03

### Security

- **CVE remediation:** 3,466 critical/high vulnerabilities resolved across Docker base images, npm dependencies, and image tags
- **PostgreSQL 13 → 16 upgrade:** PostgreSQL 13 is end-of-life. The default image is now `postgres:16`.
  - **⚠ Deployers MUST follow `docs/UPGRADE.md`** — this is a **mandatory migration** with planned downtime. Run `pg_dumpall`, reset the `genieai`/`kong`/`keycloak` role passwords, and verify before restarting services.

### Changed

- **Docker base images updated:** Node.js `node:22`, Alpine `3.22`, Keycloak `26.7`, PostgreSQL `16`
- **Image tags pinned:** all `:latest` tags pinned to specific versions (Kong `3.9.3`, ClamAV `stable-debian`, vLLM `v0.10.0`, OPEA services, etc.)
- **Reranker default strategy:** `RERANKING_STRATEGY` now defaults to `slice` (top-N) with `RERANKER_TOP_N=3` — the `adaptive` strategy could return 0 documents with low TEI scores

### Fixed

- **Chat responses interrupted:** `max_tokens=None` rejected by pydantic ≥2.13 caused chat stream failures — fixed in ChatQnA

## [2.0.0] - 2026-07-28

### Added

- **Quick Help:** configurable dual-prompt system with customizable welcome message, knowledge hierarchy categories, and service labels for precise RAG retrieval filtering
- **Non-English document ingestion:** upload and translate Spanish PDFs into the RAG knowledge base
- **Account management:** administrators can deactivate and reactivate user accounts
- **RAG abstention:** the assistant now says "I don't know" instead of hallucinating when no relevant information is found — toggle via `CHATQNA_ENFORCE_ABSTENTION`
- **Contextual Retrieval (Anthropic-style):** LLM-generated document context is prepended to each chunk before embedding, improving retrieval relevance for domain-specific documents — toggle via `CONTEXTUAL_RETRIEVAL_ENABLED`
- **Reranking strategies:** configurable via `RERANKING_STRATEGY` (slice, threshold, knee, adaptive) — each deployment can select the method best suited to its data
- **Streaming translation:** chat output now streams in the target language during generation instead of waiting for the full English response first — enable via `STREAMING_TRANSLATION_ENABLED`
- **Multi-turn vector-space blending:** previous conversation turns influence retrieval, improving relevance in multi-turn chats — enable via `MULTI_TURN_BLEND_ENABLED`
- **Multi-crop query support:** users can query across multiple crop categories simultaneously
- **Faster document ingestion:** batched LLM labeling (4 chunks per call) with increased concurrency — processing time reduced by an order of magnitude
- **Remote GPU node:** deploy model services (vLLM, TEI) on a dedicated machine with TLS and API key authentication
- **Config-driven locale whitelist:** restrict active UI locales per deployment via `VUE_APP_AVAILABLE_LOCALES` — applies to web, mobile, and Keycloak login pages
- **Documentation site:** public Hugo/Docsy site with redesigned landing page, dark mode, and curated reference docs
- **Model selection guide:** comprehensive documentation on choosing and configuring LLM, embedding, and reranker models
- **Docker Swarm deployment:** fully automated via Ansible — one command to deploy the entire stack
- **Kong API gateway:** production-grade API gateway with automatic route configuration
- **SSL certificates:** automatic Let's Encrypt certificate provisioning and renewal
- **GPU support:** configurable NVIDIA GPU utilization and data type for vLLM inference in Swarm mode
- **Configurable RAG pipeline:** new variables (`ARANGO_PORT`, `EMBEDDING_SERVER_ENDPOINT`, `RETRIEVER_ARANGO_GRAPH_NAME`)
- **Keycloak OIDC authentication:** replaced the legacy authentication system with Keycloak as the central identity provider — single sign-on, password reset, and token lifecycle management
- **Mobile app OIDC migration:** Flutter app now uses Keycloak OIDC with build flavors, custom URL schemes, TLS enforcement, and network error recovery — no more legacy auth
- **SSE streaming:** LLM responses now stream in real-time via Server-Sent Events instead of waiting for the full response
- **Query Inspector:** admin tool for inspecting and debugging RAG pipeline results (what was retrieved, reranked, and sent to the LLM)
- **Dynamic favicon:** the browser favicon is set from the deployment configuration
- **Weather API hardening:** 5-second timeout on all external weather service calls to prevent hangs
- **Observability stack:** OpenTelemetry tracing across the entire RAG pipeline, with Grafana dashboards, VictoriaMetrics, and alerting (enable via `ENABLE_OBSERVABILITY=1`)

### Changed

- **UI theme system:** replaced hardcoded colors with CSS custom properties — custom themes can now be applied by overriding variables
- **Document repository file upload limit:** default reduced from 500 MB to 50 MB — adjustable via `MAX_FILE_SIZE`
- **Translation pipeline:** automatically detects model type from `VLLM_TRANSLATION_MODEL_ID` — no manual config needed
- **Translation backend:** default mode changed from `cpu` to `auto` — the system picks the best available translation method
- **Guardrails:** content guardrail service is now disabled by default; enable explicitly if needed
- **Deployment:** consolidated to a single `docker-compose.yaml` supporting both local dev (`docker compose`) and production Swarm (`docker stack deploy`)
- **Deployment:** all persistent data centralized under `./data/` directory
- **Deployment:** configuration files consolidated into single `configs/` directory
- **Nginx security headers:** `Permissions-Policy` now configurable per environment
- **LLM token limit:** removed the arbitrary 1024 max_tokens default — the LLM can now generate full responses
- **Locale parity:** all 14 locales brought to strict key parity — 81 unused keys removed, 9 missing translations added

### Security

- Fixed authentication bypass on `/email` route — no-token access to email operations (#422)
- Added admin authorization checks to database operations routes (#423)
- Prevented AQL injection by converting all database queries to tagged template literals (#425)
- Replaced all shell `exec()` calls with Node.js built-in APIs (#426)
- Prevented path traversal in file upload and log file operations (#431)
- Removed hardcoded `JWT_SECRET` fallback — the server now fails fast at startup if the secret is missing (#430)
- Removed hardcoded database password fallback in connection service (#432)
- Stopped leaking internal error messages in API responses (#434)
- Replaced real credentials with placeholders in environment templates (#424)
- Added admin authorization to file deletion routes (#467)
- Added magic-byte validation for file uploads — rejects files disguised by MIME type (#470)
- Sanitized Content-Disposition headers against CRLF injection attacks (#471)
- Added array size validation on batch file endpoints (#472)
- Added path traversal guard in file storage operations (#477)
- Removed legacy `_key <= 10` admin bypass — all admin access now role-based (#429)

### Fixed

- Mobile app now sends timestamps in UTC instead of device local time
- Translations created without `nameEN` on category and service documents (#531, #532)
- JWT token not forwarded from Authorization header to logout endpoint (#530)
- Duplicate logout call when navigating away from the app (#527)
- Database statistics API returning 404 on `/admin/database/stats` (#528)
- Admin toast notification when Quick Help labels don't match the knowledge hierarchy (#529)
- Admin role checks now use JWT claims instead of stale cached roles — changes take effect immediately
- Admin document search bar no longer collapses; pagination button labels no longer overflow (#830)
- Admin document status filter now case-insensitive (#832)
- Document re-ingestion/retraction status guard now case-insensitive (#831)
- Conversation saved twice on certain actions
- Markdown conversation export producing broken PDFs
- Missing routes causing mobile registration screen to fail
- Spanish responses appearing when English is selected — the UI language is now correctly included in all LLM requests (#579)
- Wrong i18n key causing SatisfactionHeatmap to display incorrectly (#580)
- Streaming SSE `|<-MSG->|` boundary markers no longer visible in chat output
- Label filters now correctly cleared when switching to Just Chat mode (#249)
- Just Chat no longer auto-submits a hidden prompt — enters free-form mode without sending any message
- Cross-document label contamination fixed — chunk labels scoped to their document (#216)

## [R_1_0_0] - 2026-03-16

Initial release for El Salvador agricultural AI assistant deployment.

[R_1_0_0]: https://opensource.unicc.org/un/itu/genie-ai/-/tags/R_1_0_0
[2.0.0]: https://opensource.unicc.org/un/itu/genie-ai/-/compare/R_1_0_0...v2.0.0
[2.0.1]: https://opensource.unicc.org/un/itu/genie-ai/-/compare/v2.0.0...v2.0.1
[Unreleased]: https://opensource.unicc.org/un/itu/genie-ai/-/compare/v2.0.1...main
