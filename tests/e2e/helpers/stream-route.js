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
 */
function sseBody(chunks, metadata) {
  const frames = chunks.map((c) => `data: ${JSON.stringify({ type: 'chunk', content: c })}`);
  if (metadata) frames.push(`data: ${JSON.stringify({ type: 'metadata', ...metadata })}`);
  return [...frames, '', `data: ${JSON.stringify({ type: 'done', queryId: 'mock-query-1' })}`, ''].join('\n');
}

/**
 * The SSE envelope every mocked stream answer shares: 200, the event
 * stream content type, the CORS header. `mockChatStream`, the
 * held-release test in chatbot/chat-conversation.spec.js and the query watcher
 * in chatbot/quick-help-scope.spec.js hand the same envelope different
 * bodies; stating it once is what keeps a wire-contract change a
 * one-file edit.
 */
function sseFulfill(route, body) {
  return route.fulfill({ status: 200, contentType: 'text/event-stream', headers: CORS_HEADERS, body });
}

module.exports = { CORS_HEADERS, STREAM_PATH, STREAM_ROUTE, sseBody, sseFulfill };
