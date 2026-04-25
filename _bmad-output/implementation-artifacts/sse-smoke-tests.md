# SSE Streaming Smoke Tests

**Created:** 2026-04-25

## Prerequisites

- All services running (`docker compose --profile opea up -d`)
- User authenticated in the browser (Keycloak)
- ChatQnA healthy: `curl -sf http://localhost:8888/health` (from inside network)

## Test 1: Backend Direct SSE (no Kong/NGINX)

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

**Expected:** SSE events appear in real-time: `data: {"type":"chunk","content":"The"...}`, ending with `data: {"type":"done","queryId":"..."}`

## Test 2: Kong SSE Passthrough

```bash
# Test through Kong (from inside Docker network)
docker exec main-kong-1 curl -sN -X POST http://backend:3000/api/queries/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GENIE_TOKEN" \
  -d '{"sessionId":"test-sse-002","messages":[{"role":"user","content":"Hello"}],"context":{"categoryLabel":"General","serviceLabels":[],"language":"EN"}}'
```

**Expected:** Same as Test 1 — real-time tokens, no buffering delay.

## Test 3: Full Stack (Browser → NGINX → Kong → Backend)

1. Open browser at `https://localhost`
2. Log in as Admin
3. Send a message in the chat
4. **Expected:** Tokens appear incrementally, not all at once after a delay
5. **Verify:** No visible delay between first token and display (should be < 2s)
6. **Verify:** Metadata (source documents) appears in sidebar after response completes
7. **Verify:** Confidence score displays after response completes

## Test 4: Translation Post-Stream

1. Set user language to French (or any non-EN language)
2. Send a message
3. **Expected:** English tokens appear first, then text is replaced with French translation after stream completes
4. **Verify:** The translation replaces the full content, not partial

## Test 5: Streaming with Translation Disabled

1. Disable translation (set `TRANSLATION_BACKEND=off` or ensure translation service is unavailable)
2. Send a message
3. **Expected:** Stream works normally, English text remains after [DONE], no translation event sent
4. **Verify:** No error is thrown due to translation failure

## Test 5b: Translation UX — Intermediate State

1. Set user language to French
2. Send a message that produces a long response (> 20 words)
3. **Observe:** After the English stream completes (tokens stop appearing), the text should remain visible
4. **Verify:** The translation should arrive within a few seconds and replace the English text
5. **Verify:** There is no blank or loading state between stream end and translation arrival — the English text remains visible as a fallback

## Test 6: Error Handling — ChatQnA Down

```bash
docker compose scale chatqna-xeon-backend-server=0
# Send a streaming request — expect error event
```

**Expected:** Backend sends `data: {"type":"error","code":"CHATQNA_UNAVAILABLE",...}` and frontend shows error message

## Test 7: Client Disconnect (Clean)

1. Send a long query (e.g., "Write a 500-word essay on...") via browser
2. Navigate to another page while response is streaming
3. **Verify:** Backend logs show connection cleanup, no orphaned processes
4. **Verify:** No error in backend logs about broken pipe after cleanup
5. **Verify:** The query record in ArangoDB has `isAnswered: false` and partial response text saved

## Test 7b: Network Interruption (Mid-Stream Failure)

1. Send a long query via browser
2. While streaming, kill the backend container: `docker compose stop backend`
3. **Expected:** Browser shows a stream error message (the fetch will fail with a network error)
4. Restart backend: `docker compose up -d --force-recreate --no-deps backend`
5. **Verify:** No zombie processes or memory leaks after restart
6. **Verify:** The partially streamed query in ArangoDB has `isAnswered: false`

## Test 8: Kong Timeout (Regression)

1. Send a query that takes > 60 seconds (long generation)
2. **Expected:** Response continues past 60 seconds — Kong does NOT timeout
3. **Previous behavior:** Kong would timeout at 60 seconds, dropping the connection

## Test 9: Non-Streaming Fallback

```bash
docker exec main-backend-1 curl -s -X POST http://localhost:3000/api/queries \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GENIE_TOKEN" \
  -d '{"sessionId":"test-sse-009","messages":[{"role":"user","content":"Hello"}],"context":{"categoryLabel":"General","serviceLabels":[],"language":"EN"}}'
```

**Expected:** Complete JSON response: `{"queryId":"...","response":"...","metadata":{...}}`

## Test 10: Flutter Mobile Streaming

1. Build and run the Flutter app against the test environment:
   ```bash
   cd mobile/genie_ai_mobile
   flutter run --release
   ```
2. Log in and send a chat message
3. **Expected:** Tokens appear incrementally in the chat UI
4. **Verify:** Metadata appears after stream completes
5. **Verify:** No crashes or memory leaks during streaming
6. **Verify:** App remains responsive during streaming (UI doesn't freeze)

## Test 11: Streaming Disabled

```bash
# Set OPEA_STREAMING=false in .env
# Restart backend
docker compose up -d --force-recreate --no-deps backend
# Send request to /api/queries/stream
```

**Expected:** HTTP 501 with error message

## Cleanup after testing

```bash
# Revert ROPC if enabled for testing
# Restore ChatQnA scale: docker compose scale chatqna-xeon-backend-server=1
# Remove test queries from ArangoDB if needed
```
