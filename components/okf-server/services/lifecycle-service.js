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
//   submit   draft|register|validate -> review       (steward submits)
//   approve  review -> approve                       (reviewer signs off)
//   publish  approve|publish|retracted -> publish   GUARDS: NOT serving (a
//                serving repo is READ ONLY — retract first, 409
//                REPO_READ_ONLY), >=1 concept + mint gates (PII-complete,
//                all-indexed, conformance-clean, no drains).
//                EFFECTS: version N+1 current; zip <name>-v(N+1).zip stored in
//                doc-repo supersedes the old zip; serving CLEARED (the new
//                version is not serving until INGEST).
//   ingest   publish|retracted(non-serving) -> publish+serving  GUARD: bundle artifact
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
  submit: { from: ['draft', 'register', 'validate'], to: 'review' },
  approve: { from: ['review'], to: 'approve' },
  publish: { from: ['approve', 'publish', 'retracted'], to: 'publish' },
  ingest: { from: ['publish', 'retracted'], to: 'publish' },
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
 * BUILDING GATE (David, 2026-09-02): a repo whose source file is still being
 * converted, or whose concepts are still indexing, is NOT reviewable content
 * yet — the human workflow pins it to "In progress" and refuses every
 * transition until the build completes. Server-authoritative; the dashboard
 * mirrors it (building lane pinning + spinner). Returns the blocking error or
 * null when the repo may transition.
 *   - BUILD_IN_PROGRESS: conversion record present and not terminal
 *     ('done'|'failed' — via isTerminal; missing conversion = not building).
 *   - INDEXING_IN_PROGRESS: parsed (queued/in-flight) concept rows > 0 —
 *     reuses conceptMetaService.countByIndexStatus; 'rejected'/'failed' rows
 *     are terminal states that block at the mint's own gates instead.
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
  const pending = await conceptMetaService.countByIndexStatus(repo.repo_id, 'parsed');
  if (pending > 0) {
    return new LifecycleError(
      'INDEXING_IN_PROGRESS',
      pending +
        ' concept(s) are still indexing. The repository stays In progress until every concept shows Indexed.',
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
      throw new LifecycleError(
        'INVALID_TRANSITION',
        `'${action}' is not allowed from lifecycle state '${repo.lifecycle_state}' (allows: ${spec.from.join(', ')})`,
        409
      );
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
        updated_at: nowIso()
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
      // VERSIONED GRAPH (David, 2026-08-30): physically rename the working
      // graph to `OKF_<name-slug>_v<N>` BEFORE the serving flags flip — a
      // failed rename leaves the repo un-serving and simply retryable.
      const graphName = await graphLifecycle.promoteGraph(repo, actor);
      const ts = nowIso();
      await db.collection(REPOS).update(repoId, {
        lifecycle_state: spec.to, // 'publish' (re-ingest from 'retracted')
        ingested_at: ts,
        ingested_version: repo.version || null,
        ingested_graph_name: graphName,
        updated_at: ts
      });
      await audit('repo.ingest', repoId, actor, {
        ingested_version: repo.version || null,
        graph_name: graphName,
        description: 'Ingested version ' + (repo.version || '?') + ' — graph "' + graphName + '" is now serving'
      });
      logger.info('OKF repository ingested (version serving)', {
        repo_id: repoId,
        version: repo.version,
        graph_name: graphName
      });
      return {
        ok: true,
        action,
        lifecycle_state: spec.to,
        ingested_version: repo.version || null,
        graph_name: graphName
      };
    }

    // action === 'retract'
    if (!repo.ingested_at) {
      throw new LifecycleError('NOT_INGESTED', 'repository is not ingested — nothing to retract', 409);
    }
    // GRAPH DEMOTE (David, 2026-08-30): rename the versioned serving graph
    // back to the working `OKF_{repo_id}` BEFORE the flags clear — the repo
    // becomes editable again. A failed rename keeps the state retryable.
    await graphLifecycle.demoteGraph(repo, actor);
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
        ' — taken out of service; the repository is editable again'
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
  assertWritable,
  TRANSITIONS,
  ACTIONS,
  LifecycleError
};
