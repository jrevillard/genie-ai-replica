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
//
// Update semantics (2026-08-15 review fixes):
//  - MINIMAL input (no frontmatter AND no body — e.g. conformance's
//    {concept_id, repo_id} persist) writes ONLY the caller's patch fields:
//    it must never clobber the first-class fields a full upsert wrote
//    (ADR-021 write-path order: 4b full upsert → 4c conformance persist).
//  - A FULL re-ingest never downgrades pii_state back to 'unknown', never
//    clears last_good_index_at, and never downgrades index_status from
//    'indexed' back to 'parsed' — the fail-closed publish gate (2.8) must not
//    be silently un-blocked without a rescan, and indexed|failed transitions
//    belong to the 2.9.4 worker alone.

const { createHash } = require('node:crypto');
const { DateTime } = require('luxon');
const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');
const { getMeter } = require('../shared-lib/metrics');
const { isArangoNotFound, isArangoUniqueViolation } = require('./arango-errors');

const COLLECTION = 'okf_concepts_meta';

const LIFECYCLE_STATUSES = ['draft', 'stable', 'deprecated'];

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

/** firstExample that treats a not-found as null (real arangojs throws; the
 * unit mock returns null). STRICT classifier — see arango-errors.js. */
async function findConceptDoc(col, repo_id, concept_id) {
  try {
    return await col.firstExample({ repo_id, concept_id });
  } catch (err) {
    if (!isArangoNotFound(err)) throw err; // transient — surface, don't mask
    return null;
  }
}

/** sha256 hex of the concept body — the 2.9.1/2.9.5 content-hash dedup key. */
function contentHash(body) {
  return createHash('sha256')
    .update(String(body || ''))
    .digest('hex');
}

/** True iff the parsed input carries no concept payload (no frontmatter AND
 * no body) — a partial persist (e.g. conformance issues), not a re-ingest. */
function isMinimalInput(parsed) {
  const p = parsed || {};
  return p.frontmatter == null && p.body == null;
}

/**
 * Build the first-class okf_concepts_meta doc from a parseConcept output
 * (parser-service.js:182+). Pure mapping — no DB. Null-safe (guard BEFORE
 * deref — review fix for the dead null guard).
 */
function buildMetaDoc(repo_id, parsed, opts = {}) {
  const p = parsed || {};
  const fm = p.frontmatter || {};
  const path = p.path || '';
  const title = (fm.title && String(fm.title).trim()) || path.split('/').pop().replace(/\.md$/, '') || p.concept_id;
  const tags = Array.isArray(fm.tags) ? fm.tags : typeof fm.tags === 'string' ? [fm.tags] : [];
  const labels = Array.isArray(fm.labels) ? fm.labels : typeof fm.labels === 'string' ? [fm.labels] : [];
  const summary = (fm.description && String(fm.description).trim()) || (fm.summary && String(fm.summary).trim()) || '';
  const lifecycleStatus = LIFECYCLE_STATUSES.includes(p.status) ? p.status : 'draft'; // enum-validated
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
    pii_state: 'unknown', // superseded on scan (2.8 pii-service); never downgraded on update
    last_good_index_at: null,
    created_at: nowIso(),
    updated_at: nowIso()
  };
}

/**
 * Single update path (was three copy-pasted blocks). `minimal` writes ONLY
 * the caller's patch (no clobber); a full update additionally protects
 * pii_state/last_good_index_at from downgrades.
 */
async function applyUpdate(col, existing, repo_id, conceptId, parsed, opts, minimal, span) {
  let patch;
  if (minimal) {
    patch = { ...(opts.patch || {}) }; // ONLY caller-provided fields — never clobber
  } else {
    patch = { ...buildMetaDoc(repo_id, parsed, opts), ...(opts.patch || {}) };
    delete patch.created_at; // keep the original created_at on update
    // Fail-closed protection: a re-ingest must not silently un-block the PII
    // gate, erase indexing provenance, or downgrade an indexed concept back to
    // 'parsed' — indexed|failed transitions belong to the 2.9.4 worker alone
    // (2026-08-16 review fix; mirrors the pii_state rule).
    if (existing.pii_state && existing.pii_state !== 'unknown' && patch.pii_state === 'unknown') {
      delete patch.pii_state;
    }
    if (existing.last_good_index_at != null && patch.last_good_index_at == null) {
      delete patch.last_good_index_at;
    }
    if (existing.index_status === 'indexed' && patch.index_status === 'parsed') {
      delete patch.index_status;
    }
  }
  patch.updated_at = nowIso();
  try {
    await col.update(existing._key, patch);
  } catch (err) {
    recordOp('update', 'error');
    logger.error('Concepts-meta UPSERT update failed', { repo_id, concept_id: conceptId, error: err.message });
    throw err;
  }
  recordOp('update', 'success');
  logger.info('Concepts-meta UPSERT (update)', { repo_id, concept_id: conceptId });
  span.setAttribute('okf.meta.action', 'updated');
  return { action: 'updated', doc: { ...existing, ...patch, _key: existing._key, _id: existing._id } };
}

/**
 * Canonical UPSERT of a concept's okf_concepts_meta doc. Creates when absent,
 * updates when present, idempotent. Race-guarded against the unique
 * (repo_id, concept_id) index. Accepts an optional `patch` of extra fields
 * (e.g. { conformance_issues }) merged onto the doc.
 * @param {string} repo_id — required (falsy rejected: a repo-wide lookup hazard)
 * @param {object} parsed — parseConcept output (or a minimal {concept_id})
 * @param {object} [opts] { bundle_version?, patch?: object }
 * @returns {Promise<{action: 'created'|'updated', doc: object}>}
 */
async function upsertConceptMeta(repo_id, parsed, opts = {}) {
  const p = parsed || {};
  if (!repo_id || !p.concept_id) {
    // Guard: on real arangojs an undefined bind key is JSON-dropped, which
    // degrades firstExample to repo-wide (arbitrary-doc overwrite). The unit
    // mock's strict equality can never catch this — reject at the boundary.
    throw new Error(
      `upsertConceptMeta requires repo_id and concept_id (got repo_id=${String(repo_id)}, concept_id=${String(p.concept_id)})`
    );
  }
  return withSpan('okf.meta.upsert', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    span.setAttribute('okf.concept_id', p.concept_id);
    const db = await getDb();
    const col = db.collection(COLLECTION);
    const minimal = isMinimalInput(p);

    const existing = await findConceptDoc(col, repo_id, p.concept_id);
    if (existing) {
      try {
        return await applyUpdate(col, existing, repo_id, p.concept_id, p, opts, minimal, span);
      } catch (err) {
        if (isArangoNotFound(err)) {
          // TOCTOU: the doc vanished between find and update → create instead.
          logger.warn('Concepts-meta UPSERT: doc deleted mid-flight — retrying as create', {
            repo_id,
            concept_id: p.concept_id
          });
        } else {
          throw err;
        }
      }
    }

    try {
      // Create: a minimal persist seeds the doc with defaults (the G9 fix);
      // a full upsert writes the complete first-class field set.
      const merged = { ...buildMetaDoc(repo_id, p, opts), ...(opts.patch || {}) };
      const saved = await col.save(merged);
      recordOp('create', 'success');
      logger.info('Concepts-meta UPSERT (create)', { repo_id, concept_id: p.concept_id });
      span.setAttribute('okf.meta.action', 'created');
      return { action: 'created', doc: { ...merged, ...(saved || {}) } }; // keep save's _key/_id/_rev
    } catch (err) {
      if (isArangoUniqueViolation(err)) {
        // Concurrent create lost the race → retry as update (unique index guard).
        const again = await findConceptDoc(col, repo_id, p.concept_id);
        if (again) {
          return applyUpdate(col, again, repo_id, p.concept_id, p, opts, minimal, span);
        }
      }
      recordOp('create', 'error');
      logger.error('Concepts-meta UPSERT create failed', { repo_id, concept_id: p.concept_id, error: err.message });
      throw err;
    }
  });
}

/** Read one concept's meta doc (null when absent). The orchestrator's 4e
 * PRE-upsert read — the stored content_hash + index_status is the dedup basis
 * (2026-08-16 review fix: the post-upsert doc always carries the new hash). */
async function getConceptMeta(repo_id, concept_id) {
  if (!repo_id || !concept_id) return null;
  const db = await getDb();
  return findConceptDoc(db.collection(COLLECTION), repo_id, concept_id);
}

module.exports = { upsertConceptMeta, getConceptMeta, buildMetaDoc, contentHash };
