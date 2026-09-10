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
const conceptMetaService = require('./concept-meta-service');

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

const { isArangoNotFound } = require('./arango-errors');
const isUniqueViolation = (err) =>
  err && (err.errorNum === 1210 || err.errorNum === 1185 || err.code === 409 || err.statusCode === 409);
const isNotFound = (err) => isArangoNotFound(err); // structural ONLY — never message-regex (outages must not mask as 404)

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
 * Hashes are the STORED canonical content_hash — single source of truth. Carries
 * conformance_issues + pii_state too (Story 4.8-amend) so the publish gate can be
 * enforced on the snapshot AND the manifest records per-concept conformance/PII. */
async function snapshotConcepts(db, repo_id) {
  const cursor = await db.query(
    `FOR m IN ${META} FILTER m.repo_id == @repo_id SORT m.concept_id ASC ` +
      'RETURN KEEP(m, ["concept_id", "title", "content_hash", "index_status", "conformance_issues", "pii_state", "pii_hits_summary"])',
    { repo_id }
  );
  return cursor.all();
}

/** Per-version modification ledger (David, 2026-09-09): the PII remediations
 * accumulated since the previous version — redactions, replacements, removals,
 * acceptances, whole-file redactions — plus all-time totals. Every version
 * manifest therefore carries the auditable "what was modified to produce this
 * version" record. Entries beyond the most recent 100 are summarized
 * (truncated: true); full detail lives in okf_concepts_meta (pii_resolutions)
 * and the audit log. */
const LEDGER_RECENT_CAP = 100;
const LEDGER_TEXT_CAP = 120;
const ledgerTrunc = (v) => (typeof v === 'string' && v.length > LEDGER_TEXT_CAP ? v.slice(0, LEDGER_TEXT_CAP) : v);

async function collectModificationLedger(db, repo_id, sinceIso) {
  const since = sinceIso || '1970-01-01T00:00:00.000Z';
  // NOTE: the since-cutoff is applied client-side (rows.filter) — the bind
  // vars here must declare EXACTLY what the AQL uses (@repo_id), or ArangoDB
  // rejects the query ("bind parameter 'since' was not declared") and every
  // publish 500s (live find, 2026-09-09).
  const rows = await (
    await db.query(
      `FOR m IN ${META} FILTER m.repo_id == @repo_id AND IS_ARRAY(m.pii_resolutions)
         FOR r IN m.pii_resolutions
           SORT r.at ASC
           RETURN { concept_id: m.concept_id, action: r.action, type: r.type,
                    where: r.where, before: r.before, after: r.after, at: r.at, actor: r.actor }`,
      { repo_id }
    )
  ).all();
  const deltas = rows.filter((r) => r.at && r.at > since);
  const byAction = {};
  const byConceptMap = {};
  for (const r of rows) {
    byAction[r.action] = (byAction[r.action] || 0) + 1;
    byConceptMap[r.concept_id] = (byConceptMap[r.concept_id] || 0) + 1;
  }
  return {
    since: sinceIso || null,
    total_delta: deltas.length,
    by_action: byAction,
    by_concept: Object.entries(byConceptMap)
      .map(([concept_id, n]) => ({ concept_id, n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 50),
    total_all_time: rows.length,
    recent: deltas.slice(-LEDGER_RECENT_CAP).map((r) => ({
      concept_id: r.concept_id,
      action: r.action,
      type: r.type,
      where: r.where,
      before: ledgerTrunc(r.before),
      after: ledgerTrunc(r.after),
      at: r.at,
      actor: r.actor
    })),
    truncated: deltas.length > LEDGER_RECENT_CAP
  };
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

    // D1 (review, 2026-08-17) — RE-SCOPED 2026-09-04 (import ≠ RAG, David):
    // parsed concept rows are the NORMAL state pre-ingest (imports do not
    // drain — the pipeline arms only at the Ingest transition), so the old
    // blanket parsed-rows refusal would brick every publish. The only
    // in-flight signal that matters now is an ACTIVE rag drain (armed by
    // ingest): snapshotting a version mid-drain would freeze it on chunks
    // that carry the NEW manifest's hashes (citation integrity).
    if (repo.rag_drain_active === true) {
      recordOp('mint', 'busy');
      throw new VersionError(
        'DRAIN_IN_PROGRESS',
        `repository ${repo_id} has a RAG ingestion in progress — retry after it completes`,
        409
      );
    }
    // Stale-Pending bundle reconcile (legacy single-file repos): a Pending zip
    // with an empty queue is a stale marker — reconcile best-effort and
    // proceed. (Pre-ingest repos have no Pending zips by construction.)
    const drainInFlight = async (aql) => (await (await db.query(aql, { repo_id })).all()).length > 0;
    if (
      await drainInFlight(
        `FOR f IN files FILTER f.repo_id == @repo_id AND f.dataprep.status == 'Pending' LIMIT 1 RETURN 1`
      )
    ) {
      try {
        const { authedAxios } = require('./service-token');
        const config = require('../config');
        const resp = await authedAxios.get(
          `${config.documentRepository.url}/api/files?repo_id=${encodeURIComponent(repo_id)}&is_bundle=true&limit=20`
        );
        const body = (resp && resp.data) || {};
        const items = Array.isArray(body) ? body : body.data || body.items || [];
        for (const f of items.filter((x) => x && x.file_id && x.dataprep && x.dataprep.status === 'Pending')) {
          await authedAxios.patch(
            `${config.documentRepository.url}/api/files/${encodeURIComponent(f.file_id)}/status`,
            { dataprep: { status: 'Ingested' } },
            { timeout: 10000 }
          );
        }
        logger.info('Stale Pending bundle zip(s) reconciled to Ingested at mint', { repo_id, count: items.length });
      } catch (err) {
        logger.warn('Stale Pending bundle reconcile failed (non-fatal)', { repo_id, error: err.message });
      }
    }

    // PUBLISH GATE — repo-level PII scan completeness (Story 4.8-amend, 2026-08-19).
    // The per-concept gate (index_status/conformance/pii) is enforced on the
    // snapshot result inside the loop below (no separate query).
    if (repo.pii_scan_status !== 'complete') {
      recordOp('mint', 'blocked');
      throw new VersionError(
        'PUBLISH_GATE_BLOCKED',
        'repository has not completed a PII scan (pii_scan_status != complete)',
        409
      );
    }

    // Race-guarded, SELF-HEALING mint (P2/P3, review 2026-08-17): compute N+1,
    // INSERT the manifest first (the unique [repo_id, bundle_version] index
    // catches concurrent mints AND a previously committed-but-unbumped manifest
    // — the crashed-mint wedge), then bump the counter. On a unique violation,
    // RECONCILE from the existing manifest (the ledger is the source of truth
    // for the counter) and retry — never brick the repo on a crash.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const nextVersion = (repo.version || 0) + 1;
      const okfTag = `okf:v${nextVersion}`;
      const concepts = await snapshotConcepts(db, repo_id);

      // PER-CONCEPT PUBLISH GATE (Story 4.8-amend, 2026-08-19; re-scoped
      // 2026-09-04 — import ≠ RAG, David): publish certifies CONTENT — every
      // concept conformant and PII-clean. Indexing is NOT a publish concern:
      // nothing is chunked until the Ingest transition (the drain then gates
      // serving completion, not publishing).
      const gateReasons = [];
      const nonConformant = concepts.filter(
        (c) => Array.isArray(c.conformance_issues) && c.conformance_issues.length > 0
      );
      if (nonConformant.length > 0) {
        gateReasons.push(
          `${nonConformant.length} concept(s) with conformance issues: ${nonConformant.map((c) => c.concept_id).join(', ')}`
        );
      }
      // PII gate (split from the generic reasons — David, 2026-08-30): a
      // scanner 'error' hard-blocks; a reviewed 'hit' can be waived by the
      // steward's explicit acknowledgement (public-sector contact data is
      // PII-SHAPED but publishable — the acknowledgement is audited and
      // recorded on the manifest). The other gates (indexed, conformance)
      // remain unconditional.
      const piiErrors = concepts.filter((c) => c.pii_state === 'error');
      if (piiErrors.length > 0) {
        recordOp('mint', 'blocked');
        throw new VersionError(
          'PII_GATE_BLOCKED',
          `${piiErrors.length} concept(s) with PII scan errors (fail-closed): ${piiErrors.map((c) => c.concept_id).join(', ')}`,
          409
        );
      }
      const piiHits = concepts.filter((c) => c.pii_state === 'hit');
      if (piiHits.length > 0 && !opts.acknowledgePii) {
        recordOp('mint', 'blocked');
        // ACTIONABLE GATE (David, 2026-09-09: "the specifics of what to do to
        // remove the flags must be determinable by the user"): each entry names
        // its flagged entity TYPES + counts, and the message states BOTH
        // remedies — edit the concept (the save re-scans and clears the flag
        // automatically) or acknowledge legitimate entities and continue.
        const detail = piiHits
          .map((c) => {
            const s = c.pii_hits_summary && typeof c.pii_hits_summary === 'object' ? c.pii_hits_summary : null;
            const kinds = s
              ? Object.entries(s)
                  .map(([t, n]) => `${t}×${n}`)
                  .join(', ')
              : 'counts unavailable';
            return `${c.concept_id} (${kinds})`;
          })
          .join('; ');
        throw new VersionError(
          'PII_GATE_BLOCKED',
          `${piiHits.length} concept(s) contain flagged entities (review required): ${detail}. ` +
            'To clear a flag: open the concept in the editor and remove or alter the flagged entity — ' +
            'saving re-scans it automatically and the flag clears. ' +
            'If the entities are legitimate for publication (e.g. official contact details), acknowledge and continue.',
          409
        );
      }
      const piiAcknowledged = piiHits.length > 0 && opts.acknowledgePii === true;
      if (gateReasons.length > 0) {
        recordOp('mint', 'blocked');
        throw new VersionError('PUBLISH_GATE_BLOCKED', gateReasons.join('; '), 409);
      }

      // PER-VERSION MODIFICATION LEDGER (David, 2026-09-09): each version
      // records the PII modifications that produced it — read fresh inside
      // the mint loop so a self-heal retry snapshots the current ledger.
      const modifications = await collectModificationLedger(db, repo_id, repo.version_minted_at || null);
      const manifest = {
        _key: `${repo_id}_${nextVersion}`, // deterministic + tamper-evident
        repo_id,
        bundle_version: nextVersion,
        okf_tag: okfTag,
        trigger,
        source_ref: typeof opts.source_ref === 'string' ? opts.source_ref.slice(0, 500) : null,
        curator: opts.curator || (actor && actor.sub) || null,
        pii_acknowledged: piiAcknowledged || undefined,
        pii_modifications: modifications,
        minted_at: nowIso(),
        concept_count: concepts.length,
        concepts
      };
      try {
        await db.collection(VERSIONS).save(manifest);
      } catch (err) {
        if (!isUniqueViolation(err)) {
          recordOp('mint', 'error');
          logger.error('Version manifest insert failed', { repo_id, bundle_version: nextVersion, error: err.message });
          throw err;
        }
        if (attempt === 1) {
          // Two racers + self-heal still collided — the ledger is being
          // written concurrently; surface the designed 409 (never raw).
          recordOp('mint', 'race');
          throw new VersionError('MINT_RACE', 'concurrent mint could not be resolved', 409);
        }
        // SELF-HEAL: the manifest for THIS version already exists — either a
        // concurrent winner (counter ahead) or a crashed mint that committed
        // the manifest but died before the counter bump (counter behind). The
        // existing manifest's bundle_version IS the truth; reconcile the repo
        // counter to max(repo.version, existing) and retry with N+2.
        logger.warn('Version mint reconciled from the ledger', { repo_id, collidedVersion: nextVersion });
        const existing = await db
          .collection(VERSIONS)
          .document(`${repo_id}_${nextVersion}`)
          .catch(() => null);
        const reconciled = Math.max(repo.version || 0, (existing && existing.bundle_version) || 0, nextVersion);
        repo = { ...repo, version: reconciled };
        continue;
      }
      // Bump the repo's counter + record the tag (mint is the sole writer of
      // `version`; repository-service.update() cannot touch it). The bump is
      // the only post-commit step — a failure here leaves the manifest + a
      // stale counter, which the SELF-HEAL path repairs on the next mint.
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
          actor_name: (actor && actor.name) || null,
          action: 'repo.version_mint',
          repo_id,
          version: nextVersion, // review fix P7: attribute the exact manifest
          okf_tag: okfTag,
          source_ip: (actor && actor.source_ip) || null,
          description:
            'Minted version ' +
            nextVersion +
            ' (okf:v' +
            nextVersion +
            ') — immutable manifest snapshot of ' +
            concepts.length +
            ' concept(s)'
        })
        .catch(() => {
          /* best-effort */
        });
      // B+C+E follow-up (2026-08-24): refresh okf_bundle_manifest at mint time.
      // The manifest is otherwise only rewritten at SETTLE (last concept
      // terminal), so version + summary_stats go stale after a post-settle
      // re-index until the next full settle. writeManifest is idempotent
      // (same _key, cached summary preserved unless stale-flagged) and
      // isolated — a manifest refresh failure never bricks the mint itself.
      try {
        await conceptMetaService.writeManifest(repo_id, nextVersion, repo.cloned_from || null);
      } catch (err) {
        logger.warn('Bundle manifest refresh at mint failed (non-fatal)', {
          repo_id,
          bundle_version: nextVersion,
          error: err.message
        });
      }
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
