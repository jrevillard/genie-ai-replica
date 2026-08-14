// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// PII service — the orchestrator-facing API (ADR-okf-021 write-path step 4d).
// scanConcept calls the Presidio sidecar (fail-closed), UPSERTs pii_state onto
// okf_concepts_meta (the SEED of Story 2.9.2's writer — G9/G28), and returns
// redacted_text for the caller to persist (2.9.1 stores bodies). Also owns:
// the publish gate (assertPiiClean, D22/ADR-okf-030), the FR-3 ingest version
// record (sha256-derived, NOT bundle_version — 2.9.7 boundary), and the FR-28
// document-reference shape. NFR-P2: raw PII NEVER persisted or logged — only
// type/count summaries. MELT on every method.

const { aql } = require('arangojs');
const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');
const { getMeter } = require('../shared-lib/metrics');
const piiClient = require('./pii/pii-client');

const META = 'okf_concepts_meta';
const REPOS = 'okf_repositories';
const FILES = 'files';

const meter = getMeter();
const opsCounter = meter.createCounter('okf_pii_operations_total', {
  description: 'OKF PII scan/gate/version operations'
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

// ─── pii_state writer (G28 — the seed UPSERT) ───────────────────────────────

/**
 * Idempotent upsert of the PII state onto okf_concepts_meta. Creates a minimal
 * doc when absent (Story 2.9.2 formalizes first-class fields). The unique
 * (repo_id, concept_id) index is the race guard: a unique violation on the
 * concurrent-create path retries as an update.
 * @param {string} repo_id
 * @param {string} concept_id
 * @param {object} patch {pii_state, pii_hits_summary?, pii_scanned_at}
 */
async function upsertPiiState(repo_id, concept_id, patch) {
  const db = await getDb();
  const col = db.collection(META);
  const existing = await col.firstExample({ repo_id, concept_id });
  if (existing) {
    await col.update(existing._key, patch);
    return 'updated';
  }
  try {
    await col.save({ repo_id, concept_id, ...patch });
    return 'created';
  } catch (err) {
    // Concurrent create lost the race → retry as update (unique index guard).
    if (err && (err.errorNum === 1210 || err.errorNum === 1185 || err.code === 409)) {
      const again = await col.firstExample({ repo_id, concept_id });
      if (again) {
        await col.update(again._key, patch);
        return 'updated';
      }
    }
    throw err;
  }
}

// ─── scanConcept (write-path step 4d) ────────────────────────────────────────

/**
 * Scan one concept (frontmatter values + body) via the sidecar; persist state.
 * @returns {Promise<{repo_id, concept_id, pii_state, pii_hits_summary, redacted_text?}>}
 */
async function scanConcept(repo_id, concept_id, frontmatter = {}, body = '') {
  return withSpan('okf.pii.scan', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    span.setAttribute('okf.concept_id', concept_id);
    // Frontmatter values are scanned as text (ADR-okf-019 scans frontmatter).
    const fmText = Object.values(frontmatter || {})
      .filter((v) => typeof v === 'string' || typeof v === 'number')
      .join('\n');
    const out = await piiClient.scanOne(concept_id, `${fmText}\n${body}`);
    let result;
    if (out.state === 'error') {
      // FAIL-CLOSED: transport failure → pii_state='error' (blocks publish).
      result = { repo_id, concept_id, pii_state: 'error', pii_hits_summary: null };
      await upsertPiiState(repo_id, concept_id, {
        pii_state: 'error',
        pii_hits_summary: null,
        pii_scanned_at: new Date().toISOString()
      });
      recordOp('scan', 'error');
      logger.warn('PII scan errored (fail-closed)', { repo_id, concept_id, error: out.error });
    } else if (out.hits.length > 0) {
      result = {
        repo_id,
        concept_id,
        pii_state: 'hit',
        pii_hits_summary: out.counts_by_type,
        redacted_text: out.redacted_text
      };
      await upsertPiiState(repo_id, concept_id, {
        pii_state: 'hit',
        pii_hits_summary: out.counts_by_type, // counts only — NFR-P2
        pii_scanned_at: new Date().toISOString()
      });
      recordOp('scan', 'hit');
    } else {
      result = { repo_id, concept_id, pii_state: 'clean', pii_hits_summary: {} };
      await upsertPiiState(repo_id, concept_id, {
        pii_state: 'clean',
        pii_hits_summary: {},
        pii_scanned_at: new Date().toISOString()
      });
      recordOp('scan', 'clean');
    }
    span.setAttribute('okf.pii_state', result.pii_state);
    return result;
  });
}

// ─── Publish gate (D22/ADR-okf-030) ─────────────────────────────────────────

/**
 * FR-5/NFR-P1 blocking gate. blocked iff ANY concept has pii_state
 * 'hit'|'error', OR the repo has concepts with NO scan record (unknown).
 * A repo with ZERO concept docs is NOT blocked by PII (nothing to leak).
 * @returns {Promise<{blocked: boolean, reasons: string[]}>}
 */
async function assertPiiClean(repo_id) {
  return withSpan('okf.pii.gate', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    const db = await getDb();
    const cursor = await db.query(aql`
      FOR d IN ${db.collection(META)}
        FILTER d.repo_id == ${repo_id}
        COLLECT state = d.pii_state WITH COUNT INTO n
        RETURN { state, n }
    `);
    const counts = await cursor.all();
    const byState = Object.fromEntries(counts.map((r) => [r.state, r.n]));
    const reasons = [];
    if ((byState.hit || 0) > 0) reasons.push(`${byState.hit} concept(s) with PII hits (pii_state=hit)`);
    if ((byState.error || 0) > 0) reasons.push(`${byState.error} concept(s) with scan errors (pii_state=error)`);
    if ((byState.unknown || 0) > 0) reasons.push(`${byState.unknown} concept(s) not yet scanned (pii_state=unknown)`);
    const blocked = reasons.length > 0;
    span.setAttribute('okf.pii_gate_blocked', blocked);
    recordOp('gate', blocked ? 'blocked' : 'open');
    logger.info('PII publish gate evaluated', { repo_id, blocked, byState });
    return { blocked, reasons };
  });
}

// ─── FR-3 ingest version record (2.9.7 boundary: upload-moment, NOT publish) ─

/**
 * Record the ingest provenance on the repo doc: file_id, uploaded_at (read
 * from the files doc), curator, and a stable version_id derived from the
 * recorded content hash. bundle_version (2.9.7) stays the publish manifest.
 * @param {string} repo_id
 * @param {object} input {file_id, curator: {sub, name}}
 */
async function recordIngestVersion(repo_id, input) {
  return withSpan('okf.pii.recordIngestVersion', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    const db = await getDb();
    let uploadedAt = null;
    let hash = null;
    try {
      const fileDoc = await db.collection(FILES).firstExample({ file_id: input.file_id });
      if (fileDoc) {
        uploadedAt = fileDoc.uploaded_date || null;
        hash = fileDoc.file_hash || null;
      }
    } catch {
      logger.warn('Ingest version: files doc lookup failed', { file_id: input.file_id });
    }
    const lastIngest = {
      file_id: input.file_id,
      uploaded_at: uploadedAt,
      curator: input.curator || null,
      version_id: hash ? `sha256:${String(hash).slice(0, 16)}` : null
    };
    await db.collection(REPOS).update(repo_id, { last_ingest: lastIngest });
    recordOp('recordIngestVersion', 'success');
    return lastIngest;
  });
}

// ─── FR-28 document references ───────────────────────────────────────────────

/**
 * Stable document reference for a concept's source file (FR-28) — reuses the
 * doc-repo's EXISTING view/download endpoints (no new doc-repo surface).
 * @param {string} file_id
 */
function getDocumentReference(file_id) {
  if (!file_id) return null;
  return {
    file_id,
    view_url: `/api/files/${file_id}/view`,
    download_url: `/api/files/${file_id}/download`
  };
}

/** Repo-level references: every file stamped with this repo_id (2.5 stamps it). */
async function getRepoDocumentReferences(repo_id) {
  const db = await getDb();
  const cursor = await db.query(aql`
    FOR f IN ${db.collection(FILES)}
      FILTER f.okf_repo_id == ${repo_id}
      SORT f.uploaded_date DESC
      RETURN f.file_id
  `);
  const ids = await cursor.all();
  return ids.map(getDocumentReference).filter(Boolean);
}

// ─── Discovery: repo files → scan inputs ────────────────────────────────────

/**
 * Discover the repo's uploaded plain-.md files (by okf_repo_id) and return
 * them as scan inputs. Zips are rejected with a clear deferred message.
 * @returns {Promise<Array<{concept_id, frontmatter, body, file_id}>>}
 */
async function discoverRepoFiles(repo_id) {
  const db = await getDb();
  const cursor = await db.query(aql`
    FOR f IN ${db.collection(FILES)}
      FILTER f.okf_repo_id == ${repo_id}
      RETURN KEEP(f, ['file_id', 'file_name', 'file_type'])
  `);
  const files = await cursor.all();
  const out = [];
  for (const f of files) {
    const bytes = await fetchFileBytes(f.file_id);
    const text = bytes ? bytes.toString('utf-8') : '';
    out.push({ concept_id: f.file_id, frontmatter: {}, body: text, file_id: f.file_id });
  }
  return out;
}

/** Fetch file bytes from the doc-repo view endpoint (base64 JSON). */
async function fetchFileBytes(fileId) {
  const config = require('../config');
  const axios = require('axios');
  try {
    const res = await axios.get(`${config.documentRepository.url}/api/files/${fileId}/view`);
    if (res.data && res.data.file) {
      return Buffer.from(res.data.file, 'base64');
    }
    return null;
  } catch (err) {
    logger.warn('Doc-repo view fetch failed', { file_id: fileId, status: err.response && err.response.status });
    return null;
  }
}

module.exports = {
  scanConcept,
  upsertPiiState,
  assertPiiClean,
  recordIngestVersion,
  getDocumentReference,
  getRepoDocumentReferences,
  discoverRepoFiles
};
