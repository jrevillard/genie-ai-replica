// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 1.7 (ADR-okf-039 D1-D3, FR-44) — retrieval mode governance.
//
// The okf_system_config collection holds runtime-live retrieval posture as
// small keyed docs (_key='retrieval' today). Boot defaults come from env
// (config.retrieval); a stored doc overrides FIELD-BY-FIELD, so a partial doc
// is legal and the doc never has to exist (mode 'legacy' is the safe default
// and needs no row).
//
// The engagement gate (ADR-039 D2): the fan-out path may run only when
// mode !== 'legacy' AND at least one OKF graph is serving. Serving truth is
// the same predicate everywhere else in the product: lifecycle_state==='publish'
// AND ingested_at set AND not soft-deleted (the Ingested-lane truth — the
// frontend laneFor uses the same). Graph names are resolved through the SINGLE
// authority workingGraphName(repo) — versioned serving names OKF_<slug>_v<N>
// — never from a static per-repo constant and never from the manifest's
// stamped version (which can skew during a re-publish drain window; see
// okf-fanout-course-correction-2026-09-20.md §1.3 Trap 2).
//
// Every PUT is validated (mode enum, integer caps within sane maxima),
// revision-bumped, and audited before→after to okf_audit_logs (ADR-029 spine)
// with repo_id='_system' (config is repo-independent).

const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');
const config = require('../config');
const { workingGraphName } = require('./graph-lifecycle-service');
const auditService = require('./audit-service');

const COLLECTION = 'okf_system_config';
const DOC_KEY = 'retrieval';
const AUDIT_REPO = '_system';

const MODES = ['legacy', 'okf_only', 'hybrid'];

// Validation limits (ADR-039 D3: "mode enum, caps ≥1, ≤ sane maxima").
const LIMITS = {
  max_fanout_graphs: { min: 1, max: 20 },
  spine_max_hops: { min: 1, max: 3 },
  extracted_hop_cap: { min: 1, max: 3 },
  candidate_cap_per_graph: { min: 1, max: 200 },
  candidate_cap_global: { min: 1, max: 1000 }
};

// Env boot defaults → the wire shape (snake_case, the same keys a stored doc uses).
function envDefaults() {
  return {
    mode: config.retrieval.mode,
    max_fanout_graphs: config.retrieval.maxFanoutGraphs,
    spine_max_hops: config.retrieval.spineMaxHops,
    extracted_hop_cap: config.retrieval.extractedHopCap,
    candidate_cap_per_graph: config.retrieval.candidateCapPerGraph,
    candidate_cap_global: config.retrieval.candidateCapGlobal
  };
}

// Shared DB connection — cache the RESOLVED proxy (not the promise); retry on failure.
let _db = null;
async function getDb() {
  if (_db) return _db;
  _db = await dbService.getConnection('default');
  return _db;
}

/**
 * The effective config: env defaults overlaid field-by-field with the stored
 * doc (when present). Source is reported so operators can tell "row deleted,
 * running on env" from "governed row".
 * @returns {Promise<{config: object, source: 'database'|'env-defaults'}>}
 */
async function getEffectiveConfig() {
  const db = await getDb();
  let stored = null;
  try {
    stored = await db.collection(COLLECTION).document(DOC_KEY);
  } catch (err) {
    if (!err || err.code !== 404) throw err; // genuine storage failure — surface it
    // no governed row yet — env defaults stand (stored stays null)
  }
  if (!stored) {
    return {
      config: { ...envDefaults(), revision: 0, updated_at: null, updated_by: null },
      source: 'env-defaults'
    };
  }
  const defaults = envDefaults();
  const merged = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (stored[key] !== undefined && stored[key] !== null) merged[key] = stored[key];
  }
  return {
    config: {
      ...merged,
      revision: typeof stored.revision === 'number' ? stored.revision : 0,
      updated_at: stored.updated_at || null,
      updated_by: stored.updated_by || null
    },
    source: 'database'
  };
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
 * @param {{fresh?: boolean}} [opts]
 * @returns {Promise<Array<{repo_id, name, domain, graph_name}>>}
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
        "RETURN KEEP(r, ['repo_id', 'name', 'domain', 'version', 'ingested_version'])"
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
 * The full read-model the chat path and the Studio card consume (Story 1.7 AC):
 * effective config + engagement gate + serving graph set.
 * `engaged` is the ADR-039 D2 gate evaluated server-side for convenience —
 * the fan-out path may run only when mode !== 'legacy' AND ≥1 graph serves.
 * `okf_only` with zero serving graphs reports engaged=false WITH a warning
 * string (never a silent legacy fallback).
 */
async function getRetrievalConfig() {
  return withSpan('okf.retrieval_config.get', async (span) => {
    const { config: cfg, source } = await getEffectiveConfig();
    const serving = await servingRepos();
    const servingCount = serving.length;
    const engaged = cfg.mode !== 'legacy' && servingCount >= 1;
    const warnings = [];
    if (cfg.mode === 'okf_only' && servingCount === 0) {
      warnings.push('okf_only with zero serving graphs — OKF contribution is zero (ADR-039 D2)');
    }
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
 * Validate a PUT payload. Returns the sanitized patch ({mode?, ...caps?}) or
 * throws {code:'VALIDATION_ERROR', message}.
 */
function validatePatch(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw { code: 'VALIDATION_ERROR', message: 'body must be a JSON object' };
  }
  const allowed = ['mode', ...Object.keys(LIMITS)];
  const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
  if (unknown.length) {
    throw { code: 'VALIDATION_ERROR', message: `unknown field(s): ${unknown.join(', ')}` };
  }
  const patch = {};
  if (body.mode !== undefined) {
    if (!MODES.includes(body.mode)) {
      throw { code: 'VALIDATION_ERROR', message: `mode must be one of: ${MODES.join(', ')}` };
    }
    patch.mode = body.mode;
  }
  for (const [key, { min, max }] of Object.entries(LIMITS)) {
    const v = body[key];
    if (v === undefined) continue;
    if (!Number.isInteger(v) || v < min || v > max) {
      throw { code: 'VALIDATION_ERROR', message: `${key} must be an integer in [${min}, ${max}]` };
    }
    patch[key] = v;
  }
  if (!Object.keys(patch).length) {
    throw { code: 'VALIDATION_ERROR', message: 'no configurable fields in body' };
  }
  return patch;
}

/**
 * PUT path: validate → merge over the CURRENT effective config → revision
 * bump → persist → audit before→after. The write is a full overwrite of the
 * governed row (env defaults are baked in at write time so the row stays
 * self-describing), but only fields present in the payload change values.
 * @param {object} body  validated-or-raw request body
 * @param {{sub: string, name?: string}} actor
 * @param {string} [source_ip]
 */
async function putRetrievalConfig(body, actor, source_ip) {
  return withSpan('okf.retrieval_config.put', async (span) => {
    const patch = validatePatch(body);
    const { config: current } = await getEffectiveConfig();
    const before = { ...current };
    const next = {
      ...current,
      ...patch,
      revision: (typeof current.revision === 'number' ? current.revision : 0) + 1,
      updated_at: new Date().toISOString(),
      updated_by: actor ? actor.sub : null
    };
    const db = await getDb();
    await db.collection(COLLECTION).save({ _key: DOC_KEY, ...next }, { overwrite: true });
    const changed = Object.keys(patch).filter((k) => before[k] !== next[k]);
    const description =
      'Retrieval config updated: ' +
      (changed.length
        ? changed.map((k) => `${k}: ${JSON.stringify(before[k])} → ${JSON.stringify(next[k])}`).join('; ')
        : 'no effective change') +
      ` (revision ${next.revision})`;
    // AUDIT (ADR-029): governance change with before→after. Best-effort by
    // contract (writeAudit never throws), but the config write itself has
    // already succeeded — a lost audit row is logged inside writeAudit.
    await auditService.writeAudit({
      actor: actor ? actor.sub : null,
      actor_name: actor ? actor.name : null,
      action: 'system.retrieval_config.update',
      repo_id: AUDIT_REPO,
      description,
      details: { before, after: next, patch },
      source_ip: source_ip || null
    });
    span.setAttribute('okf.retrieval.revision', next.revision);
    span.setAttribute('okf.retrieval.mode', next.mode);
    logger.info('Retrieval config updated', { revision: next.revision, patch, actor: actor ? actor.sub : null });
    return next;
  });
}

module.exports = {
  getEffectiveConfig,
  getRetrievalConfig,
  servingRepos,
  putRetrievalConfig,
  validatePatch,
  _resetServingCache,
  SERVING_TTL_MS,
  MODES,
  LIMITS,
  DOC_KEY,
  AUDIT_REPO
};
