// src/services/streamingService.js - SSE consumption for POST /api/queries/stream
// Falls back to the non-streaming endpoint when streaming fails before the
// first event (network error, 4xx/5xx, no body stream).
//
// Audit F9 (night of 09-28/29): the stream is now abortable (Stop button /
// unmount), a no-progress watchdog replaces the old wait-forever, and a clean
// EOF without a done event is a TRUNCATION error — never a complete answer.

import keycloakAuthService from './keycloakAuthService';

const STREAM_URL = '/api/queries/stream';
const NO_PROGRESS_TIMEOUT_MS = 150000; // backend heartbeats every 15s — only real hangs hit this

let activeController = null;

/** Abort the in-flight stream (if any) — Stop button / component unmount. */
export function abortActiveStream() {
  activeController?.abort();
}

/**
 * Incremental SSE frame parser. Feed it decoded text chunks; it buffers
 * across chunk boundaries and invokes onEvent(jsonString) once per data line.
 * @returns {{push(text: string): void, flush(): void}}
 */
export function createSSEParser(onEvent) {
  let buffer = '';
  return {
    push(text) {
      buffer += text;
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line.startsWith('data:')) {
          onEvent(line.slice(5).trim());
        }
      }
    },
    flush() {
      const line = buffer.trim();
      if (line.startsWith('data:')) {
        onEvent(line.slice(5).trim());
      }
      buffer = '';
    }
  };
}

function authHeaders() {
  const token = keycloakAuthService.getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Stream a chat query. Handlers receive parsed event objects
 * ({queryId}, {delta}, {done, queryId, metadata}, {error}, and the F4
 * end-of-stream translation events {translation} / {translationNotice}).
 * Resolves with the aggregated result ({response, queryId, metadata, sessionId, error}).
 * Rejects with err.streamStarted=true if it fails after events were emitted
 * (err.partial carries whatever text had arrived).
 */
export async function streamChatQuery(queryData, handlers = {}, fetchImpl = fetch) {
  const controller = new AbortController();
  activeController = controller;
  let response;
  try {
    response = await fetchImpl(STREAM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ ...queryData, timestamp: new Date().toISOString() }),
      signal: controller.signal
    });
  } catch (err) {
    err.streamStarted = false;
    throw err;
  }

  if (!response.ok || !response.body) {
    const err = new Error(`stream unavailable (${response.status})`);
    err.streamStarted = false;
    throw err;
  }

  let streamStarted = false;
  let sawDone = false;
  const result = { response: '', queryId: null, metadata: {}, sessionId: queryData.sessionId, error: null };

  const parser = createSSEParser((raw) => {
    if (!raw) return;
    let evt;
    try {
      evt = JSON.parse(raw);
    } catch {
      return; // keep-alive or non-JSON comment line
    }
    streamStarted = true;
    if (evt.queryId && !evt.delta && !evt.done) {
      result.queryId = evt.queryId;
      handlers.onOpen?.(evt);
    } else if (evt.delta) {
      result.response += evt.delta;
      handlers.onDelta?.(evt.delta);
    } else if (evt.done) {
      sawDone = true;
      result.queryId = evt.queryId || result.queryId;
      result.metadata = evt.metadata || {};
      handlers.onDone?.(evt);
    } else if (evt.error) {
      result.error = evt.error;
      handlers.onError?.(evt.error);
    } else if (evt.translation !== undefined) {
      // F4 end-of-stream translation: the final translated answer replaces the
      // streamed English preview (deltas were a live preview, not the answer).
      result.response = evt.translation;
      handlers.onTranslation?.(evt.translation);
    } else if (evt.translationNotice) {
      // F4: translation unavailable — the English answer stands; the UI shows a
      // muted notice. Distinct from {error}: the answer itself is fine.
      handlers.onTranslationNotice?.();
    }
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let lastActivity = Date.now();
  const watchdog = setInterval(() => {
    if (Date.now() - lastActivity > NO_PROGRESS_TIMEOUT_MS) controller.abort();
  }, 5000);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      lastActivity = Date.now();
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.flush();
  } catch (err) {
    err.streamStarted = streamStarted;
    err.partial = result.response;
    throw err;
  } finally {
    clearInterval(watchdog);
    if (activeController === controller) activeController = null;
  }

  // A clean EOF without done is a TRUNCATED answer, not a complete one —
  // surface it (with the partial text) so the UI never passes it off as success.
  if (!sawDone) {
    const err = new Error(result.error || 'stream ended without a done event');
    err.streamStarted = streamStarted;
    err.partial = result.response;
    throw err;
  }
  return result;
}
