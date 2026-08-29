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
//   publish  approve|publish|retracted -> publish   GUARD: >=1 concept + mint gates
//                (PII-complete, all-indexed, conformance-clean, no drains).
//                EFFECTS: version N+1 current; zip <name>-v(N+1).zip stored in
//                doc-repo supersedes the old zip; serving CLEARED (the new
//                version is not serving until INGEST).
//   ingest   publish|retracted(non-serving) -> publish+serving  GUARD: bundle artifact
//                exists. EFFECTS: ingested_at + ingested_version = N.
//   retract  publish+serving -> RETRACTED (own state + lane — a pulled repo
//                must stay visible, never fold back into Published).
//   delete   any state EXCEPT serving (409 INGESTED_DELETE_BLOCKED otherwise);
//            EFFECTS: full cascade (graph + meta + bundle + manifests).
//
// EDITING AFTER PUBLISH: concepts stay editable in every state; changes go
// live only via publish (mints vN+1) then ingest. No auto state-change.

const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');
const { DateTime } = require('luxon');
const auditService = require('./audit-service');
const versionService = require('./version-service');
const bundleExportService = require('./bundle-export-service');

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
    .writeAudit({ actor: (actor && actor.sub) || 'system', action, repo_id: repoId, ...extra })
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

    if (!spec.from.includes(repo.lifecycle_state)) {
      throw new LifecycleError(
        'INVALID_TRANSITION',
        `'${action}' is not allowed from lifecycle state '${repo.lifecycle_state}' (allows: ${spec.from.join(', ')})`,
        409
      );
    }

    if (action === 'submit' || action === 'approve') {
      await db.collection(REPOS).update(repoId, { lifecycle_state: spec.to, updated_at: nowIso() });
      await audit(`repo.${action}`, repoId, actor, { from: repo.lifecycle_state, to: spec.to });
      logger.info('OKF lifecycle transition', { repo_id: repoId, action, to: spec.to });
      return { ok: true, action, lifecycle_state: spec.to };
    }

    if (action === 'publish') {
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
      await versionService.mintVersion(repoId, { trigger: 'publish' }, actor);
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
        bundle_file_name: bundle.file_name
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
      const ts = nowIso();
      await db.collection(REPOS).update(repoId, {
        lifecycle_state: spec.to, // 'publish' (re-ingest from 'retracted')
        ingested_at: ts,
        ingested_version: repo.version || null,
        updated_at: ts
      });
      await audit('repo.ingest', repoId, actor, { ingested_version: repo.version || null });
      logger.info('OKF repository ingested (version serving)', { repo_id: repoId, version: repo.version });
      return { ok: true, action, lifecycle_state: spec.to, ingested_version: repo.version || null };
    }

    // action === 'retract'
    if (!repo.ingested_at) {
      throw new LifecycleError('NOT_INGESTED', 'repository is not ingested — nothing to retract', 409);
    }
    await db.collection(REPOS).update(repoId, {
      lifecycle_state: spec.to, // 'retracted' — a pulled repo must stay VISIBLE
      ingested_at: null,
      ingested_version: null,
      updated_at: nowIso()
    });
    await audit('repo.retract', repoId, actor, { retracted_version: repo.ingested_version || null });
    logger.info('OKF repository retracted (version out of service)', {
      repo_id: repoId,
      version: repo.ingested_version
    });
    return { ok: true, action, lifecycle_state: spec.to, retracted_version: repo.ingested_version || null };
  });
}

module.exports = { transition, TRANSITIONS, ACTIONS, LifecycleError };
