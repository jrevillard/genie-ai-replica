// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
'use strict';

/** Which upstream failures are worth another attempt? Shared by every
 * caller of the remote model endpoints (the frontmatter chat/embed retry
 * wrappers AND the model-discovery probe): TEI_EMBED_HOST and VLLM_ENDPOINT
 * both point at the SHARED remote GPU node, so a dropped connection is
 * routine rather than exceptional — it is the exact failure these wrappers
 * exist for. One home: a transient class learned from a live incident must
 * not have to be re-learned per call site.
 *
 * A prematurely-closed response stream was MISSING from this list until
 * 2026-10-12. axios surfaces a mid-response upstream disconnect as
 * ERR_STREAM_PREMATURE_CLOSE ("stream has been aborted"), which matches
 * neither the status codes nor the socket codes below, so the callers fell
 * through to `throw err` on the FIRST abort. Live proof: "Explain
 * failures" on the Alphabet repo died twice in a row with
 * `AxiosError: stream has been aborted` at frontmatter-service.js
 * withTeiRetry — zero retries — while the head-embed endpoint kept
 * resetting under the shared node's load. */

const RETRIABLE_CODES = new Set([
  'ECONNABORTED', // our own axios timeout
  'ECONNREFUSED',
  'ECONNRESET', // peer reset the socket
  'EPIPE',
  'ETIMEDOUT',
  'ERR_STREAM_PREMATURE_CLOSE' // axios: upstream closed mid-response
]);
// 429 joined 2026-10-23: the shared endpoint's burst limiter answers 429
// long before the plan's 5-hour/weekly quotas are anywhere near spent (live:
// 4 of 100 benchmark rows died on a 429 that sailed straight through this
// set). A rate limit is the definition of "wait and try again" — pausing is
// the fix, failing is not.
const RETRIABLE_STATUS = new Set([429, 502, 503, 504]);

function isRetriableUpstreamError(err) {
  if (!err) return false;
  const status = err.response && err.response.status;
  if (status && RETRIABLE_STATUS.has(status)) return true;
  if (err.code && RETRIABLE_CODES.has(err.code)) return true;
  // Some aborts reach us as a bare Error carrying neither a code nor a
  // response — match the message so a known-transient blip is never
  // mistaken for a permanent failure.
  const msg = typeof err.message === 'string' ? err.message : '';
  return /stream has been aborted|socket hang up|premature close|ECONNRESET/i.test(msg);
}

module.exports = { isRetriableUpstreamError };
