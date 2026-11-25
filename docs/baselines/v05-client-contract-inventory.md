# V05 — Client Contract Inventory (BFF chat path)

- **Artifact:** `v05-client-contract-inventory`
- **Story:** #1947 — PRD agentic-foundations, story 1.9 (Epic 1 / stage S3, gate V05)
- **Scope:** the ACTUAL API / SSE / error contract surface the Node BFF (`components/gov-chat-backend`) serves on the chat path, read from code — every route, SSE frame type, metadata field, error shape and status code, with file:line references into this checkout. The overlay services (chatqna, retriever, …) are covered by V02; the okf-server REST surface by its own docs; only the client-facing BFF surface is inventoried here.
- **Method:** read from code at the referenced lines; nothing inferred from swagger comments (the `@swagger` blocks are checked against the handlers and noted where they disagree). The regression-coverage map names the suite and the assertion set that pins each surface today. The gaps are numbered and are the pre-S3-exit work items.
- **Status:** recorded 2026-11-20, branch `feat/agentic-foundations/1-9-…`, baseline `8e26b872`.

---

## 1. The routes

All ten routes mount under `/api/queries` (`routes/query-routes.js`, module factory `:175`); every one sits behind `keycloakAuthMiddleware.authenticate` (`:177`). `req.user.iss_sub` is the trusted user id the routes stamp into the query data (`:328`, `:882`, `:1243`).

| # | Method + path | Handler | Success | Error statuses (shape) |
|---|---|---|---|---|
| 1 | `POST /api/queries/stream` | `:313` | `200` + SSE stream (§2) | `501` `{error:'STREAMING_DISABLED'}` when `OPEA_STREAMING=false` (`:320-326`); `401` `{error:'UNAUTHENTICATED'}` (`:329-331`, and bearer failures caught during fan-out resolution `:684-688`); `400` unsupported-language refusal body (`:340-343`, §7); `504` `{error:'CHATQNA_UNAVAILABLE'}` on `ECONNABORTED`/`ERR_CANCELED` (`:689-690`); `500` `{error:'STREAM_ERROR'}` other setup failures (`:692`); after headers, failures become `error` frames (`:636-640`, `:695-697`) |
| 2 | `POST /api/queries` (non-stream) | `:880` | `201` query doc | `401` UNAUTHENTICATED (`:883-885`) and propagated fan-out `401` (`:905-907`); `400` unsupported-language refusal (`:891-894`); `500` `{message}` (`:908`) |
| 3 | `PATCH /api/queries/:queryId/responsetime` | `:234` | `200` updated doc | `400` `{message:'Response time is required'}` — `0` accepted (`:239-241`); service errors → `next(error)` → global middleware (`:246-251`) |
| 4 | `PATCH /api/queries/:queryId/answered` | `:1113` | `200` updated doc | `400` same body as #3 (`:1118-1120`); `next(error)` otherwise |
| 5 | `POST /api/queries/:queryId/feedback` | `:1051` | `200` query + feedback | service errors → `next(error)` (`:1056-1060`) |
| 6 | `GET /api/queries/:queryId` | `:963` | `200` query doc | **`500` on every service error, including a missing id** (`:968-972`) — no 404 semantics (Gap 2, §9) |
| 7 | `GET /api/queries` (search) | `:1241` | `200` `{queries, pagination}` | `401` (`:1243-1246`); `500` (`:1254-1257`); `limit` clamped 1..100 default 20, `offset` ≥ 0 default 0 via `parsePositiveInt` (`:1249-1250`) |
| 8 | `GET /api/queries/:queryId/conversations` | `:1290` | `200` conversations | `400` `{success:false,message:'User ID is required'}` (`:1294-1299`); `403` `{success:false,message:'Access denied'}` on the service's access-denied error (`:1302-1305`); else `next(error)` |
| 9 | `POST /api/queries/:queryId/conversation` | `:1361` | `201` `{conversation}` | `next(error)` (`:1370-1376`) |
| 10 | `POST /api/queries/:queryId/link/:messageId` | `:1426` | `200` link result | `next(error)` (`:1435-1441`) |

Route-level error shape: two vocabularies coexist — `{error, message}` on the streaming/auth paths and `{message}` (or `{success, message}` on #8) elsewhere. The frontend reads both (`chatbotService.test.js` surfaces "the backend message when the response is not ok" and "falls back to the status when the error body carries no message").

## 2. The SSE stream contract (`POST /api/queries/stream`)

Response headers (`:351-356`): `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`. An in-stream keepalive comment `: keepalive\n\n` every 15 s (`:673-679`); the frontend ignores comment lines (pinned in `chatbotService.test.js`).

Frame types — five, the exact list AD-8 freezes (every frame is `data: <JSON>\n\n`; values are `JSON.stringify`-escaped so a payload cannot forge or terminate a frame, pinned by the #1096 test in `query-routes.test.js`):

| Frame | Written at | Payload |
|---|---|---|
| `chunk` | `:461`, `:500`, `:510`, `:531`, `:605`, `:608` | `{type:'chunk', content}` — the answer text (or its per-unit translation, §7) |
| `metadata` | `:721` | `{type:'metadata', ...chatqna metadata, responseTime}` — see §4; always emitted once before `done` (`capturedMetadata` or the empty default `:162-173`) |
| `translation` | `:746` | `{type:'translation', content}` — the post-stream whole-answer translation (streaming mode does not emit it: `skipPostStreamTranslation` `:543-548`) |
| `done` | `:773` | `{type:'done', queryId, translationFailed}` — always the last frame (`res.end()` follows immediately) |
| `error` | `:637`, `:695` | `{type:'error', message, code}` — codes `CHATQNA_STREAM_ERROR` (upstream stream error after headers) and `STREAM_ERROR` (setup error after headers). Terminal: the client treats it as such (`frontend-sse-error-is-terminal`); the response ends after it |

Frame ordering: `chunk`* → `metadata` → (`translation`?) → `done`; `error` replaces everything after it. The client-side envelope is single-sourced in `tests/e2e/helpers/stream-route.js` (AD-8 reconciliation point).

Upstream parsing — `queryService.parseChatQnASSELine` (`services/query-service.js:453-546`), the dialect chatqna serves:

- the literal `[DONE]` line → `{type:'done'}` (`:455-457`);
- a JSON object with `type === 'metadata'` → the metadata payload (§4) with per-field defaults plus a PRESENCE-keyed passthrough of every unknown key (`:497-514` — `self_confidence` and `query_translation_status` ride this; `__proto__` excluded);
- a Python-repr token line `b'…'` → `{type:'chunk', content}` after escape decoding (`\x` byte runs, `\n`, quotes) and control-char stripping (`:517-541`);
- anything else → `{type:'error', raw}` — logged by the route (`:624-626`), never forwarded to the client (Gap 3, §9).

## 3. The metadata payload

Fields after parsing (defaults in `query-service.js:469-489`):

| Field | Default | Semantics |
|---|---|---|
| `source_documents` | `[]` | the envelope, §5 |
| `confidence_score` | `0` | citizen-facing confidence (LLM self-grade when enabled, else retrieval) |
| `retrieval_confidence_score` | `null` | raw rank-weighted retrieval confidence (admin/eval) |
| `abstained` | `false` | the turn abstained; **`null` on the never-answered empty default** (`:162-173`) — `false` ("answered, chose not to abstain") is distinguishable from `null` ("chatqna never answered") |
| `abstention_reason` | `null` | the machine-readable cause: `no_documents_retrieved` / `reranker_selected_nothing` / `reranker_input_too_long` / `result_budget_exhausted` / `no_resolvable_candidates` |
| `filter_labels` | `null` | the scope the retrieval filtered on; `null` = "not recorded", `[]` = a reported empty scope |
| `is_grounded` | `false` | the answer is backed by retrieved chunks |
| *(passthrough)* `self_confidence` | absent | presence-keyed: absent = feature off; explicit `null` = feature on, sentinel malformed (`:497-509`) |
| *(passthrough)* `query_translation_status` | absent | `translated` / `passthrough_english` / `passthrough_unknown_language` / `fallback_timeout` / `fallback_error` — what the history translator fed the embedder |

The route forwards the parsed object whole minus `type` (`:610-621`) and adds `responseTime`; it is also the shape persisted by `finalizeStreamQuery` (`:760`) — including on a disconnect (`emptyStreamMetadata()` `:662-668`, whose `abstained: null` marks "never answered").

## 4. The `source_documents` envelope

Assembled by chatqna and forwarded verbatim (`genie-ai-overlay/chatqna/genieai_chatqna.py:3651-3680`):

- **Legacy variant** — `{document_id, document_name, url, categoryLabels, serviceLabels, score}` (+ `text` when contexts are included). NO `source` key: the absence is what tells the frontend to take the legacy branch (doc-repo read URL, `conversation.js:239-296`).
- **OKF variant** — the legacy fields with `url:''` plus `concept_id`, **`source:'okf-concept'`**, and additively `graph_name`, `repo_id`, `bundle_version` (each only when present; `bundle_version: 0` rides — the `is not None` rule). Without the marker the frontend would build a doc-repo URL for a concept that has none.

## 5. The error surface (global)

- **Global error middleware** (`index.js:512-534`): typed errors (`AppError` subclasses) carry `statusCode`; an error carrying an explicit `body` object (e.g. `VlUnavailableError`) forwards that body verbatim (`{error, message}` shapes survive); otherwise `500 {message:'An unexpected error occurred', error?: err.message in development}`.
- **404 handler** (`index.js:540-547`): `{message:'Resource not found'}` for every unmatched route.
- **`process.on('unhandledRejection')`** (`index.js:989-998`): logs and `process.exit(1)` — a dangling rejection takes the process down; the streaming route deliberately awaits its translation chain for this reason (`query-routes.js:557-562`).
- The language refusal body (`unsupportedLanguageBody`, via `:104-114`) names the refused side and never echoes the caller's raw value back.

## 6. The language + answer-translation contract

- The target language travels in `context.language`, normalized once by `normalizeRequestedLanguage` (`query-routes.js:13`, `:28-30`); `wantsTranslation` (`:46-48`) is the one rule every translation decision reads (no translation for `en`, `auto`, empty).
- A language the map does not carry is refused BEFORE any generation with the same `400` the translate routes answer (`:76-114`, `:340-343`, `:891-894`); a translator that is not ready does NOT refuse — the answer proceeds in English and the failure is reported on `done` (`:85-88`, `:1205` test).
- Two delivery modes (`STREAMING_TRANSLATION_ENABLED`): per-unit streaming translation (`:451-515` — complete units via `stream-boundary.js`, markdown AST skeleton, EN fallback per failed unit, `translationFailed` on `done`) and post-stream whole-answer translation (the `translation` frame, `:728-757`).

## 7. Regression coverage map

| Surface | Pinned by |
|---|---|
| Auth guard on all routes | `__tests__/routes/query-routes.test.js` "Auth guard" (5×401) |
| Route #1 happy path + statuses 501/500/504/401 | `query-routes.test.js` "POST /stream" block |
| SSRF pin (upstream is service-resolved, never request data) | `query-routes.test.js` "posts to the upstream the service resolved…" + `query-service.test.js` initStreamQuery |
| Upstream Authorization forwarding | `query-routes.test.js` "should forward Authorization header to ChatQnA" |
| Streaming translation (#829): unit boundaries, EN fallback, ordering, empty translation, degradation, paragraph breaks | `query-routes.test.js` `#829` suite (12 tests) |
| Language refusal (stream + non-stream, auto, not-ready translator) | `query-routes.test.js` "the language the client asked for" suite (9 tests) |
| Frame forgery containment (#1096) | `query-routes.test.js` "keeps a translation payload inside one SSE frame" |
| `metadata` forwarding: defaults, presence-keyed passthrough, abstention reason, self_confidence null-vs-absent, unknown fields | `query-routes.test.js` "SSE metadata retrieval" suite (8 tests) |
| `translation` + `done.translationFailed` semantics | `query-routes.test.js` "SSE translation" suite |
| Stream-end auto-finalize, finalize-failure resilience, query-id baggage + server-span correlation | `query-routes.test.js` corresponding blocks |
| `parseChatQnASSELine` (all four line shapes, defaults, passthrough, `__proto__` guard) | `__tests__/services/query-service.test.js` "parseChatQnASSELine" |
| `initStreamQuery` / `createQuery` / `finalizeStreamQuery` / CRUD / inspector methods | `query-service.test.js`, `query-service-inspector.test.js` |
| Fan-out carrier + sticky routing (posture matrix, bearer failure, legacy byte-parity) | `__tests__/query-service-fanout.test.js` |
| Frontend SSE handling: per-frame callbacks, idle-timeout abort, #1820 dead-session recovery, error-body surfacing, comment-line tolerance | `components/gov-chat-frontend/src/__tests__/services/chatbotService.test.js` |
| End-to-end stream envelope + citation rendering + error handling UI | `tests/e2e/chatbot/`: `send-message-and-stream.spec.js`, `real-rag-citation.spec.js`, `error-handling.spec.js`, `chat-conversation.spec.js`, `conversation-history.spec.js`, `chat-composer.spec.js`, `quick-help-scope.spec.js` (executed set = the local run, `tests/e2e/run/run-local-e2e.sh`; no CI door) |

## 8. S3 reconciliation note

AD-8 freezes the five client event types and reconciles them against this inventory at the S3 compatibility gate. The inventory confirms exactly five frame types on the wire today (`chunk`, `metadata`, `translation`, `done`, `error`); the agentic path's two additive events (`agent_activity`, `agent_verdict`) extend — never renumber — this list. The `metadata` payload and the `source_documents` envelope shapes recorded here are the shapes the agentic path must preserve byte-compatibly (`is_grounded`, `abstained`/`abstention_reason`, `query_translation_status`, the okf-concept marker semantics).

## 9. Gaps — numbered pre-S3-exit work items

1. **Client-disconnect is unwired.** The `req.on('close')` listener (`query-routes.js:649-671`) provably never fires — `express.json()` consumes the body before the first `await`, so `close` has already been emitted (the code's own note). No `res.on('close')` handler exists. Consequence: a mid-stream disconnect neither aborts the upstream call nor finalizes the query doc. This is the exact hole AD-6's cancellation chain (BFF detects disconnect → aborts upstream → agent-service cancels the model call) must plug; the fix belongs to the activation/rollback epic's wiring, but the S3 gate should record the gap now. Work item: replace the dead listener with res-side detection, wire `opeaController.abort()` + partial finalize, and pin it with a test.
2. **`GET /api/queries/:queryId` has no 404.** Every service error — a missing id included — maps to `500 {message}` (`:968-972`); the swagger block claims 404. Work item: decide the not-found semantics (404 vs the app-wide 404 body) and pin it; until then the client cannot distinguish "absent" from "broken".
3. **Upstream `error` events are swallowed.** `parseChatQnASSELine` classifies chatqna `error` lines and the route only logs them (`:624-626`) — the client sees a silent `end` (auto-finalized at `:643-647`). Work item: record the disposition (deliberate swallow vs forward-as-`error`-frame) as a decision; today it is neither documented in code nor pinned by a test asserting the swallow.
4. **The two PATCH write paths overlap uncontracted.** #3 and #4 both write `responseTime`; #4 additionally flips `isAnswered`. No test pins that #3 must NOT flip `isAnswered`. Work item: one assertion, so the two endpoints cannot drift into duplicates.
5. **The non-stream path's metadata passthrough is thinner than the stream's.** The streamed path forwards chatqna metadata field-by-field with presence semantics (§3) and is pinned by 8 tests; the non-stream `createQuery` response merges the chatqna answer into the query doc, and the metadata fields (`abstained`, `query_translation_status`) ride no pinned contract in the response body. Work item: inventory the non-stream response's metadata fields and pin whichever the frontend actually reads.
