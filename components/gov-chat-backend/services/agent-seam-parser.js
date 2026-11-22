'use strict';

// Story 2.4 — the seam dialect's one parser. The agent service streams the
// internal envelope `{run_id, call_id, seq, kind, payload}` as SSE `data:`
// lines, plus its own terminal usage-record frame
// (`data: {"usage_record":{...}}`). This module turns ONE data line into a
// tagged result the frame writer can dispatch on:
//   { type: 'event', event }        — a validated envelope
//   { type: 'usage_record', record } — the terminal usage record
//   { type: 'error', raw }           — anything else (logged, never forwarded)
//
// The parser discipline mirrors query-service.parseChatQnASSELine: a
// discriminator, explicit defaults for the optional envelope fields, and a
// `__proto__` exclusion — JSON.parse yields `__proto__` as an own property,
// but ordinary assignment routes through the inherited setter and would
// replace the result's prototype instead of copying the value. The seam is
// deployment-internal, but the parser validates the envelope contract anyway:
// a malformed line degrades to `error`, never to a half-valid event the
// frame writer projects onto the client stream.

/**
 * Parse one seam SSE data line (the `data: ` prefix already removed).
 *
 * @param {string} line - The raw data line.
 * @returns {Object} `{ type: 'event', event }` | `{ type: 'usage_record', record }` |
 *   `{ type: 'error', raw }`.
 */
function parseAgentSeamLine(line) {
  const trimmed = String(line ?? '').trim();
  const invalid = () => ({ type: 'error', raw: trimmed });
  if (!trimmed.startsWith('{')) {
    return invalid();
  }
  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return invalid();
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return invalid();
  }

  // The terminal usage record: the run surface's last frame, carrying the
  // shared counters (`run_id`, `outcome`, steps/model/tool calls, tokens...).
  // The record is forwarded as parsed — the frame writer only persists it.
  if (Object.prototype.hasOwnProperty.call(obj, 'usage_record')) {
    const record = obj.usage_record;
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return invalid();
    }
    return { type: 'usage_record', record: withoutProto(record) };
  }

  // The envelope: run_id, seq and kind are REQUIRED. An envelope without any
  // one of them is not an event — a default there would let a malformed line
  // drive client frames.
  const runId = obj.run_id;
  const seq = obj.seq;
  const kind = obj.kind;
  if (typeof runId !== 'string' || !runId.trim()) {
    return invalid();
  }
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) {
    return invalid();
  }
  if (typeof kind !== 'string' || !kind.trim()) {
    return invalid();
  }
  const callId = typeof obj.call_id === 'string' && obj.call_id ? obj.call_id : null;
  const payload =
    obj.payload && typeof obj.payload === 'object' && !Array.isArray(obj.payload) ? withoutProto(obj.payload) : {};
  return {
    type: 'event',
    event: { run_id: runId, call_id: callId, seq, kind, payload }
  };
}

/**
 * A shallow copy of `obj`'s own enumerable properties minus `__proto__`.
 * @param {Object} obj
 * @returns {Object}
 */
function withoutProto(obj) {
  const copy = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === '__proto__') continue;
    copy[key] = value;
  }
  return copy;
}

module.exports = { parseAgentSeamLine };
