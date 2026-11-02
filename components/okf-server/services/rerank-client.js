// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// ONE TEI rerank client (review !622 round 9, #78662): head-suite and
// ragas-suite each grew a private rerankTexts and the copies drifted —
// the batch cap, the Retry-After ceiling and abort-retryable existed only
// in the ragas copy, the attempt count differed (3 vs 4), and the
// "after N attempts" honest note existed only in the head-suite copy.
// This module is the surviving superset; both callers consume it, so the
// next transport fix lands in exactly one place.
//
// Contract: POST {query, texts} to OKF_RERANK_ENDPOINT (Bearer
// OKF_RERANK_TOKEN when set), decode [{index, score}]. Batches at 32
// (live 2026-10-18: TEI hard-fails "batch size 48 > maximum 32" — client-
// side batching bounds every caller regardless of fanout) and runs the
// batches through a worker pool of OKF_RAGAS_RERANK_CONCURRENCY (default
// 3, clamp 1..8) — the calls are independent, results reassemble by index,
// so pooling changes transport only, never scores. Per attempt: 30s
// timeout (15s aborted healthy-but-busy batches — live 2026-10-23, 2 of
// 100 rows) and our own abort is retryable (the endpoint was busy, not
// wrong). Retries: statuses 429/502/503/504 only, up to 4 attempts, the
// server's Retry-After wins but capped at 60s, otherwise binary
// exponential backoff capped at 8s with jitter (parallel retries must not
// synchronise into a stampede). A final transient failure renames the
// error "HTTP <s> after 4 attempts" — the probe/row notes render it.

const { logger } = require('../shared-lib/logger');

const RERANK_RETRY_ATTEMPTS = 4;
const RERANK_RETRY_STATUSES = new Set([429, 502, 503, 504]);
// Ceiling for a server-provided Retry-After (review 2026-10-23): the
// server's number wins over our ladder, but never past 60s — an uncapped
// 'Retry-After: 3600' would sleep an hour per attempt.
const RETRY_AFTER_CAP_MS = 60000;
const RERANK_TIMEOUT_MS = 30000;
const RERANK_BATCH = 32;
const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * How many rerank batch calls may be in flight at once (2026-10-23, David:
 * "the reranker is lightweight and there is no pressure on the GPU server;
 * benchmarks and curation will not be running while users are using the
 * system"). 1 = the old polite sequential behaviour; the default 3 turns a
 * 6-batch pool from ~6 sequential round trips into ~2 waves. Read per call
 * so a deployment can turn it without touching code, and clamped hard
 * because a retry stampede helps nobody.
 */
function rerankConcurrency() {
  const n = parseInt(process.env.OKF_RAGAS_RERANK_CONCURRENCY || '3', 10);
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(n, 8));
}

function retryDelayMs(e, attempt) {
  // Binary exponential backoff (David, 2026-10-23): 0.5s, 1s, 2s, ... capped
  // at 8s, jittered so parallel batches do not synchronise into a stampede.
  // The server's own Retry-After wins when it sends one — a rate limiter
  // that says "come back in 3s" knows better than our ladder — but CAPPED:
  // a limiter that says "come back in an hour" must not park the benchmark
  // (or an interactive caller) for an hour per attempt.
  if (e.retryAfterMs) return Math.min(RETRY_AFTER_CAP_MS, e.retryAfterMs);
  return Math.min(8000, 500 * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 250);
}

/**
 * Rerank `texts` against `query`. Returns [{index, score}] with batch-local
 * indices remapped to the caller's global ones. Throws (never degrades) —
 * the callers own their degradation posture.
 */
async function rerankTexts(query, texts) {
  const rerankUrl = process.env.OKF_RERANK_ENDPOINT || '';
  if (!rerankUrl) {
    const err = new Error('rerank endpoint not configured (OKF_RERANK_ENDPOINT)');
    err.code = 'RERANK_NOT_CONFIGURED';
    throw err;
  }
  const headers = { 'Content-Type': 'application/json' };
  const token = process.env.OKF_RERANK_TOKEN || '';
  if (token) headers.Authorization = `Bearer ${token}`;
  const batches = [];
  for (let offset = 0; offset < texts.length; offset += RERANK_BATCH) {
    batches.push({ offset, batch: texts.slice(offset, offset + RERANK_BATCH) });
  }
  const concurrency = rerankConcurrency();
  const started = Date.now();
  logger.info('rerank-client.start', {
    texts: texts.length,
    batches: batches.length,
    concurrency
  });

  async function rerankBatch(batch) {
    let decoded;
    let attempts = 0;
    for (let attempt = 1; attempt <= RERANK_RETRY_ATTEMPTS; attempt += 1) {
      attempts = attempt;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), RERANK_TIMEOUT_MS);
      try {
        const resp = await fetch(rerankUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ query, texts: batch }),
          signal: controller.signal
        });
        if (!resp.ok) {
          const err = new Error(`HTTP ${resp.status}`);
          err.status = resp.status;
          err.retryable = RERANK_RETRY_STATUSES.has(resp.status);
          const ra = Number(resp.headers && resp.headers.get && resp.headers.get('retry-after'));
          if (Number.isFinite(ra) && ra > 0) err.retryAfterMs = ra * 1000;
          // The honest note: callers render "rerank failed: HTTP 429 after
          // 4 attempts" — "HTTP 429" alone hides that retrying happened.
          if (err.retryable && attempt >= RERANK_RETRY_ATTEMPTS) {
            err.message = `HTTP ${resp.status} after ${RERANK_RETRY_ATTEMPTS} attempts`;
          }
          throw err;
        }
        decoded = await resp.json();
        if (!Array.isArray(decoded)) throw new Error('unexpected rerank response shape');
        break;
      } catch (e) {
        // Our own RERANK_TIMEOUT_MS abort (Node fetch rejects with a
        // DOMException, name AbortError / code 20) is transient by
        // definition — the endpoint was busy, not wrong. Live 2026-10-23:
        // 2 of 100 rows died on exactly this at a 6x-bigger pool because an
        // abort carried no retryable marker and sailed straight through.
        if (e && (e.name === 'AbortError' || e.code === 20 || e.code === 'ABORT_ERR')) {
          e.retryable = true;
        }
        if (e.retryable === true && attempt < RERANK_RETRY_ATTEMPTS) {
          await sleepMs(retryDelayMs(e, attempt));
          continue;
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }
    return { decoded, attempts };
  }

  // Worker pool over the batch list: each worker takes the next batch index
  // when it frees up, so a slow batch never idles the other workers. Results
  // land in decodedByBatch[i] — batch order is preserved regardless of
  // completion order.
  const decodedByBatch = new Array(batches.length);
  let retries = 0;
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next;
      if (i >= batches.length) return;
      next += 1;
      const { decoded, attempts } = await rerankBatch(batches[i].batch);
      retries += attempts - 1;
      decodedByBatch[i] = decoded;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) || 1 }, worker));

  // chunk-local indices -> global indices before merging
  const merged = [];
  batches.forEach(({ offset, batch }, i) => {
    for (const r of decodedByBatch[i] || []) {
      const idx = Number(r && r.index);
      if (Number.isInteger(idx) && idx >= 0 && idx < batch.length) {
        merged.push({ index: idx + offset, score: Number(r && r.score) || 0 });
      }
    }
  });
  logger.info('rerank-client.done', {
    texts: texts.length,
    batches: batches.length,
    concurrency,
    retries,
    wall_ms: Date.now() - started
  });
  return merged;
}

module.exports = { rerankTexts };
