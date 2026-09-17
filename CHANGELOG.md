# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **GPU OCR on dataprep:** `dataprep-arango-service` now declares `NVIDIA_VISIBLE_DEVICES=all` in the Swarm env (was previously unset, leaving the GPU-in-Docling/EasyOCR path inert despite `DOCLING_DEVICE=cuda` default). The v2.1.0 image already ships `torch==2.13.0+cu130` + `cuda-toolkit==13.0.3.0` + `nvidia-cudnn-cu13==9.20.0.48`, so no image rebuild is required. Requires a Swarm node with the `gpu == true` label and `nvidia-container-toolkit` installed (already in place for the 4 OPEA services).

### Changed

- **PII redaction moved from OTel SDK LoggerProvider to OTel Collector edge:** All fluentd-sourced logs now pass through `transform/pii_redact` on the `otel-collector` container BEFORE any enrichment, so the 19-key PII list (`configs/otel/pii-key-list.md`, CODEOWNER @jrevillard) is enforced at the export boundary into VictoriaLogs. Previously the in-process SDK LoggerProvider was the sole redaction path; logs arriving via the docker fluentd driver never went through it and reached VL unredacted. The new transform redacts both `body` string (JSON-style `"key":"value"`) and `attributes` Map (same regex via `replace_all_patterns`), with anchored `IsString(body)` / `IsMap(attributes)` guards so each statement runs against its native shape. A 4th statement handles the Map-body shape (fluentd-in_json parsed records) at the value-level regex floor. `transform/pii_redact` runs with `error_mode: propagate` for the first 30 days; downgrade to `ignore` after stabilization (a follow-up MR will flip the flag and update this entry).
- **Body-level `trace_id` stamping moved to OTel Collector transform:** The previous auto-injection happened inside the OTel SDK LoggerProvider, which is removed in T2/T3 of the same initiative. To preserve trace correlation on the fluentd path that has no SDK, `transform/set_trace_id_from_body` now reads `body["trace_id"]` (when the body is a Map and the value is a string) and promotes it to `attributes["trace_id"]` for trace correlation. `error_mode: ignore` matches the other always-run log transforms (`stamp_log_metadata_from_msg`, `stamp_service_name_from_container`) — propagate was unsafe because a body whose `trace_id` is itself a Map would crash the pipeline under propagate.
- **Log pipeline collapsed to single channel:** Every log record now traverses `Winston/python-logging → stdout → Docker fluentd driver → OTel Collector → VictoriaLogs`. The previous dual-channel architecture (SDK-direct via `OTLPLogExporter` + fluentd-driver-via-`fluentd_forward`) is gone. Trace correlation on the fluentd path is preserved via `transform/set_trace_id_from_body` (above). Operators reading `.env` no longer need to set `LOG_TO_VICTORIALOGS` or `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` — the docker logging driver carries every record to the collector regardless of env.

### Removed

- **`LOG_TO_VICTORIALOGS` env var** (was gating the in-process OTel SDK logs path). No longer read; the env var is harmless if set but the SDK LoggerProvider it gated is gone. Removed from `env`, `deploy/ansible/templates/env.j2`, and `docker-compose.yaml` propagation.
- **`OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` env var** (was the OTel logs exporter URL). No longer read; the docker fluentd driver uses its own collector address (`${OTEL_EXPORTER_OTLP_ENDPOINT}` for traces + metrics still applies, and the collector `fluent_forward` receiver is configured via the existing `*fluent-logging` anchor). Removed from `env` and `deploy/ansible/templates/env.j2`.
- **`LOG_TO_FILE` deployment propagation paths:** The `LOG_TO_FILE` env var still controls the runtime `booleanEnv('LOG_TO_FILE')` gate at `components/shared/lib/logger.js:107` (audit-retention escape hatch, Story 7-1), but its `env_file` propagation to the `backend` + `document-repository` services and the `${DATA_DIR}/logs/{backend,doc-repo}:/app/logs` bind mounts are removed from `docker-compose.yaml`. Operators setting `LOG_TO_FILE=1` to re-enable file transports now must manually re-add the `/app/logs` host bind mount (a 3-line cross-reference comment in `env` documents this).
- **`ADMIN_LOGS_SOURCE=file` body implementation:** The 22 file-source methods (`_getLogsInRangeFromFile`, `_searchLogsFromFile`, `_acquireReadLock`, `groupLogs`, `parseLogs`, `detectLogLevel`, etc. — ~1100 LOC) in `components/gov-chat-backend/services/logs-service.js` are dropped. The env contract is preserved (SPEC D2 + AD-6): `ADMIN_LOGS_SOURCE` is still read per-call by `_sourceMode()`, and `ADMIN_LOGS_SOURCE=file` with the default `LOG_TO_FILE=0` now returns HTTP 503 `VlFilesDisabledError` with body `{"error":"vl_files_disabled","message":"Set LOG_TO_FILE=1 to use file-based log source"}` — a loud failure rather than a behavioural switch. Re-enabling file-source behaviour requires the surviving `LOG_TO_FILE=1` escape hatch AND a manually re-added `/app/logs` bind mount.
- **OTel SDK `LoggerProvider` instantiation:** Dropped from `components/gov-chat-backend/tracing.js` (T2, -65 LOC), `components/document-repository/src/tracing.js` (T3, -61 LOC), and `genie-ai-overlay/tracing.py` (T2b, -180 LOC + `setup_logging()` removal). The `logs.setGlobalLoggerProvider` call sites are gone; no in-process OTel logs signal chain exists.
- **`VictoriaLogsTransport` winston transport** (`components/shared/lib/victorialogs-transport.js`) + **`PIIRedactingLogRecordProcessor extends BatchLogRecordProcessor`** (`components/gov-chat-backend/tracing-pii-logs.js` + the parallel `components/document-repository/src/tracing-pii-logs.js`): both deleted (T4). The `BatchLogRecordProcessor` chain that owned them is gone with the SDK LoggerProvider.
- **`_vlFilter` dedup in `logs-service.js:413-435`:** Dropped (T5). The `NOT fluent.tag:*` discriminator served dual-channel reconciliation between SDK-direct (`service.name=genie-*`) and fluentd-driver (`_stream:genie.*`) emits; single-channel invariant makes it dead code. `logs-service-vl.test.js` was updated to assert the q passthrough.
- **4 dead transport test files** (`T4b`): `logger-vl-integration.test.js`, `pii-body-scrubbing.test.js`, the parallel `tracing-pii-logs.test.js` (backend), and `victorialogs-transport.test.js` (shared/lib). All exercised the deleted OTel SDK logs chain.
- **OTel SDK logs-signal Python deps** from `genie-ai-overlay` Dockerfiles: `@opentelemetry/api-logs`, `@opentelemetry/sdk-logs`, `@opentelemetry/exporter-logs-otlp-http` (T2b).

### Fixed

- **PII redaction gap on the fluentd-driver path:** Previously the in-process `PIIRedactingLogRecordProcessor` only redacted logs that flowed through the OTel SDK chain; logs arriving via the docker fluentd driver never went through it and reached VictoriaLogs unredacted (most non-Node services + any process whose tracing.js crashed before init). The new `transform/pii_redact` runs at the collector edge and covers BOTH paths, closing the gap. The `otel-pii-redact-fail` alert rule (above) fires critical on any silent-regression.
- **Trace correlation broken on the fluentd path:** Body-level `trace_id` was previously auto-injected by the OTel SDK LoggerProvider. After the SDK removal, the fluentd path had no `trace_id` on its records, breaking trace↔log correlation in Grafana. `transform/set_trace_id_from_body` (above) reads `body["trace_id"]` from Map-body fluentd-in_json records and promotes it to `attributes["trace_id"]` so trace correlation is preserved.
- **fluentd buffer full under single-channel load:** With the SDK LoggerProvider gone, every record flows through the docker fluentd driver; under burst load (ingest peaks), the default 1 MB buffer + 3 retries saturated and Docker logged `Buffer full` errors, dropping records before they reached the collector. Bumped `x-logging` anchor to `fluentd-buffer-limit: 8MB`, `fluentd-max-retries: 5`, `fluentd-retry-wait: 2s` in `docker-compose.yaml` (T-fluentd-buffer).

### Security

- **PII redaction coverage now spans all log paths:** With the collector-edge redaction, no log record can reach VictoriaLogs with a redacted key unredacted regardless of ingestion path (OTel SDK LoggingHandler, docker fluentd driver, Winston envelope, etc.). The new `otel-pii-redact-fail` alert rule (`configs/grafana/provisioning/alerting/alert-rules.yml`) fires critical if the transform's dropped rate is > 0 or its accepted rate is flat for 15 minutes, so any silent-regression on the redactor is page-able.

## [2.1.0] - 2026-08-31

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
- **Backend CPU translation fallback crash:** When the GPU translation endpoint was unreachable, the CPU fallback crashed the backend at startup (EACCES on the transformers.js model cache and log directories owned by root while the image runs as uid 1000). Image directories are now pre-created writable, and fatal translation-worker errors fail fast with a clear message instead of hanging for the 20-minute init timeout. (#325)

### Security

- **Horizontal privilege escalation prevented:** Query message endpoints now validate that the requesting user owns the queried resource.
- **Dependency CVE remediation (GitLab Ultimate pipeline 6345, 2026-08-22):** Resolved 21 high-severity runtime CVEs across all JS components by bumping affected transitive and direct dependencies. Highlights: `protobufjs` 7.5.5 → 7.5.6 (5 CVEs including RCE via prototype pollution CVE-2026-44291, code injection CVE-2026-44293, DoS recursion CVE-2026-44289); `sharp` 0.32.6 → 0.35.0 (inherited libvips CVEs); `ip-address` 5.9.4 → 10.3.1 (SSRF via Address4 octal/decimal confusion CVE-2026-69192) via `geoip-lite` 1.4.10 → 2.0.3; `@opentelemetry/propagator-jaeger` 2.7.1 → 2.9.0 (DoS via malformed Jaeger header CVE-2026-59892); `js-yaml` → 4.3.1 across all manifests (quadratic CPU `!!omap` GHSA-5p4m-2wfm-xmqj); `dompurify` 3.2.6 → 3.4.14 (IN_PLACE hook XSS); `uuid`, `postcss`, `serialize-javascript`, `fast-uri` overrides; `@opentelemetry/core` 2.7.1 → 2.8.0 (unbounded memory W3C Baggage CVE-2026-54285).
- **Mobile AppAuth MITM vulnerability fixed:** The vendored `flutter_appauth` Android plugin previously wired an `InsecureConnectionBuilder` (which disables TLS certificate validation via a trust-everything `X509TrustManager`) into the `AuthorizationService` unconditionally at engine attach. Production now never instantiates an insecure service: `createAuthorizationServices()` lazy-instantiates the insecure service only when `allowInsecureConnections=true`, which only the dev and E2E configs set. Production flavors (`flavors/itu.dart`, `flavors/template.dart`) inherit `false` from `KeycloakConfig` and reach the secure path. An attacker on a hostile network (Wi-Fi, ISP proxy) can no longer MITM the Keycloak login flow on Android production builds.
- **SAST scan surface restricted:** `.gitlab-ci.yml` adds `SAST_EXCLUDED_PATHS` covering only dev/test-only paths (Windows desktop CMake runner, real-comps contract tests, jest test dirs, dev migration scripts, synthetic-data generators, coverage reports). The production Docker entrypoint `document-repository/scripts/clamav-node.sh` remains scanned. The previously advertised `SEARCH_IGNORED` variable was removed — it is not honored by any official GitLab SAST template.

- **Container least-privilege hardening:** All 37 compose services now run with `cap_drop: [ALL]`, `no-new-privileges`, and only the capabilities their entrypoints require. The GPU-node (`docker-compose.gpu.yaml`) and standalone-Arango compose files are hardened identically. **Breaking** for custom deployments with modified entrypoints: add the required `cap_add` to your overrides (#320, #324, #329)
- **Slimmed runtime images:** Backend, doc-repo, dataprep, retriever and reranker runtime stages moved to Debian slim bases with `apt-get upgrade` security-update layers at build time, removing the kernel-headers CVE surface; entrypoint/healthcheck tool inventory audited per image (#315)
- **keycloak-config image security updates:** The `adorsys/keycloak-config-cli` base (Ubuntu 24.04) now receives `apt-get upgrade` at build time, pulling published perl/p11-kit fixes on every rebuild (#328)
- **Crawler SSRF hardening:** Literal-IP validation (encoded-IPv4 normalization), DNS resolution checked against private ranges, and manual per-hop redirect revalidation (#318)
- **Dynamic `RegExp` hardening:** All interpolated `RegExp` construction sites escape their inputs or were refactored to plain string operations; the DNS safety layer gained dedicated tests (#319, #321)
- **Conversation key generation:** Backend uses `crypto.randomInt` instead of `Math.random` for conversation key suffixes (#318)
- **Frontend dev-server path containment:** The `gov-chat-frontend` static server restricts served paths to the project root (#323)
- **OPEA base images security patch:** `apt-get upgrade` layer added to the embedding/textgen wrappers, fixing openssl CVE-2026-31789 (#314)
- **Brace-expansion DoS overrides:** `brace-expansion` pinned above the affected versions across all four package locks (#323, #330)
- **file-type nested copy eliminated:** The transitive `file-type@16.5.4` under `mime-kind` (CVE-2026-31808, ASF parser infinite loop) is removed via a self-referencing override resolving to the direct 21.3.4 (#330)

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
[Unreleased]: https://opensource.unicc.org/un/itu/genie-ai/-/compare/v2.1.0...main
[2.1.0]: https://opensource.unicc.org/un/itu/genie-ai/-/compare/v2.0.1...v2.1.0
