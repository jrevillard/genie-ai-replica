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
const auditService = require('./audit-service');

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

// Shared strict ArangoDB error classifiers (2026-08-15 review fix — was a
// local copy with a message-regex that masked transient failures as doc-absent).
const { isArangoNotFound } = require('./arango-errors');

/** firstExample that treats a not-found as null (real arangojs throws; the
 * unit mock returns null). Rejects falsy ids — an undefined bind key is
 * JSON-dropped by real arangojs, degrading the lookup to repo-wide. */
async function findPiiDoc(col, repo_id, concept_id) {
  if (!repo_id || !concept_id) {
    throw new Error(
      `findPiiDoc requires repo_id and concept_id (got repo_id=${String(repo_id)}, concept_id=${String(concept_id)})`
    );
  }
  try {
    return await col.firstExample({ repo_id, concept_id });
  } catch (err) {
    if (!isArangoNotFound(err)) throw err; // transient — surface
    return null;
  }
}

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
  const existing = await findPiiDoc(col, repo_id, concept_id);
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
      const again = await findPiiDoc(col, repo_id, concept_id);
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
/** Recursively flatten frontmatter values (strings/numbers/arrays/objects)
 * into scan text, so PII nested inside objects/arrays is NOT silently missed
 * (code-review fix: previously only top-level scalars were scanned). */
function flattenFrontmatter(value, depth = 0, out = []) {
  if (depth > 6) return out; // guard against pathological nesting
  if (value === null || value === undefined) return out;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    out.push(String(value));
  } else if (Array.isArray(value)) {
    value.forEach((v) => flattenFrontmatter(v, depth + 1, out));
  } else if (typeof value === 'object') {
    Object.values(value).forEach((v) => flattenFrontmatter(v, depth + 1, out));
  }
  return out;
}

async function scanConcept(repo_id, concept_id, frontmatter = {}, body = '') {
  return withSpan('okf.pii.scan', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    span.setAttribute('okf.concept_id', concept_id);
    // Frontmatter values (recursively flattened) are scanned as text too —
    // ADR-okf-019 scans frontmatter, not just bodies.
    const fmText = flattenFrontmatter(frontmatter).join('\n');
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

// ─── Steward PII acknowledgement (David, 2026-08-30) ────────────────────────
// The publish PII gate needs a sanctioned release valve for PUBLIC entities
// (government contact details are PII-shaped: phone numbers, emails, names).
// The steward EXPLICITLY acknowledges the flagged entities; the decision is
// stamped on the registry (pii_ack) and audited. A scanner 'error' still
// hard-blocks — only reviewed 'hit's are waivable (version-service enforces).

async function acknowledgePii(repo_id, acknowledge, actor) {
  return withSpan('okf.pii.acknowledge', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    const db = await getDb();
    let repo = null;
    try {
      repo = await db.collection(REPOS).document(repo_id);
    } catch (err) {
      if (!isArangoNotFound(err)) throw err;
    }
    if (!repo || repo.deleted_at) {
      throw Object.assign(new Error('Repository ' + repo_id + ' not found'), { code: 'REPO_NOT_FOUND', status: 404 });
    }
    // Count the currently-flagged concepts so the ack carries what was reviewed.
    const flagged = await (
      await db.query(
        'FOR m IN okf_concepts_meta FILTER m.repo_id == @r AND m.pii_state == "hit" COLLECT WITH COUNT INTO c RETURN c',
        { r: repo_id }
      )
    ).all();
    const ts = new Date().toISOString();
    const patch = acknowledge
      ? { pii_ack: { by: (actor && actor.sub) || 'system', at: ts, flagged_concepts: flagged[0] || 0 } }
      : { pii_ack: null };
    await db.collection(REPOS).update(repo_id, patch);
    await auditService
      .writeAudit({
        actor: (actor && actor.sub) || 'system',
        action: acknowledge ? 'repo.pii_ack' : 'repo.pii_ack_revoke',
        repo_id,
        flagged_concepts: flagged[0] || 0
      })
      .catch(() => {});
    logger.info('PII acknowledgement ' + (acknowledge ? 'recorded' : 'revoked'), {
      repo_id,
      flagged_concepts: flagged[0] || 0,
      actor: (actor && actor.sub) || 'system'
    });
    return { ok: true, acknowledged: !!acknowledge, flagged_concepts: flagged[0] || 0 };
  });
}

// ─── Publish gate (D22/ADR-okf-030) ─────────────────────────────────────────

/**
 * Mark a repo as fully PII-scanned (sets the publish-gate marker). Called by
 * the scan endpoint after a successful scan of the expected concept set.
 */
async function markRepoPiiScanned(repo_id) {
  return withSpan('okf.pii.markScanned', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    const db = await getDb();
    await db.collection(REPOS).update(repo_id, {
      pii_scan_status: 'complete',
      pii_scanned_at: new Date().toISOString()
    });
    recordOp('markScanned', 'success');
    logger.info('Repo marked PII-scanned', { repo_id });
  });
}

/**
 * FR-5/NFR-P1 blocking gate. blocked iff:
 *  - the repo has NO 'complete' PII scan marker (unscanned content — absent
 *    meta docs are invisible to a per-doc query, so the repo-level marker is
 *    the source of truth), OR
 *  - ANY concept has pii_state 'hit' | 'error'.
 * A repo with zero concepts AND a completed scan is NOT blocked (nothing to leak).
 * @returns {Promise<{blocked: boolean, reasons: string[]}>}
 */
async function assertPiiClean(repo_id) {
  return withSpan('okf.pii.gate', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    const db = await getDb();
    const reasons = [];

    // Repo-level scan marker (the unscanned-content guard).
    let scanStatus = 'pending';
    try {
      const repo = await db.collection(REPOS).document(repo_id);
      scanStatus = (repo && repo.pii_scan_status) || 'pending';
    } catch {
      /* repo missing — the caller enforces existence; gate stays conservative */
    }
    if (scanStatus !== 'complete') {
      reasons.push('repository has not completed a PII scan (pii_scan_status != complete)');
    }

    // Per-concept states.
    const cursor = await db.query(aql`
      FOR d IN ${db.collection(META)}
        FILTER d.repo_id == ${repo_id}
        COLLECT state = d.pii_state WITH COUNT INTO n
        RETURN { state, n }
    `);
    const counts = await cursor.all();
    const byState = Object.fromEntries(counts.map((r) => [r.state, r.n]));
    if ((byState.hit || 0) > 0) reasons.push(`${byState.hit} concept(s) with PII hits (pii_state=hit)`);
    if ((byState.error || 0) > 0) reasons.push(`${byState.error} concept(s) with scan errors (pii_state=error)`);

    const blocked = reasons.length > 0;
    span.setAttribute('okf.pii_gate_blocked', blocked);
    recordOp('gate', blocked ? 'blocked' : 'open');
    logger.info('PII publish gate evaluated', { repo_id, blocked, scanStatus, byState });
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
    // Sanitize curator to {sub, name} — never persist source_ip (code-review fix).
    const curator = input.curator ? { sub: input.curator.sub || null, name: input.curator.name || null } : null;
    const lastIngest = {
      file_id: input.file_id,
      uploaded_at: uploadedAt,
      curator,
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
      FILTER f.repo_id == ${repo_id}
      SORT f.uploaded_date DESC
      RETURN f.file_id
  `);
  const ids = await cursor.all();
  return ids.map(getDocumentReference).filter(Boolean);
}

// ─── Discovery: repo files → scan inputs ────────────────────────────────────

/** Plain-text file types that can be scanned directly. Everything else (zip,
 * pdf, docx, ...) is rejected — scanning binary bytes as UTF-8 would produce
 * mojibake and a false "clean" (code-review fix: discovery must not silently
 * scan binaries/zips). */
const SCANNABLE_FILE_TYPES = ['text/markdown', 'text/plain', 'text/html', 'text/x-markdown'];

/**
 * Discover the repo's uploaded plain-text files (by repo_id — the field doc-repo stamps) and return
 * them as scan inputs. Binary/zips are skipped with a clear rejection — a
 * bundle zip is unzipped in Story 2.9.5, not scanned as raw bytes.
 * @returns {Promise<Array<{concept_id, frontmatter, body, file_id, file_type}>>}
 */
async function discoverRepoFiles(repo_id) {
  const db = await getDb();
  const cursor = await db.query(aql`
    FOR f IN ${db.collection(FILES)}
      FILTER f.repo_id == ${repo_id}
      SORT f.uploaded_date DESC
      RETURN KEEP(f, ['file_id', 'file_name', 'file_type'])
  `);
  const files = await cursor.all();
  const out = [];
  for (const f of files) {
    if (!SCANNABLE_FILE_TYPES.includes(f.file_type)) {
      logger.warn('PII discovery skipped non-text file', { file_id: f.file_id, file_type: f.file_type });
      continue; // zip/pdf/docx are not scanned as raw bytes
    }
    const bytes = await fetchFileBytes(f.file_id); // FAIL-CLOSED: throws on failure
    const text = bytes ? bytes.toString('utf-8') : '';
    out.push({ concept_id: f.file_id, frontmatter: {}, body: text, file_id: f.file_id, file_type: f.file_type });
  }
  return out;
}

/** Fetch file bytes from the doc-repo view endpoint. FAIL-CLOSED: a fetch
 * failure THROWS (the caller marks pii_state='error'), so a doc-repo blip can
 * never produce a false "clean". The doc-repo view endpoint returns base64 at
 * res.data.data.base64 (verified fileController.viewFile). */
async function fetchFileBytes(fileId) {
  const config = require('../config');
  const { authedAxios } = require('./service-token');
  let res;
  try {
    res = await authedAxios.get(`${config.documentRepository.url}/api/files/${fileId}/view`, { timeout: 30000 });
  } catch (err) {
    const status = err.response && err.response.status;
    logger.warn('Doc-repo view fetch FAILED (fail-closed)', { file_id: fileId, status });
    const e = new Error(`doc-repo view fetch failed (${status || 'network'})`);
    e.code = 'DOCREPO_FETCH_ERROR';
    throw e;
  }
  const b64 = res.data && res.data.data && res.data.data.base64;
  if (typeof b64 !== 'string' || b64.length === 0) {
    logger.warn('Doc-repo view returned no base64 (fail-closed)', { file_id: fileId });
    const e = new Error('doc-repo view returned no base64');
    e.code = 'DOCREPO_FETCH_ERROR';
    throw e;
  }
  return Buffer.from(b64, 'base64');
}

module.exports = {
  scanConcept,
  upsertPiiState,
  assertPiiClean,
  markRepoPiiScanned,
  recordIngestVersion,
  getDocumentReference,
  getRepoDocumentReferences,
  discoverRepoFiles,
  fetchFileBytes,
  flattenFrontmatter,
  acknowledgePii
};
