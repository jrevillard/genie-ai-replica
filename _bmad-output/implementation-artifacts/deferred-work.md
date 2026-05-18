# Deferred Work

Items deferred during code reviews. Revisit when the related component is next modified.

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
- Index out-of-bounds in retrieved_docs lookup — `input.retrieved_docs[best_response["index"]]` (genieai_tei_reranker.py:80, 89, 105, 111) has no bounds check. A buggy TEI response with index >= len(retrieved_docs) will crash with IndexError. Pre-existing production code vulnerability.
- KneeLocator single-doc / flat-score edge cases not tested — When there's only 1 document or all scores are identical, KneeLocator behavior is untested. Nice-to-have, not required by AC.
