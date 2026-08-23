// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Internal cross-service controller (Story 4.8-amend): dataprep → okf-server
// completion callbacks for OKF CONCEPTS (content-only chunking — no doc-repo
// files doc exists for a concept, so the old doc-repo status path has nowhere to
// write). This endpoint owns the concept's index_status transition (indexed|failed)
// and the post-index edge write — the exact logic the 2.9.4 worker used to own
// when it drained files docs. Guarded by a shared internal secret (fail-closed:
// no secret configured ⇒ every callback is refused).

const { logger } = require('../shared-lib/logger');
const dbService = require('../shared-lib/db-connection-service');
const conceptMetaService = require('../services/concept-meta-service');
const edgeService = require('../services/edge-service');
const { authedAxios } = require('../services/service-token');
const { getBundleFileId } = require('../workers/ingestWorker');
const config = require('../config');

/**
 * Bundle zip state machine (David's directive: a bundle is NEVER 'Ingested'
 * until its concepts actually are). The bundle is stored 'Pending' (doc-repo);
 * this controller — the single owner of concept terminal transitions — moves
 * it 'Ingesting' when its first concept starts and 'Ingested' (or 'Ingestion
 * Error' when any concept failed) when no concept remains 'parsed'.
 * Best-effort: a doc-repo hiccup never fails the concept callback.
 */
async function transitionBundle(repoId, status) {
  try {
    const bundleFileId = await getBundleFileId(repoId);
    await authedAxios.patch(
      `${config.documentRepository.url}/api/files/${encodeURIComponent(bundleFileId)}/status`,
      { dataprep: { status } },
      { timeout: 10000 }
    );
    logger.info(`Bundle state machine: ${status} (repo ${repoId}, bundle ${bundleFileId})`);
  } catch (err) {
    const st = err && err.response && err.response.status;
    if (st !== 404 && st !== 409) {
      logger.warn(`Bundle state machine -> ${status} failed: [${repoId}] status=${st || 'n/a'} err=${err.message}`);
    }
  }
}

/** After a concept reaches a terminal state, close the bundle out when the
 * repo has no concepts left to ingest. 'rejected' concepts (hard-gate) count
 * as settled-not-failed: the bundle reflects the INGESTION outcome, and the
 * rejection is surfaced via meta + logs, not a bundle error.
 *
 * On settle the bundle's STRUCTURAL artifacts are also persisted (Story B+C:
 * the bundle IS a graph — its structure becomes queryable):
 *   1. The bundle manifest (okf_bundle_manifest): deterministic body (concept
 *      list, author links, root, stats); the LLM summary is generated LAZILY
 *      on the first discovery read (David's directive: summary authored by
 *      the LLM from ingest-time metadata, not hand-written).
 *   2. Author-stated cross-concept links mirrored into the per-repo
 *      _LINKS_TO collection with source='author' (the parser's
 *      markdown-syntax edges live alongside as source='parser' — a tier-3
 *      graph walk reads either transparently).
 * Both idempotent (re-settle refreshes) and mirrored into the bundle's
 * ingestion_log so the UI's Ingestion Log tab reflects the full process. */
async function settleBundleIfComplete(repoId) {
  const remaining = await conceptMetaService.countByIndexStatus(repoId, 'parsed');
  if (remaining > 0) return;
  const failed = await conceptMetaService.countByIndexStatus(repoId, 'failed');
  await transitionBundle(repoId, failed > 0 ? 'Ingestion Error' : 'Ingested');

  const db = await dbService.getConnection('default');

  // Manifest write (deterministic body; lazy LLM summary on first discovery).
  try {
    const repoRows = await (
      await db.query('FOR r IN okf_repositories FILTER r.repo_id == @rid RETURN KEEP(r, ["version", "cloned_from"])', {
        rid: repoId
      })
    ).all();
    const repo = repoRows[0] || {};
    const manifest = await conceptMetaService.writeManifest(
      repoId,
      repo.version != null ? repo.version : null,
      repo.cloned_from || null
    );
    if (manifest) {
      // Mirror into the bundle's ingestion log — keyed on the bundle file so
      // the UI surfaces it (David: the logs must reflect the process).
      try {
        const bundleFileId = await getBundleFileId(repoId);
        await authedAxios.post(
          `${config.documentRepository.url}/api/files/${encodeURIComponent(bundleFileId)}/ingestion-log`,
          {
            level: 'INFO',
            stage: 'Manifest',
            message:
              `[${repoId}] Bundle manifest written: ${manifest.concepts.length} concepts, ` +
              `${manifest.links.length} author links, root=${manifest.root_id || 'none'} ` +
              '(summary generated lazily on first discovery read).'
          },
          { timeout: 10000 }
        );
      } catch (logErr) {
        logger.warn(`Manifest ingestion-log mirror failed (non-fatal): ${logErr.message}`);
      }
    }
  } catch (err) {
    logger.warn(`Bundle manifest write failed (non-fatal): [${repoId}] ${err.message}`);
  }

  // Author-stated cross-concept links → _LINKS_TO (source='author').
  try {
    const er = await edgeService.writeRepoAuthorLinks(repoId);
    try {
      const bundleFileId = await getBundleFileId(repoId);
      await authedAxios.post(
        `${config.documentRepository.url}/api/files/${encodeURIComponent(bundleFileId)}/ingestion-log`,
        {
          level: 'INFO',
          stage: 'AuthorLinks',
          message:
            `[${repoId}] Author-stated cross-concept links written to the graph: ` +
            `${er.written} written, ${er.skipped} skipped (source='author'; parser-derived ` +
            "edges live alongside as source='parser')."
        },
        { timeout: 10000 }
      );
    } catch (logErr) {
      logger.warn(`Author-links ingestion-log mirror failed (non-fatal): ${logErr.message}`);
    }
  } catch (err) {
    logger.warn(`Author-link write failed (non-fatal): [${repoId}] ${err.message}`);
  }
}

/**
 * Dataprep completion callback for a concept (content-only path).
 * Body: { file_id, status: 'Ingested'|'Ingestion Error'|'Killed', chunk_count? }.
 * On success the meta row transitions to 'indexed' (or 'failed' on error) and the
 * concept's within-repo edges are written (the post-index hook). Isolated + never
 * fatal to the dataprep caller (it only cares that a callback was attempted).
 */
async function conceptStatus(req, res) {
  try {
    logger.info('INTERNAL conceptStatus hit', { concept_id: req.params.concept_id, method: req.method });
    // Fail-closed internal auth: the shared secret must be configured AND match.
    if (!config.internal.secret || req.get('x-okf-internal-secret') !== config.internal.secret) {
      return res.status(401).json({ error: 'INTERNAL_UNAUTHORIZED' });
    }
    const { concept_id } = req.params;
    const { file_id, status, chunk_count, repo_id: repoHint } = req.body || {};
    if (!concept_id || typeof status !== 'string') {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'concept_id + status required' });
    }
    // Resolve the repo from the concept's meta row. The caller's repo_id hint
    // (threaded from the ingest graph_name OKF_{repo_id}) gives an EXACT
    // lookup; the repo-wide search fallback is ambiguous when the same
    // concept_id exists in multiple repos (clones, scratch repos) and
    // deliberately returns null rather than guessing.
    let meta = null;
    if (repoHint) {
      meta = await conceptMetaService.getConceptMeta(repoHint, concept_id);
    }
    if (!meta) {
      meta = await conceptMetaService.getConceptMetaFromAnyRepo(concept_id);
    }
    if (!meta) {
      logger.warn('Concept status callback: unknown concept', { concept_id });
      return res.status(404).json({ error: 'CONCEPT_NOT_FOUND' });
    }
    const repo_id = meta.repo_id;
    const st = String(status).toLowerCase();
    // TRANSIENT status: dataprep announces "Ingesting" when it STARTS a
    // concept. Treating it as terminal dead-lettered every concept to
    // 'failed' for the whole processing window (the worker's terminal poll
    // caught the false-failed state, logged ERROR System bundle entries,
    // and reported failed drains — then the real "Ingested" callback
    // arrived and flipped the row back; live-caught 2026-08-21).
    if (st === 'ingesting') {
      logger.info('Concept status callback: transient Ingesting (no transition)', { repo_id, concept_id });
      // First dataprep activity for this bundle → 'Ingesting' (idempotent).
      await transitionBundle(repo_id, 'Ingesting');
      return res.status(200).json({ success: true, transient: true });
    }
    if (st === 'ingested') {
      await conceptMetaService.upsertConceptMeta(
        repo_id,
        { concept_id, repo_id },
        {
          patch: {
            index_status: 'indexed',
            last_good_index_at: new Date().toISOString(),
            chunk_count: chunk_count != null ? chunk_count : null
          }
        }
      );
      // Post-index hook (was the worker's): write the concept's within-repo edges.
      try {
        await edgeService.writeRepoConceptEdges(repo_id, concept_id, {
          file_id: file_id || concept_id,
          bundle_version: meta.bundle_version ?? null
        });
      } catch (err) {
        logger.error('Concept status: edge write failed (isolated)', { repo_id, concept_id, error: err.message });
      }
    } else if (st === 'ingestion error' || st === 'killed') {
      // Ingestion Error | Killed → dead-letter: 'failed' (recovery = re-ingest).
      await conceptMetaService.upsertConceptMeta(
        repo_id,
        { concept_id, repo_id },
        { patch: { index_status: 'failed', last_error: `${status} (chunks=${chunk_count ?? 0})` } }
      );
    }
    // Bundle state machine: close the bundle when its last concept settles.
    await settleBundleIfComplete(repo_id);
    logger.info('Concept status callback applied', { repo_id, concept_id, status, chunk_count });
    return res.status(200).json({ success: true });
  } catch (err) {
    logger.error('Concept status callback failed', { error: err.message });
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}

module.exports = { conceptStatus };
