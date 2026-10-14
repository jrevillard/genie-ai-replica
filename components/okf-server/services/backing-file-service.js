// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// Backing-file lifecycle for a repository (David, 2026-10-12).
//
// A repository can own two KINDS of document-repository files docs, and they
// have OPPOSITE lifecycles:
//
//   1. BUNDLE ARTIFACTS (files.is_bundle === true, stamped files.repo_id) —
//      OUR OWN export of the repo (bundle-export-service.exportBundle). Born
//      at dataprep.status='Ingested' BY DESIGN (the mint gate guarantees the
//      concepts are indexed), regenerable from okf_concepts_meta at any time.
//      -> RETRACT: mark Retracted (reversible). DELETE: remove outright.
//
//   2. SOURCE DOCUMENTS (stamped files.okf_repo_id, mirrored on the repo doc's
//      source_documents[]) — the STEWARD'S OWN UPLOADS, which also feed the
//      free-form RAG corpus (the SOURCES_NOT_RETRACTED gate reads their
//      dataprep.status). The repository does not own them.
//      -> RETRACT: mark Retracted ONLY. A retracted repository is the EDIT
//         state and its ONLY exit is submit -> review (lifecycle-service.js:75)
//         — it can come back, and hard-deleting the steward upload on a
//         REVERSIBLE transition would destroy their document.
//      -> DELETE: remove outright (the repo is terminal; the uploads die with
//         it, which is exactly the "simplify life" behaviour asked for).
//
// WHY THIS SERVICE EXISTS (the two defects it closes):
//
//   A. Retract marked EXACTLY ONE bundle. lifecycle-service fetched
//      `?is_bundle=true&limit=1` and patched items[0], so a repo with N bundle
//      zips (one per publish — supersedeOldBundles was removed by the WS3
//      directive, they live forever) left N-1 still badged 'Ingested'. That is
//      literally how Bali-wikipedia-LLM came to show v18/v19/v20 as INGESTED
//      with ingested_at=null: only v17, the zip that existed at retract time,
//      was marked Retracted. The badge lied about a repo serving nothing.
//
//   B. The DELETE cascade's files-doc sweep filters `f.repo_id == repo_id`
//      (graph-retract-service.js:230). Source documents are stamped
//      `okf_repo_id`, NOT `repo_id`, so that sweep MISSES EVERY SOURCE
//      DOCUMENT — deleting a document-built repo orphaned every upload it was
//      built from. This service covers both stamps.
//
// MULTI-REPO SAFETY (a file can legitimately back more than one repo):
//   The one-file-one-repo intent is enforced SOFTLY, and has been observed
//   failing 41/41 (producer-service.js stamp is fail-soft; story 1-8g-q), plus
//   the DUPLICATE_CONTENT guard is content-hash based and explicitly exempts
//   the target repo (producer-service.js:779 `r.repo_id != @rid`). So a file
//   MAY back a second live repo. Deleting without a check would be a data-loss
//   bug. Every delete below therefore re-checks for another LIVE repo that
//   still references the file, and skips when one is found.

const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');
const { authedAxios } = require('./service-token');
const config = require('../config');

const COLLECTION = 'okf_repositories';

const NOT_FOUND = (err) =>
  err &&
  (err.code === 404 ||
    err.errorNum === 1204 ||
    err.statusCode === 404 ||
    (err.response && err.response.status === 404) ||
    /not found|no match/i.test(String(err.message || '')));

/**
 * Every backing file doc a repository owns, in both stamp flavours.
 *
 * Bundles are matched on files.repo_id (what bundle-export-service writes);
 * source documents on files.okf_repo_id (what producer-service.stampSources
 * writes) CROSS-CHECKED against the repo doc's source_documents[] — the two
 * are written by different services and either can be missing, so both are
 * unioned rather than trusting one.
 *
 * @param {string} repoId
 * @returns {Promise<Array<{file_id,file_name,kind,is_bundle,status}>>}
 */
async function listBackingFiles(repoId) {
  const db = await dbService.getConnection('default');
  const out = new Map(); // file_id -> record (a file can match both filters)

  const add = (doc, kind) => {
    if (!doc || !doc.file_id) return;
    const prev = out.get(doc.file_id);
    out.set(doc.file_id, {
      file_id: doc.file_id,
      file_name: doc.file_name || null,
      // A doc matching BOTH filters is a source document that also carries the
      // repo_id stamp (the crawl path stamps repo_id, not is_bundle). Source
      // documents win the kind label — they are the ones with the stricter
      // retract semantics above.
      kind: kind === 'source' || !prev ? kind : prev.kind,
      is_bundle: doc.is_bundle === true,
      status: (doc.dataprep && doc.dataprep.status) || null
    });
  };

  // (a) Bundle artifacts — stamped repo_id by the export service.
  const bundles = await (
    await db.query(
      `FOR f IN files FILTER f.repo_id == @repo_id RETURN {file_id: f.file_id, file_name: f.file_name,
        is_bundle: f.is_bundle, dataprep: f.dataprep}`,
      { repo_id: repoId }
    )
  ).all();
  for (const f of bundles) add(f, 'bundle');

  // (b) Source documents — stamped okf_repo_id by producer-service.
  const sources = await (
    await db.query(
      `FOR f IN files FILTER f.okf_repo_id == @repo_id RETURN {file_id: f.file_id, file_name: f.file_name,
        is_bundle: f.is_bundle, dataprep: f.dataprep}`,
      { repo_id: repoId }
    )
  ).all();
  for (const f of sources) add(f, 'source');

  // (c) The repo doc's own source_documents[] mirror — catches an upload whose
  //     okf_repo_id stamp failed (observed 41/41) but which the repo still
  //     claims as a source. Without this the file would never be found.
  let repo = null;
  try {
    repo = await db.collection(COLLECTION).document(repoId);
  } catch (err) {
    if (!NOT_FOUND(err)) throw err;
  }
  for (const s of (repo && repo.source_documents) || []) {
    if (!s || !s.file_id) continue;
    if (out.has(s.file_id)) {
      // The mirror is authoritative proof this file backs THIS repo — upgrade
      // the kind from 'bundle' to 'source' so it gets the reversible retract.
      out.get(s.file_id).kind = 'source';
      continue;
    }
    const known = await (
      await db.query(
        `FOR f IN files FILTER f.file_id == @fid LIMIT 1 RETURN {file_id: f.file_id,
        file_name: f.file_name, is_bundle: f.is_bundle, dataprep: f.dataprep}`,
        { fid: s.file_id }
      )
    ).all();
    if (known[0]) add(known[0], 'source');
    else
      logger.info('Backing file: source_documents entry has no files doc (upload already gone)', {
        repo_id: repoId,
        file_id: s.file_id
      });
  }

  logger.info('Backing files enumerated', {
    repo_id: repoId,
    total: out.size,
    bundles: [...out.values()].filter((f) => f.kind === 'bundle').length,
    sources: [...out.values()].filter((f) => f.kind === 'source').length
  });
  return [...out.values()];
}

/**
 * Is some OTHER live repository still backed by this file? Guards the hard
 * delete below: a file may back more than one repo (see the header — the
 * one-file-one-repo stamp is fail-soft and the content guard exempts the
 * target repo), so deleting on retract/delete without this check would
 * silently destroy a second repository's source.
 *
 * @param {string} repoId the repo being torn down (excluded from the check)
 * @param {string} fileId
 * @returns {Promise<string|null>} the other repo_id, or null when none
 */
async function otherLiveRepoUsingFile(repoId, fileId) {
  const db = await dbService.getConnection('default');
  try {
    const cursor = await db.query(
      `FOR r IN ${COLLECTION}
         FILTER r.deleted_at == null && r.repo_id != @repo_id
         FILTER (LENGTH(r.source_documents || []) != 0)
         FOR s IN r.source_documents
           FILTER s.file_id == @file_id
         RETURN r.repo_id`,
      { repo_id: repoId, file_id: fileId }
    );
    const rows = await cursor.all();
    return rows.length ? rows[0].repo_id : null;
  } catch (err) {
    // Fail CLOSED: if the check itself errors we cannot prove the file is
    // unshared, and deleting on a failed safety check is the one outcome that
    // loses data irrecoverably. Surface it and keep the file.
    logger.error('Backing file: live-repo reference check FAILED — refusing to delete', {
      repo_id: repoId,
      file_id: fileId,
      error: err.message
    });
    return '__CHECK_FAILED__';
  }
}

/**
 * Mark every backing file Retracted — the REVERSIBLE teardown, used by the
 * lifecycle retract transition.
 *
 * Fixes defect A: the previous code marked only items[0] of a limit=1 fetch,
 * so a repo with several bundle zips left the rest badged 'Ingested'.
 *
 * Best-effort and non-fatal by contract: the retract itself has already
 * succeeded (graph dropped, state flipped) and a doc-repo hiccup must never
 * undo that — same shape as the existing bundle-mark block it replaces.
 *
 * @param {string} repoId
 * @param {{actor?: object, reason?: string}} [opts]
 * @returns {Promise<{repo_id, marked: Array, failed: Array, total: number}>}
 */
async function markRetracted(repoId, opts = {}) {
  return withSpan('okf.backing_files.retract', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    const reason = opts.reason || 'repository retracted';
    let files;
    try {
      files = await listBackingFiles(repoId);
    } catch (err) {
      logger.error('Backing files: enumeration failed on retract (non-fatal)', {
        repo_id: repoId,
        error: err.message
      });
      return { repo_id: repoId, marked: [], failed: [], total: 0 };
    }

    const marked = [];
    const failed = [];
    for (const f of files) {
      // Already retracted — skip rather than re-stamp, so the original
      // retract_date (the audit trail) is preserved.
      if (f.status === 'Retracted' || f.status === 'retracted') {
        logger.debug('Backing file already Retracted — left untouched', {
          repo_id: repoId,
          file_id: f.file_id,
          kind: f.kind
        });
        continue;
      }
      try {
        await authedAxios.patch(
          `${config.documentRepository.url}/api/files/${encodeURIComponent(f.file_id)}/status`,
          { dataprep: { status: 'Retracted', retract_date: new Date().toISOString() } },
          { timeout: 10000 }
        );
        marked.push(f.file_id);
        logger.info('Backing file marked Retracted', {
          repo_id: repoId,
          file_id: f.file_id,
          file_name: f.file_name,
          kind: f.kind,
          previous_status: f.status,
          reason
        });
      } catch (err) {
        failed.push({ file_id: f.file_id, error: err.message });
        logger.warn('Backing file mark-Retracted failed (non-fatal)', {
          repo_id: repoId,
          file_id: f.file_id,
          file_name: f.file_name,
          kind: f.kind,
          error: err.message
        });
      }
    }

    span.setAttribute('okf.backing_files.marked', marked.length);
    span.setAttribute('okf.backing_files.failed', failed.length);
    logger.info('Backing files retract complete', {
      repo_id: repoId,
      total: files.length,
      marked: marked.length,
      failed: failed.length,
      reason
    });
    return { repo_id: repoId, marked, failed, total: files.length };
  });
}

/**
 * HARD-delete every backing file — the IRREVERSIBLE teardown, used by the
 * repository delete cascade.
 *
 * Deletes through document-repository's DELETE /api/files/:fileId rather than
 * a raw Arango REMOVE: only the HTTP route also unlinks the bytes from disk
 * (document-repository fileService.deleteFile → fs.unlink) and purges the
 * crawl/ingestion log rows. The graph-retract sweep's raw REMOVE leaves the
 * upload bytes orphaned in the storage dir with no FK to reclaim them.
 *
 * Skips (never deletes) any file another live repository still backs, and
 * skips the whole set if the safety check itself fails — see otherLiveRepoUsingFile.
 *
 * Best-effort and non-fatal: same contract as every other cascade branch in
 * repository-service.remove() — the registry entry is the thing that must go.
 *
 * @param {string} repoId
 * @param {{actor?: object}} [opts]
 * @returns {Promise<{repo_id, deleted: Array, skipped: Array, failed: Array, total: number}>}
 */
/**
 * Drop `files.okf_repo_id` when — and only when — it names `repoId`.
 *
 * `okf_repo_id` is a single scalar, so a file stamped by two repositories
 * carries whichever wrote last. A guarded match (`FILTER f.okf_repo_id ==
 * @repo_id`) rather than a blind UNSET is what keeps the other repository's
 * claim intact; the surviving repo is still enumerable through its own
 * `source_documents[]` mirror regardless.
 *
 * Best-effort like every other step on the delete path: a stamp that survives
 * is cosmetic (it points at a repo whose doc is tombstoned), whereas failing the
 * delete over it would be a data-loss-adjacent surprise.
 */
async function clearRepoStamp(repoId, fileId) {
  const db = await dbService.getConnection('default');
  try {
    // arangojs cursors are lazy — the query does not execute until consumed,
    // so the .all() is load-bearing, not decoration.
    const updated = await (
      await db.query(
        `FOR f IN files FILTER f.file_id == @file_id && f.okf_repo_id == @repo_id
           UPDATE f WITH { okf_repo_id: null } IN files RETURN LENGTH(f)`,
        { file_id: fileId, repo_id: repoId }
      )
    ).all();
    if (!updated || updated.length === 0) {
      // Either the file is already gone or its stamp names a different repo —
      // both correct outcomes, and both worth distinguishing from a real clear.
      logger.info('Backing file: no okf_repo_id stamp to clear (absent or names another repo)', {
        repo_id: repoId,
        file_id: fileId
      });
      return;
    }
    logger.info('Backing file: cleared okf_repo_id stamp for deleted repository', {
      repo_id: repoId,
      file_id: fileId
    });
  } catch (err) {
    logger.warn('Backing file: clearing okf_repo_id stamp failed (non-fatal)', {
      repo_id: repoId,
      file_id: fileId,
      error: err && err.message
    });
  }
}

async function hardDelete(repoId, opts = {}) {
  return withSpan('okf.backing_files.delete', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    span.setAttribute('okf.actor_sub', (opts.actor && opts.actor.sub) || 'system');
    let files;
    try {
      files = await listBackingFiles(repoId);
    } catch (err) {
      logger.error('Backing files: enumeration failed on delete (non-fatal)', {
        repo_id: repoId,
        error: err.message
      });
      return { repo_id: repoId, deleted: [], skipped: [], failed: [], total: 0 };
    }

    const deleted = [];
    const skipped = [];
    const failed = [];
    for (const f of files) {
      const other = await otherLiveRepoUsingFile(repoId, f.file_id);
      if (other) {
        skipped.push(f.file_id);
        if (other === '__CHECK_FAILED__') {
          logger.error('Backing file SKIPPED — reference check failed, file kept', {
            repo_id: repoId,
            file_id: f.file_id,
            file_name: f.file_name
          });
        } else {
          // Not an error: the file legitimately backs another live repository
          // (one-file-one-repo is enforced fail-soft, so this IS reachable).
          logger.warn('Backing file SKIPPED — another live repository still uses it', {
            repo_id: repoId,
            file_id: f.file_id,
            file_name: f.file_name,
            kept_for_repo: other
          });
        }
        // The file SURVIVES the repo it was stamped for, so the stamp is now a
        // dangling reference to a repo that no longer exists. Left in place it
        // makes the file look "used by" a deleted repository forever, and any
        // later sweep keyed on okf_repo_id has to special-case tombstones.
        //
        // Only clear it when it actually names THIS repo: okf_repo_id is a
        // single scalar, so a file stamped by two repos carries whichever wrote
        // last, and clearing that would drop the surviving repo's claim. The
        // other repo's claim survives regardless via its own
        // `source_documents[]` mirror, which is path (c) of listBackingFiles.
        await clearRepoStamp(repoId, f.file_id);
        continue;
      }
      try {
        await authedAxios.delete(`${config.documentRepository.url}/api/files/${encodeURIComponent(f.file_id)}`, {
          timeout: 10000
        });
        deleted.push(f.file_id);
        logger.info('Backing file deleted from document repository', {
          repo_id: repoId,
          file_id: f.file_id,
          file_name: f.file_name,
          kind: f.kind
        });
      } catch (err) {
        // A file doc already gone from doc-repo is the desired end state, not
        // a failure (double-delete race, or a prior raw REMOVE by the graph
        // sweep) — same idempotency rule repository-service.remove() applies
        // to the registry entry itself.
        if (NOT_FOUND(err)) {
          deleted.push(f.file_id);
          logger.info('Backing file already absent from document repository (idempotent success)', {
            repo_id: repoId,
            file_id: f.file_id
          });
        } else {
          failed.push({ file_id: f.file_id, error: err.message });
          logger.warn('Backing file delete failed (non-fatal)', {
            repo_id: repoId,
            file_id: f.file_id,
            file_name: f.file_name,
            kind: f.kind,
            error: err.message
          });
        }
      }
    }

    span.setAttribute('okf.backing_files.deleted', deleted.length);
    span.setAttribute('okf.backing_files.skipped', skipped.length);
    span.setAttribute('okf.backing_files.failed', failed.length);
    logger.info('Backing files delete complete', {
      repo_id: repoId,
      total: files.length,
      deleted: deleted.length,
      skipped: skipped.length,
      failed: failed.length
    });
    return { repo_id: repoId, deleted, skipped, failed, total: files.length };
  });
}

/**
 * RETRACT: the split rule (David, 2026-10-12).
 *
 *   - BUNDLES (`is_bundle: true`) are HARD DELETED. A zip is regenerated on
 *     every publish: exportBundle mints version N and writes `<repo>-vN.zip`,
 *     so deleting the old artifact costs nothing operationally — the next
 *     publish produces a new one.
 *   - EVERYTHING ELSE (uploads, imports, clones) is only MARKED 'Retracted'.
 *     Never deleted. A steward's own upload is not ours to destroy on a
 *     reversible transition, and the doc is what the repo was built from.
 *
 * This replaces the pre-fix behaviour that fetched `is_bundle=true&limit=1`
 * and patched exactly one doc: with WS3 keeping one zip per version, a repo
 * at v20 had 20 zips and retract left 19 of them badged 'Ingested'.
 *
 * Best-effort and non-fatal, like every other cascade branch: the retract
 * itself has already succeeded and a doc-repo hiccup must not undo that.
 *
 * @param {string} repoId
 * @param {{actor?: object, reason?: string}} [opts]
 */
async function retractBackingFiles(repoId, opts = {}) {
  return withSpan('okf.backing_files.retract_split', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    const reason = opts.reason || 'repository retracted';
    let files;
    try {
      files = await listBackingFiles(repoId);
    } catch (err) {
      logger.error('Backing files: enumeration failed on retract (non-fatal)', {
        repo_id: repoId,
        error: err.message
      });
      return { repo_id: repoId, deleted_bundles: [], marked_sources: [], skipped: [], failed: [], total: 0 };
    }

    const deletedBundles = [];
    const markedSources = [];
    const skipped = [];
    const failed = [];

    for (const f of files) {
      if (f.kind === 'source') {
        // Mark only. Already-retracted files are left alone so the original
        // retract_date stays intact as the audit trail.
        if (f.status === 'Retracted' || f.status === 'retracted') continue;
        try {
          await authedAxios.patch(
            `${config.documentRepository.url}/api/files/${encodeURIComponent(f.file_id)}/status`,
            { dataprep: { status: 'Retracted', retract_date: new Date().toISOString() } },
            { timeout: 10000 }
          );
          markedSources.push(f.file_id);
          logger.info('Source file marked Retracted (never deleted on retract)', {
            repo_id: repoId,
            file_id: f.file_id,
            file_name: f.file_name,
            previous_status: f.status,
            reason
          });
        } catch (err) {
          failed.push({ file_id: f.file_id, kind: 'source', error: err.message });
          logger.warn('Source file mark-Retracted failed (non-fatal)', {
            repo_id: repoId,
            file_id: f.file_id,
            file_name: f.file_name,
            error: err.message
          });
        }
        continue;
      }

      // Bundle — hard delete, but never a bundle another live repo still needs.
      const other = await otherLiveRepoUsingFile(repoId, f.file_id);
      if (other) {
        skipped.push(f.file_id);
        logger.warn('Bundle delete SKIPPED on retract', {
          repo_id: repoId,
          file_id: f.file_id,
          file_name: f.file_name,
          reason:
            other === '__CHECK_FAILED__'
              ? 'reference check failed — failed closed, kept'
              : 'another live repo still uses it',
          kept_for_repo: other === '__CHECK_FAILED__' ? null : other
        });
        continue;
      }
      try {
        await authedAxios.delete(`${config.documentRepository.url}/api/files/${encodeURIComponent(f.file_id)}`, {
          timeout: 10000
        });
        deletedBundles.push(f.file_id);
        logger.info('Bundle deleted on retract (regenerated by the next publish)', {
          repo_id: repoId,
          file_id: f.file_id,
          file_name: f.file_name,
          bundle_version: f.bundle_version
        });
      } catch (err) {
        if (NOT_FOUND(err)) {
          deletedBundles.push(f.file_id);
          logger.info('Bundle already absent from document repository (idempotent success)', {
            repo_id: repoId,
            file_id: f.file_id
          });
        } else {
          failed.push({ file_id: f.file_id, kind: 'bundle', error: err.message });
          logger.warn('Bundle delete failed on retract (non-fatal)', {
            repo_id: repoId,
            file_id: f.file_id,
            file_name: f.file_name,
            error: err.message
          });
        }
      }
    }

    span.setAttribute('okf.backing_files.bundles_deleted', deletedBundles.length);
    span.setAttribute('okf.backing_files.sources_marked', markedSources.length);
    logger.info('Backing files retract complete (bundles deleted, sources marked)', {
      repo_id: repoId,
      total: files.length,
      bundles_deleted: deletedBundles.length,
      sources_marked: markedSources.length,
      skipped: skipped.length,
      failed: failed.length,
      reason
    });
    return {
      repo_id: repoId,
      deleted_bundles: deletedBundles,
      marked_sources: markedSources,
      skipped,
      failed,
      total: files.length
    };
  });
}

/**
 * A bundle earns 'Ingested' only when its repository is ACTUALLY drained.
 *
 * David, 2026-10-12: "Right now there is no bali data ingested at all.
 * Having multiple versions of this file displaying in the document
 * repository as ingested should never happen." Export stamped every zip
 * 'Ingested' unconditionally at publish time, so a published-but-never-
 * drained repo showed every one of its versions as ingested.
 *
 * bundle-export-service now writes 'Pending' unless the repo already carries
 * ingested_at; this is the other half — the settle flip that grants the badge
 * once the drain actually completes. Without it a legitimately drained repo
 * would sit at 'Pending' forever.
 *
 * Only 'Pending' bundles are touched, so a retracted or errored artifact keeps
 * its real state.
 */
async function markIngested(repoId) {
  return withSpan('okf.backing_files.mark_ingested', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    let files;
    try {
      files = await listBackingFiles(repoId);
    } catch (err) {
      logger.error('Backing files: enumeration failed on settle (non-fatal)', {
        repo_id: repoId,
        error: err.message
      });
      return { repo_id: repoId, marked: [], skipped: 0, failed: [] };
    }
    const marked = [];
    const failed = [];
    let skipped = 0;
    for (const f of files) {
      if (f.kind !== 'bundle') continue;
      if (f.status !== 'Pending') {
        skipped += 1;
        continue;
      }
      try {
        await authedAxios.patch(
          `${config.documentRepository.url}/api/files/${encodeURIComponent(f.file_id)}/status`,
          { dataprep: { status: 'Ingested' } },
          { timeout: 10000 }
        );
        marked.push(f.file_id);
        logger.info('Bundle granted Ingested — the repository drain completed', {
          repo_id: repoId,
          file_id: f.file_id,
          file_name: f.file_name,
          bundle_version: f.bundle_version
        });
      } catch (err) {
        failed.push({ file_id: f.file_id, error: err.message });
        logger.warn('Bundle Ingested flip failed (non-fatal)', {
          repo_id: repoId,
          file_id: f.file_id,
          file_name: f.file_name,
          error: err.message
        });
      }
    }
    span.setAttribute('okf.backing_files.ingested_marked', marked.length);
    logger.info('Backing files settle complete', {
      repo_id: repoId,
      marked: marked.length,
      skipped,
      failed: failed.length
    });
    return { repo_id: repoId, marked, skipped, failed };
  });
}

module.exports = {
  listBackingFiles,
  otherLiveRepoUsingFile,
  markRetracted,
  retractBackingFiles,
  markIngested,
  hardDelete
};
