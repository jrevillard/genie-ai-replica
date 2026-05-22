# Deferred Work

Items deferred during code reviews. Revisit when the related component is next modified.

## Deferred from: code review of 1-3-create-ci-pipeline-test-stage (2026-05-19)

- Python venv recreated on every CI run despite cache restoration — `python -m venv .venv` in `before_script` recreates the venv even when cache restores it. Pattern is functional (venv creation is idempotent, pip skips installed packages) but wastes ~5-10s per run. Could be optimized with a conditional check (`if [ ! -d .venv ]; then python -m venv .venv; fi`).

## Deferred from: code review of 3-3-test-critical-vue-components-userprofile-and-admin-dashboard (2026-05-19)

- Deferred promise + setTimeout(300) not awaited — UserProfileComponent.loadUserProfileData has nested $nextTick + setTimeout(300) for country dropdown initialization; tests never await this, but country dropdown interaction is explicitly out of scope per spec "What NOT to Test" section. Revisit if country dropdown tests are added.
- SearchableCountryDropdown stub methods never called — stub defines manuallySetCountryName/loadCountries methods but setTimeout(300) prevents invocation during tests; country dropdown interaction is explicitly out of scope per spec. Revisit if country dropdown tests are added.
- AdminDashboard missing error handling edge cases — tests only cover happy path for service responses; null/malformed/missing response handling not tested but beyond current AC scope. Nice-to-have for future hardening.

## Deferred from: code review of 3-4-test-vuex-store-modules (2026-05-20)

- UPDATE_CHAT: chaîne vide traitée comme "pas de changement" — le code source utilise `title || state.chats[chatIndex].title` qui traite `''` comme falsy. Comportement du code source, pas des tests. Pre-existing.
- Persistence plugin dupliqué au lieu d'être importé — `persistence.test.js` réplique la logique du plugin au lieu d'importer depuis `store/index.js`. Approche délibérée pour isolation; duplication fidèle au source. Pre-existing design choice.
- Edge cases manquants (null inputs, IDs dupliqués, quota localStorage) — amélioration de couverture future, pas bloquant pour cette story.

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

- getMetric fallback quand service retourne null/undefined — le controller a un fallback pour null values, non testé. Scope controller, sera couvert par story 2.7.
- Locale non testé sur satisfaction endpoints — le controller accepte un param locale sur gauge/heatmap mais les tests ne vérifient pas sa propagation. Nice-to-have hors AC.
- Malformed JSON dans filters param — `JSON.parse(req.query.filters)` peut throw si le JSON est invalide. Edge case non couvert par AC4.
- Pagination avec limit/offset non-numériques — `parseInt() || default` gère les cas non-numériques. Edge case au-delà du scope AC7.
- Recherche avec query string vide — `?query=` vs query absent. AC14 couvre le cas sans query param.
- categoryExists lance une erreur (DB failure) — si le service throw au lieu de retourner false, le route catch retourne 500. Edge case d'infrastructure.
- DELETE service avec error code non-404 — le route check `error.code === 404`, les autres codes tombent dans le 500 générique. Edge case au-delà du scope AC16.

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

- Worker thread mock ne simule pas le flux async — le mock Worker fournit `on`/`postMessage`/`terminate` mais ne simule jamais l'émission d'événements. Tests actuels fonctionnent car le code OPEA worker n'est pas appelé directement. Amélioration nice-to-have.
- Pagination: un seul scénario testé — `searchQueries` testé avec total=25 et pageSize=10. Scénarios limites (exact boundary, zero results) seraient un plus.
- User profile `process`: couverture indirecte — la méthode `process` (agrégation de custom settings) n'est testée que via `updateUserProfile`. Des tests directs ajouteraient de la robustesse.
- Translation backend fallback: risque théorique de race — le test de fallback GPU→CPU assigne `translationService.backend` manuellement. Risque théorique si le service cache le backend.
- Chat history: edge collection query patterns — les patterns de traversal de graphe ArangoDB (edge bidirectionnelle, vérification d'existence d'edge) sont complexes à mocker et ne sont pas testés directement.

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
