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
      const res = await client.post(config.piiService.scanPath, body, { timeout: scanTimeoutMs(texts) });
      // FAIL-CLOSED on payloads too (code-review fix): a 200 with a malformed/
      // empty body must NOT be treated as 'no hits'. Validate the shape.
      const results = res.data && res.data.results;
      if (!Array.isArray(results) || results.length !== texts.length) {
        throw new Error(`malformed sidecar response (${res.status})`);
      }
      for (const r of results) {
        if (!r || typeof r.id !== 'string' || !Array.isArray(r.hits) || typeof r.counts_by_type !== 'object') {
          throw new Error('malformed sidecar result item');
        }
      }
      return { state: 'ok', results };
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

/** Size-scaled per-call timeout (live-fix 2026-09-03): the 10 s default is
 * tuned for small concepts; presidio NER on a 90 KB crawl page legitimately
 * runs tens of seconds, and a client timeout ALWAYS beats a working sidecar
 * (3 attempts x fail-closed = pii_state=error on healthy content). Budget
 * ~2 s per KB of scanned text with the configured default as the floor and
 * a hard 10-min cap. */
function scanTimeoutMs(texts) {
  const totalChars = texts.reduce((n, t) => n + (t && typeof t.text === 'string' ? t.text.length : 0), 0);
  const scaled = Math.ceil(totalChars / 1024) * 2000;
  return Math.min(Math.max(scaled, config.piiService.timeoutMs), 600000);
}

/** Convenience: scan one text → ok|hit|error + hits/redacted_text. */
async function scanOne(id, text, opts) {
  const out = await scan([{ id, text }], opts);
  if (out.state === 'error') return out;
  return { state: 'ok', ...out.results[0] };
}

module.exports = { scan, scanOne };
