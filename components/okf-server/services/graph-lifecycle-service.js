// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Graph lifecycle — BORN-RIGHT versioned graph naming (David, 2026-08-30:
// "graphs ... must be named according to the OKF repo name and version",
// refined 2026-08-31: "when graphs are created, they are created with the
// correct naming convention" — NO rename hack).
//
// ONE graph name per content version, computed by workingGraphName(repo):
//   being edited  -> `OKF_<name-slug>_v{version+1}`  (the draft the next mint
//                     will publish) — dataprep CREATES the graph under this
//                     name on the repo's FIRST concept ingest, so it is born
//                     right. Registry keeps `graph_name = OKF_{repo_id}` only
//                     as an immutable technical anchor (legacy), never used
//                     for new writes.
//   serving       -> `OKF_<name-slug>_v{version}`    (the live version).
// Transitions that change the content's version identity rename surgically
// (drop FROM definition -> rename 4 collections -> rewrite edge _from/_to ->
// recreate TO definition) and re-point okf_concepts_meta.graph_name:
//   ingest  (promote): usually a NO-OP — the draft graph is already v{N};
//           only a retracted-then-re-ingested repo (v{N+1} draft, content
//           still v{N}) or a legacy OKF_{repo_id} graph needs the move.
//   retract (demote):  v{N} -> v{N+1} (opens the next draft).
// The edge-endpoint rewrite exists because a collection rename does NOT touch
// the STORED _from/_to strings inside edge documents — without it every edge
// dangles (live-caught 2026-08-31: single vertex, zero edges in the ArangoDB
// console graph view). It also migrates legacy OKF_{repo_id}-prefixed
// endpoints.
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

// Local copy of bundle-export-service's slugFor — importing it back would
// create a require cycle (bundle-export imports this module's helpers).
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

/**
 * THE graph name for a repo's CURRENT content (David, 2026-08-31: "graphs are
 * created with the correct naming convention" — the working graph is BORN
 * `OKF_<slug>_v<N>`, never OKF_{repo_id}):
 *   serving / published content -> `v{version}`     (the live version)
 *   being edited (draft|register|review|approve|retracted) -> `v{version+1}`
 *   (the version the next publish will mint — monotonic, so deterministic).
 * Every graph-name consumer (dataprep payloads, meta rows, edge writer,
 * surgery) derives the name HERE — no site invents `OKF_${repo_id}` any more.
 */
function workingGraphName(repo) {
  const servingLike = !!(repo && (repo.ingested_at || repo.lifecycle_state === 'publish'));
  const n = servingLike ? (repo && repo.version) || 1 : ((repo && repo.version) || 0) + 1;
  return `OKF_${slugFor(repo && repo.name)}_v${n}`;
}

/**
 * The OPEN DRAFT name — always `v{version+1}` regardless of the repo's current
 * serving flags. demoteGraph must use this (not workingGraphName): at retract
 * time the repo doc still carries the serving state, but the rename TARGET is
 * the next draft. Deterministic because the version counter is monotonic —
 * the next publish mints exactly version+1.
 */
function draftGraphName(repo) {
  return `OKF_${slugFor(repo && repo.name)}_v${((repo && repo.version) || 0) + 1}`;
}

function edgeDefinitions(graph) {
  return [
    { collection: `${graph}_HAS_SOURCE`, from: [`${graph}_ENTITY`], to: [`${graph}_SOURCE`] },
    { collection: `${graph}_LINKS_TO`, from: [`${graph}_ENTITY`], to: [`${graph}_ENTITY`] }
  ];
}

// The per-edge endpoint shapes dataprep registers — the rewrite writes these
// CANONICAL endpoints directly (deriving a suffix from the old collection name
// via AQL SLICE is wrong: SLICE is an ARRAY function, null on strings — the
// live-caught mangled-endpoint bug of 2026-08-31).
const EDGE_SHAPES = {
  _HAS_SOURCE: { from: '_ENTITY', to: '_SOURCE' },
  _LINKS_TO: { from: '_ENTITY', to: '_ENTITY' }
};

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
 * The name the repo's data ACTUALLY lives under — the first candidate whose
 * member collections exist. A transition retry after a mid-rename crash finds
 * the collections at the TARGET name while the registry still names the
 * source; resolving from reality (never from the registry alone) is what
 * makes the retry heal instead of no-op.
 */
async function resolveGraphName(db, candidates) {
  for (const name of candidates) {
    if (!name) continue;
    const col = db.collection(`${name}_SOURCE`);
    if (await col.exists()) return name;
    const ent = db.collection(`${name}_ENTITY`);
    if (await ent.exists()) return name;
  }
  return candidates.find(Boolean); // nothing exists — use the primary candidate
}

/**
 * Move the per-repo graph from `fromGraph` to `toGraph`: definition drop ->
 * 4 collection renames -> endpoint rewrite -> definition recreate. Idempotent
 * per the table above; `allowDropTarget` clears a leftover TARGET only when it
 * provably belongs to this repo's own lifecycle (our prior partial rename),
 * never another repo's. The edge-endpoint rewrite runs EVERY pass (also when
 * from==to): it is the step that carries stored `_from`/`_to` strings across
 * a rename and migrates legacy OKF_{repo_id}-prefixed endpoints.
 * @returns {Promise<{renamed: string[], skipped: string[], dropped_target: string[]}>}
 */
async function renameGraph(repo, fromGraph, toGraph, { allowDropTarget = false } = {}) {
  const db = await getDb();
  const renamed = [];
  const skipped = [];
  const droppedTarget = [];

  // Born-right path: a graph already named for its content version needs NO
  // rename — the COMMON promote, because the working graph is created as
  // `OKF_<slug>_v{N}` while the draft is built. The endpoint rewrite below
  // still runs (it is a no-op once endpoints name the current world).
  if (fromGraph !== toGraph) {
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
  }

  // 2b. REWRITE EDGE ENDPOINTS (live-caught 2026-08-31): a collection rename
  //     does NOT touch the STORED _from/_to strings inside edge documents —
  //     after the rename they name collections that no longer exist, so every
  //     edge dangles (the ArangoDB console graph rendered ONE vertex, zero
  //     edges). The endpoints are written CANONICALLY from the fixed edge
  //     shapes above — never derived from the old name (an AQL SLICE on a
  //     string is null). Matches: legacy OKF_{repo_id}-prefixed endpoints
  //     (pre-convention repos), endpoints naming the from-world after a
  //     rename, and the bare graph name without a collection part (the
  //     mangled output of the SLICE bug this rewrite replaced). Idempotent by
  //     VALUE: already-correct endpoints are rewritten to the same string.
  for (const [edgeSuffix, shape] of Object.entries(EDGE_SHAPES)) {
    try {
      await db.query(
        'FOR e IN @@edge ' +
          'LET f = PARSE_IDENTIFIER(e._from) ' +
          'LET t = PARSE_IDENTIFIER(e._to) ' +
          'FILTER STARTS_WITH(f.collection, @from) || STARTS_WITH(t.collection, @from) ' +
          '  || STARTS_WITH(f.collection, @legacy) || STARTS_WITH(t.collection, @legacy) ' +
          '  || f.collection == @bareTo || t.collection == @bareTo ' +
          'UPDATE e WITH { ' +
          '  _from: CONCAT(@toFrom, "/", f.key), ' +
          '  _to: CONCAT(@toTo, "/", t.key) ' +
          '} IN @@edge',
        {
          '@edge': `${toGraph}${edgeSuffix}`,
          from: fromGraph,
          legacy: `OKF_${repo.repo_id}`, // pre-born-right repos named their graph OKF_{repo_id}
          bareTo: toGraph, // suffix-less (mangled) endpoints
          toFrom: `${toGraph}${shape.from}`,
          toTo: `${toGraph}${shape.to}`
        }
      );
    } catch (err) {
      if (isNotFound(err)) continue; // the edge collection may not exist yet (fresh graph)
      logger.error('Graph rename: edge endpoint rewrite failed', {
        repo_id: repo.repo_id,
        edge: `${toGraph}${edgeSuffix}`,
        error: err.message
      });
      throw err;
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
 * Keep okf_concepts_meta.graph_name aligned after a transition — the worker
 * drains rows by the graph_name stamped on them, so a version transition must
 * re-point every row of the repo. (Enqueue is blocked while serving and no
 * drains cross a publish gate, so this never races an in-flight drain.)
 */
async function refreshMetaGraphNames(repoId, graphName) {
  const db = await getDb();
  await db.query(
    'FOR m IN okf_concepts_meta FILTER m.repo_id == @rid AND m.graph_name != @g ' +
      'UPDATE m WITH { graph_name: @g } IN okf_concepts_meta',
    { rid: repoId, g: graphName }
  );
}

/**
 * INGEST side: the content becomes version N — the serving graph MUST be
 * `OKF_<slug>_v<N>`. With born-right naming the working graph is usually
 * ALREADY `v<N>` (renameGraph no-ops); only a draft opened at retract
 * (`v<N+1>`) or a legacy pre-convention graph needs the transition rename.
 * Called by lifecycle-service BEFORE the serving flags flip — a failed
 * rename leaves the repo un-serving and retryable.
 * @param {object} repo the registry doc (name, version, repo_id, ingested_graph_name?)
 * @returns {Promise<string>} the serving graph name
 */
async function promoteGraph(repo, actor) {
  return withSpan('okf.graph.promote', async (span) => {
    const toGraph = versionedGraphName(repo);
    span.setAttribute('okf.repo_id', repo.repo_id);
    span.setAttribute('okf.graph.to', toGraph);
    // Resolve where the data ACTUALLY lives (a mid-rename crash leaves the
    // collections at the target while the registry still names the source).
    const db = await getDb();
    const fromGraph = await resolveGraphName(db, [
      repo.ingested_graph_name,
      workingGraphName(repo),
      versionedGraphName(repo),
      `OKF_${repo.repo_id}` // the legacy pre-convention anchor
    ]);
    // Our own leftover from a crashed promote is drop-safe; anything else is a
    // foreign graph (e.g. another repo with the same name) — refuse loudly.
    const allowDropTarget = (repo.ingested_graph_name || null) === toGraph;
    const result = await renameGraph(repo, fromGraph, toGraph, { allowDropTarget });
    await refreshMetaGraphNames(repo.repo_id, toGraph);
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
 * RETRACT side: serving `v<N>` -> the OPEN DRAFT `v<N+1>` — the repo becomes
 * editable again and every further write (dataprep drains, edges) lands in a
 * graph BORN named for the version it is building. The draft name is
 * repo-private, so a leftover is always our own and drop-safe.
 * @returns {Promise<string>} the draft graph name
 */
async function demoteGraph(repo, actor) {
  return withSpan('okf.graph.demote', async (span) => {
    const toGraph = draftGraphName(repo); // the open draft v{version+1}
    span.setAttribute('okf.repo_id', repo.repo_id);
    span.setAttribute('okf.graph.to', toGraph);
    // Resolve where the data ACTUALLY lives — a crashed prior demote leaves
    // the collections at this very draft name while the registry still names
    // the served version; the retry must no-op the rename, not fail.
    const db = await getDb();
    const fromGraph = await resolveGraphName(db, [
      repo.ingested_graph_name,
      versionedGraphName(repo),
      toGraph,
      `OKF_${repo.repo_id}` // the legacy pre-convention anchor
    ]);
    const result = await renameGraph(repo, fromGraph, toGraph, { allowDropTarget: true });
    await refreshMetaGraphNames(repo.repo_id, toGraph);
    span.setAttribute('okf.graph.renamed', result.renamed.length);
    logger.info('OKF graph demoted to the open draft version', {
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

module.exports = {
  promoteGraph,
  demoteGraph,
  versionedGraphName,
  workingGraphName,
  GraphLifecycleError
};
