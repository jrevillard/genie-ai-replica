// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Lifecycle transition service (Story 4.3 pulled forward — David, 2026-08-28).
// This service is the SINGLE OWNER of FR-9 transitions. THE STATE MACHINE,
// 100% DEFINED:
//
// STATES (registry lifecycle_state; "serving" = ingested_version != null):
//   draft | register (initial, crawl) | review | approve | publish | retracted
//   RESERVED (kept for FR-9 enum compatibility, NO transitions):
//   validate, version, deprecate, retire. Terminal: deleted.
//
// EVENTS — the only writes to lifecycle_state / the serving flag:
//   CREATE (studio dialog)   -> draft
//   CRAWL-CREATE             -> register
//   submit   draft|register|validate|retracted -> review  (steward submits;
//                'retracted' IS the edit state for out-of-service content —
//                David, 2026-09-04: Retract (edit/validate/correct) -> Edit)
//   approve  review -> approve                       (reviewer signs off)
//   publish  approve|publish -> publish             GUARDS: NOT serving (a
//                serving repo is READ ONLY — retract first, 409
//                REPO_READ_ONLY), >=1 concept + mint CONTENT gates
//                (PII-complete, conformance-clean; NOT indexing — nothing is
//                chunked until ingest).
//                EFFECTS: version N+1 current; zip <name>-v(N+1).zip stored in
//                doc-repo supersedes the old zip; serving CLEARED (the new
//                version is not serving until INGEST).
//   ingest   publish -> publish+serving             GUARD: bundle artifact
//                exists. EFFECTS: ingested_at + ingested_version = N AND the
//                per-repo graph is PROMOTED to the versioned serving name
//                `OKF_<name-slug>_v<N>` (graph-lifecycle-service) — the
//                serving graph's NAME carries the repo+version it serves
//                (David, 2026-08-30); the registry records
//                ingested_graph_name.
//   retract  publish+serving -> RETRACTED (own state + lane — a pulled repo
//                must stay visible, never fold back into Published).
//                EFFECTS: the graph is DEMOTED back to the working name
//                `OKF_{repo_id}` — the repo becomes editable again.
//   delete   any state EXCEPT serving (409 INGESTED_DELETE_BLOCKED otherwise);
//            EFFECTS: full cascade (graph + meta + bundle + manifests).
//
// EDITING (David, 2026-08-30): a SERVING repo (ingested_at set) is READ ONLY
// — concept mutations (ingest/patch/delete/resplit/autocorrect), registry
// updates and publish all refuse with 409 REPO_READ_ONLY. Retract demotes the
// graph and re-opens editing; changes then go live via publish (vN+1) +
// ingest. Concepts stay editable in every non-serving state.

const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');
const { DateTime } = require('luxon');
const auditService = require('./audit-service');
const versionService = require('./version-service');
const bundleExportService = require('./bundle-export-service');
const graphLifecycle = require('./graph-lifecycle-service');
const graphRetract = require('./graph-retract-service');
const conceptMetaService = require('./concept-meta-service');

const REPOS = 'okf_repositories';
const META = 'okf_concepts_meta';

class LifecycleError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const TRANSITIONS = {
  // David, 2026-09-04: Import -> Edit (validate/correct) -> Review (edit/
  // validate/correct) -> Publish -> Ingest -> Retract (edit/validate/correct)
  // -> Edit ... — a RETRACTED repo is the EDIT state for out-of-service
  // content: it stays visible in its own lane, is editable (retract demoted
  // the graph), and re-enters the loop via submit.
  // David, 2026-09-11: a RETRACTED repo's ONLY exit is submit -> review.
  // publish-from-retracted and ingest-from-retracted are INVALID — the
  // pre-2026-09-11 escape hatches let a re-ingest skip review AND reuse the
  // retired version (Kenya live incident: retract -> PII edits -> Ingest
  // re-promoted the SAME v11 graph name, mutating retired content under
  // citations pinned to it). Post-retract changes now always re-enter the
  // loop: submit -> review -> approve -> publish (mints v{N+1}) -> ingest.
  submit: { from: ['draft', 'register', 'validate', 'retracted'], to: 'review' },
  approve: { from: ['review'], to: 'approve' },
  publish: { from: ['approve', 'publish'], to: 'publish' },
  ingest: { from: ['publish'], to: 'publish' },
  retract: { from: ['publish'], to: 'retracted' }
};

// Terminal conversion statuses — SINGLE-SOURCED from the owner service
// (contract agreed with the crawl-conversion session 2026-09-02: terminal is
// 'done' | 'failed'; 'completed'/'interrupted' never occur — a hard-coded
// list here drifted and would have permanently locked successful crawl
// repos). Lazy require: keeps this module load-order independent of the
// conversion service.
function conversionTerminal(conv) {
  return require('./crawl-conversion-service').isTerminal(conv);
}

/**
 * BUILDING GATE (David, 2026-09-02; import/RAG boundary 2026-09-04): a repo
 * whose source file is still being IMPORTED is not reviewable content yet —
 * the workflow pins it to "In progress" and refuses transitions until the
 * import completes. Returns the blocking error or null when the repo may
 * transition.
 *   - BUILD_IN_PROGRESS: conversion record present and not terminal
 *     ('done'|'failed' — via isTerminal; missing conversion = not building).
 *
 * IMPORT ≠ RAG INGESTION (David, 2026-09-04, 6-step workflow): NOTHING is
 * chunked before the Ingest transition. Imported concepts sit as parsed rows
 * with ZERO dataprep activity through import/edit/review/publish; the mint
 * gates CONTENT only (conformance + PII — re-scoped same day). The ingest
 * transition arms the drain; serving starts when it completes.
 */
async function buildingBlocker(repo) {
  const conv = repo.conversion;
  if (conv && !conversionTerminal(conv)) {
    const stage = conv.stage || conv.status || 'processing';
    return new LifecycleError(
      'BUILD_IN_PROGRESS',
      'The source file is still being processed (stage: ' +
        stage +
        ', ' +
        (conv.pages_done || 0) +
        ' pages, ' +
        (conv.batches_done || 0) +
        ' batches done). The repository stays In progress until the full file is processed.',
      409
    );
  }
  return null;
}

const ACTIONS = Object.keys(TRANSITIONS);

function nowIso() {
  return DateTime.now().toUTC().toISO();
}

async function getDb() {
  return dbService.getConnection('default');
}

async function loadRepo(db, repoId) {
  let repo = null;
  try {
    repo = await db.collection(REPOS).document(repoId);
  } catch (err) {
    if (!(err && (err.code === 404 || err.errorNum === 1204 || err.statusCode === 404))) throw err;
  }
  if (!repo || repo.deleted_at) {
    throw new LifecycleError('REPO_NOT_FOUND', `Repository ${repoId} not found`, 404);
  }
  return repo;
}

function audit(action, repoId, actor, extra = {}) {
  return auditService
    .writeAudit({
      actor: (actor && actor.sub) || 'system',
      actor_name: (actor && actor.name) || null,
      action,
      repo_id: repoId,
      ...extra
    })
    .catch(() => {
      /* best-effort */
    });
}

/**
 * SETTLE AN INGEST (import ≠ RAG, David, 2026-09-04): promote the published
 * version's graph to the versioned serving name and flip the serving flags.
 * Called by the ingest transition (nothing left to drain) and by the worker
 * when the armed drain completes. Idempotent per version.
 */
async function _settleIngest(db, repo, actor) {
  // VERSIONED GRAPH (David, 2026-08-30): physically rename the working graph
  // to `OKF_<name-slug>_v<N>` BEFORE the serving flags flip — a failed rename
  // leaves the repo un-serving and simply retryable.
  const graphName = await graphLifecycle.promoteGraph(repo, actor);
  const ts = nowIso();
  await db.collection(REPOS).update(repo.repo_id, {
    lifecycle_state: 'publish', // (re-ingest from 'retracted' returns to publish)
    ingested_at: ts,
    ingested_version: repo.version || null,
    ingested_graph_name: graphName,
    rag_drain_active: false,
    updated_at: ts
  });
  // P0 (David's re-test, 2026-09-08): _settleIngest OWNS the final
  // rag_ingestion record — it is the single authority for "serving now".
  // The worker's refresh normally completes the record, but a settle that
  // bypasses it (the immediate-settle branch, or a drain whose per-concept
  // callbacks died before the refresh — Kenya v5: edge-materialization
  // errors) left status 'draining' forever, and the dashboard's
  // isBuilding() then pinned a SERVING repo to the Import lane as
  // "Building…". Write the terminal record here, always, from live counts.
  try {
    const [doneCount, failedCount, parsedCount] = await Promise.all([
      conceptMetaService.countByIndexStatus(repo.repo_id, 'indexed'),
      conceptMetaService.countByIndexStatus(repo.repo_id, 'failed'),
      conceptMetaService.countByIndexStatus(repo.repo_id, 'parsed')
    ]);
    // failed_concepts written UNCONDITIONALLY (David's card-lies catch,
    // 2026-09-09): the live list on failures, [] on success — a completed
    // record must never carry a previous drain's stale list (ArangoDB's
    // deep-merge on update() would otherwise preserve it).
    const failedRows =
      failedCount > 0
        ? await (
            await db.query(
              "FOR m IN okf_concepts_meta FILTER m.repo_id == @rid AND m.index_status == 'failed' " +
                "RETURN {concept_id: m.concept_id, error: LEFT(m.last_error || '', 300)}",
              { rid: repo.repo_id }
            )
          ).all()
        : [];
    const total = doneCount + failedCount + parsedCount;
    await db.collection(REPOS).update(repo.repo_id, {
      rag_ingestion: {
        status: parsedCount > 0 ? 'failed' : failedCount > 0 ? 'failed' : 'completed',
        requested_at: (repo.rag_ingestion && repo.rag_ingestion.requested_at) || ts,
        finished_at: ts,
        concepts_total: total,
        concepts_done: doneCount,
        error: failedCount > 0 ? failedCount + ' concept(s) failed to index — re-ingest them' : null,
        failed_concepts: failedRows
      }
    });
  } catch (err) {
    logger.warn('Settle: rag_ingestion finalize failed (non-fatal — serving flags are set)', {
      repo_id: repo.repo_id,
      error: err.message
    });
  }
  await audit('repo.ingest', repo.repo_id, actor, {
    ingested_version: repo.version || null,
    graph_name: graphName,
    description: 'Ingested version ' + (repo.version || '?') + ' — graph "' + graphName + '" is now serving'
  });
  logger.info('OKF repository ingested (version serving)', {
    repo_id: repo.repo_id,
    version: repo.version,
    graph_name: graphName
  });
  return {
    ok: true,
    action: 'ingest',
    lifecycle_state: 'publish',
    ingested_version: repo.version || null,
    graph_name: graphName
  };
}

/**
 * Apply ONE lifecycle transition.
 * @param {string} repoId
 * @param {string} action one of ACTIONS
 * @param {object} [actor] { sub, source_ip? }
 * @returns {Promise<{ok:true, action, lifecycle_state, ...transition-specific}>}
 */
async function transition(repoId, action, actor) {
  const spec = TRANSITIONS[action];
  if (!spec) {
    throw new LifecycleError('VALIDATION_ERROR', `action must be one of ${ACTIONS.join('|')}`, 400);
  }
  return withSpan('okf.lifecycle.transition', async (span) => {
    span.setAttribute('okf.repo_id', repoId);
    span.setAttribute('okf.lifecycle.action', action);
    const db = await getDb();
    const repo = await loadRepo(db, repoId);

    // BUILDING GATE — before the transition table so a building repo hears
    // "still building", never "invalid transition". Retract is exempt (a
    // serving repo can never be building: publish already required all-indexed).
    if (action !== 'retract') {
      const blocker = await buildingBlocker(repo);
      if (blocker) {
        span.setAttribute('okf.lifecycle.blocked', blocker.code);
        throw blocker;
      }
    }

    if (!spec.from.includes(repo.lifecycle_state)) {
      const e = new LifecycleError(
        'INVALID_TRANSITION',
        `'${action}' is not allowed from lifecycle state '${repo.lifecycle_state}' (allows: ${spec.from.join(', ')})`,
        409
      );
      // STRUCTURED BODY (David's wizard-idempotency directive, 2026-09-04):
      // the wizard renders only VALID actions — carry the machine in the
      // machine-readable fields, not just the message text. The error
      // handler passes client-error `details` through verbatim.
      e.details = { current_state: repo.lifecycle_state, allowed: spec.from.slice() };
      throw e;
    }

    if (action === 'submit' || action === 'approve') {
      await db.collection(REPOS).update(repoId, { lifecycle_state: spec.to, updated_at: nowIso() });
      await audit(`repo.${action}`, repoId, actor, {
        from: repo.lifecycle_state,
        to: spec.to,
        description: action === 'submit' ? 'Submitted for review' : 'Approved (review sign-off)'
      });
      logger.info('OKF lifecycle transition', { repo_id: repoId, action, to: spec.to });
      return { ok: true, action, lifecycle_state: spec.to };
    }

    if (action === 'publish') {
      // A SERVING repo is READ ONLY (David, 2026-08-30): publishing a new
      // version requires retracting first — content cannot change while the
      // graph serves, so a publish-while-serving would mint an identical
      // version and desync the versioned graph name.
      if (repo.ingested_at) {
        throw new LifecycleError(
          'REPO_READ_ONLY',
          'repository is serving (ingested) — retract it before publishing a new version',
          409
        );
      }
      // An empty repo must not publish — the mint would snapshot zero concepts.
      const conceptCount = (
        await (
          await db.query(`FOR m IN ${META} FILTER m.repo_id == @repo_id COLLECT WITH COUNT INTO c RETURN c`, {
            repo_id: repoId
          })
        ).all()
      )[0];
      if (!conceptCount) {
        throw new LifecycleError('PUBLISH_EMPTY', 'repository has no concepts — add content before publishing', 409);
      }
      // The mint is the REAL publish gate (PII-complete, all-indexed,
      // conformance-clean; 409 PUBLISH_GATE_BLOCKED / DRAIN_IN_PROGRESS pass
      // through untouched). It bumps repo.version to N.
      // A recorded steward acknowledgement (pii_ack) waives the PII 'hit'
      // gate (reviewed public entities); a scanner 'error' still blocks.
      await versionService.mintVersion(repoId, { trigger: 'publish', acknowledgePii: !!repo.pii_ack }, actor);
      // Re-read the registry post-mint (version/okf_tag bumped).
      const fresh = await loadRepo(db, repoId);
      // Export the bundle zip — THE repo+version artifact in the doc-repo.
      // A failure here fails the publish (lifecycle unchanged; retryable).
      const bundle = await bundleExportService.exportBundle(fresh, actor);
      await db.collection(REPOS).update(repoId, {
        lifecycle_state: spec.to,
        bundle: {
          file_id: bundle.file_id || null,
          file_name: bundle.file_name,
          bundle_version: bundle.bundle_version,
          stored_at: bundle.stored_at
        },
        ingested_at: null, // the NEW version is not serving until ingested
        ingested_version: null,
        rag_drain_active: false, // the drain served its purpose — the mint guaranteed all-indexed
        updated_at: nowIso()
      });
      // P0 hot-fix (David's re-test, 2026-09-08): the mint's all-indexed gate
      // read the OLD drain's state — requeue every row so the NEXT ingest
      // actually drains the NEW version's content (fm/label edits included).
      // Without this, a publish→ingest after edits promoted an empty graph
      // (population was always a side effect of INDEXING, never of promote).
      // Fatal on failure: without the requeue the re-drain silently no-ops.
      const requeuedPublish = await conceptMetaService.requeueRepoForRedrain(repoId, {
        graphName: graphLifecycle.versionedGraphName({ name: repo.name, version: bundle.bundle_version })
      });
      logger.info('OKF publish requeued meta rows for re-drain', {
        repo_id: repoId,
        requeued: requeuedPublish,
        graph_name: bundle.bundle_version
          ? graphLifecycle.versionedGraphName({ name: repo.name, version: bundle.bundle_version })
          : undefined
      });
      await audit('repo.publish', repoId, actor, {
        bundle_version: bundle.bundle_version,
        bundle_file_name: bundle.file_name,
        pii_acknowledged: !!repo.pii_ack || undefined,
        description:
          'Published version ' +
          bundle.bundle_version +
          ' — bundle "' +
          bundle.file_name +
          '" stored in the document repository'
      });
      logger.info('OKF repository published', {
        repo_id: repoId,
        bundle_version: bundle.bundle_version,
        bundle_file_name: bundle.file_name
      });
      return {
        ok: true,
        action,
        lifecycle_state: spec.to,
        bundle_version: bundle.bundle_version,
        bundle
      };
    }

    if (action === 'ingest') {
      if (!repo.bundle || !repo.bundle.file_id) {
        throw new LifecycleError('NO_BUNDLE', 'no published bundle artifact — publish the repository first', 409);
      }
      if (repo.ingested_at && repo.ingested_version === repo.version) {
        return { ok: true, action, lifecycle_state: repo.lifecycle_state, already: true }; // idempotent
      }
      // INGEST = THE RAG BOUNDARY (David, 2026-09-04, 6-step workflow): this
      // transition starts the RAG ingestion of the published version —
      // chunking, vectorization, knowledge-graph construction. NOTHING is
      // chunked before this point: import/edit/review/publish are
      // dataprep-free. The version starts serving when the drain completes
      // (the worker settles via _settleIngest; immediate here when there is
      // nothing left to drain).
      const pending = await conceptMetaService.countByIndexStatus(repoId, 'parsed');
      const done = await conceptMetaService.countByIndexStatus(repoId, 'indexed');
      // NAME AUTHORITY (David's v9 wedge, 2026-09-08): the drain must write
      // the name that WILL serve — stale row stamps made dataprep resurrect
      // the dropped v8 graph (ensure-graph re-created it at 08:18:41). Stamp
      // every row to this drain's serving name right before arming.
      const drainGraphName = graphLifecycle.versionedGraphName(repo);
      await conceptMetaService.stampRepoGraphName(repoId, drainGraphName);
      const ts = nowIso();
      await db.collection(REPOS).update(repoId, {
        rag_drain_active: true,
        // COMPLETE FRESH RECORD (David's card-lies catch, 2026-09-09): ArangoDB
        // update() DEEP-MERGES nested objects, so any key this write omits
        // leaks from the previous record — a stale failed_concepts from a
        // prior failed drain survived into a healthy completed card. Every
        // key is written, every time.
        rag_ingestion: {
          status: pending > 0 ? 'draining' : 'completed',
          requested_at: ts,
          finished_at: pending > 0 ? null : ts,
          concepts_total: pending + done,
          concepts_done: done,
          error: null,
          failed_concepts: []
        },
        updated_at: ts
      });
      await audit('repo.rag_drain_armed', repoId, actor, {
        ingested_version: repo.version || null,
        description:
          'Ingest started — RAG ingestion of version ' +
          (repo.version || '?') +
          ' (' +
          pending +
          ' concept(s) to prepare)'
      });
      logger.info('OKF RAG drain armed at ingest', { repo_id: repoId, pending, version: repo.version });
      if (pending === 0) {
        // Everything already drained (re-ingest) — settle immediately.
        const fresh = await loadRepo(db, repoId);
        return _settleIngest(db, fresh, actor);
      }
      // Async: the worker drains, then settles (promotes the serving graph).
      return {
        ok: true,
        action,
        lifecycle_state: repo.lifecycle_state, // stays 'publish' until drained
        ingesting: true,
        rag_ingestion: {
          status: 'draining',
          concepts_total: pending + done,
          concepts_done: done
        }
      };
    }

    // action === 'retract'
    if (!repo.ingested_at) {
      throw new LifecycleError('NOT_INGESTED', 'repository is not ingested — nothing to retract', 409);
    }
    // D-C (#981, David's Stage-1 ruling): retract DROPS the serving graph with
    // ALL underlying collections — a retracted repository stays visible and
    // editable (its meta rows are KEPT; this is deliberately NOT the delete
    // cascade) but nothing serves, and re-ingest rebuilds the graph born-right
    // from the meta rows. The former rename-demote left the graph in place —
    // the Stage-1 defect David caught on Kenya. D-C amendment (David,
    // 2026-09-08: "retract MUST just drop the graph" + "fail and stall
    // silently is NOT acceptable"): a teardown failure now FAILS the retract
    // loudly — the state never flips on a half-drop. The drop is idempotent
    // (404-class = already gone), so a refused retract is safely re-runnable;
    // the flip happens only after the teardown AND the requeue both succeed.
    let dropped;
    try {
      dropped = await graphRetract.dropRepoGraphsForRepo(repoId);
    } catch (err) {
      logger.error('OKF retract graph teardown FAILED — retract refused', {
        repo_id: repoId,
        error: err.message
      });
      throw new LifecycleError(
        'GRAPH_TEARDOWN_FAILED',
        'the serving graph could not be dropped (' +
          err.message +
          ') — nothing was retracted; retry once the database is healthy',
        500
      );
    }
    logger.info('OKF retract graph teardown done', { repo_id: repoId, dropped: dropped.length });
    // P0 hot-fix (David's re-test, 2026-09-08): the meta rows ARE the drain
    // queue — with the graph gone, 'indexed' stamps are meaningless and the
    // re-ingest would promote an EMPTY graph (the exact defect David hit).
    // Requeue every row so retract→ingest rebuilds, and fail the retract (not
    // fail-soft) if the reset fails — a half-retracted repo would strand the
    // empty-graph bug. (The graph drop above is idempotent, so a retry heals.)
    const requeued = await conceptMetaService.requeueRepoForRedrain(repoId, {
      graphName: graphLifecycle.draftGraphName(repo)
    });
    logger.info('OKF retract requeued meta rows for re-drain', { repo_id: repoId, requeued });
    await db.collection(REPOS).update(repoId, {
      lifecycle_state: spec.to, // 'retracted' — a pulled repo must stay VISIBLE
      ingested_at: null,
      ingested_version: null,
      ingested_graph_name: null,
      updated_at: nowIso()
    });
    await audit('repo.retract', repoId, actor, {
      retracted_version: repo.ingested_version || null,
      graph_name: repo.ingested_graph_name || null,
      description:
        'Retracted version ' +
        (repo.ingested_version || '?') +
        ' — taken out of service, serving graph dropped; the repository is editable again'
    });
    logger.info('OKF repository retracted (version out of service)', {
      repo_id: repoId,
      version: repo.ingested_version,
      graph_name: repo.ingested_graph_name || null
    });
    return { ok: true, action, lifecycle_state: spec.to, retracted_version: repo.ingested_version || null };
  });
}

/**
 * READ-ONLY guard (David, 2026-08-30): a SERVING repo (ingested_at set) must
 * refuse every content mutation. Call after the getById pre-gate in every
 * mutating handler (concepts, repo update, publish). 409 REPO_READ_ONLY.
 * @param {object} repo the registry doc
 */
function assertWritable(repo) {
  if (repo && repo.ingested_at) {
    throw new LifecycleError(
      'REPO_READ_ONLY',
      'repository is serving (ingested) and is READ ONLY — retract it to make changes',
      409
    );
  }
}

module.exports = {
  transition,
  _settleIngest,
  assertWritable,
  TRANSITIONS,
  ACTIONS,
  LifecycleError
};
