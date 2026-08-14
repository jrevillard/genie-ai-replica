// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Canonical okf_concepts_meta UPSERT writer (Story 2.9.2, gap G9). Creates/
// updates each concept's metadata row with first-class, indexable fields so
// conformance metrics, PII state, trust/provenance, and the Graph Router's
// selection signals are actually written — replacing the previous
// filter-and-UPDATE in conformance-service that silently wrote ZERO rows when
// no doc existed. The (repo_id, concept_id) unique index (collections.js) is
// the race guard; a concurrent-create violation retries as an update (pattern
// proven in pii-service.upsertPiiState). Direct AQL, shared db-connection.

const crypto = require('crypto');
const { DateTime } = require('luxon');
const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');
const { getMeter } = require('../shared-lib/metrics');

const COLLECTION = 'okf_concepts_meta';

const meter = getMeter();
const opsCounter = meter.createCounter('okf_concepts_meta_operations_total', {
  description: 'OKF concepts-meta UPSERT operations (create/update)'
});
function recordOp(operation, status) {
  try {
    opsCounter.add(1, { operation, status });
  } catch {
    /* meter no-op when observability off */
  }
}

let _db = null;
async function getDb() {
  if (_db) return _db;
  _db = await dbService.getConnection('default');
  return _db;
}

function nowIso() {
  return DateTime.now().toUTC().toISO();
}

/** arangojs "document not found / no match" detector (firstExample throws it). */
function isNotFound(err) {
  return (
    err &&
    (err.errorNum === 1204 ||
      err.code === 404 ||
      err.statusCode === 404 ||
      (err.message && /no match|not found/i.test(String(err.message))))
  );
}

/** firstExample that treats a no-match as null (real arangojs + the shared db
 * wrapper throw "no match"; the unit mock returns null). Smoke-test caught this
 * divergence. */
async function findConceptDoc(col, repo_id, concept_id) {
  try {
    return await col.firstExample({ repo_id, concept_id });
  } catch (err) {
    if (!isNotFound(err)) throw err; // transient — surface, don't mask
    return null;
  }
}

/** sha256 hex of the concept body — the 2.9.1/2.9.5 content-hash dedup key. */
function contentHash(body) {
  return crypto
    .createHash('sha256')
    .update(String(body || ''))
    .digest('hex');
}

/**
 * Build the first-class okf_concepts_meta doc from a parseConcept output
 * (parser-service.js:182+). Pure mapping — no DB.
 */
function buildMetaDoc(repo_id, parsed, opts = {}) {
  const fm = parsed.frontmatter || {};
  const p = parsed || {};
  const path = p.path || '';
  const title = (fm.title && String(fm.title).trim()) || path.split('/').pop().replace(/\.md$/, '') || p.concept_id;
  const tags = Array.isArray(fm.tags) ? fm.tags : typeof fm.tags === 'string' ? [fm.tags] : [];
  const labels = Array.isArray(fm.labels) ? fm.labels : typeof fm.labels === 'string' ? [fm.labels] : [];
  const summary = (fm.description && String(fm.description).trim()) || (fm.summary && String(fm.summary).trim()) || '';
  const lifecycleStatus = p.status || 'draft';
  const staleAfter = p.stale_after || null;
  return {
    repo_id,
    concept_id: p.concept_id,
    path,
    graph_name: `OKF_${repo_id}`,
    bundle_version: p.bundle_version != null ? p.bundle_version : (opts.bundle_version ?? null),
    title,
    type: fm.type || '',
    tags,
    labels,
    summary,
    frontmatter: fm,
    content_hash: contentHash(p.body),
    lifecycle_status: lifecycleStatus,
    index_status: 'parsed', // orchestrator/worker transitions to indexed|failed (2.9.1/2.9.4)
    trust_tier: p.trust_tier || 'unverified',
    stale_after: staleAfter,
    verified: p.verified ?? null,
    sources: Array.isArray(p.sources) ? p.sources : [],
    pii_state: 'unknown', // superseded on scan (2.8 pii-service)
    last_good_index_at: null,
    created_at: nowIso(),
    updated_at: nowIso()
  };
}

/**
 * Canonical UPSERT of a concept's okf_concepts_meta doc. Creates when absent,
 * updates when present, idempotent. Race-guarded against the unique
 * (repo_id, concept_id) index. Accepts an optional `patch` of extra fields
 * (e.g. { conformance_issues }) merged onto the doc.
 * @param {string} repo_id
 * @param {object} parsed — parseConcept output (or {concept_id} minimal)
 * @param {object} [opts] { bundle_version?, patch?: object }
 * @returns {Promise<{action: 'created'|'updated', doc: object}>}
 */
async function upsertConceptMeta(repo_id, parsed, opts = {}) {
  return withSpan('okf.meta.upsert', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    span.setAttribute('okf.concept_id', parsed.concept_id);
    const db = await getDb();
    const col = db.collection(COLLECTION);
    const doc = buildMetaDoc(repo_id, parsed, opts);

    const existing = await findConceptDoc(col, repo_id, parsed.concept_id);
    if (existing) {
      const patch = { ...doc, ...(opts.patch || {}) };
      delete patch.created_at; // keep the original created_at on update
      patch.updated_at = nowIso();
      await col.update(existing._key, patch);
      recordOp('update', 'success');
      logger.info('Concepts-meta UPSERT (update)', { repo_id, concept_id: parsed.concept_id });
      span.setAttribute('okf.meta.action', 'updated');
      return { action: 'updated', doc: { ...existing, ...patch } };
    }

    try {
      const merged = { ...doc, ...(opts.patch || {}) };
      await col.save(merged);
      recordOp('create', 'success');
      logger.info('Concepts-meta UPSERT (create)', { repo_id, concept_id: parsed.concept_id });
      span.setAttribute('okf.meta.action', 'created');
      return { action: 'created', doc: merged };
    } catch (err) {
      // Concurrent create lost the race → retry as update (unique index guard).
      if (err && (err.errorNum === 1210 || err.errorNum === 1185 || err.code === 409)) {
        const again = await findConceptDoc(col, repo_id, parsed.concept_id);
        if (again) {
          const patch = { ...doc, ...(opts.patch || {}) };
          delete patch.created_at;
          patch.updated_at = nowIso();
          await col.update(again._key, patch);
          recordOp('update', 'success');
          span.setAttribute('okf.meta.action', 'updated');
          return { action: 'updated', doc: { ...again, ...patch } };
        }
      }
      recordOp('create', 'error');
      throw err;
    }
  });
}

module.exports = { upsertConceptMeta, buildMetaDoc, contentHash };
