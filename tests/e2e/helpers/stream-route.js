// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
/**
 * The stream interception contract — the endpoint the app calls and the
 * shape a mocked stream answers with.
 *
 * ONE definition, and no credential in it. Two reasons:
 *
 * - a spec that intercepts the stream and needs nothing else (the quick
 *   help scope spec) requires THIS module, so it does not import the
 *   chat helper — which re-exports the fixtures' credentials — into a
 *   file that has no business importing them (tests/e2e/CLAUDE.md §
 *   Fixtures). The credential module may still be in the process graph
 *   through another helper; what this module removes is the DIRECT
 *   import of a credential-bearing helper;
 * - the config-validator gate reads the endpoint from here, so the gate
 *   watches the LIVE value instead of scraping the source text for a
 *   declaration whose spelling it would have to guess.
 *
 * The endpoint is stated ONCE: the path under the API base is the
 * endpoint; the route pattern is its interception glob. A copy of either
 * in a spec is a copy that can drift away from what the app calls
 * (#1271) — a drifted interception silently lets the request reach the
 * real network, so the spec then asserts against a live backend, and a
 * drifted predicate never matches at all.
 */
const STREAM_PATH = '/queries/stream';
const STREAM_ROUTE = `**${STREAM_PATH}**`;

// The CORS header a cross-origin reader needs to read ANY mocked
// answer: without it the browser drops the fulfilment and the app reads
// a transport failure instead of the mocked bytes (#1587). One
// definition — every fulfilment of a mocked answer uses it.
const CORS_HEADERS = { 'access-control-allow-origin': '*' };

/**
 * The wire bytes of a mocked answer: the chunk frames, the metadata
 * frame when one is given, and the done frame that closes the stream.
 *
 * The agentic extension (story 2.9): `options.activity` carries one
 * entry per chunk — an `{status, operation, callId}` object or null —
 * and a non-null entry emits an `agent_activity` frame immediately
 * before that chunk (the pinned interleave: activity frames ride
 * WITH the chunks); `options.verdict` carries the projection payload
 * and emits an `agent_verdict` frame after the last chunk, before the
 * metadata frame — the pinned terminal order (agent-frame-writer.js,
 * story 2.4). A two-arg call builds exactly the legacy bytes, so the
 * five existing event types keep their dialect by construction.
 */
function sseBody(chunks, metadata, options = {}) {
  // One activity entry per chunk, no silent misalignment: a longer (or
  // shorter) array would absorb the mismatch and a spec would then assert
  // against a stream it did not script.
  if (options.activity && options.activity.length !== chunks.length) {
    throw new Error(`sseBody: ${options.activity.length} activity entries for ${chunks.length} chunks`);
  }
  const frames = [];
  chunks.forEach((c, i) => {
    const a = options.activity?.[i];
    if (a) {
      frames.push(
        `data: ${JSON.stringify({ type: 'agent_activity', version: 1, status: a.status, operation: a.operation, callId: a.callId })}`
      );
    }
    frames.push(`data: ${JSON.stringify({ type: 'chunk', content: c })}`);
  });
  if (options.verdict) {
    // A verdict payload cannot override the frame's discriminator or
    // version — the same rule the BFF frame writer applies
    // (agent-frame-writer.js deletes its own type/version before spreading).
    const verdictProjection = { ...options.verdict };
    delete verdictProjection.type;
    delete verdictProjection.version;
    frames.push(`data: ${JSON.stringify({ type: 'agent_verdict', version: 1, ...verdictProjection })}`);
  }
  if (metadata) frames.push(`data: ${JSON.stringify({ type: 'metadata', ...metadata })}`);
  return [...frames, '', `data: ${JSON.stringify({ type: 'done', queryId: 'mock-query-1' })}`, ''].join('\n');
}

/**
 * The SSE envelope every mocked stream answer shares: 200, the event
 * stream content type, the CORS header. `mockChatStream`, the
 * held-release tests in chatbot/chat-conversation.spec.js and the
 * capture helper (helpers/stream-capture.js, which the query watcher in
 * chatbot/quick-help-scope.spec.js composes) hand the same envelope
 * different bodies; stating it once is what keeps a wire-contract change
 * a one-file edit.
 */
function sseFulfill(route, body) {
  return route.fulfill({ status: 200, contentType: 'text/event-stream', headers: CORS_HEADERS, body });
}

module.exports = { CORS_HEADERS, STREAM_PATH, STREAM_ROUTE, sseBody, sseFulfill };
