// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Retracts the per-repository graph (OKF_{repo_id}_*) on repository delete.
// REAL IMPLEMENTATION (2026-08-16, steward directive — the former 2.2 no-op
// stub's contract): a per-repo graph serves EXACTLY ONE repository/bundle, so
// repo-level retraction is simply DROPPING the graph — its named definition
// plus the 4 collections. No surgical chunk deletion at repo granularity.
//
// Safety rails:
//  - the graph name is read from the REGISTRY (okf_repositories.graph_name —
//    an IMMUTABLE field), never caller-supplied;
//  - a footgun guard refuses anything that is not an OKF_ per-repo graph —
//    the free-form default GRAPH can never be dropped through this path;
//  - every step is idempotent (absent collections/graphs are fine).
// Dangling doc-repo files docs pointing at the dropped graph are removed;
// the raw upload bytes in doc-repo's storage dir are orphaned (no FK) — ops
// reclamation, not a transactional concern.

const { aql } = require('arangojs');
const dbService = require('../shared-lib/db-connection-service');
const auditService = require('./audit-service');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');

const GRAPH_SUFFIXES = ['_SOURCE', '_ENTITY', '_HAS_SOURCE', '_LINKS_TO'];
const NOT_FOUND = (err) =>
  err &&
  (err.code === 404 ||
    err.errorNum === 1204 ||
    err.statusCode === 404 ||
    /not found|no match/i.test(String(err.message || '')));

/**
 * Retract the entire per-repo graph: drop the named graph definition, the 4
 * OKF_{repo_id}_* collections, the repo's okf_concepts_meta rows, and its
 * dangling files docs. Called from repository delete (non-fatal there).
 * @param {string} repo_id
 * @param {object} [actor] {sub, source_ip} — audit
 * @returns {Promise<{repo_id, retracted, dropped: string[], meta_removed, files_removed, reason?}>}
 */
async function retractRepoGraph(repo_id, actor) {
  return withSpan('okf.graph.retract', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    span.setAttribute('okf.operation', 'graph_retract');
    const db = await dbService.getConnection('default');

    // Resolve the graph name from the registry — the ONLY trusted source.
    let repo = null;
    try {
      repo = await db.collection('okf_repositories').document(repo_id);
    } catch (err) {
      if (!NOT_FOUND(err)) throw err;
    }
    const graph = repo && repo.graph_name;
    if (!graph || !String(graph).startsWith('OKF_')) {
      // No repo, no graph, or not an OKF per-repo graph (footgun guard: the
      // default free-form GRAPH must never be droppable through this path).
      logger.info('Graph retract skipped (no OKF per-repo graph)', { repo_id });
      span.setAttribute('okf.graph.retracted', false);
      return { repo_id, retracted: false, reason: 'no-okf-graph', dropped: [] };
    }

    const dropped = [];
    // 1. CASCADE DROP: deleting the graph with dropCollections=true removes the
    //    definition AND all its member tables in one server-side call. (Why the
    //    definition must go first either way — ArangoDB hard rule, live-verified
    //    errorNum 1942: "must not drop collection while part of graph"; member
    //    tables cannot be dropped while a definition references them.)
    try {
      await db.route(`_api/gharial/${encodeURIComponent(graph)}?dropCollections=true`).delete();
      dropped.push(`${graph} (graph definition + member collections, cascade)`);
    } catch (err) {
      if (!NOT_FOUND(err)) {
        logger.warn('Graph retract: graph cascade drop failed', { repo_id, graph, error: err.message });
      }
    }
    // 2. Sweep ORPHANED tables (no definition — e.g. a prior partial retract):
    //    droppable now that nothing references them. No-op after a clean cascade.
    for (const suffix of GRAPH_SUFFIXES) {
      const name = `${graph}${suffix}`;
      try {
        await db.collection(name).drop();
        dropped.push(name);
      } catch (err) {
        if (!NOT_FOUND(err)) {
          logger.warn('Graph retract: collection drop failed', { repo_id, name, error: err.message });
        }
      }
    }
    // 3. The repo's concept meta rows died with the graph — remove them.
    let metaRemoved = 0;
    try {
      const removed = await (
        await db.query(aql`
        FOR m IN okf_concepts_meta FILTER m.repo_id == ${repo_id}
          REMOVE m IN okf_concepts_meta RETURN OLD
      `)
      ).all();
      metaRemoved = removed.length;
    } catch (err) {
      logger.warn('Graph retract: meta removal failed', { repo_id, error: err.message });
    }
    // 4. Dangling files docs (they point at the dropped graph) — remove them.
    let filesRemoved = 0;
    try {
      const removed = await (
        await db.query(aql`
        FOR f IN files FILTER f.repo_id == ${repo_id}
          REMOVE f IN files RETURN OLD
      `)
      ).all();
      filesRemoved = removed.length;
    } catch (err) {
      logger.warn('Graph retract: files-doc removal failed', { repo_id, error: err.message });
    }
    // 5. The repo's version manifests (Story 2.9.7): a deleted repository's
    // manifests are repo-scoped data — they go with the teardown (retention of
    // LIVE repos' superseded versions is 4.6's concern, not this path).
    let versionsRemoved = 0;
    try {
      const removed = await (
        await db.query(aql`
        FOR v IN okf_versions FILTER v.repo_id == ${repo_id}
          REMOVE v IN okf_versions RETURN OLD
      `)
      ).all();
      versionsRemoved = removed.length;
    } catch (err) {
      logger.warn('Graph retract: version-manifest removal failed', { repo_id, error: err.message });
    }
    // 6. The repo's bundle manifest (B+C+E, 2026-08-24): the okf_bundle_manifest
    // doc is repo-scoped (_key = repo_id) — it goes with the teardown. Without
    // this purge a deleted repo's manifest lingers in discoverRepos and crowds
    // the k-clamped candidate slice (live-caught 2026-08-25: stale manifests
    // from crashed smoke runs displaced the live repos).
    let manifestRemoved = 0;
    try {
      const removed = await (
        await db.query(aql`
        FOR d IN okf_bundle_manifest FILTER d._key == ${repo_id}
          REMOVE d IN okf_bundle_manifest RETURN OLD
      `)
      ).all();
      manifestRemoved = removed.length;
    } catch (err) {
      logger.warn('Graph retract: bundle-manifest removal failed', { repo_id, error: err.message });
    }

    span.setAttribute('okf.graph.retracted', true);
    span.setAttribute('okf.graph.dropped', dropped.length);
    logger.info('OKF repo graph retracted (dropped)', {
      repo_id,
      graph,
      dropped: dropped.length,
      metaRemoved,
      filesRemoved
    });
    auditService
      .writeAudit({
        actor: (actor && actor.sub) || 'system',
        action: 'repo.graph_retract',
        repo_id,
        source_ip: (actor && actor.source_ip) || null
      })
      .catch(() => {
        /* best-effort */
      });
    return {
      repo_id,
      graph_name: graph,
      retracted: true,
      dropped,
      meta_removed: metaRemoved,
      files_removed: filesRemoved,
      versions_removed: versionsRemoved,
      manifest_removed: manifestRemoved
    };
  });
}

module.exports = { retractRepoGraph };
