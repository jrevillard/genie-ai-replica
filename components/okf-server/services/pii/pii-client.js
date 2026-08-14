// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// PII sidecar HTTP client (ADR-okf-004 rev 2026-08-14). FAIL-CLOSED: any
// transport failure maps to { state: 'error' } — NEVER silently clean
// (FR-5/NFR-P1: a PII gate that silently passes on failure is a compliance
// hole). Raw text is never logged (NFR-P2) — only ids/counts/error classes.

const axios = require('axios');
const config = require('../../config');
const { logger } = require('../../shared-lib/logger');

const client = axios.create({
  baseURL: config.piiService.url,
  timeout: config.piiService.timeoutMs
});

/** Mask an error to a loggable class string — never embed response bodies. */
function errorClass(err) {
  if (err.code) return err.code; // e.g. ECONNREFUSED, ETIMEDOUT
  if (err.response) return `HTTP_${err.response.status}`;
  return 'UNKNOWN';
}

/**
 * Scan a batch of texts via the sidecar.
 * @param {Array<{id: string, text: string}>} texts
 * @param {object} [opts] { entities?: string[], threshold?: number }
 * @returns {Promise<{state: 'ok', results: object[]}|{state: 'error', error: string}>}
 */
async function scan(texts, opts = {}) {
  const body = {
    texts,
    ...(opts.entities ? { entities: opts.entities } : {}),
    ...(opts.threshold ? { threshold: opts.threshold } : {})
  };
  for (let attempt = 1; attempt <= config.piiService.retries + 1; attempt++) {
    try {
      const res = await client.post(config.piiService.scanPath, body);
      return { state: 'ok', results: res.data.results };
    } catch (err) {
      const cls = errorClass(err);
      logger.warn('PII sidecar call failed', { attempt, error_class: cls, items: texts.length });
      if (attempt > config.piiService.retries) {
        // FAIL-CLOSED: the authoritative gate degrades to 'error', which the
        // publish gate blocks on. Callers NEVER treat this as clean.
        return { state: 'error', error: cls };
      }
      await new Promise((r) => setTimeout(r, 250 * attempt)); // linear backoff
    }
  }
  /* istanbul ignore next — unreachable (loop returns) */
  return { state: 'error', error: 'EXHAUSTED' };
}

/** Convenience: scan one text → ok|hit|error + hits/redacted_text. */
async function scanOne(id, text, opts) {
  const out = await scan([{ id, text }], opts);
  if (out.state === 'error') return out;
  return { state: 'ok', ...out.results[0] };
}

module.exports = { scan, scanOne };
