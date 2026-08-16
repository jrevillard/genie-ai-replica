# Deferred Work

Items deferred during code reviews. Revisit when the related component is next modified.

---

## Initiative: mobile-oidc (2026-04 — 2026-05)

## Deferred from: code review of 3-1-applifecycle-token-validation (mobile-oidc, 2026-04-27)

- **Concurrent `validateTokens()` calls not guarded** — No mutex/re-entrancy guard on `validateTokens()`. Multiple `resumed` events can trigger overlapping async refresh flows. Known limitation documented in spec.
- **`validateTokens()` can race with `logout()`** — If user logs out while a lifecycle-triggered refresh is in-flight, the refresh may re-save tokens that logout deleted. Pre-existing issue, made more reachable by the lifecycle trigger. Root cause: no coordination flag between logout and validateTokens.
- **`validateTokens()` can race with `authorize()`** — If app resumes while user is mid-authorization flow, lifecycle validation could trigger a redundant refresh competing with the in-flight authorize.

## Deferred from: code review of 3-2-network-error-detection-recovery (mobile-oidc, 2026-04-28)

- **Lost state on app close after network error** — If app closes while state is `error` due to network error during refreshToken, on restart `_initializeAuth()` will attempt refresh with same stale tokens. Pre-existing.
- **Race condition: authorize() vs logout()** — If logout() is called during authorize(), tokens may be saved after logout. Pre-existing (async concurrent methods, out of scope).
- **Fragile keyword-based classification** — NetworkErrorClassifier uses keywords in error code. Documented as "best-effort heuristic" in spec, accepted as technical limitation.

## Deferred from: code review of 4-2-dart-flavor-config-keycloak-client-template (mobile-oidc, 2026-04-28)

- **No runtime validation of scheme coherence** — The 4-layer scheme coherence rule (Dart config, Android build.gradle, iOS XCConfig, .env) is well-documented but not enforced programmatically. A mismatch causes silent OIDC callback failure.
- **No backchannel logout configuration** — The mobile client lacks `backchannel.logout.session.required` and `backchannel.logout.url`. Not mentioned in spec, out of scope for this story.

## Deferred from: code review of 4-3-custom-url-scheme-per-deployment (mobile-oidc, 2026-04-28)

- **No automated enforcement for scheme coherence rule** — The coherence rule (Dart = Gradle = XCConfig = env) is documented but no lint/CI check prevents future mismatches.
- **Missing `webOrigins` in Keycloak mobile client config** — `genie-realm.yaml` mobile client has no `webOrigins`, potentially needed for Android App Links verification.
- **Non-flavored debug build collides with `itu` flavor** — `flutter build apk` without `--flavor` uses same `applicationId` as `itu`. Pre-existing.
- **`e2e_config.dart` missing `allowInsecureConnections: true`** for `http://localhost:8080` URL. Would cause OIDC flow failure if appauth enforces HTTPS.
- **Template flavor config has misleading scheme pattern** — `com.<institution>.genieai` vs actual convention `com.itu.genieai[.<suffix>]`.
- **`env` template hardcodes `KC_MOBILE_REDIRECT_SCHEME=com.itu.genieai`** — Not generic for new institutional deployments.

## Deferred from: code review of 4-4-deployment-onboarding-guide (mobile-oidc, 2026-04-28)

- **Air-gapped section lacks concrete DNS configuration example** — Guide mentions local DNS and /etc/hosts but provides no specific commands.
- **No Docker service health check before running verification commands** — Operators may run verification before keycloak-config finishes processing.
- **Missing key.properties file permissions warning** — Signing credentials file should be chmod 600 but guide doesn't mention permissions.
- **Missing dependency resolution troubleshooting** — `flutter pub get` failure is a common first-build error not covered in troubleshooting section.
- **App Store compliance requirements omitted** — Google Play Data Safety disclosure and Apple privacy manifests are non-optional for store submission but not mentioned.
- **Version code/name management across deployments** — App stores require unique version codes per submission; no guidance for managing these across multiple institutional deployments.

## Deferred from: code review of 6-1-user-service-migration (mobile-oidc, 2026-04-29)

- **RightSidebarComponent fallback accessToken removed** — If `widget.accessToken` is null, the operation is silently ignored. Dead code (cleanup story 6.2/6.3).
- **UserProfileProxy multipart Authorization header removed without replacement** — `UserProfileProxy` creates `ApiService()` directly, not in scope for this story.
- **FileProxy token null handling** — If `TokenStorage.getAccessToken()` returns null, upload proceeds without auth. Very rare edge case.

## Deferred from: code review of 5-1-password-reset-via-keycloak-browser (mobile-oidc, 2026-04-29)

- **`resetCredentials` flow verification in Keycloak Admin Console not documented** — If a previous deployment modified the browser authentication flow, the "Forgot Password" button may not appear even if `resetPasswordAllowed=true`. Pre-existing operational risk.

## Deferred from: code review of 6-5-auth-test-suite-ci (mobile-oidc, 2026-05-04)

- **`InsecureHttpClient` in production `auth_providers.dart`** — Class with `badCertificateCallback = true` in `lib/services/auth/`. Low risk since `allowInsecureConnections` defaults to `false` for all production flavors, but should be guarded by `kDebugMode` or moved to test-only to prevent accidental use.
- **`init()` signature change breaks backward compatibility** — `keycloak-auth-service.js`: `init(idpUrl, clientId)` → `init(idpUrl)`. Out of scope for this test story, introduced via Keycloak proxy chain infrastructure fix.
- **AC#7 Data preservation** — Marked "manual QA" but no procedure documented in completion notes. Manual verification not automated.

---

## Initiative: testing-framework (2026-05 — 2026-06)

## Deferred from: code review of 7-6-deploy-victorialogs-centralized-log-aggregation (2026-05-29)

- Fluentd driver drops logs when Collector is down — inherent tradeoff; dual logging keeps docker logs functional. No fallback mechanism.
- CSP headers may block Grafana WebSocket — nginx CSP `connect-src` for `/grafana/` location may not include `ws://`/`wss://` protocols needed for live dashboard updates. Needs runtime verification.
- OTel Collector global mode without resource limits — no CPU/memory limits on global-mode Collector instances could cause resource pressure on multi-node Swarm with many services.
- VictoriaTraces datasource reference in vlogs-datasource.yml — `derivedFields.datasourceUid: victoriatraces` references a datasource that doesn't exist yet (story 7.7). Trace ID link-outs will show "datasource not found" until story 7.7 is deployed.
- Volume backup/cleanup strategy for VictoriaLogs — named volume `vlogs-data` has no documented backup procedure. VictoriaLogs retention flag controls soft deletion only; compaction may be needed for disk reclaim.
- Dashboard variable refresh 2s too aggressive — service/level/trace_id variables refresh every 2s which creates unnecessary query load on VictoriaLogs with multiple concurrent dashboard users.
- Dashboard _stream_ shows `genie.` prefix — fluentd tag is `genie.{{.Name}}` so dropdown shows `genie.backend` instead of `backend`. Filter works but UX is suboptimal. Could strip prefix in dashboard variable regex.
- ENABLE_OBSERVABILITY type not enforceable in YAML — setting `true` instead of `1` causes Swarm replicas failure. Documented in env file but not enforceable.

## Deferred from: code review of 7-1-express-backend-otel-tracing-foundation (2026-05-28)

- OTel Collector absent from docker-compose — the env template references `otel-collector:4318` but no service is defined yet. Scope of story 7-5 (deploy observability stack).
- `npm_package_version` fallback to `1.0.0` — only set when running via `npm start`; direct `node index.js` falls back. Acceptable in Docker containers; limitation documented.

## Deferred from: code review of 1-3-create-ci-pipeline-test-stage (2026-05-19)

- Python venv recreated on every CI run despite cache restoration — `python -m venv .venv` in `before_script` recreates the venv even when cache restores it. Pattern is functional (venv creation is idempotent, pip skips installed packages) but wastes ~5-10s per run. Could be optimized with a conditional check (`if [ ! -d .venv ]; then python -m venv .venv; fi`).

## Deferred from: code review of 3-3-test-critical-vue-components-userprofile-and-admin-dashboard (2026-05-19)

- Deferred promise + setTimeout(300) not awaited — UserProfileComponent.loadUserProfileData has nested $nextTick + setTimeout(300) for country dropdown initialization; tests never await this, but country dropdown interaction is explicitly out of scope per spec "What NOT to Test" section. Revisit if country dropdown tests are added.
- SearchableCountryDropdown stub methods never called — stub defines manuallySetCountryName/loadCountries methods but setTimeout(300) prevents invocation during tests; country dropdown interaction is explicitly out of scope per spec. Revisit if country dropdown tests are added.
- AdminDashboard missing error handling edge cases — tests only cover happy path for service responses; null/malformed/missing response handling not tested but beyond current AC scope. Nice-to-have for future hardening.

## Deferred from: code review of 3-4-test-vuex-store-modules (2026-05-20)

- UPDATE_CHAT: empty string treated as "no change" — source code uses `title || state.chats[chatIndex].title` which treats `''` as falsy. Source code behavior, not a test issue. Pre-existing.
- Persistence plugin duplicated instead of imported — `persistence.test.js` replicates plugin logic instead of importing from `store/index.js`. Deliberate approach for isolation; duplication faithful to source. Pre-existing design choice.
- Missing edge cases (null inputs, duplicate IDs, localStorage quota) — future coverage improvement, not blocking for this story.

## Deferred from: code review of 3-5-test-http-services (2026-05-20)

- submitQuery edge cases (null queryId, empty response, non-string response) — source code edge cases beyond spec scope. Pre-existing.
- Partial PATCH failure in submitQuery (time recorded but not answered, or vice versa) — internal orchestration edge case. Pre-existing.
- Missing individual error tests (500/404/401) for every service method — error pattern is consistent across methods; tested for main paths. Nice-to-have hardening.
- Missing pagination edge cases (limit:0, negative offset) — source validation concern, beyond spec scope.
- Search term special characters and whitespace — source validation concern, beyond spec scope.
- Missing locale parameter inheritance test — service might have locale resolution bug when param omitted; nice-to-have.
- Missing folder reorder edge cases (duplicate orders, non-existent folders) — nice-to-have hardening.
- getComparisonData partial failure (first succeeds, second fails) — returns both null even on partial failure; source edge case.
- getTimeSeriesData/getUniqueUsersCount edge cases (null items in array, string values) — source data shape edge cases beyond spec scope.

## Deferred from: code review of 1-5-create-ci-pipeline-configuration-validation-stage (2026-05-20)

- GPU profile name detection hardcoded via `endsWith()` in validate-hardware.js:1016-1020 — fragile if new profiles are added; acceptable for current T4/RTX6000 profiles. Pre-existing design choice.

## Deferred from: code review of 1-6-configure-mr-blocking-and-scheduled-jobs (2026-05-20)

- GPU_AVAILABLE variable never set in CI config — follows spec exactly (spec prescribes `$GPU_AVAILABLE` check pattern); variable must be set at runner infrastructure level (runner config.toml or custom environment variable). Not a CI config concern.
- Missing Keycloak in integration test services — follows spec exactly (spec prescribes `backend frontend arangodb redis`); health check will reveal at runtime if Keycloak is needed. Deliberate minimal first pass per spec.

## Deferred from: code review of 2-1-refactor-backend-indexjs-to-export-createapp (2026-05-13)

- swaggerSpec/swaggerUi silent failure at module-level — if `swaggerJsdoc()` throws, the spec stays undefined and `/api-docs` silently unavailable. Pre-existing behavior, not introduced by the refactor.
- registerRoutes() without external try-catch — the function has internal per-route try-catch blocks but the call site itself is unwrapped. Pre-existing pattern.
- Route loading error handling inconsistency — failed routes are logged and skipped silently. Pre-existing design choice.
- Routes without service (auth-routes) not mounted when `services={}` — calling `createApp({ services: {} })` skips all route registration including routes that don't need services. This matches the AC spec ("routes mounted when services object is provided").

## Deferred from: code review of 2-3-test-backend-auth-route-handlers (2026-05-15)

- Unexpected error path in controller not tested — The controller's try/catch covers session errors but if `res.json()` or `JSON.stringify()` in the audit log throws, the behavior is untested. Pre-existing controller design.
- Sessions returned without _key property — If `getUserSessions` returns sessions missing `_key`, `endSession(undefined)` would be called. Depends on session-service contract guarantee. Pre-existing service contract assumption.

## Deferred from: code review of 4-1-configure-pytest-and-create-shared-fixtures-for-opea (2026-05-15)

- Missing comps submodule mocks for telemetry/retrievers/rerankers paths — `comps.cores.telemetry`, `comps.retrievers.src.*`, `comps.rerankings.src.*` not in sys.modules pre-population. Current list matches spec Dev Notes exactly; will be needed when stories 4.2-4.6 import actual service modules.
- Mock response shapes may need dict-access support — chatqna uses `data["choices"][0]["message"]["content"]` (dict access) while mocks provide attribute access only. Stories 4.2-4.6 may need to extend mock helpers for both access patterns.

## Deferred from: code review of 2-4-test-backend-chat-route-handlers (2026-05-15)

- db.collection mock pollution potential — `mockReturnValue` persists after `clearAllMocks`. No actual failure because tests that use `db.collection` re-define it.
- Edge cases pagination (negative values, non-numeric) — `parseInt() || default` handles these correctly. Defensive tests not critical.
- Test failure addMessage after createConversation — The route has no rollback. Error propagation edge case not in ACs.
- AC2: missing userId not tested on all routes — Good defensive practice but not required by AC2 which targets GET /conversations.
- AC6: default pagination values not tested — Correct behavior via `parseInt() || default`.
- **SECURITY**: `GET /query/:queryId/messages` has no userId validation — any authenticated user can access messages for any queryId. Pre-existing security gap, not introduced by this story. Route should validate ownership via `extractUserId(req)`.

## Deferred from: code review of 4-2-test-retriever-hybrid-search-logic (2026-05-16)

- Graph validation unreachable branch in source code — `has_vertex_collection` OR `has_edge_collection` check at line ~583-598 may allow a case where the collection is misconfigured and `db.collection()` raises an unhandled exception. Pre-existing source code issue, not introduced by the tests.

## Deferred from: code review of 4-3-test-dataprep-extraction-pipeline (2026-05-17)

- Race condition in ArangoGraph initialization during concurrent batch processing — production code concern in `genieai_dataprep_arangodb.py`
- File lock `fileno()` edge case when lock_file lacks file descriptor — production code concern
- Concurrent batch failure scenarios — complex concurrency testing out of scope for this story
- Orphan deletion with circular entity references — production edge case
- CancelledError propagation through concurrent batches — complex concurrency test
- Synonym matching plural/singular — not in AC scope, only case-insensitive required
- BM25 tokenization regex `r"\b\w+\b"` — inline regex mocked out in tests, would need extraction to test in isolation

## Deferred from: code review of 2-5-test-backend-analytics-and-categories-route-handlers (2026-05-17)

- getMetric fallback when service returns null/undefined — controller has a fallback for null values, untested. Controller scope, will be covered by story 2.7.
- Locale not tested on satisfaction endpoints — controller accepts a locale param on gauge/heatmap but tests don't verify its propagation. Nice-to-have beyond AC.
- Malformed JSON in filters param — `JSON.parse(req.query.filters)` can throw if JSON is invalid. Edge case not covered by AC4.
- Pagination with non-numeric limit/offset — `parseInt() || default` handles non-numeric cases. Edge case beyond AC7 scope.
- Search with empty query string — `?query=` vs query absent. AC14 covers the case without query param.
- categoryExists throws error (DB failure) — if service throws instead of returning false, route catch returns 500. Infrastructure edge case.
- DELETE service with non-404 error code — route checks `error.code === 404`, other codes fall into generic 500. Edge case beyond AC16 scope.

## Deferred from: code review of 2-6-test-backend-admin-and-files-route-handlers (2026-05-18)

- Auth guard tests cover only 2/15 endpoints — AC1 says "all" but only system-health (GET) and security-scan (POST) tested. Representative sampling sufficient since middleware applied at router level via `router.use()`. Pre-existing test design pattern.
- Security endpoint error response shapes inconsistent — Three security endpoints return different error shapes: `{ message }`, `{ success, message }`, `{ error, message }`. Tests correctly document this. Pre-existing API design issue.

## Deferred from: code review of 4-4-test-core-type-definitions-and-api-protocols (2026-05-17)

- RetrievalRequestArangoDB serialization/deserialization not tested (AC #2) — The OPEA mock base class (`type("RetrievalRequest", (), {"__init__": lambda self, **kw: None})`) prevents `model_dump()` and dict deserialization because the model is not a real Pydantic BaseModel. To test properly: run integration tests inside the Docker container where the real `comps` library is available, or create a Docker-based test stage in CI that runs `pytest tests/test_core.py -k "RetrievalRequest"` with OPEA deps installed.
- RetrievalRequestArangoDB constructor kwargs not verifiable — The mocked base `__init__` swallows all kwargs, so `RetrievalRequestArangoDB(graph_name="X")` does NOT set `self.graph_name = "X"`. Tests correctly verify annotations and attribute assignment instead. To test properly: same as above — integration tests in Docker with real OPEA deps, where the Pydantic base class handles field assignment correctly.

## Deferred from: code review of 4-5-test-reranker-score-validation-and-top-k-constraints (2026-05-18)

- TEI error handling not tested — Production code has no try/except around aiohttp call (genieai_tei_reranker.py:67-71). Network errors, HTTP failures, and malformed JSON responses will propagate unhandled. Pre-existing production code gap.

## Deferred from: code review of 4-6-test-chatqna-orchestrator-interface (2026-05-18)

- `assert` in production in `align_outputs` RETRIEVER branch (genieai_chatqna.py:575,587) — crashes service on metadata count mismatch rather than graceful degradation
- `file_metadata["labels"]` unguarded dict access (genieai_chatqna.py:1684) — KeyError if document repository returns unexpected metadata format
- `runtime_graph.downstream(cur_node)[0]` IndexError (genieai_chatqna.py:604) — crashes when downstream list is empty
- `assert isinstance(data, list)` in EMBEDDING output (genieai_chatqna.py:550) — production crash on unexpected embedding service response format
- Bare `dict[key]` access in `align_inputs`/`align_outputs` at multiple locations (lines 367, 395, 420, 515, 516, 537, 551, 760) — KeyError/IndexError on unexpected service data
- MagicMock truthiness hides parameter fallback logic in `handle_request` — `chat_request.max_tokens if chat_request.max_tokens else 1024` always selects MagicMock (truthy), masking regression in default-value logic
- 3/5 `add_remote_service*` variants untested — `add_remote_service_faqgen()`, `add_remote_service_without_translation()`, `add_remote_service_genieai()` have zero test coverage
- Index out-of-bounds in retrieved_docs lookup — `input.retrieved_docs[best_response["index"]]` (genieai_tei_reranker.py:80, 89, 105, 111) has no bounds check. A buggy TEI response with index >= len(retrieved_docs) will crash with IndexError. Pre-existing production code vulnerability.
- KneeLocator single-doc / flat-score edge cases not tested — When there's only 1 document or all scores are identical, KneeLocator behavior is untested. Nice-to-have, not required by AC.

## Deferred from: code review of 2-7-test-backend-service-layer (2026-05-18)

- Worker thread mock does not simulate async flow — mock Worker provides `on`/`postMessage`/`terminate` but never simulates event emission. Current tests work because OPEA worker code is not called directly. Nice-to-have improvement.
- Pagination: only one scenario tested — `searchQueries` tested with total=25 and pageSize=10. Boundary scenarios (exact boundary, zero results) would be a plus.
- User profile `process`: indirect coverage — `process` method (custom settings aggregation) only tested via `updateUserProfile`. Direct tests would add robustness.
- Translation backend fallback: theoretical race risk — GPU→CPU fallback test manually assigns `translationService.backend`. Theoretical risk if service caches the backend.
- Chat history: edge collection query patterns — ArangoDB graph traversal patterns (bidirectional edge, edge existence check) are complex to mock and not tested directly.

## Deferred from: code review of 2-9-test-backend-admin-and-security-services (2026-05-26)

- Date calculation in test setup without Date mocking — midnight boundary flakiness risk in logs-service.test.js (new Date() calls without mocking). Extremely unlikely edge case, tests pass in CI.
- ResourceUsageMonitor 30s cache behavior untested — getResourceUsage() caches for 30s but no test verifies cache hit/miss with mocked Date.now(). AC1 satisfied, nice-to-have hardening.
- SecurityScanService worker thread / async pattern edge cases — processLogsInParallel() with Worker threads, timeouts, and concurrent file processing has limited edge case coverage. Worker thread mocking is extremely complex, ACs satisfied.
- LogsService file size limit edge cases — MAX_LOG_FILE_SIZE (20MB) and MAX_LINES_TO_PROCESS (200000) constants exist but edge cases around partial reads and corrupted gzip not fully tested. Happy path tested, hardening beyond AC scope.
- Date/time edge case coverage — DST transitions, timezone boundaries, leap years not explicitly tested across all services. Luxon handles these, testing is nice-to-have hardening.

## Deferred from: code review of 3-2-test-critical-vue-components-chatbot-and-navbar (2026-05-19)

- Error recovery: no test verifying user can send a new message after streaming error — improvement beyond AC scope. The current tests verify error display (AC5) but don't confirm the component resets to a usable state after onError. Should add a test that sends a message, triggers onError, then sends another message successfully.

## Deferred from: code review of 5-1-create-document-repository-test-fixtures-and-mocks (2026-05-20)

- JWT timestamps frozen at module load (`mockJwtPayload.js:8-9,39`) — `Math.floor(Date.now() / 1000)` evaluates once at import time. Tests get stale values but this actually makes tests deterministic. Pre-existing test helper pattern.
- `cleanClamAV`/`infectedClamAV` shared singletons with mutable `jest.fn()` state (`mocks/clamav.js:27,32`) — Standard Jest module-level singleton pattern. Jest's default isolation resets module state between test files. Pre-existing test pattern.

## Deferred from: code review of 5-2-test-file-upload-download-search-and-delete-endpoints (2026-05-20)

- ~80 lines identical mock setup duplicated across 4 route test files — self-contained mocks improve test isolation at the cost of DRY. Common test pattern in this project.
- Download test accepts both 200 and 500 (`download.test.js:106-134`) — `sendFile` fails without real filesystem. Test verifies controller logic up to sendFile call. Would need temp file creation for stronger assertion.
- CRLF sanitization test passes vacuously when `content-disposition` header absent (`download.test.js:175-197`) — same root cause: sendFile fails before header is set.

## Deferred from: code review of pre-existing integration tests discovered during Epic 5 (2026-05-20)

- labelService mock inconsistency — methods assigned per-test via `labelService.getLabels = jest.fn()` instead of `jest.mock()` factory like all other services. Pre-existing test design pattern in `labelRoutes.test.js`.
- GET label by ID "not found" returns 500 — production controller wraps all errors in generic 500. Test correctly documents current behavior (`labelRoutes.test.js:133-138`).
- PATCH /api/files/:fileId bypasses metadataService for raw AQL — production code design choice where controller queries DB directly. Pre-existing.
- DELETE label "has children" returns 500 instead of 409 — production controller returns generic 500 for all service errors. Test correctly documents current behavior (`labelRoutes.test.js:193-197`).
- GET related labels mock response shape mismatch — mock returns flat array `[{_key, name}]` but real service may return structured objects. Mock reflects minimum needed for route test (`labelRoutes.test.js:213-221`).

## Deferred from: code review of 5-3-test-file-service-business-logic (2026-05-20)

- Six untested public methods — `uploadLink`, `getCrawlMetrics`, `updateCrawlMetrics`, `addCrawlLog`, `getCrawlLogs`, `killCrawlTask` have zero test coverage. Pre-existing gap.
- Empty string bypass in delete — `storage_path: ""` is falsy so `storagePath && fs.promises.unlink` skips cleanup silently. Pre-existing production behavior.
- Missing status default — upload test expects `dataprep.status = 'Pending'` but doesn't verify the code sets this default explicitly. Pre-existing production behavior.
- AC5 (ingestion triggers) NOT SATISFIED — no test verifies dataprep pipeline trigger after upload. fileService sets `dataprep.status = 'Pending'` but doesn't trigger pipeline; trigger happens at different layer. AC wording ambiguous.
- AC4 (delete cleanup) gap — delete test verifies metadata removal and unlink but not underlying AQL `REMOVE`. Pre-existing test gap.
- Silent partial success on upload — if metadata save succeeds but file write fails, uploaded file remains as orphan. Pre-existing production gap.

## Deferred from: code review of 5-4-test-security-middleware-and-metadata-services (2026-05-20)

- File type validation tests in security.test.js are tautological — validateFileType is fully mocked; tests assert only mock return value. Real validation logic has zero coverage from these tests. mimeTypeValidator.test.js covers helpers but not validateFileType itself.
- Auth middleware success path untested — no test verifies successful JWT verification populating req.user. mapRole, authorizeRole, isPublicRoute (for paths other than /health) also untested. Missing error paths: empty Bearer token, azp validation, JWTClaimValidationFailed, getJWKS 503.
- securityService.initialize()/ensureInitialized() untested — ClamAV init path has zero coverage. All scanBuffer tests bypass init by setting isInitialized = true directly.
- validateFileType has zero real test coverage — mimeTypeValidator.test.js covers helpers only, not the main function performing extension checking, MIME validation, and magic-byte detection.
- getFileCategory and isTextExtractable not tested with null/undefined input — will throw on mimeType.includes(). Missing application/msword test for isTextExtractable.
- getDb mock pattern fragile in metadataService.test.js and labelService.test.js — jest.fn() replacement instead of jest.spyOn prevents automatic restoration. Pre-existing test design pattern.
- || vs ?? in extractMetadata — source uses fileInfo.file_size || stats.size treating file_size: 0 as falsy. Same for file_hash: '' and publish: 0. Source code design decision.
- labelService.test.js missing mocks for shared-lib and appConfig — relies on moduleNameMapper and real config loading. Pre-existing test design.
- deleteLabel missing error path for non-existent label — remove() can throw ArangoDB 1202. getRelatedLabels also missing error path for non-existent key.
- updateMetadata source has dead code — 'labels' branch in field filter can never execute since 'labels' is not in allowedFields. Pre-existing source code concern.
- 50MB buffer allocation in oversized buffer test — slow and memory-intensive. Pre-existing test design.
- AC6 (EICAR fixture from Story 5.1 mocks) NOT SATISFIED — shared mocks imported but unused; each test creates inline mocks instead. AC2 PARTIALLY SATISFIED due to tautological mocking.

## Deferred from: code review of 1-6-configure-mr-blocking-and-scheduled-jobs round 2 (2026-05-21)

- BUILD API enabled in socket proxy (`docker_socket_proxy_build: "1"`) — security/infrastructure decision enabling docker build through the proxy. Pre-existing configuration choice.

## Deferred from: code review of 1-7-configure-ci-caching-and-path-based-triggers (2026-05-21)

- Flutter SDK cache key lacks OS/architecture component — `.flutter_base` template uses `flutter-sdk-${FLUTTER_VERSION}` without `${CI_RUNNER_EXECUTABLE_ARCH}`. Cross-architecture runners could corrupt each other's SDK cache. Pre-existing issue in template not changed in this diff.
- Patrol E2E cache fallback_keys inheritance — `patrol:e2e` job may override `.flutter_base` cache block instead of extending it, missing the new fallback_keys. Verify at runtime.
- AC6 pipeline time budget — NFR can only be verified at runtime with actual CI execution. Estimated 4-5 min, well within 10 min budget. No code change needed.

## Deferred from: code review of 1-8-e2e-playwright-tests-for-chatbot-interaction-flows (2026-05-21)

- Token expiry in long-running chat sessions — tests run up to 120s but don't handle token expiration mid-stream. Architectural concern beyond E2E test scope; would require Keycloak token refresh in test helpers.
- CI cache key doesn't include Playwright version — cache uses only `package-lock.json` prefix, same pattern as story 1.7. If Playwright version changes, cached browsers may be incompatible. Follows established project pattern.
- Hardcoded test user credentials (`testuser/TestPass123!`) — follows existing E2E pattern across all epic1/epic2/epic3 tests. Should come from env vars for multi-environment support but consistent with project convention.
- AC6 performance not verified — requires running the full suite against deployed stack. 30m timeout is set in CI config but actual execution time can't be verified from diff alone.

## Deferred from: code review round 2 of 1-8-e2e-playwright-tests-for-chatbot-interaction-flows (2026-05-23)

- ADB Keepalive race condition in patrol-wrapper.sh — Phase 1/Phase 2 race on APK file detection. Pre-existing mobile infrastructure.
- socat process not killed on error — background process leak in mobile E2E CI section. Pre-existing.
- Fix loop potential infinite loop in patrol-wrapper.sh — no absolute timeout on test_bundle.dart wait. Pre-existing mobile infrastructure.
- Environment variable validation missing in patrol-wrapper.sh — no validation of empty KC_PWD. Pre-existing mobile infrastructure.
- Playwright workers: 1 hides concurrency bugs — intentional trade-off for CI stability, serial execution prevents resource contention.
- Progressive rendering test may flake on slow runners — 5×1s polling window adequate for Docker network but could miss progressive rendering on very slow backends. Passes in CI (1.0m total).

## Deferred from: story 2-10 checklist review — architecture inconsistency (2026-05-26)

- **Backend controller layer inconsistency** — 2 of 12 route files use the Controller → Service pattern (`auth-routes.js` → `authController.js`, `analytics-routes.js` → `analyticsController.js`), while the other 10 routes call services directly. Additionally, `adminController.js` (314 lines) is dead code — never imported anywhere, superseded by `admin-routes.js` calling services directly after the singleton refactor (commit `cd1e94802`, April 2026).

  **Current state:**
  - `authController.js` (48 lines) — used by auth-routes, orchestrates logout (multi-service: session-service + audit log)
  - `analyticsController.js` (253 lines) — used by analytics-routes, provides HTTP validation + data transformation + metric mapping with fallbacks
  - `adminController.js` (314 lines) — dead code, 0 references in codebase

  **Options to resolve (deferred to future initiative):**
  1. Standardize to direct service calls — delete all 3 controllers, migrate auth/analytics logic into route files
  2. Standardize to controller pattern — create 8 missing controllers, reattach adminController
  3. Accept current mix — document as intentional, delete only dead adminController.js

  **Testability impact:** No practical difference — `createApp()` + supertest route tests cover both patterns equally. Controller pattern allows isolated unit testing of validation/transformation logic, but route-level integration tests provide the same coverage.

  **Recommendation:** Option 3 (accept + cleanup dead code) is the pragmatic choice. Refactoring 10 routes to add controllers (or migrating 2 to remove them) is low-value churn with no testability or reliability improvement.

## Deferred from: code review of story 2-10 (2026-05-26)

- SSE streaming complex error paths untested — query-routes.js has extensive error handling (metadata failures, translation failures during streaming, client disconnect, keepalive timers, res.writableEnded checks) not exercised by tests. Query-routes coverage 74.2% vs 100% for simpler routes. Root cause: complex stream pipeline with axios, SSE protocol, external service calls. Future SSE-specific test story recommended.
- GDPR delete cascade and idempotency — DELETE /api/me test verifies keycloakProxyService.deleteUser is called but doesn't test cascade cleanup (ArangoDB data, analytics) or idempotency (double-delete). GDPR compliance testing should be a dedicated story.
- Auth middleware edge cases in route tests — routes check req.user?.iss_sub but tests always mock req.user in beforeEach. Testing middleware-level edge cases (undefined req.user, missing iss_sub) is a middleware testing concern, not route testing.
- Translation type validation edge cases — empty array for texts[] and empty string for markdown beyond spec AC4 scope.
- Service locale validation — routes accept any locale without validation. Invalid locales passed to service layer is a service-layer testing concern.
- Query parameter parseInt edge cases — GET / uses parseInt() for limit/offset without NaN/negative validation. Pre-existing route design.
- Multipart file upload edge cases — PUT /api/me uses multer with size limits; tests don't cover oversized files, multiple files, invalid types. Multer config testing beyond route scope.

## Deferred from: code review of 3-7-test-frontend-design-system-components (2026-05-26)

- DsCombobox keyboard navigation tests (ArrowUp/Down, Enter, Escape) — complex interaction testing beyond basic unit scope
- DsCombobox click-outside close behavior — requires attachTo + event simulation
- DsModal focus trap test — JSDOM lacks focus management
- DsModal scrollable body overflow-y test — JSDOM CSS limitation
- DsModal close-on-Escape keydown test — event listener lifecycle complexity
- DsPill/DsStatusTag minimal coverage, no interaction tests — pre-existing, AC only requires variants+slots
- No accessibility tests beyond DsModal — pre-existing, broader concern beyond this story scope
- DsButton invalid variant not tested — pre-existing, validator warning not in AC
- DsInput textarea rows only one case tested — pre-existing, single case sufficient for AC
- DsCombobox mousedown .prevent not tested — pre-existing, JSDOM limitation

## Deferred from: code review of story 3-8 (2026-05-27)

- `handleViewInternalFile` method untested in FileDetailsDialog.vue:916-1061 — requires XHR/Blob/new-window mocking beyond JSDOM capabilities, coverage targets met

## Deferred from: code review of 1-10-test-flutter-service-layer (2026-05-26)

- AppAuth interface-only tests — FlutterAppAuth requires platform channels; only interface contract verifiable in unit tests. Documented limitation in completion notes. [app_auth_test.dart]
- ConnectivityService concurrent state changes untested — `_isChecking` guard exists but concurrent async testing is complex; better suited for integration tests. [connectivity_service_test.dart]
- NotificationService stream controller lifecycle — `_controller` never closed; service design issue beyond test scope. [notification_service_test.dart]
- ConnectivityService dispose/timer cleanup untested — Timer cancellation and stream closing after dispose requires platform-dependent testing. [connectivity_service_test.dart]
- Connectivity checker periodic testing + DNS timeout — Periodic checks and DNS timeout scenarios require `connectivity_plus` plugin; not achievable in unit tests. [connectivity_checker_test.dart]

## Deferred from: code review of 1-11-test-flutter-design-system-and-core-components (2026-05-27)

- AppTokens malformed config edge cases — Tests don't verify behavior with null config, wrong-type values (e.g., `theme: "string"` instead of map), or missing nested keys. `fromConfig()` uses `as Map<String, dynamic>?` casts which could throw on malformed input. Beyond current AC8 scope, deferred to hardening pass.
- I18nService translate fallback not tested — `tr()` fallback returns the key itself when no translation exists (line 114 of i18n_service.dart). This behavior is never verified in any test. Pre-existing gap, not introduced by this story.
- ColorUtils.withAlpha boundary values — Only 0.5 and 1.0 alpha values tested; missing 0.0 (fully transparent), negative values, and values > 1.0 to verify clamping. Minor, beyond AC7 scope.

## Deferred from: code review of 2-11-test-backend-chat-history-completion-and-database-operations (2026-05-27)

- Route tests check only HTTP status, not error response body structure — pre-existing test pattern across suite, nice-to-have hardening
- Weather service tests use hardcoded 2026 dates in mock data — mock data processed as-is by code, no runtime date validation concern
- deleteFolder cascade test doesn't verify removal calls — test verifies no-throw but not specific side effects
- Service category test relies on implementation-specific default name 'Category 1' — fragile to implementation changes in category naming logic
- Weather service missing coordinate boundary tests (±90, ±180) — one out-of-bounds case tested, exact boundary values untested
- Test isolation: process.exit mock in global scope — pre-existing test infrastructure pattern in chat-history-service tests
- key-handler edge cases (Unicode, 254-char boundary) not exhaustive despite 100% coverage — additional edge case hardening

## Deferred from: code review of 7-2-opea-services-otel-tracing-chatqna-retriever (2026-05-28)

- TEI embedding calls from Retriever lack trace propagation — OPEA framework internal HTTP client not instrumented; httpx auto-instrumentation only in ChatQnA. Out of scope for this story, requires OPEA-level instrumentation.
- Test mocks don't verify actual span export behavior — unit tests mock OTLPSpanExporter at class level, giving false confidence in URL construction. Testing philosophy concern; integration test with real collector would be separate effort.
- OTLP URL double `/v1/traces` if operator sets wrong env var — `rstrip('/')` handles trailing slash but not duplicate path. Operator error, documented in env template. Not worth adding runtime detection.
- Chunk count stays 0 if OPEA response format changes — telemetry robustness concern, not functional. Fallback to 0 is safe.
- Streaming responses close orchestration span before first token — known limitation of current span model. Streaming trace correlation would need a different span architecture (event-based spans).

## Deferred from: code review of 7-4-end-to-end-trace-propagation-and-log-correlation (2026-05-29)

- Full-chain trace ID integration test (AC5) — requires running services (Backend → ChatQnA → Retriever → Reranker → LLM) to verify a single trace_id propagates across the entire chain. Unit tests verify individual service propagation; end-to-end integration testing deferred to a dedicated observability integration test story.

## Deferred from: code review of 7-5-deploy-observability-stack-collector-victoriametrics-grafana (2026-05-29)

- Dashboard metric names may not match OTel→Prometheus conversion — `http_server_duration_*` in dashboards should match OTel→Prometheus remote write conversion (`http.server.duration` → `http_server_duration_*`). Likely correct but verify after first deploy by querying VictoriaMetrics `api/v1/label/__name__/values`.
- Prometheus Remote Write / batch processor tuning under high load — out of MVP scope per spec ("basic batch processor only"). Revisit if Collector OOM or data loss observed in production.
- No volume backup/retention policy documentation — `vm-data` and `grafana-data` volumes lack backup procedures. Operational concern for production deployments.
- Dashboard JSON lacks schema validation in CI — complex manually-created JSON files not validated against Grafana schema. Pre-commit hook or CI step would catch malformed dashboards before deploy.
- Dashboard variable query fails when no metrics exist (fresh deploy) — `label_values(http_server_duration_count, service_name)` returns error before first request. Expected Grafana behavior, resolves once traffic flows.
- Volume name collision in Swarm multi-node deployment — named volumes `vm-data`/`grafana-data` have no node placement constraints. Spec is single-node; multi-node would need volume driver or placement constraints.
- Dashboard refresh interval (10s) may overload VictoriaMetrics with many concurrent users — low risk for MVP single-team usage. Consider increasing to 30s for production.
- Missing depends_on for Grafana→VictoriaMetrics in compose mode — nice-to-have startup ordering; services work without it. Swarm ignores depends_on.
- OTel Collector logging exporter generates high stdout volume under load — `loglevel: info` intentional per spec (Option A MVP: traces logged to stdout). Consider `warn` for production with separate trace backend.

## Deferred from: code review of 7-8-instrument-application-metrics (2026-06-04)

- PII nested attributes not filtered — Current sanitization only matches exact top-level keys (e.g., `user_id`). Nested keys like `user.email` pass through. Not a risk with current code (flat attrs only) but worth hardening if attribute shapes change.
- Metric export interval hardcoded — `export_interval_millis=15_000` in tracing.py is not configurable. Reasonable default, but should be tunable via env var for different deployment scenarios.


## Deferred from: code review of 7-11-observability-slos (2026-06-08)

- Alert threshold too sensitive / storage threshold context-blind — Hardcoded 1GB and 0.5 rows/sec thresholds not configurable per deployment.
- No documented rollback procedure for alert rules — No emergency rollback docs if bad alert rules deployed.
- Notification repeat_interval 4h for critical alerts — May be too slow for collector-down response.
- Alert thresholds not tunable via env var — Magic numbers hardcoded in alert rules.

## Initiative: contextual-retrieval (2026-06)

## Deferred from: multi-goal split of spec-contextual-retrieval (2026-06-26)

- **Part B — Retriever hybrid BM25 + RRF fusion (SOTA Contextual Retrieval recipe, part 2 of 2)** — Part A (`spec-contextual-retrieval`, dataprep) stores per-chunk contextualized text in vertex `text`. Part B consumes it: (1) create an ArangoSearch BM25 view over `{GRAPH}_SOURCE.text` at retriever init (`_initialize_client`, ~line 170) — no BM25 view exists today (vector ANN view auto-created by `langchain_arangodb.ArangoVector` only); (2) add a BM25 query path via `self.db.aql.execute()` with ArangoSearch `BM25()` (pattern: file_id AQL at retriever ~line 803); (3) Reciprocal Rank Fusion (RRF) of dense (vector ANN, existing `ArangoVector.asimilarity_search_with_relevance_scores` ~line 778) and sparse (BM25) candidates, inserted after vector `search_res` (~line 787) and before graph traversal (~line 818), in `invoke()` `genie-ai-overlay/retriever/genieai_retriever_arangodb.py`; (4) gated by `HYBRID_BM25_ENABLED` (default off) + knobs `BM25_TOP_K`, `RRF_K=60`, `RRF_DENSE_WEIGHT`, `RRF_SPARSE_WEIGHT` in `genie-ai-overlay/retriever/config.py` after line 221. Text field const `ARANGO_TEXT_FIELD="text"` (line 75). Reranker untouched (separate microservice; receives fused list via retriever microservice wrapper, ~line 114-147). Tests: `test_retriever.py` `TestInvoke` pattern; mock `db.aql.execute` (existing pattern ~line 293) + `ArangoVector`. Independent of A but compounds: with A's contextualized `text` → "contextual BM25" (full SOTA). Works standalone as raw-text BM25 hybrid. Research: `_bmad-output/planning-artifacts/research/deep-research-labeling-retrieval-report.md`.


## Initiative: issue-834 / dataprep-cold-cache-build (2026-07)

## Deferred from: MR !231 dependency-lock introduction (2026-07-03)

- **OPEA bump v1.3 -> v1.4+ retires most of the issue-834 machinery** — The lock + pin + CI gates added by MR !231 exist BECAUSE OPEA v1.3 ships an unpinned `requirements.txt`. OPEA v1.4+ switched to `requirements.in` + compiled `requirements-cpu.txt`/`-gpu.txt` with `uv pip compile --generate-hashes` upstream (audited: v1.4 pins `docling-core==2.37.0`, v1.5 `docling-core==2.44.2` — both below the 2.83.0 `legacy_doc` removal). On bumping OPEA, the following become REDUNDANT and should be removed to avoid carrying dead divergence:
  - `genie-ai-overlay/dataprep/requirements.in` + `requirements.lock` (replace with OPEA's compiled `requirements-cpu.txt`; GPU image variant may use `requirements-gpu.txt`).
  - `genie-ai-overlay/dataprep/scripts/generate-requirements-in.sh` (OPEA now provides the `.in`).
  - The `docling-core==2.82.0` pin (upstream pins correctly).
  - The `openai-whisper` drop (re-evaluate: v1.4 keeps whisper; its build may be fixed or the path exercised).
  - `Makefile` targets `lock-dataprep` / `requirements-in-dataprep` (or repoint them at OPEA's `.in`).
  - `verify:dataprep-lock` CI job (OPEA ships the lock; drift check may still add value if we patch their `.in`, but the current "compile from our .in" logic goes away).
  - The `pip install --upgrade pip setuptools wheel` + `--no-deps --require-hashes` Dockerfile block (keep `--require-hashes` if we consume their compiled lock, but the patched-`.in` pipeline is gone).
  - KEEP `smoke:dataprep-arango` (runtime import check is valuable independent of how deps are resolved — catches any future docling-style ImportError, upstream-pinned or not).
  - KEEP the `opencv-python` -> `opencv-python-headless` decision if the image is still displayless (re-confirm against v1.4 reqs).
- **Dockerfile requirements-patch rewrite (mandatory on bump)** — `ARG REQ_PATH=/app/comps/dataprep/src/requirements.txt` and the sed/`fix_dependencies.sh` blocks target a file that no longer exists in v1.4. Rewrite to target `requirements-cpu.txt` (and adjust pins: `pyspark==4.0.0`, `pathway` line is dead, `unstructured[all-docs]` sed is a no-op). See the v1.3->v1.4 audit in MR !231 description.
- **`fix_dependencies.sh` is shared by reranker + retriever** — Do NOT delete it in the dataprep-only bump; only the dataprep Dockerfile stops using it (already done in MR !231). Reranker/retriever still consume it until they migrate to locks too (separate follow-up).
- **Apply the lock pattern to retriever/reranker** — They use `python:*-slim` (modern pip) so they don't hit issue #834, but the same determinism + SBOM story applies. Out of scope for #834; pick up when those images next change.


## Initiative: quick-help-service-labels (2026-07)

## Deferred from: spec-quick-help-service-labels adversarial review (2026-07-07)

- **Localized `categoryLabel` breaks AND-strategy retriever deployments** — chatqna now applies `categoryLabel` (singular) as a retriever filter (the plural `categoryLabels` bug that made it dead was fixed in `_build_filter_labels`). But the frontend `getCategoryLabelById` returns `category.name` from `serviceTreeService.getAllCategories(locale)` — the LOCALIZED name (e.g. "Cultivos" in ES). Retriever chunks carry English labels; exact-match filter. Under the default `ARANGO_FILTER_STRATEGY=OR` this is benign (serviceLabels still match; the mismatched category label just fails one OR branch). Under `AND` strategy, every non-English user gets 0 chunks on any sidebar category selection. Fix: backend should resolve `categoryId -> nameEN` before forwarding (data model has `nameEN`), or FE sends `nameEN`. Verify el-salvador uses OR before treating as urgent. Files: `components/gov-chat-frontend/src/components/ChatBotComponent.vue` (`getCategoryLabelById`), `components/gov-chat-backend/services/query-service.js`, `genie-ai-overlay/chatqna/genieai_chatqna.py` (`_build_filter_labels`).
- **Mobile `_sendNonStreaming` drops Quick Help `serviceLabels`** — `_sendStreaming` was updated to send `_activeServiceLabels` in the context block, but `_sendNonStreaming` (used when `streamBaseUrl` not provided) builds `ApiQueriesPostRequest(categoryId: _selectedCategoryId)` with no context field — Quick Help labels silently dropped. Also no `_activeServiceLabels` reset on non-streaming success/error. Fix: add `context.serviceLabels` to the non-streaming request (requires OpenAPI spec extension) OR document Quick Help as streaming-only. Low severity — streaming is the default path.
- **Missing FE tests for G1 (sidebar serviceKey) and R3 (mismatch warning emission)** — spec T14 lists these; code is correct but tests not added. Add: (1) `handleTreeNodeSelected` under ES locale asserting `serviceKey==='Tomato'` + `service==='Tomate'`; (2) `checkContextConfig` with a non-matching label asserting `chatbot.serviceLabelMismatch` warning emitted and returns `true` (mismatch is informational, not blocking). File: `components/gov-chat-frontend/src/__tests__/components/ChatBotComponent.test.js`.

## Deferred from: code review of 2-1-okf-server-skeleton-deploy (2026-08-12)

- **Ansible `env.j2` double-prefix bug** — `env.j2:376` emits `GENIE_AI_{{ img.name | upper | replace('-','_') }}_IMAGE`, which for `genie-ai-okf-server` produces `GENIE_AI_GENIE_AI_OKF_SERVER_IMAGE`, while `docker-compose.yaml` reads `${GENIE_AI_OKF_SERVER_IMAGE}` (single prefix). Systemic across ALL 17 services (frontend/backend/… all generate the double prefix). Deploys still work because compose falls through `${GENIE_AI_*_IMAGE:-${GENIE_AI_REGISTRY}/<name>}:${GENIE_AI_*_IMAGE_TAG:-${GENIE_AI_GLOBAL_TAG}}` to the global tag; only per-image `image_tag_overrides` are silently lost. Fix (global): either change `env.j2` to strip the `GENIE-AI-` prefix before upper-casing, or change compose to reference the double-prefixed var. Out of scope for story 2.1 (which correctly follows the established pattern). Files: `deploy/ansible/templates/env.j2:376-377`, `deploy/ansible/tasks/deploy-shared-facts.yml`, `docker-compose.yaml`.
- **Trivy scan is advisory (`allow_failure: true`)** — `.scan_template` (`.gitlab-ci.yml:667`) sets `allow_failure: true`, so a failing container scan does NOT block `promote:`. Contradicts ADR-0001 / NFR-S5 (blocking scan gate). Affects every service using `.scan_template`, not just okf-server. Decision needed on whether to make scans blocking globally (cross-cutting CI policy change). Files: `.gitlab-ci.yml:667`, `.scan_template`.
- **`depends_on` ignored by Docker Swarm** — `docker stack deploy` strips `depends_on.{condition: service_healthy}`, so okf-server can start before `keycloak-config` is healthy on cold stack bring-up. The first auth request then fails OIDC discovery → 30s cooldown → spurious 401s for 30s even after Keycloak becomes ready. Mitigated by cooldown expiry + retry. Systemic (affects all services with `depends_on`). Optional future fix: eager `init()` with backoff at startup. Files: `docker-compose.yaml:512-514`, `components/shared/lib/keycloak-auth-service.js` (cooldown logic).
- **Auth `Bearer` scheme prefix is case-sensitive** — `middleware/auth.js:9` uses `authHeader.startsWith('Bearer ')`; RFC 6750 §2.1 says the scheme is case-insensitive, so `bearer`/`BEARER` tokens are rejected. Matches the existing backend behavior (consistent), so deferred rather than diverging. Low interop risk. Files: `components/okf-server/middleware/auth.js:9`.
- **Kong `okf-server` service lacks timeout/retry/preserve_host fields** — the `okf-server` service + `okf-route` entries omit the explicit `connect_timeout`/`read_timeout`/`write_timeout`/`retries`/`preserve_host`/`regex_priority`/`path_handling` fields present on `document-repository` (story said "mirror document-repository"). Functional with Kong defaults; less predictable under load. Files: `api-gateway-solution/new-config/kong_config.json`.

## Deferred from: code review of 2-9-2-concepts-meta-upsert-writer (2026-08-15)

- Prettier (`npx prettier --check .`) fails on 8 files in components/okf-server outside the 2.9.2 diff: `services/repository-service.js` (touched by e1d1a3c03), five Story-2.3-era files, two runtime `logs/*.json`. Run `npx prettier --write .` + review churn.
- Content-hash dedup semantics for `okf_concepts_meta`: skip-if-unchanged short-circuit on re-ingest, and whether `content_hash` should cover frontmatter (currently body-only). Owned by Stories 2.9.1 (orchestrator dedup) / 2.9.5 (content-hash idempotency) — decide there, do not patch ad hoc.

## Deferred from: code review of 6-1-authn-authz-rbac (2026-08-16)

- Direct unit tests for the shared/lib copy of `verifyToken(token,{audience})` (only the gov-chat-backend copy is tested; hunks are byte-identical today — drift risk until components/shared gets its own jest harness).
- Tenant-axis binding of the `okf:{tenant}:{repo}:{level}` grammar (tenant segment is carried but unbound; D3 defers to Story 6.1b authz-resolver).
- okf-server route tests mirror the service authz contract via mocks; the generated `FILTER d.repo_id IN` AQL executes only in the live smoke — revisit with Story 8.2 integration fixtures.

## Deferred from: code review of 2-9-1 (2026-08-16)

- mapRole dual-role precedence (admin > dataprep-service > okf-service) — unreachable with single-role clients.
- Double repo fetch per ingest (route gate + service fetch) — deliberate, documented.
- doc-repo ingest-bundle swagger still says Admin-only (route now allows okf-service).
- repo.ingest audit row carries no outcome totals (accepted/partial not distinguishable in audit).
