// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Graph lifecycle — VERSIONED graph naming on the serving boundary (David,
// 2026-08-30: "Upon ingestion ... the names of the graphs created which are
// related to specific OKF repositories must be named according to the OKF repo
// name and version ... prefixed with OKF").
//
// TWO graph names per repository:
//   WORKING graph   `OKF_{repo_id}`      — the registry's immutable graph_name;
//                                          where ALL editing happens (meta rows,
//                                          worker drains, edges).
//   SERVING graph   `OKF_{name-slug}_v{N}` — physically renamed AT ingest and
//                                          renamed back at retract, so the
//                                          serving graph's NAME carries the
//                                          repo+version it serves.
// The rename is surgical: drop the FROM graph DEFINITION (members survive),
// rename the 4 collections (SOURCE/ENTITY/HAS_SOURCE/LINKS_TO), recreate the
// TO definition with the same edge shapes dataprep registers (Story
// 4.8-amend: ENTITY -(_HAS_SOURCE)-> SOURCE and ENTITY -(_LINKS_TO)-> ENTITY).
//
// Idempotency (a crash mid-rename must heal on retry, never brick the repo):
//   source exists, target missing -> rename
//   source exists, target exists  -> our own leftover (registry
//                                    ingested_graph_name === target for
//                                    promote; the working name is repo-private
//                                    for demote) -> drop target, rename.
//                                    A FOREIGN target throws GRAPH_NAME_CONFLICT
//                                    (two repos must never share a serving
//                                    name — e.g. duplicate repo names).
//   source missing, target exists -> skip (completes a partial rename)
//   both missing                  -> skip
//
// CONSUMERS: only lifecycle-service calls this (ingest -> promoteGraph,
// retract -> demoteGraph) — the single-owner rule of the state machine. The
// editing path keeps using registry.graph_name (unchanged, immutable), and the
// registry's ingested_graph_name is the authoritative serving name (shown in
// the editor, available to any serving-side retrieval fan-out).

const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');
const auditService = require('./audit-service');
const { slugFor } = require('./bundle-export-service');

const GRAPH_SUFFIXES = ['_SOURCE', '_ENTITY', '_HAS_SOURCE', '_LINKS_TO'];

class GraphLifecycleError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** The versioned serving-graph name for a repo doc (`OKF_<slug>_v<N>`). */
function versionedGraphName(repo) {
  return `OKF_${slugFor(repo && repo.name)}_v${(repo && repo.version) || 1}`;
}

function edgeDefinitions(graph) {
  return [
    { collection: `${graph}_HAS_SOURCE`, from: [`${graph}_ENTITY`], to: [`${graph}_SOURCE`] },
    { collection: `${graph}_LINKS_TO`, from: [`${graph}_ENTITY`], to: [`${graph}_ENTITY`] }
  ];
}

async function getDb() {
  return dbService.getConnection('default');
}

async function audit(action, repoId, actor, extra = {}) {
  return auditService
    .writeAudit({ actor: (actor && actor.sub) || 'system', action, repo_id: repoId, ...extra })
    .catch(() => {
      /* best-effort */
    });
}

/**
 * Move the per-repo graph from `fromGraph` to `toGraph`: definition drop ->
 * 4 collection renames -> definition recreate. Idempotent per the table above;
 * `allowDropTarget` clears a leftover TARGET only when it provably belongs to
 * this repo's own lifecycle (our prior partial rename), never another repo's.
 * @returns {Promise<{renamed: string[], skipped: string[], dropped_target: string[]}>}
 */
async function renameGraph(repo, fromGraph, toGraph, { allowDropTarget = false } = {}) {
  const db = await getDb();
  const renamed = [];
  const skipped = [];
  const droppedTarget = [];

  // 1. Drop the FROM definition first (ArangoDB hard rule — members cannot be
  //    manipulated while a definition references them; verified errorNum 1942
  //    in graph-retract-service). dropCollections=false keeps the data.
  try {
    await db.graph(fromGraph).drop({ dropCollections: false });
  } catch (err) {
    if (!isNotFound(err))
      logger.warn('Graph rename: FROM definition drop failed (continuing)', {
        repo_id: repo.repo_id,
        fromGraph,
        error: err.message
      });
  }

  // 2. Rename the 4 member collections.
  for (const suffix of GRAPH_SUFFIXES) {
    const src = db.collection(`${fromGraph}${suffix}`);
    const dst = db.collection(`${toGraph}${suffix}`);
    const srcExists = await src.exists();
    const dstExists = await dst.exists();
    if (srcExists && dstExists) {
      // A leftover target is only OURS when the registry points at it (promote)
      // — or it is the repo-private working name (demote). Otherwise refuse:
      // two repos must never silently share a serving graph name.
      if (!allowDropTarget) {
        throw new GraphLifecycleError(
          'GRAPH_NAME_CONFLICT',
          `graph '${toGraph}${suffix}' already exists and does not belong to this repository's lifecycle — ` +
            'rename one of the colliding repositories and retry',
          409
        );
      }
      await dst.drop();
      droppedTarget.push(`${toGraph}${suffix}`);
    }
    if (srcExists) {
      await src.rename(`${toGraph}${suffix}`);
      renamed.push(`${fromGraph}${suffix} -> ${toGraph}${suffix}`);
    } else if (dstExists) {
      skipped.push(`${toGraph}${suffix}`); // completes a prior partial rename
    }
  }

  // 3. Recreate the TO definition (same edge shapes dataprep registers).
  if (!(await db.graph(toGraph).exists())) {
    // arangojs signature: createGraph(name, edgeDefinitions[], options?).
    await db.createGraph(toGraph, edgeDefinitions(toGraph));
  }

  return { renamed, skipped, dropped_target: droppedTarget };
}

function isNotFound(err) {
  return (
    err &&
    (err.code === 404 ||
      err.errorNum === 1204 ||
      err.statusCode === 404 ||
      /not found|no match/i.test(String(err.message || '')))
  );
}

/**
 * INGEST side: working `OKF_{repo_id}` -> serving `OKF_<slug>_v<N>`.
 * Called by lifecycle-service BEFORE the serving flags flip — a failed rename
 * leaves the repo un-serving and retryable.
 * @param {object} repo the registry doc (name, version, repo_id, ingested_graph_name?)
 * @returns {Promise<string>} the serving graph name
 */
async function promoteGraph(repo, actor) {
  return withSpan('okf.graph.promote', async (span) => {
    const toGraph = versionedGraphName(repo);
    span.setAttribute('okf.repo_id', repo.repo_id);
    span.setAttribute('okf.graph.to', toGraph);
    const fromGraph = (repo && repo.graph_name) || `OKF_${repo.repo_id}`;
    // Our own leftover from a crashed promote is drop-safe; anything else is a
    // foreign graph (e.g. another repo with the same name) — refuse loudly.
    const allowDropTarget = (repo.ingested_graph_name || null) === toGraph;
    const result = await renameGraph(repo, fromGraph, toGraph, { allowDropTarget });
    span.setAttribute('okf.graph.renamed', result.renamed.length);
    logger.info('OKF graph promoted to versioned serving name', {
      repo_id: repo.repo_id,
      from: fromGraph,
      to: toGraph,
      renamed: result.renamed.length,
      skipped: result.skipped.length
    });
    await audit('repo.graph_promote', repo.repo_id, actor, { from: fromGraph, to: toGraph });
    return toGraph;
  });
}

/**
 * RETRACT side: serving `OKF_<slug>_v<N>` -> working `OKF_{repo_id}` — the
 * repo becomes editable again. The working name is repo-private (derived from
 * repo_id), so a leftover working collection is always our own and drop-safe.
 * @returns {Promise<string>} the working graph name
 */
async function demoteGraph(repo, actor) {
  return withSpan('okf.graph.demote', async (span) => {
    const toGraph = (repo && repo.graph_name) || `OKF_${repo.repo_id}`;
    // Fall back to the computed name when the registry field is missing
    // (defensive: the field is always set by ingest since this feature).
    const fromGraph = repo.ingested_graph_name || versionedGraphName(repo);
    span.setAttribute('okf.repo_id', repo.repo_id);
    span.setAttribute('okf.graph.to', toGraph);
    const result = await renameGraph(repo, fromGraph, toGraph, { allowDropTarget: true });
    span.setAttribute('okf.graph.renamed', result.renamed.length);
    logger.info('OKF graph demoted back to working name', {
      repo_id: repo.repo_id,
      from: fromGraph,
      to: toGraph,
      renamed: result.renamed.length,
      skipped: result.skipped.length
    });
    await audit('repo.graph_demote', repo.repo_id, actor, { from: fromGraph, to: toGraph });
    return toGraph;
  });
}

module.exports = { promoteGraph, demoteGraph, versionedGraphName, GraphLifecycleError };
