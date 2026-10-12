// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Bundle-zip EXPORT service (Story #978 lifecycle — David, 2026-08-28): a
// PUBLISHED repository must have a tangible bundle artifact in the
// document-repository, VISIBLY linked to its repo + version — the zip's file
// name carries both (`<repo-name>-v<N>.zip`), and the files doc carries
// repo_id + bundle_version + is_bundle (metadataService). Crawler-intake
// bundles reach doc-repo via ingest-service [4g]; editor-built repos had NO
// artifact at all — this service closes that gap at publish time.
//
// Supersede policy: LIVE FOREVER (WS3, David, 2026-09-25). There is exactly
// ONE bundle PER PUBLISH VERSION and none are ever superseded — publishing
// version N appends <repo>-v<N>.zip and leaves every earlier zip in place.
// The superseded-bundle DELETE that this file used to perform is gone
// (supersedeOldBundles removed; see the note at exportBundle and the
// "live-forever contract" suite in __tests__/bundle-export-service.test.js,
// which asserts no DELETE is issued against prior bundle docs).
//
// CONSEQUENCE: a repo at v20 has TWENTY zips in the document repository.
// Anything that reasons about "the repo's bundle" must scope by
// bundle_version, never by "the latest one" or by a bare limit — a bare
// limit=1 against this collection silently picks ONE of twenty.
//
// The remove() cascade deletes a repo's bundles on RETRACT (see
// backing-file-service.retractBackingFiles), so the accumulation is bounded
// by repo lifetime, not unbounded. Backfill of pre-WS3 zips is NOT required:
// the live-forever policy has held since 2026-09-25.
//
// Status note: a bundle's 'Ingested' badge is EARNED, not assumed. Export
// writes 'Pending' unless the repo already carries ingested_at; the settle
// flip (lifecycle-service -> backingFileService.markIngested, at the moment
// ingested_at is set) upgrades it once the drain actually completes. The
// previous unconditional 'Ingested' was wrong: the mint gate proves concepts
// are INDEXED, which is not the same as the repo being DRAINED — Bali-
// wikipedia-LLM sat at lifecycle_state=publish with ingested_at=null while
// all twenty of its zips displayed as ingested. Do not reintroduce the
// shortcut. The crawler intake path keeps its own Pending → Ingesting →
// Ingested progression.

const AdmZip = require('adm-zip');
const matter = require('gray-matter');
const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');
const { authedAxios } = require('./service-token');
const config = require('../config');
const { versionedGraphName } = require('./graph-lifecycle-service');

const META = 'okf_concepts_meta';

class ExportError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Filename-safe slug of the repo name for the bundle file name. */
function slugFor(name) {
  return (
    String(name || 'repo')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'repo'
  );
}

/** The exported zip's file name — THE visible repo+version link (David:
 * "even if it is the name of the file, it can be established by association"). */
function bundleFileName(repo, bundleVersion) {
  return `${slugFor(repo.name)}-v${bundleVersion}.zip`;
}

/** Build the zip in memory: index.md at the root + concepts/<id>.md per
 * concept. Returns { buffer, concept_count }. Throws EXPORT_FAILED when the
 * repo has no concept rows (a published repo with an empty bundle is a bug —
 * the lifecycle publish gate refuses this earlier). */
async function buildBundleZip(repoId) {
  const db = await dbService.getConnection('default');
  const rows = await (
    await db.query(
      `FOR m IN ${META} FILTER m.repo_id == @repo_id SORT m.concept_id ASC ` +
        'RETURN KEEP(m, ["concept_id", "title", "frontmatter", "body", "is_index"])',
      { repo_id: repoId }
    )
  ).all();
  if (!rows.length) {
    throw new ExportError('EXPORT_EMPTY', `repository ${repoId} has no concepts to bundle`, 409);
  }
  const indexRow = rows.find((r) => r.is_index) || rows[0];
  const zip = new AdmZip();
  zip.addFile('index.md', Buffer.from(matter.stringify(indexRow.body || '', indexRow.frontmatter || {}), 'utf8'));
  for (const row of rows) {
    if (row.concept_id === indexRow.concept_id) continue;
    zip.addFile(
      `concepts/${row.concept_id}.md`,
      Buffer.from(matter.stringify(row.body || '', row.frontmatter || {}), 'utf8')
    );
  }
  return { buffer: zip.toBuffer(), concept_count: rows.length };
}

/** WS3 (David, 2026-09-25): supersedeOldBundles was REMOVED — bundles live
 * forever. Prior zips remain alongside new ones for version history.
 * The per-version trace is now the durable record, not the
 * doc-repository's "current" bundle. See exportBundle's supersede-removal
 * comment for the full rationale.
 *
 * (listBundleDocs helper removed in WS3 — superseded by
 * versionService.linkBundleToVersion. If a future UI endpoint needs the
 * raw doc-repo bundle list, see git history for the prior implementation.)
 */

/**
 * Export the repo's CURRENT version as a bundle zip into the doc-repo.
 * Callers invoke this AFTER versionService.mintVersion — repo.version is the
 * version being exported. Idempotent per version: a re-export of the SAME
 * version (e.g. a retried publish) replaces the artifact.
 * @param {object} repo the registry doc (post-mint: version, graph_name, name)
 * @param {object} actor { sub }
 * @returns {Promise<{file_id, file_name, bundle_version, stored_at, concept_count}>}
 */
async function exportBundle(repo, actor) {
  const repoId = repo.repo_id;
  const bundleVersion = repo.version;
  return withSpan('okf.bundle.export', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    span.setAttribute('okf.bundle_version', bundleVersion);

    const { buffer, concept_count } = await buildBundleZip(repoId);
    const bundleBytes = buffer.length;
    const fileName = bundleFileName(repo, bundleVersion);
    // The bundle represents version N — its graph_name metadata records the
    // SERVING graph the bundle's content becomes at ingest (born-right vN).
    const graphName = versionedGraphName(repo) || `OKF_${repoId}`;

    // WS3 (David, 2026-09-25): bundles LIVE FOREVER. We do NOT delete prior
    // version zips — the Versions menu needs them for per-version history,
    // re-import, and audit (ingestion logs are tied to the bundle doc).
    // Each new publish APPENDS a new bundle alongside the old. The
    // worker's bundle cache points at the most-recent zip per repo
    // (the "current" bundle for ingestion logs); we refresh it here.

    let fileId;
    try {
      const res = await authedAxios.post(
        `${config.documentRepository.url}/api/files/ingest-bundle`,
        {
          bundle: buffer.toString('base64'),
          graph_name: graphName,
          repo_id: repoId,
          originalFileName: fileName,
          labels: repo.labels || [],
          bundle_version: bundleVersion,
          is_bundle: true
        },
        { timeout: config.documentRepository.bundleStoreTimeoutMs }
      );
      fileId = res && res.data && res.data.file_id;
    } catch (err) {
      const status = err && err.response && err.response.status;
      logger.error('Bundle export store failed', {
        repo_id: repoId,
        bundle_version: bundleVersion,
        bundle_bytes: bundleBytes,
        status
      });
      throw new ExportError(
        'EXPORT_FAILED',
        `bundle store failed (doc-repo status ${status || 'n/a'}): ${err.message}`,
        502
      );
    }

    // The concepts are indexed (mint gate), but "indexed" is NOT "this repo is
    // drained" — the bundle badge used to say 'Ingested' unconditionally, so
    // a published-but-never-ingested repo showed every version as ingested
    // (David, 2026-10-12: "Right now there is no bali data ingested at all.
    // Having multiple versions of this file displaying in the document
    // repository as ingested should never happen.").
    //
    // So the badge is earned, not assumed: 'Ingested' only when the repo
    // already carries ingested_at; otherwise 'Pending', which the settle flip
    // (lifecycle-service -> backingFileService.markIngested) upgrades the
    // moment the drain actually completes.
    const drained = Boolean(repo.ingested_at);
    const bundleStatus = drained ? 'Ingested' : 'Pending';
    const storedAt = new Date().toISOString();
    if (fileId) {
      try {
        await authedAxios.patch(
          `${config.documentRepository.url}/api/files/${encodeURIComponent(fileId)}/status`,
          { dataprep: { status: bundleStatus } },
          { timeout: 10000 }
        );
        logger.info('Bundle status set at export', {
          repo_id: repoId,
          file_id: fileId,
          bundle_version: bundleVersion,
          status: bundleStatus,
          repo_drained: drained
        });
      } catch {
        logger.warn('Bundle status set failed (non-fatal)', { repo_id: repoId, file_id: fileId });
      }
      // WS3: link this bundle to the version manifest (Versions menu shows
      // it as a download link per row). Best-effort — the bundle itself
      // already exists in doc-repo; a failed link just hides the row's link.
      try {
        const versionService = require('./version-service');
        await versionService.linkBundleToVersion(repoId, bundleVersion, {
          file_id: fileId,
          file_name: fileName,
          stored_at: storedAt
        });
      } catch (linkErr) {
        logger.warn('Bundle → version manifest link failed (non-fatal)', {
          repo_id: repoId,
          bundle_version: bundleVersion,
          file_id: fileId,
          error: linkErr && linkErr.message
        });
      }
    }

    span.setAttribute('okf.bundle.file_id', fileId || 'none');
    span.setAttribute('okf.bundle.bytes', bundleBytes);
    logger.info('OKF bundle zip exported (live-forever, no supersede)', {
      repo_id: repoId,
      bundle_version: bundleVersion,
      bundle_bytes: bundleBytes,
      file_name: fileName,
      file_id: fileId,
      concepts: concept_count,
      actor: (actor && actor.sub) || 'system'
    });
    return {
      file_id: fileId,
      file_name: fileName,
      bundle_version: bundleVersion,
      stored_at: storedAt,
      concept_count
    };
  });
}

module.exports = { exportBundle, buildBundleZip, bundleFileName, slugFor, ExportError };
