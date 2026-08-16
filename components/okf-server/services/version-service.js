// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Version mint service (Story 2.9.7, gap G26 — ADR-okf-031 + design addendum
// D-V1/D-V4). Versioning is REPO-LEVEL: each mint increments the repository's
// monotonic integer `version` and snapshots an IMMUTABLE manifest into
// `okf_versions` (INSERT-only — the D-V3 integrity ledger). Minting is a
// publish/crawl side-effect, never a lifecycle state (ADR-030); callers:
// the steward API (manual), 4.3 publish (trigger 'publish'), Epic 7 producer
// on re-crawl (trigger 'crawl' — D-V4: a re-crawl mints N+1 of the SAME
// repository, never a new registry entry).
//
// Exclusivity: mint is the ONLY writer of `version` on okf_repositories (the
// field is deliberately absent from repository-service UPDATABLE_FIELDS) and
// never touches concept index_status (the 2.9.4 worker owns indexed|failed).
// Manifest concept hashes are READ from okf_concepts_meta.content_hash — the
// canonical (trimmed-body) sha256 written by the 2.9.2 writer; never recomputed.

const { DateTime } = require('luxon');
const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');
const { getMeter } = require('../shared-lib/metrics');
const auditService = require('./audit-service');

const VERSIONS = 'okf_versions';
const REPOS = 'okf_repositories';
const META = 'okf_concepts_meta';
const TRIGGERS = ['manual', 'publish', 'crawl'];

const meter = getMeter();
const opsCounter = meter.createCounter('okf_version_operations_total', {
  description: 'OKF version mint operations'
});
function recordOp(operation, status) {
  try {
    opsCounter.add(1, { operation, status });
  } catch {
    /* meter no-op when observability off */
  }
}

class VersionError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const isUniqueViolation = (err) =>
  err && (err.errorNum === 1210 || err.errorNum === 1185 || err.code === 409 || err.statusCode === 409);
const isNotFound = (err) =>
  err &&
  (err.code === 404 ||
    err.errorNum === 1204 ||
    err.statusCode === 404 ||
    /not found|no match/i.test(String(err.message || '')));

let _db = null;
async function getDb() {
  if (_db) return _db;
  _db = await dbService.getConnection('default');
  return _db;
}

function nowIso() {
  return DateTime.now().toUTC().toISO();
}

/** Manifest snapshot of the repo's concept set, read from okf_concepts_meta.
 * Hashes are the STORED canonical content_hash — single source of truth. */
async function snapshotConcepts(db, repo_id) {
  const cursor = await db.query(
    `FOR m IN ${META} FILTER m.repo_id == @repo_id SORT m.concept_id ASC ` +
      'RETURN KEEP(m, ["concept_id", "title", "content_hash", "index_status"])',
    { repo_id }
  );
  return cursor.all();
}

/**
 * Mint the repository's NEXT version (N → N+1; first mint null → 1).
 * @param {string} repo_id
 * @param {object} [opts] { trigger: 'manual'|'publish'|'crawl', source_ref?, curator? }
 * @param {object} [actor] { sub, source_ip? } — audit
 * @returns {Promise<{repo_id, bundle_version, okf_tag, concept_count, manifest_key, minted_at}>}
 * @throws VersionError REPO_NOT_FOUND (404) | VALIDATION_ERROR (400)
 */
async function mintVersion(repo_id, opts = {}, actor) {
  const trigger = opts.trigger || 'manual';
  if (!TRIGGERS.includes(trigger)) {
    throw new VersionError('VALIDATION_ERROR', `trigger must be one of ${TRIGGERS.join('|')}`, 400);
  }
  return withSpan('okf.versions.mint', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    span.setAttribute('okf.versions.trigger', trigger);
    const db = await getDb();

    // Resolve the repo — unknown or soft-deleted refuses the mint.
    let repo = null;
    try {
      repo = await db.collection(REPOS).document(repo_id);
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
    if (!repo || repo.deleted_at) {
      recordOp('mint', 'not_found');
      throw new VersionError('REPO_NOT_FOUND', `Repository ${repo_id} not found`, 404);
    }

    // Race-guarded mint: compute N+1, INSERT the manifest first (the unique
    // [repo_id, bundle_version] index catches concurrent mints), then bump the
    // repo counter. On a unique violation, re-read and retry ONCE.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const nextVersion = (repo.version || 0) + 1;
      const okfTag = `okf:v${nextVersion}`;
      const concepts = await snapshotConcepts(db, repo_id);
      const manifest = {
        _key: `${repo_id}_${nextVersion}`, // deterministic + tamper-evident
        repo_id,
        bundle_version: nextVersion,
        okf_tag: okfTag,
        trigger,
        source_ref: typeof opts.source_ref === 'string' ? opts.source_ref.slice(0, 500) : null,
        curator: opts.curator || (actor && actor.sub) || null,
        minted_at: nowIso(),
        concept_count: concepts.length,
        concepts
      };
      try {
        await db.collection(VERSIONS).save(manifest);
      } catch (err) {
        if (isUniqueViolation(err) && attempt === 0) {
          logger.warn('Version mint raced — re-reading counter and retrying once', { repo_id });
          repo = await db.collection(REPOS).document(repo_id);
          continue;
        }
        recordOp('mint', 'error');
        logger.error('Version manifest insert failed', { repo_id, bundle_version: nextVersion, error: err.message });
        throw err;
      }
      // Bump the repo's counter + record the tag (mint is the sole writer of
      // `version`; repository-service.update() cannot touch it).
      await db.collection(REPOS).update(repo_id, {
        version: nextVersion,
        okf_tag: okfTag,
        version_minted_at: manifest.minted_at,
        updated_at: manifest.minted_at
      });
      span.setAttribute('okf.versions.bundle_version', nextVersion);
      span.setAttribute('okf.versions.concept_count', concepts.length);
      recordOp('mint', 'success');
      logger.info('OKF version minted', {
        repo_id,
        bundle_version: nextVersion,
        okf_tag: okfTag,
        trigger,
        concepts: concepts.length
      });
      auditService
        .writeAudit({
          actor: (actor && actor.sub) || 'system',
          action: 'repo.version_mint',
          repo_id,
          source_ip: (actor && actor.source_ip) || null
        })
        .catch(() => {
          /* best-effort */
        });
      return {
        repo_id,
        bundle_version: nextVersion,
        okf_tag: okfTag,
        concept_count: concepts.length,
        manifest_key: manifest._key,
        minted_at: manifest.minted_at
      };
    }
    throw new VersionError('MINT_RACE', 'concurrent mint could not be resolved', 409);
  });
}

/** List a repo's manifests, newest first (Story 4.5's diff/list backing). */
async function listVersions(repo_id) {
  const db = await getDb();
  const cursor = await db.query(
    `FOR v IN ${VERSIONS} FILTER v.repo_id == @repo_id SORT v.bundle_version DESC ` +
      'RETURN KEEP(v, ["bundle_version", "okf_tag", "trigger", "source_ref", "curator", "minted_at", "concept_count"])',
    { repo_id }
  );
  return cursor.all();
}

/** One manifest (full, including the concept list). */
async function getVersion(repo_id, bundle_version) {
  const db = await getDb();
  try {
    return await db.collection(VERSIONS).document(`${repo_id}_${bundle_version}`);
  } catch (err) {
    if (!isNotFound(err)) throw err;
    throw new VersionError('VERSION_NOT_FOUND', `Version ${bundle_version} not found for ${repo_id}`, 404);
  }
}

module.exports = { mintVersion, listVersions, getVersion, VersionError, TRIGGERS };
