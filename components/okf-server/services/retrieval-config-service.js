// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 1.7 (ADR-okf-039 D1-D3, FR-44) — retrieval mode governance.
//
// The okf_system_config collection holds runtime-live retrieval posture as
// small keyed docs (_key='retrieval' today). Boot defaults come from env
// (config.retrieval); a stored doc overrides FIELD-BY-FIELD, so a partial doc
// is legal and the doc never has to exist (mode 'legacy' is the safe default
// and needs no row). EVERY value — env or stored — passes the read-path
// sanitizer (validators/retrieval-config-validator.js), so a garbled env var
// or a hand-edited doc degrades to the safe default instead of reaching the
// read-model (code-review fix 2026-09-20: the old `mode !== 'legacy'`
// engagement check would have engaged the fan-out on ANY invalid mode).
//
// The engagement gate (ADR-039 D2): the fan-out path may run only when mode is
// explicitly 'okf_only'/'hybrid' AND at least one OKF graph is serving. The
// hybrid+zero-serving asymmetry vs okf_only is DELIBERATE: for okf_only, zero
// serving graphs is a misconfiguration signal (the operator asked for OKF-only
// grounding and gets none — warn); for hybrid, zero serving graphs is normal
// operation (the free-form corpus carries the query — no warning).
//
// Serving truth is the same predicate everywhere else in the product:
// lifecycle_state==='publish' AND ingested_at set AND not soft-deleted (the
// Ingested-lane truth — the frontend laneFor uses the same). Graph names are
// resolved through the SINGLE authority workingGraphName(repo) — versioned
// serving names OKF_<slug>_v<N> — never from a static per-repo constant and
// never from the manifest's stamped version (which can skew during a
// re-publish drain window; see okf-fanout-course-correction-2026-09-20.md
// §1.3 Trap 2). NOTE: workingGraphName reads repo.ingested_at /
// repo.lifecycle_state — the serving query's projection MUST carry both
// fields (code-review fix 2026-09-20: the KEEP once stripped them and
// production resolved every repo to the not-yet-built v{N+1} draft name).
//
// Every PUT is validated (joi — validators/retrieval-config-validator.js),
// written under optimistic concurrency (_rev precondition, retry-once on
// conflict), revision-bumped, and audited before→after to okf_audit_logs
// (ADR-029 spine) with repo_id='_system' (config is repo-independent).

const { DateTime } = require('luxon');
const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');
const { isArangoNotFound, isArangoConflict } = require('./arango-errors');
const { deriveScopeAuthz } = require('./scope-authz-service');
const config = require('../config');
const { workingGraphName } = require('./graph-lifecycle-service');
const auditService = require('./audit-service');
const {
  MODES,
  LIMITS,
  sanitizeConfigShape,
  validateRetrievalConfigPatch
} = require('../validators/retrieval-config-validator');

const COLLECTION = 'okf_system_config';
const DOC_KEY = 'retrieval';
const AUDIT_REPO = '_system';

// Shared DB connection — cache the RESOLVED proxy (not the promise). Same
// pattern as audit-service/collections.js; the SHARED db-connection-service
// owns reconnection (this module adds no retry of its own).
let _db = null;
async function getDb() {
  if (_db) return _db;
  _db = await dbService.getConnection('default');
  return _db;
}

/** Env boot defaults → raw wire-shape (then sanitized like every other source). */
function envDefaultsRaw() {
  return {
    mode: config.retrieval.mode,
    max_fanout_graphs: config.retrieval.maxFanoutGraphs,
    spine_max_hops: config.retrieval.spineMaxHops,
    extracted_hop_cap: config.retrieval.extractedHopCap,
    candidate_cap_per_graph: config.retrieval.candidateCapPerGraph,
    candidate_cap_global: config.retrieval.candidateCapGlobal
  };
}

/**
 * The effective config for a stored row (or none): env defaults sanitized,
 * overlaid field-by-field with the SANITIZED stored values. Source is reported
 * so operators can tell "row deleted, running on env" from "governed row".
 * @param {object|null} stored — the raw stored doc (null = no governed row)
 * @returns {{config: object, source: 'database'|'env-defaults', stored: object|null}}
 */
function mergeEffective(stored) {
  const env = sanitizeConfigShape(envDefaultsRaw());
  if (!stored) {
    return { config: { ...env, revision: 0, updated_at: null, updated_by: null }, source: 'env-defaults', stored: null };
  }
  const raw = {};
  for (const key of Object.keys(env)) raw[key] = stored[key];
  return {
    config: {
      ...env,
      ...sanitizeConfigShape(raw), // sanitized stored values win per-field
      revision: typeof stored.revision === 'number' ? stored.revision : 0,
      updated_at: stored.updated_at || null,
      updated_by: stored.updated_by || null
    },
    source: 'database',
    stored
  };
}

/**
 * The effective config (fresh from the store). A not-found doc is the
 * DESIGNED default path (env defaults); a genuine storage failure surfaces.
 */
async function getEffectiveConfig() {
  const db = await getDb();
  let stored = null;
  try {
    stored = await db.collection(COLLECTION).document(DOC_KEY);
  } catch (err) {
    if (!isArangoNotFound(err)) throw err; // real failure — surface it, never mask as "no row"
  }
  return mergeEffective(stored);
}

/**
 * Serving repos: lifecycle truth (publish + ingested_at + not tombstoned),
 * each with its CURRENT serving graph name via the workingGraphName authority.
 * These are the only repos a fan-out leg may traverse.
 *
 * MEMOIZED ≤30s (ADR-039 D3's skew bound, shared with the authz resolver —
 * one cached query, two consumers). The cache bounds re-publish skew: a graph
 * that retires/reappears mid-window is tolerated by the retriever (zero-hit),
 * never stale-served past 30s. `fresh` bypasses for tests; `_resetServingCache`
 * is the test hook.
 *
 * PROJECTION CONTRACT: the KEEP must carry lifecycle_state + ingested_at —
 * workingGraphName branches on them (see module header).
 * @param {{fresh?: boolean}} [opts]
 * @returns {Promise<Array<{repo_id, name, domain, lifecycle_state, ingested_at, version, graph_name}>>}
 */
const SERVING_TTL_MS = 30_000;
let _servingCache = { at: 0, rows: null };

async function servingRepos(opts = {}) {
  if (!opts.fresh && _servingCache.rows && Date.now() - _servingCache.at < SERVING_TTL_MS) {
    return _servingCache.rows;
  }
  const db = await getDb();
  const rows = await (
    await db.query(
      "FOR r IN okf_repositories " +
        "FILTER r.lifecycle_state == 'publish' && r.ingested_at != null && r.deleted_at == null " +
        "SORT r.name ASC " +
        "RETURN KEEP(r, ['repo_id', 'name', 'domain', 'version', 'lifecycle_state', 'ingested_at'])"
    )
  ).all();
  const serving = rows.map((r) => ({ ...r, graph_name: workingGraphName(r) }));
  _servingCache = { at: Date.now(), rows: serving };
  return serving;
}

/** Test hook: drop the serving-set memo (no production caller — TTL governs). */
function _resetServingCache() {
  _servingCache = { at: 0, rows: null };
}

/**
 * The read-model the chat path and the Studio card consume (Story 1.7 AC,
 * refined by code review 2026-09-20): the effective CONFIG is global
 * governance posture, but the SERVING VIEW is per-caller — superadmin sees
 * every serving repo, a scoped caller sees exactly their intersection
 * (zero-hit by construction, mirroring /authz/graphs), and an unprivileged
 * caller sees none. `engaged` is therefore the CALLER's ADR-039 D2 gate:
 * mode ∈ {okf_only, hybrid} AND ≥1 graph serving FOR THIS CALLER.
 * @param {{okfScopes?: string[], isSuperAdmin?: boolean}} [caller]
 */
async function getRetrievalConfig(caller = {}) {
  return withSpan('okf.retrieval_config.get', async (span) => {
    const { isSuperAdmin, authorizedRepoIds } = deriveScopeAuthz(caller.okfScopes, caller.isSuperAdmin);
    const { config: cfg, source } = await getEffectiveConfig();
    const allServing = await servingRepos();
    const serving = isSuperAdmin ? allServing : allServing.filter((r) => authorizedRepoIds.has(r.repo_id));
    const servingCount = serving.length;
    // WHITELIST, not negation: only a known non-legacy mode engages (a
    // corrupted mode value can never switch the fan-out on).
    const engaged = (cfg.mode === 'okf_only' || cfg.mode === 'hybrid') && servingCount >= 1;
    const warnings = [];
    if (cfg.mode === 'okf_only' && servingCount === 0) {
      warnings.push('okf_only with zero serving graphs — OKF contribution is zero (ADR-039 D2)');
    }
    // hybrid + zero serving: deliberately NO warning — normal free-form-only
    // operation (see module header).
    span.setAttribute('okf.retrieval.mode', cfg.mode);
    span.setAttribute('okf.retrieval.serving_count', servingCount);
    span.setAttribute('okf.retrieval.engaged', engaged);
    logger.info('Retrieval config resolved', { mode: cfg.mode, source, serving_count: servingCount, engaged });
    return {
      config: cfg,
      source,
      serving_graph_count: servingCount,
      serving_repo_ids: serving.map((r) => r.repo_id),
      serving_graphs: serving.map((r) => ({ repo_id: r.repo_id, graph_name: r.graph_name, domain: r.domain })),
      engaged,
      warnings
    };
  });
}

/**
 * PUT path: validate (joi) → optimistic write (read → _rev-preconditioned
 * update; create on first-ever PUT; ONE retry on a concurrent-write conflict)
 * → revision bump → audit before→after. The stored row is self-describing
 * (env defaults are baked in at write time); `details` also carries the raw
 * prior STORED row + its source so an auditor can tell governed fields from
 * baked-env ones.
 * @param {object} body  raw request body
 * @param {{sub: string, name?: string}} actor
 * @param {string} [source_ip]
 */
async function putRetrievalConfig(body, actor, source_ip) {
  return withSpan('okf.retrieval_config.put', async (span) => {
    const patch = validateRetrievalConfigPatch(body);
    const db = await getDb();
    const col = db.collection(COLLECTION);

    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      let stored = null;
      try {
        stored = await col.document(DOC_KEY);
      } catch (err) {
        if (!isArangoNotFound(err)) throw err;
      }
      const { config: before, source: beforeSource, stored: beforeStored } = mergeEffective(stored);
      const next = {
        ...before,
        ...patch,
        revision: (typeof before.revision === 'number' ? before.revision : 0) + 1,
        updated_at: DateTime.now().toUTC().toISO(),
        updated_by: actor ? actor.sub : null
      };
      try {
        if (stored) {
          await col.update(DOC_KEY, { ...next, _rev: stored._rev }, { ignoreRevs: false });
        } else {
          await col.save({ _key: DOC_KEY, ...next });
        }
        const changed = Object.keys(patch).filter((k) => before[k] !== next[k]);
        const description =
          'Retrieval config updated: ' +
          (changed.length
            ? changed.map((k) => `${k}: ${JSON.stringify(before[k])} → ${JSON.stringify(next[k])}`).join('; ')
            : 'no effective change') +
          ` (revision ${next.revision})`;
        // AUDIT (ADR-029): governance change with before→after + the prior
        // raw STORED row and its source (an auditor must be able to tell a
        // governed prior value from a baked-env one). Best-effort by contract
        // (writeAudit never throws).
        await auditService.writeAudit({
          actor: actor ? actor.sub : null,
          actor_name: actor ? actor.name : null,
          action: 'system.retrieval_config.update',
          repo_id: AUDIT_REPO,
          description,
          details: { before, after: next, patch, before_source: beforeSource, before_stored: beforeStored },
          source_ip: source_ip || null
        });
        span.setAttribute('okf.retrieval.revision', next.revision);
        span.setAttribute('okf.retrieval.mode', next.mode);
        logger.info('Retrieval config updated', { revision: next.revision, patch, actor: actor ? actor.sub : null });
        return next;
      } catch (err) {
        if (isArangoConflict(err) && attempt === 0) {
          lastErr = err; // a concurrent steward won the race — re-read and retry once
          continue;
        }
        throw err;
      }
    }
    throw lastErr; // unreachable (both attempts either return or throw) — safety net
  });
}

module.exports = {
  getEffectiveConfig,
  getRetrievalConfig,
  servingRepos,
  putRetrievalConfig,
  _resetServingCache,
  SERVING_TTL_MS,
  mergeEffective,
  MODES,
  LIMITS,
  DOC_KEY,
  AUDIT_REPO
};
