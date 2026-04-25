---
title: 'SSE Streaming for LLM Responses'
slug: 'sse-streaming'
created: '2026-04-25'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Vue 3 (Options API)', 'Node.js 22/Express 4.18 (CommonJS)', 'Kong 3.8', 'NGINX', 'Flutter 3.10+/Dart', 'ChatQnA (Python/FastAPI, OPEA 1.3)', 'vLLM (OpenAI-compatible SSE)', 'Axios 1.10+']
files_to_modify: [
  'components/gov-chat-backend/routes/query-routes.js',
  'components/gov-chat-backend/services/query-service.js',
  'components/gov-chat-backend/services/translation-service.js',
  'components/gov-chat-backend/index.js',
  'components/gov-chat-frontend/src/components/ChatBotComponent.vue',
  'components/gov-chat-frontend/src/services/chatbotService.js',
  'components/gov-chat-frontend/src/i18n/locales/en.js',
  'api-gateway-solution/new-config/kong_config.json',
  'api-gateway-solution/nginx/conf/default.conf.template',
  'docker-compose.yaml',
  'env',
  'deploy/ansible/templates/env.j2',
  'mobile/genie_ai_mobile/lib/services/chatbot_proxy.dart',
  'mobile/genie_ai_mobile/lib/components/chat/chatbot_component.dart',
  'mobile/genie_ai_mobile/pubspec.yaml'
]
code_patterns: [
  'Backend CommonJS require/module.exports (never ES imports)',
  'Vue 3 Options API with export default {} (never Composition API or script setup)',
  'i18n via translate() function (never $t())',
  'Express per-route auth middleware (never global)',
  'Axios 1.10+ for HTTP (backend and frontend)',
  'Winston logging via shared-lib logger',
  'ArangoDB direct AQL queries (no ORM)',
  'Kong declarative config via kong_config.json applied by kong-config service',
  'NGINX templated config with env var substitution',
  'Docker Swarm deployment via Ansible with tagged playbooks',
  'Flutter setState() for state management (no Provider/Bloc/Riverpod)'
]
test_patterns: [
  'Backend: Jest with CommonJS (require/module.exports), __tests__/ directory',
  'Frontend: Jest with jsdom, @vue/vue3-jest, src/__tests__/ directory',
  'No existing test files — framework configured but no tests written yet',
  'E2E tests in docs/e2e-tests/ with multi-phase Playwright procedures'
]
---

# Tech-Spec: SSE Streaming for LLM Responses

**Created:** 2026-04-25

## Overview

### Problem Statement

Users currently wait 5-30 seconds for the full LLM response before seeing any output. The ChatQnA microservice already supports OpenAI-compatible SSE streaming, but the Vue 3 frontend, Node.js backend BFF proxy, and Flutter mobile app all wait for the complete response. This is the single biggest UX gap and a prerequisite for agentic workflows which need real-time status updates.

### Solution

Implement SSE streaming across the full stack:
- Backend BFF creates a new streaming endpoint that bypasses worker threads, proxies ChatQnA's raw SSE stream, transforms the non-standard format (`data: b'text'`) into proper SSE events, and relays metadata as a final event after stream completion.
- Kong disables request/response buffering on streaming routes and increases timeouts.
- NGINX disables proxy buffering on `/api/` routes and adds SSE-specific headers.
- Vue 3 frontend replaces the blocking `await` pattern with SSE consumption using the Fetch API, displaying tokens incrementally with a typewriter effect.
- Flutter mobile app adds an SSE client package and implements progressive message rendering.
- Translation is applied to the complete response after the stream finishes (not during streaming).
- All environment changes propagate to `env` template, `docker-compose.yaml`, and Ansible deployment templates.

### Scope

**In Scope:**
- Backend: New streaming endpoint (`POST /api/queries/stream`) bypassing worker threads, SSE proxy with format transformation, metadata delivery as final SSE event
- Kong: Disable buffering on streaming routes, increase read/write timeouts to 1 hour
- NGINX: Disable `proxy_buffering` on `/api/` location, add `X-Accel-Buffering: no` and SSE headers
- Vue 3: Replace blocking `chatbotService.submitQuery()` with SSE streaming via Fetch API, typewriter display, streaming state management
- Flutter: Add `sse_client` or `fetch_client` package, implement streaming chat consumption, progressive message rendering
- Translation: Apply to complete response after stream `[DONE]` (not during streaming)
- Environment: New env vars (`OPEA_STREAMING`, `SSE_TIMEOUT`), update `env` template, `docker-compose.yaml`, Kong config, NGINX config, Ansible `env.j2` template
- Smoke test plan for debugging and stabilization
- Keep existing non-streaming endpoint as fallback

**Out of Scope:**
- ChatQnA Python code changes (format transformation handled in Node.js backend only)
- Translation during streaming (only post-completion)
- Socket.IO migration (SSE only)
- Agentic workflow features (future work)
- WebSocket transport

## Context for Development

### Codebase Patterns

- **Backend**: CommonJS only (`require`/`module.exports`), Express 4.18, Controller → Service pattern, per-route auth middleware, ArangoDB direct AQL, Winston logging
- **Frontend**: Vue 3 Options API, Vuex 4, `translate('key', 'default')` for i18n (never `$t()`), `httpService.js` for all API calls, event bus for cross-component events, `marked` + `DOMPurify` for markdown
- **Mobile**: Flutter 3.10+, basic `setState()` state management, `http` package for API calls, `flutter_markdown` for rendering
- **Infrastructure**: Docker Swarm + Ansible deployment, Kong declarative config via `kong_config.json`, NGINX templated config, environment via `env` template + `.env` local override

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `components/gov-chat-backend/routes/query-routes.js` | Chat query endpoints — POST /queries main endpoint (line 181), auth via `keycloakAuthMiddleware.authenticate` (line 8) |
| `components/gov-chat-backend/services/query-service.js` | Query service — OPEA call with `stream: false` (lines 406, 417), worker thread `runOPEAWorker` (lines 67-92), `createQuery` full flow (lines 217-473) |
| `components/gov-chat-backend/services/opea-worker.js` | OPEA worker thread — axios with 120s timeout (line 22), keep-alive agents (lines 16-17), buffers complete response |
| `components/gov-chat-backend/services/translation-service.js` | Translation service — GPU/CPU/Auto backends, Redis caching, `translate()` method, `translateMarkdown()` |
| `components/gov-chat-backend/index.js` | Express app — server timeout 300s (lines 1153-1155), Socket.IO (lines 20-43), no compression middleware (good for SSE) |
| `components/gov-chat-frontend/src/components/ChatBotComponent.vue` | Main chat UI — `sendMessage()` (line 729), blocking `await chatbotService.submitQuery()` (line 796), message model with sender/content/queryId/metadata/isSaved (lines 286-340), `renderMarkdown()` with marked+DOMPurify (lines 541-549), `scrollToBottom()` (lines 909-916) |
| `components/gov-chat-frontend/src/services/chatbotService.js` | Chat service — `submitQuery()` via `httpService.post('queries', ...)` (line 15), returns `{response, queryId, metadata}` |
| `components/gov-chat-frontend/src/services/httpService.js` | HTTP client — axios instance (lines 94-104), base URL priority: runtime config > VUE_APP_API_URL > localhost:3000 (line 92), request interceptor adds Bearer token (lines 143-149), no explicit timeout set |
| `components/gov-chat-frontend/src/store/chatHistoryStore.js` | Vuex chat history — state: folders, chats, folderChats, actions: createChat, updateChat |
| `components/gov-chat-frontend/src/i18n/locales/en.js` | English i18n — chatbot section (lines 1350-1394), no streaming keys exist yet |
| `api-gateway-solution/new-config/kong_config.json` | Kong config — express-api service timeouts 60s (lines 69-70), query-route with buffering true (lines 90-91), rate-limiting 1000/min |
| `api-gateway-solution/nginx/conf/default.conf.template` | NGINX config — `/api/` location: timeouts 300s, NO `proxy_buffering off`, WebSocket headers present; `/` location: `proxy_buffering off`, timeouts 3600s |
| `genie-ai-overlay/chatqna/genieai_chatqna.py` | ChatQnA — `align_generator()` produces `data: b'text'\n\n` (lines 760-785), StreamingResponse early return bypasses translation+metadata (lines 1468-1470), non-streaming returns `{response, metadata: {source_documents, confidence_score}}` (lines 1621-1628) |
| `genie-ai-overlay/chatqna/Dockerfile-chatqna_genie-ai` | Docker build — clones OPEA GenAIExamples v1.3 + GenAIComps v1.3 from GitHub during build (lines 3-41) |
| `genie-ai-overlay/core/genieai_api_protocol.py` | API protocol — `ChatCompletionRequest.stream: bool = False` (line 63), `stream_options` defined but unused |
| `components/document-repository/src/routes/fileRoutes.js` | Document repo routes — `GET /api/files/{fileId}` (line 325) returns file metadata with labels, file_name, url |
| `components/document-repository/src/controllers/fileController.js` | File controller — metadata response format (lines 938-971): file_id, file_name, labels, language, chunk_count, dataprep status |
| `mobile/genie_ai_mobile/lib/services/chatbot_proxy.dart` | Flutter chat — `submitQuery()` via `_api.post('queries', payload)` (line 39), expects `{queryId, response, metadata}` |
| `mobile/genie_ai_mobile/lib/components/chat/chatbot_component.dart` | Flutter chat UI — `_isLoading` bool (line 49), CircularProgressIndicator, `setState()` pattern, message model with role/content/metadata |
| `mobile/genie_ai_mobile/lib/services/api_service.dart` | Flutter HTTP — `http` package (^1.6.0), singleton pattern, no streaming support, no explicit timeout |
| `mobile/genie_ai_mobile/pubspec.yaml` | Flutter deps — `http: ^1.6.0`, `flutter_markdown: ^0.7.7`, NO SSE/streaming packages |
| `docker-compose.yaml` | Services — chatqna-xeon-backend-server (lines 992-1047, port 8888, env vars), vllm (lines 558-596, direct LLM access on port 8000), Kong (timeouts 60s), NGINX (env vars for domain/CSP) |
| `env` | Environment template — no SSE variables; contains OPEA_HOST, OPEA_PORT, translation vars |
| `deploy/ansible/templates/env.j2` | Ansible env — Jinja2 template with `{% if var is defined %}` pattern, translation vars at lines 144-154 |
| `deploy/ansible/deploy.yml` | Ansible playbook — tagged install/prepare/build/deploy, builds 14 images including kong-config and nginx |

### Technical Decisions

1. **SSE over Socket.IO**: Using native SSE for server-to-client streaming. Simpler, standard web API, no additional library needed on the frontend. Socket.IO remains for other real-time features.
2. **Backend BFF transforms SSE format**: ChatQnA outputs non-standard `data: b'text'\n\n` (Python repr of bytes from `align_generator()` lines 760-785). The Node.js backend parses this format and emits clean JSON SSE events to the frontend. No changes to ChatQnA Python code.
3. **Bypass worker threads for streaming**: The current `opea-worker.js` buffers complete responses via `await axiosInstance.post()`. The new streaming endpoint calls ChatQnA directly using axios `responseType: 'stream'` with `res.write()` piping — no worker threads.
4. **Translation post-stream**: Stream the English response in real-time, then translate the complete accumulated text after `[DONE]` is received via the existing translation service. The translated text replaces the English content in the message.
5. **Metadata as final SSE event**: After the content stream completes, the backend BFF calls the retriever service directly (`POST http://retriever-arango-service:7000/v1/retrieval`) to get source documents, fetches file metadata from document-repository (`GET /api/files/{fileId}`), and sends a `data: {"type":"metadata",...}` event. This is necessary because ChatQnA's streaming early return (lines 1468-1470) skips all metadata processing.
6. **SSE event protocol (Backend → Frontend)**: Use unnamed events with a `type` discriminator field for simplicity:
   - `data: {"type":"chunk","content":"token text"}\n\n` — content tokens
   - `data: {"type":"translation","content":"translated text"}\n\n` — post-stream translation
   - `data: {"type":"metadata","source_documents":[...],"confidence_score":0.87,"responseTime":5234}\n\n` — final metadata
   - `data: {"type":"done","queryId":"12345"}\n\n` — stream completion
   - `data: {"type":"error","message":"...","code":"STREAM_TIMEOUT"}\n\n` — error events
7. **Keep non-streaming endpoint**: Existing `POST /api/queries` remains as fallback. New `POST /api/queries/stream` is the streaming endpoint.
8. **Separate streaming route**: A dedicated `/api/queries/stream` route allows per-route Kong buffering disabled and timeout configuration without affecting other API routes.
9. **No compression middleware conflict**: The backend has no compression middleware configured — good for SSE, no risk of response buffering from gzip/brotli.
10. **Server timeout must match Kong**: Express server timeout is 300s but Kong is set to 3600s. If a stream exceeds 5 minutes, Express will kill the connection before Kong times out. The backend `index.js` server timeout (lines 1153-1155) must be increased to match Kong's 3600s.
11. **Commit and push frequently**: Small, incremental commits to avoid large diffs.

## Implementation Plan

### Tasks

#### Phase 1: Infrastructure & Environment (commit after each task)

- [ ] **Task 1: Update Kong configuration for SSE passthrough**
  - File: `api-gateway-solution/new-config/kong_config.json`
  - Action:
    - Add a new route `query-stream-route` for path `/api/queries/stream` with `request_buffering: false` and `response_buffering: false`, `strip_path: false`, `preserve_host: true`, `protocols: ["http", "https"]`
    - Update the `express-api` service: set `read_timeout: 3600000`, `write_timeout: 3600000`, `connect_timeout: 60000` (connect stays at 60s, read/write go to 1 hour)
    - Wire the new route to the `express-api` service and `express-api-servers` upstream
  - Notes: The existing `query-route` for `/api/queries` must remain unchanged (non-streaming fallback). Only the new `/api/queries/stream` route gets buffering disabled.

- [ ] **Task 2: Update NGINX configuration for SSE passthrough**
  - File: `api-gateway-solution/nginx/conf/default.conf.template`
  - Action: Add a **nested location block** for the streaming endpoint INSIDE the existing `/api/` location block. Do NOT modify the parent `/api/` location — this preserves buffering for all other API routes (beneficial for JSON compression):
    ```nginx
    # Inside the existing /api/ location block, add:
    location /api/queries/stream {
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header X-Accel-Buffering no;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_pass http://$kong_addr;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    ```
  - Notes: NGINX nested locations use longest prefix match, so `/api/queries/stream` will hit this block while other `/api/*` routes continue to use the parent block's buffering. This is a surgical change that doesn't affect other API routes.

- [ ] **Task 3: Add SSE environment variables**
  - File: `env`
  - Action: Add to the appropriate section:
    ```
    # SSE Streaming
    OPEA_STREAMING=${OPEA_STREAMING:-true}
    OPEA_STREAM_TIMEOUT=${OPEA_STREAM_TIMEOUT:-300000}
    ```
  - Notes: `OPEA_STREAMING` enables/disables the streaming endpoint. `OPEA_STREAM_TIMEOUT` is the backend timeout for ChatQnA streaming connections (default 5 minutes). These follow the project's DRY convention — defaults in code, overrides in env.

- [ ] **Task 4: Update docker-compose.yaml for SSE**
  - File: `docker-compose.yaml`
  - Action:
    - In the `backend` service environment section, add:
      - `OPEA_STREAMING: ${OPEA_STREAMING:-true}`
      - `OPEA_STREAM_TIMEOUT: ${OPEA_STREAM_TIMEOUT:-300000}`
  - Notes: Kong and NGINX config changes are picked up from their respective config files mounted into the containers. The backend needs the new env vars passed through. Also update `components/gov-chat-backend/index.js` line 1153-1155 to increase `server.setTimeout(3600000)` (1 hour) to match Kong's timeout.

- [ ] **Task 5: Update Ansible env template**
  - File: `deploy/ansible/templates/env.j2`
  - Action: Add a new section for SSE streaming variables:
    ```jinja2
    # Section: SSE Streaming
    {% if opea_streaming is defined %}OPEA_STREAMING={{ opea_streaming }}{% endif %}
    {% if opea_stream_timeout is defined %}OPEA_STREAM_TIMEOUT={{ opea_stream_timeout }}{% endif %}
    ```
  - Notes: Follow the existing pattern of `{% if var is defined %}` conditional inclusion. Add defaults to `deploy/ansible/group_vars/all.yml` if needed.

#### Phase 2: Backend Streaming (commit after each task)

- [ ] **Task 6: Add SSE parsing utility to query-service.js**
  - File: `components/gov-chat-backend/services/query-service.js`
  - Action: Add a static/helper method `parseChatQnASSELine(line)` that:
    - Accepts a raw line string from the ChatQnA SSE stream
    - If line starts with `data: b'` — extract content between `b'` and closing `'`, decode any escape sequences
    - If line is `data: [DONE]` — return `{ type: 'done' }`
    - Otherwise — return `{ type: 'error', raw: line }` for graceful degradation
  - Notes: The Python `repr()` format means content like `It's` becomes `b"It's"` and `back\slash` becomes `b'back\\slash'`. Use a regex-based extractor: match `b'(.*)'` or `b"(.*)"` (handle both quote styles), then decode escape sequences with a simple replacement chain: `\\\\` → `\\`, `\\n` → `\n`, `\\t` → `\t`, `\\'` → `'`, `\\"` → `"`. Do NOT use `JSON.parse()` — it won't handle all Python repr edge cases correctly.

- [ ] **Task 7: Add streamQuery initialization method to query-service.js**
  - File: `components/gov-chat-backend/services/query-service.js`
  - Action: Add `async initStreamQuery(queryData, authHeaders)` method that:
    - Validates the request (reuse existing validation logic from `createQuery` lines 226-292)
    - Saves the query to ArangoDB with `isAnswered: false` (same as existing flow)
    - Constructs the OPEA payload with `stream: true` (both single-message and conversation modes)
    - Returns `{ queryId, opeaUrl, opeaPayload, queryData }` for the route handler to use
  - Notes: This reuses the existing validation and DB save logic. The key difference from `createQuery` is: (a) sets `stream: true`, (b) returns early without calling ChatQnA, (c) does not wait for the response.

- [ ] **Task 8: Add finalizeStreamQuery method to query-service.js**
  - File: `components/gov-chat-backend/services/query-service.js`
  - Action: Add `async finalizeStreamQuery(queryId, responseText, responseTime, metadata)` method that:
    - Updates the query in ArangoDB with `response`, `responseTime`, `isAnswered: true`, `metadata`
    - Records analytics (reuse existing analytics logic from `createQuery` lines 445-447)
  - Notes: This is called after the stream completes, similar to the existing post-OPEA flow but with the accumulated streamed text.

- [ ] **Task 9: Add streaming route handler to query-routes.js**
  - File: `components/gov-chat-backend/routes/query-routes.js`
  - Action: Add `POST /stream` route handler (before the existing `POST /` handler) that:
    1. Checks `OPEA_STREAMING` env var — if `false`, return 501 with error
    2. Validates auth (same as existing route — `req.user?.iss_sub`)
    3. Calls `queryService.initStreamQuery(queryData, authHeaders)` to get queryId + OPEA payload
    4. Sets SSE response headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`
    5. Calls ChatQnA with `axios.post(opeaUrl, opeaPayload, { headers, responseType: 'stream', timeout: OPEA_STREAM_TIMEOUT })`
    6. Pipes the response through the SSE parser:
       - For each data line: parse via `parseChatQnASSELine()`, write `data: {"type":"chunk","content":"..."}\n\n` to client
       - Accumulate full response text
       - Track response start time for timing
    7. On `[DONE]`:
       - Calculate responseTime
       - Send `data: {"type":"metadata",...}\n\n` event (source_documents from retriever call + doc-repo fetch, or empty array if retrieval fails)
       - If user language != EN: call translation service, send `data: {"type":"translation","content":"..."}\n\n`
       - Call `queryService.finalizeStreamQuery(queryId, fullText, responseTime, metadata)`
       - Send `data: {"type":"done","queryId":"..."}\n\n`
       - Call `res.end()`
    8. On error: send `data: {"type":"error","message":"...","code":"..."}\n\n`, call `res.end()`
    9. On client disconnect (`req.on('close')`): abort the ChatQnA axios request, log cleanup
  - Notes:
    - The auth middleware `keycloakAuthMiddleware.authenticate` is already applied to all routes in this router (line 8) — no additional auth needed
    - Use `req.on('close')` to detect client disconnect and abort upstream connection
    - The streaming route handler calls ChatQnA DIRECTLY using axios with `responseType: 'stream'` — the existing `opea-worker.js` is NOT used and NOT modified. Worker threads are only for non-streaming queries.
    - Add `const axios = require('axios')` at the top of `query-routes.js` (it's not currently imported there — only `opea-worker.js` imports it)
    - The translation service is already available via `require('./translation-service')` — call its `translate()` method with the accumulated text

- [ ] **Task 10: Handle post-stream metadata retrieval**
  - File: `components/gov-chat-backend/routes/query-routes.js` (within the streaming route handler from Task 9)
  - Action: After `[DONE]`, implement metadata retrieval as a best-effort enhancement:
    1. Call the retriever service: `POST http://retriever-arango-service:7000/v1/retrieval` with the query text
    2. Extract document IDs and scores from the retriever response
    3. For each document ID, call document-repository: `GET http://document-repository:3001/api/files/{fileId}` with the user's Bearer token
    4. Use `Promise.all()` for parallel fetches
    5. Build the `source_documents` array in the same format as the non-streaming response: `{ document_id, document_name, url, categoryLabel, serviceLabels, score }`
    6. Calculate `confidence_score` as average of document scores
    7. Wrap the entire metadata fetch in try/catch — on failure, send metadata event with empty `source_documents` and `confidence_score: 0`
  - Notes:
    - The retriever's exact request format must be verified during implementation by reading `genie-ai-overlay/retriever/genieai_retriever_microservice.py`
    - **KNOWN LIMITATION**: The retriever may return DIFFERENT documents than what ChatQnA used internally, since the retrieval context (embeddings, reranking parameters) may differ when called independently. This is acceptable for v1 — the source documents are supplementary information, not the primary response. **Upgrade path**: A future ChatQnA update could include a `retrieval_context_id` in the streaming response, allowing the backend to fetch the exact documents used.
    - The document-repository requires Bearer token auth — forward the original request's Authorization header
    - No batch endpoint exists on document-repository — parallel individual fetches are the only option

#### Phase 3: Vue Frontend (commit after each task)

- [ ] **Task 11: Add submitQueryStream method to chatbotService.js**
  - File: `components/gov-chat-frontend/src/services/chatbotService.js`
  - Action: Add `submitQueryStream(queryData, callbacks)` method that:
    1. Gets the API base URL from `window.APP_CONFIG?.apiUrl || process.env.VUE_APP_API_URL || 'http://localhost:3000/api'`
    2. Gets the auth token from `keycloakAuthService.getAccessToken()`
    3. Calls `fetch(`${baseUrl}/queries/stream`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(queryData) })`
    4. If response not ok, throw error with status code
    5. Reads the response body as a ReadableStream using `response.body.getReader()`
    6. Decodes chunks using `TextDecoder`
    7. Buffers incomplete lines (SSE events span multiple chunks)
    8. For each complete `data: ` line: `JSON.parse()` the payload, dispatch to the appropriate callback based on `data.type`
    9. Callbacks: `onChunk(content)`, `onMetadata(metadata)`, `onTranslation(content)`, `onDone(data)`, `onError(error)`
  - Notes:
    - Uses native Fetch API (not axios) because axios doesn't support streaming responses well
    - Import keycloakAuthService: `import { keycloakAuthService } from '@/services/keycloakAuthService'`
    - SSE line buffering: split on `\n`, keep the last incomplete line in a buffer variable
    - Handle the case where a single chunk contains multiple SSE events

- [ ] **Task 12: Update ChatBotComponent.vue for streaming**
  - File: `components/gov-chat-frontend/src/components/ChatBotComponent.vue`
  - Action:
    1. Add `isStreaming: false` to data() (alongside existing `isLoading`)
    2. Add `streamingQueryId: null` to data()
    3. Modify `sendMessage()` method:
       - After pushing user message, set `isStreaming = true` and `isLoading = false`
       - Push a placeholder bot message: `{ sender: 'bot', content: '', timestamp: new Date().toISOString(), isSaved: false, metadata: {}, isStreaming: true }`
       - Call `chatbotService.submitQueryStream(queryData, { onChunk, onMetadata, onTranslation, onDone, onError })`
       - `onChunk(content)`: Find the last message in `chatMessages` (the streaming placeholder), append content: `this.chatMessages[lastIndex].content += content`, call `scrollToBottom()`. Vue 3 reactivity handles this natively since the property exists at push time.
       - `onMetadata(metadata)`: Update the last message's metadata: `this.chatMessages[lastIndex].metadata = metadata`, update relatedDocuments for sidebar display, update confidenceScore
       - `onTranslation(translatedContent)`: Replace the last message's content: `this.chatMessages[lastIndex].content = translatedContent`
       - `onDone(data)`: Set `isStreaming = false`, update `streamingQueryId = data.queryId`, mark `isStreaming: false` on the message, update `isSaved: false`, call `updateChatInHistory()`
       - `onError(error)`: Set `isStreaming = false`, set `isLoading = false`, push error message to chatMessages, call `notificationService.error()`
       - In the `finally` equivalent (error callback), always set `isStreaming = false`
    4. Update the template loading indicator: show "Thinking..." only when `isLoading && !isStreaming`; when `isStreaming`, the empty placeholder message is already in the chat (the appearing text IS the loading indicator)
    5. Add a visual streaming indicator (optional): a subtle pulsing dot or "Generating..." text on the streaming message
    6. During the translation phase (between `onDone` content and `onTranslation` arrival), the English text remains visible. If translation takes > 1s, optionally show a brief "Translating..." indicator on the message. This prevents a jarring content swap with no feedback.
  - Notes:
    - Vue 3 reactivity handles property assignment natively since `isStreaming`, `content`, and `metadata` are all defined at push time on the reactive `chatMessages` array.
    - The markdown renderer (`renderMarkdown()`) will re-render on every content change. For performance, consider debouncing the markdown render (e.g., only re-render every 100ms using a throttle), but for v1 direct re-rendering is acceptable.
    - `scrollToBottom()` should be called on every chunk for auto-scroll behavior

- [ ] **Task 13: Add i18n keys for streaming**
  - File: `components/gov-chat-frontend/src/i18n/locales/en.js`
  - Action: Add to the `chatbot` section:
    - `streamingError: 'Response was interrupted. Please try again.'`
    - `streamTimeout: 'Response timed out. Please try again.'`
    - `translationFailed: 'Translation failed. Showing original response.'`
    - `generating: 'Generating response...'`
  - Notes: The existing `processingError` key can be reused for general errors. The new keys are for streaming-specific error states.

#### Phase 4: Flutter Mobile (commit after each task)

- [ ] **Task 14: Add SSE package to Flutter**
  - File: `mobile/genie_ai_mobile/pubspec.yaml`
  - Action: Add `sse_client: ^0.2.0` (or latest stable) to dependencies
  - Notes: Run `flutter pub get` after adding. Verify the package supports POST requests with body (some SSE clients only support GET). If `sse_client` doesn't support POST, use `http` package with manual SSE line parsing as fallback.

- [ ] **Task 15: Update Flutter chatbot_proxy.dart for streaming**
  - File: `mobile/genie_ai_mobile/lib/services/chatbot_proxy.dart`
  - Action: Add `submitQueryStream(payload, callbacks)` method that:
    1. Gets the API URL and auth token from ApiService
    2. Creates SSE connection to `/api/queries/stream` with POST method
    3. Listens for SSE events and dispatches to callbacks: `onChunk(content)`, `onMetadata(metadata)`, `onTranslation(content)`, `onDone(data)`, `onError(error)`
    4. Parses JSON payload from each `data:` line
    5. Handles connection errors and timeouts
  - Notes: The exact SSE client implementation depends on the package chosen in Task 14. If using manual parsing with `http` package, read the response stream and parse SSE lines similar to the Vue implementation.

- [ ] **Task 16: Update Flutter chatbot_component.dart for progressive display**
  - File: `mobile/genie_ai_mobile/lib/components/chat/chatbot_component.dart`
  - Action:
    1. Add `_isStreaming` bool to state (alongside `_isLoading`)
    2. Modify the submit handler:
       - After sending user message, set `_isStreaming = true`, `_isLoading = false`
       - Add empty assistant message placeholder to `_messages`
       - Call `chatbotProxy.submitQueryStream(payload, callbacks)`
       - `onChunk`: Update the last message's content with `setState()`, auto-scroll
       - `onMetadata`: Update last message's metadata with `setState()`
       - `onTranslation`: Replace content with translated text
       - `onDone`: Set `_isStreaming = false`, update queryId
       - `onError`: Set `_isStreaming = false`, show error
    3. Update loading indicator: show spinner only when `_isLoading && !_isStreaming`
  - Notes: Flutter's `setState()` triggers a rebuild. For streaming performance, consider using `StreamBuilder` or updating only the affected message widget. But for v1, `setState()` on each chunk is acceptable.

#### Phase 5: Smoke Test Plan

- [ ] **Task 17: Write smoke test procedures**
  - File: `_bmad-output/implementation-artifacts/sse-smoke-tests.md`
  - Action: Create a comprehensive smoke test document (content below in the Smoke Test Plan section).

### Acceptance Criteria

- [ ] **AC 1**: Given the Vue frontend is loaded and a user sends a chat message, when the backend receives the request at `/api/queries/stream`, then the user sees response tokens appear incrementally (typewriter effect) within 2 seconds of the first token being generated by the LLM.
- [ ] **AC 2**: Given a streaming response is in progress, when the full response is received, then the backend sends a `type: "metadata"` SSE event containing `source_documents` (if retrieval succeeds) or an empty array (if retrieval fails), and `confidence_score`.
- [ ] **AC 3**: Given the user's language is not English and translation is enabled, when the stream completes, then the backend sends a `type: "translation"` SSE event with the translated text, and the Vue frontend replaces the English content with the translated version.
- [ ] **AC 4**: Given Kong and NGINX are configured for SSE, when a streaming request flows through `Browser → NGINX → Kong → Backend → ChatQnA`, then the response is delivered without buffering — tokens arrive in real-time, not in a batch after completion.
- [ ] **AC 5**: Given the ChatQnA service is unavailable, when the backend attempts to start a stream, then the backend sends a `type: "error"` SSE event with `code: "CHATQNA_UNAVAILABLE"` and the frontend displays an error message.
- [ ] **AC 6**: Given a streaming response is in progress, when the user navigates away or closes the browser tab, then the backend detects the disconnect (`req.on('close')`), aborts the upstream ChatQnA request, and cleans up resources. If any content was received before disconnect, the query record in ArangoDB is updated with the partial response text and `isAnswered: false`.
- [ ] **AC 7**: Given the existing `POST /api/queries` endpoint, when a client sends a request to it, then the response is returned as a complete JSON payload (non-streaming), maintaining backward compatibility.
- [ ] **AC 8**: Given the Flutter mobile app is connected, when a user sends a chat message, then response tokens appear incrementally in the chat UI, with metadata displayed after the stream completes.
- [ ] **AC 9**: Given a streaming response exceeds 60 seconds, when the response is still being generated, then Kong does NOT timeout the connection (new 1-hour timeout).
- [ ] **AC 10**: Given the `OPEA_STREAMING` environment variable is set to `false`, when a client sends a request to `/api/queries/stream`, then the backend returns a 501 status with an error message indicating streaming is disabled.

## Additional Context

### Dependencies

- Issue #500 (microservice auth) should be resolved — endpoints must be secured before streaming
- ChatQnA service must be healthy and responding (OPEA profile in docker-compose)
- Keycloak must be running for JWT authentication
- Document-repository service must be running for metadata fetches (port 3001)
- Retriever service must be running for post-stream document retrieval (port 7000)

### Streaming Data Flow (Complete)

```
Browser (Vue/Flutter)
  │ Fetch API / SSE client
  │ POST /api/queries/stream
  ▼
NGINX (port 443)
  │ proxy_buffering off (TO BE ADDED)
  │ proxy_read_timeout 3600s (TO BE ADDED)
  ▼
Kong (port 8000)
  │ response_buffering: false (TO BE ADDED)
  │ read_timeout: 3600000 (TO BE ADDED)
  ▼
Backend BFF (port 3000)
  │ NEW: query-routes.js streaming handler
  │ SSE headers: text/event-stream, Cache-Control: no-cache
  │ Calls ChatQnA with stream=true (axios responseType: 'stream')
  │ Parses align_generator output: data: b'text' → data: {"type":"chunk","content":"text"}
  │ After [DONE]: calls retriever + doc-repo for metadata
  │ After [DONE]: calls translation service if needed
  ▼
ChatQnA (port 8888)
  │ handle_request() → megaservice.schedule()
  │ Pipeline: embedding → retriever → reranker → LLM (streaming)
  │ align_generator() transforms vLLM SSE → data: b'text'\n\n
  │ Early return at line 1470 (skips translation + metadata)
  ▼
vLLM (port 8000) — direct connection from ChatQnA
  │ OpenAI-compatible SSE: data: {"choices":[{"delta":{"content":"..."}}]}
  │ NO textgen wrapper — ChatQnA connects directly
```

### ChatQnA SSE Format (what backend BFF receives)

```
data: b'Hello'\n\n
data: b', world'\n\n
data: b'!'\n\n
data: [DONE]\n\n
```

Format details:
- Each chunk: `data: ` + Python `repr()` of UTF-8 bytes + `\n\n`
- Content wrapped in `b'...'` (e.g., `b'Hello'`)
- Stream terminated by `data: [DONE]\n\n`
- Two input formats handled by align_generator: OpenAI `choices[0].delta.content` and OPEA internal `ops[0].value`
- Error fallback: malformed JSON is yielded as raw `repr()` bytes

### Kong/NGINX Current Blockers

| Component | Setting | Current | Required | File:Line |
|-----------|---------|---------|----------|-----------|
| Kong express-api service | read_timeout | 60000 (60s) | 3600000 (1h) | kong_config.json:70 |
| Kong express-api service | write_timeout | 60000 (60s) | 3600000 (1h) | kong_config.json:70 |
| Kong query-route | request_buffering | true | false | kong_config.json:90 |
| Kong query-route | response_buffering | true | false | kong_config.json:91 |
| NGINX /api/queries/stream | proxy_buffering | ON (default) | off (new nested location) | default.conf.template |
| NGINX /api/queries/stream | proxy_read_timeout | 300s | 3600s (new nested location) | default.conf.template |
| NGINX /api/queries/stream | X-Accel-Buffering | not set | no (new nested location) | default.conf.template |
| Express server | setTimeout | 300000 (5 min) | 3600000 (1 h) | index.js:1153 |

### Testing Strategy

#### Smoke Test Plan

**Prerequisites:**
- All services running (`docker compose --profile opea up -d`)
- User authenticated in the browser (Keycloak)
- ChatQnA healthy: `curl -sf http://localhost:8888/health` (from inside network)

**Test 1: Backend Direct SSE (no Kong/NGINX)**
```bash
# Get a token (temporarily enable ROPC, then REVERT)
GENIE_TOKEN=$(curl -sk -X POST "https://localhost/auth/realms/genie/protocol/openid-connect/token" \
  --data-urlencode "grant_type=password" \
  --data-urlencode "client_id=genie-app" \
  --data-urlencode "username=Admin" \
  --data-urlencode "password=ADMINadmin" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Test streaming endpoint directly (from inside Docker network)
docker exec main-backend-1 curl -sN -X POST http://localhost:3000/api/queries/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GENIE_TOKEN" \
  -d '{"sessionId":"test-sse-001","messages":[{"role":"user","content":"What is the capital of France?"}],"context":{"categoryLabel":"General","serviceLabels":[],"language":"EN"}}'
```
**Expected**: SSE events appear in real-time: `data: {"type":"chunk","content":"The"...}`, ending with `data: {"type":"done","queryId":"..."}`

**Test 2: Kong SSE Passthrough**
```bash
# Test through Kong (from inside Docker network)
docker exec main-kong-1 curl -sN -X POST http://backend:3000/api/queries/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GENIE_TOKEN" \
  -d '{"sessionId":"test-sse-002","messages":[{"role":"user","content":"Hello"}],"context":{"categoryLabel":"General","serviceLabels":[],"language":"EN"}}'
```
**Expected**: Same as Test 1 — real-time tokens, no buffering delay.

**Test 3: Full Stack (Browser → NGINX → Kong → Backend)**
1. Open browser at `https://localhost`
2. Log in as Admin
3. Send a message in the chat
4. **Expected**: Tokens appear incrementally, not all at once after a delay
5. **Verify**: No visible delay between first token and display (should be < 2s)
6. **Verify**: Metadata (source documents) appears in sidebar after response completes
7. **Verify**: Confidence score displays after response completes

**Test 4: Translation Post-Stream**
1. Set user language to French (or any non-EN language)
2. Send a message
3. **Expected**: English tokens appear first, then text is replaced with French translation after stream completes
4. **Verify**: The translation replaces the full content, not partial

**Test 5: Streaming with Translation Disabled**
1. Disable translation (set `TRANSLATION_BACKEND=off` or ensure translation service is unavailable)
2. Send a message
3. **Expected**: Stream works normally, English text remains after [DONE], no translation event sent
4. **Verify**: No error is thrown due to translation failure

**Test 5b: Translation UX — Intermediate State**
1. Set user language to French
2. Send a message that produces a long response (> 20 words)
3. **Observe**: After the English stream completes (tokens stop appearing), the text should remain visible
4. **Verify**: The translation should arrive within a few seconds and replace the English text
5. **Verify**: There is no blank or loading state between stream end and translation arrival — the English text remains visible as a fallback

**Test 6: Error Handling — ChatQnA Down**
```bash
# Scale ChatQnA to 0
docker compose scale chatqna-xeon-backend-server=0
# Send a streaming request — expect error event
```
**Expected**: Backend sends `data: {"type":"error","code":"CHATQNA_UNAVAILABLE",...}` and frontend shows error message

**Test 7: Client Disconnect (Clean)**
1. Send a long query (e.g., "Write a 500-word essay on...") via browser
2. Navigate to another page while response is streaming
3. **Verify**: Backend logs show connection cleanup, no orphaned processes
4. **Verify**: No error in backend logs about broken pipe after cleanup
5. **Verify**: The query record in ArangoDB has `isAnswered: false` and partial response text saved

**Test 7b: Network Interruption (Mid-Stream Failure)**
1. Send a long query via browser
2. While streaming, kill the backend container: `docker compose stop backend`
3. **Expected**: Browser shows a stream error message (the fetch will fail with a network error)
4. Restart backend: `docker compose up -d --force-recreate --no-deps backend`
5. **Verify**: No zombie processes or memory leaks after restart
6. **Verify**: The partially streamed query in ArangoDB has `isAnswered: false`

**Test 8: Kong Timeout (Regression)**
1. Send a query that takes > 60 seconds (long generation)
2. **Expected**: Response continues past 60 seconds — Kong does NOT timeout
3. **Previous behavior**: Kong would timeout at 60 seconds, dropping the connection

**Test 9: Non-Streaming Fallback**
```bash
# Test the existing endpoint still works
docker exec main-backend-1 curl -s -X POST http://localhost:3000/api/queries \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GENIE_TOKEN" \
  -d '{"sessionId":"test-sse-009","messages":[{"role":"user","content":"Hello"}],"context":{"categoryLabel":"General","serviceLabels":[],"language":"EN"}}'
```
**Expected**: Complete JSON response: `{"queryId":"...","response":"...","metadata":{...}}`

**Test 10: Flutter Mobile Streaming**
1. Build and run the Flutter app against the test environment:
   ```bash
   cd mobile/genie_ai_mobile
   flutter run --release
   ```
   Or connect to the local Docker stack by updating the API base URL in `ApiService` to point at `https://<your-local-ip>` (the NGINX host)
2. Log in and send a chat message
3. **Expected**: Tokens appear incrementally in the chat UI
4. **Verify**: Metadata appears after stream completes
5. **Verify**: No crashes or memory leaks during streaming
6. **Verify**: App remains responsive during streaming (UI doesn't freeze)

**Test 11: Streaming Disabled**
```bash
# Set OPEA_STREAMING=false in .env
# Restart backend
docker compose up -d --force-recreate --no-deps backend
# Send request to /api/queries/stream
```
**Expected**: HTTP 501 with error message

**Cleanup after testing:**
```bash
# Revert ROPC if enabled for testing
# Restore ChatQnA scale: docker compose scale chatqna-xeon-backend-server=1
# Remove test queries from ArangoDB if needed
```

#### Unit/Integration Tests (Future)

- Backend: Jest tests for `parseChatQnASSELine()` — test various `b'...'` formats, escape sequences, edge cases
- Backend: Jest tests for `initStreamQuery()` — validation, DB save, payload construction
- Frontend: Jest tests for `submitQueryStream()` — mock fetch, verify callback dispatch
- No test files exist yet — these are deferred to a follow-up task

### Notes

- Local build at `C:\Dev\builds\main` uses `docker-compose-rtx4060.yaml` override — do NOT modify `docker-compose.yaml` patches; apply local build patches after sync
- Backend uses CommonJS — never use ES imports
- Frontend uses Options API — never use Composition API or `<script setup>`
- i18n: use `translate('key', 'default')` — never `$t()`
- All changes to environment must propagate to: `env` template, `docker-compose.yaml`, Ansible `env.j2`
- Kong config is applied via `kong-config` one-shot service using `manage-kong-config.sh`
- OPEA 1.3 source is NOT vendored locally — cloned during Docker build from GitHub (GenAIExamples v1.3 + GenAIComps v1.3)
- ChatQnA connects DIRECTLY to vLLM:8000 bypassing the textgen wrapper service
- Document-repository has no batch metadata endpoint — backend BFF must use `Promise.all()` for parallel fetches
- No existing test files in the project — Jest configured but no tests written
