# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-07-28

### Added

- **Quick Help:** dual-prompt system that suggests relevant topics while the user types, with configurable knowledge hierarchy categories and service labels for precise RAG retrieval filtering
- **Non-English document ingestion:** upload and translate Spanish PDFs into the RAG knowledge base
- **Account management:** administrators can deactivate and reactivate user accounts
- **RAG abstention:** the assistant now says "I don't know" instead of hallucinating when no relevant information is found
- **Contextual Retrieval (Anthropic-style):** LLM-generated document context is prepended to each chunk before embedding, improving retrieval relevance for domain-specific documents
- **Adaptive reranking:** new strategies (slice, threshold, knee, adaptive) automatically select the best method per query — default changed from fixed slice to adaptive
- **Streaming translation:** chat output now streams in the target language during generation instead of waiting for the full English response first (#829)
- **Multi-turn vector-space blending:** previous conversation turns influence retrieval, improving relevance in multi-turn chats (#833)
- **Multi-crop query support:** users can query across multiple crop categories simultaneously
- **~37x faster document ingestion:** batched LLM labeling reduces processing time from hours to minutes
- **Remote GPU node:** deploy model services (vLLM, TEI) on a dedicated machine with TLS and API key authentication
- **Config-driven locale whitelist:** restrict active UI locales per deployment without deleting translation files — applies to web, mobile, and Keycloak login pages
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
- **Configurable Quick Help:** prompts and welcome message can be customized per deployment
- **Dynamic favicon:** the browser favicon is set from the deployment configuration
- **Weather API hardening:** 5-second timeout on all external weather service calls to prevent hangs
- **Observability stack:** OpenTelemetry tracing across the entire RAG pipeline, with Grafana dashboards, VictoriaMetrics, and alerting (enable via `ENABLE_OBSERVABILITY=1`)

### Changed

- **UI theme system:** replaced hardcoded colors with CSS custom properties — custom themes can now be applied by overriding variables
- **File upload limit:** reduced maximum file size from 500 MB to 50 MB
- **Translation pipeline:** automatically detects model type from `VLLM_TRANSLATION_MODEL_ID` — no manual config needed
- **Translation backend:** default mode changed from `cpu` to `auto` — the system picks the best available translation method
- **Guardrails:** content guardrail service is now disabled by default; enable explicitly if needed
- **Deployment:** consolidated to a single `docker-compose.yaml` supporting both local dev (`docker compose`) and production Swarm (`docker stack deploy`)
- **Deployment:** all persistent data centralized under `./data/` directory
- **Deployment:** configuration files consolidated into single `configs/` directory
- **Nginx security headers:** `Permissions-Policy` now configurable per environment
- **LLM token limit:** removed the arbitrary 1024 max_tokens default — the LLM can now generate full responses

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

### Fixed

- Mobile app sent timestamps in local time — now correctly uses UTC for analytics heatmaps
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
- All 14 locales aligned to strict key parity — 81 dead keys removed, 9 missing translations added
- Streaming SSE conversation marker leaks fixed — no more visible sentinel markers in chat output
- Label filters now correctly cleared when switching to Just Chat mode (#249)
- Cross-document label contamination fixed — chunk labels scoped to their document (#216)

## [R_1_0_0] - 2026-03-16

Initial release for El Salvador agricultural AI assistant deployment.

[R_1_0_0]: https://opensource.unicc.org/un/itu/genie-ai/-/tags/R_1_0_0
[2.0.0]: https://opensource.unicc.org/un/itu/genie-ai/-/compare/R_1_0_0...v2.0.0
[Unreleased]: https://opensource.unicc.org/un/itu/genie-ai/-/compare/v2.0.0...main
