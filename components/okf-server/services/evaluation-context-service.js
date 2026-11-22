// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// #2061 phase 2 — E-1, the Evaluation Context object.
//
// An Evaluation Context is a NAMED, VERSIONED, SNAPSHOT-RESOLVED
// authorization principal. It answers one question — "which serving graphs
// does THIS principal traverse?" — and it answers it through the ONE
// authority that already answers it for a live caller:
//
//   resolveGraphSet(okfScopes, isSuperAdmin)      authz-resolver-service.js
//     ← deriveReadAuthz            scope-authz-service.js   (the single rule)
//     ← servingRepos               retrieval-config-service.js
//     ← filterServingByAcl         access-control-service.js
//
// The context resolves the SAME way, with the scope list of the UNION of the
// groups it references — which is exactly the reduction a multi-group token
// gets (a group grant is a realm role whose name is a scope string; the
// middleware folds realm role names into the caller's effective scopes).
// There is no second authority here and no hand-listed graph set: the only
// inputs are scopes and group references, and the resolved graph set is a
// SNAPSHOT of the authority's answer.
//
// The OPEN context is first-class: empty scopes + empty principal refs resolve
// as the deployment's default posture. In open mode that is every
// UNRESTRICTED serving repository (restricted ones stay fenced); in closed
// mode it is an EMPTY carrier WITH a loud warning — never a silent one.

// nodeCrypto, not crypto: Node 19+ ships a global `crypto`, and shadowing
// it is a redeclare error (the repo's convention — retrieval-config-client).
const nodeCrypto = require('crypto');
const dbService = require('../shared-lib/db-connection-service');
const { resolveGraphSet } = require('./authz-resolver-service');
const { parseOkfScope } = require('./scope-authz-service');
const keycloakAccess = require('./keycloak-access-service');
const { writeAudit } = require('./audit-service');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');

const COLLECTION = 'okf_evaluation_contexts';
const SUPERADMIN_REALM_ROLE = 'tools-admin';

/** An Evaluation Context is refused with this shape (the repo's error style). */
class EvalContextError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'EvalContextError';
    this.code = code;
    this.status = status;
  }
}

async function ensureCollection(db) {
  const col = db.collection(COLLECTION);
  if (!(await col.exists())) await col.create();
  return col;
}

/**
 * The scope list of ONE group: the realm roles it carries whose names are
 * scope strings. A group that carries `tools-admin` makes the union
 * privileged — the same reduction a multi-group token gets, where the
 * super-role rides in realm_access.roles.
 *
 * @param {string} ref - a Keycloak group id OR a group name
 * @returns {Promise<{scopes: string[], isSuperAdmin: boolean}>}
 */
async function groupScopes(ref) {
  const group = (await keycloakAccess.findGroupByName) ? await keycloakAccess.findGroupByName(ref) : null;
  const groupId = group && group.id ? group.id : ref;
  let roles;
  try {
    roles = (await keycloakAccess.groupRealmRoles(groupId)) || [];
  } catch (err) {
    // A group that does not exist grants nothing — but the caller asked for
    // it, so it is worth saying out loud.
    logger.warn('eval_context.group_unreadable', { group_ref: ref, error: err.message });
    return { scopes: [], isSuperAdmin: false };
  }
  const scopes = [];
  let isSuperAdmin = false;
  for (const role of roles) {
    const name = role && role.name;
    if (!name) continue;
    if (name === SUPERADMIN_REALM_ROLE) {
      isSuperAdmin = true;
      continue;
    }
    // Only GRAMMAR-VALID scopes count: a typo level grants nothing, exactly
    // as it would in a token.
    if (parseOkfScope(name)) scopes.push(name);
  }
  return { scopes, isSuperAdmin };
}

/**
 * The unioned effective scope list of a context's inputs.
 * @param {string[]} scopes - explicit scope strings
 * @param {string[]} principalRefs - Keycloak group ids or names
 * @returns {Promise<{scopes: string[], isSuperAdmin: boolean}>}
 */
async function effectiveScopes(scopes = [], principalRefs = []) {
  const out = new Set();
  let isSuperAdmin = false;
  for (const raw of Array.isArray(scopes) ? scopes : []) {
    if (typeof raw === 'string' && raw.trim()) out.add(raw.trim());
  }
  for (const ref of Array.isArray(principalRefs) ? principalRefs : []) {
    if (typeof ref !== 'string' || !ref.trim()) continue;
    const group = await groupScopes(ref.trim());
    for (const s of group.scopes) out.add(s);
    if (group.isSuperAdmin) isSuperAdmin = true;
  }
  return { scopes: [...out].sort(), isSuperAdmin };
}

/**
 * The repo-set hash: sha256 over the sorted (repo_id, graph_name) pairs. The
 * graph name carries the version, so a re-publish changes the hash — which is
 * the point: two evaluations are comparable only if they saw the same set.
 */
function repoSetHash(repos) {
  const pairs = (repos || [])
    .map((r) => `${r.repo_id}:${r.graph_name}`)
    .sort()
    .join('\n');
  return nodeCrypto.createHash('sha256').update(pairs).digest('hex').slice(0, 32);
}

/**
 * RESOLVE a context's inputs into a snapshot. The authority's answer is used
 * verbatim — no recomposition.
 *
 * @param {{scopes?: string[], principal_refs?: string[]}} input
 * @returns {Promise<{scopes: string[], graph_names: string[], repos: Array, scope_mode: string, resolved_at: string, hash: string, warnings: string[], open_context: boolean}>}
 */
async function resolveContext(input = {}) {
  return withSpan('okf.evalctx.resolve', async (span) => {
    const scopes = Array.isArray(input.scopes) ? input.scopes : [];
    const principalRefs = Array.isArray(input.principal_refs) ? input.principal_refs : [];
    const { scopes: effective, isSuperAdmin } = await effectiveScopes(scopes, principalRefs);
    const view = await resolveGraphSet({ okfScopes: effective, isSuperAdmin });

    const openContext = effective.length === 0 && principalRefs.length === 0;
    const warnings = [];
    if (openContext && view.scope_mode === 'closed') {
      // The default posture in a default-deny deployment resolves to NOTHING.
      // That is correct, and it must be LOUD: a context that silently scored
      // an empty universe would look like a passing run.
      const message =
        'the OPEN evaluation context resolves to an EMPTY carrier: OKF_SCOPE_MODE is "closed" and the ' +
        'context names no scope and no group. Give the context a scope or a group, or run the ' +
        'evaluation in open mode.';
      warnings.push(message);
      logger.warn('eval_context.open_context_empty', { scope_mode: view.scope_mode });
    }

    span.setAttribute('okf.evalctx.open_context', openContext);
    span.setAttribute('okf.evalctx.graph_count', view.graph_names.length);
    return {
      scopes: effective,
      graph_names: view.graph_names,
      repos: view.repos,
      scope_mode: view.scope_mode,
      resolved_at: view.generated_at,
      hash: repoSetHash(view.repos),
      warnings,
      open_context: openContext
    };
  });
}

/** The input shape: a name is required; scopes and group refs are lists. */
function validateInput(payload = {}) {
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  if (!name) {
    throw new EvalContextError('VALIDATION_ERROR', 'an evaluation context needs a name', 400);
  }
  if (name.length > 80) {
    throw new EvalContextError('VALIDATION_ERROR', 'the name is longer than 80 characters', 400);
  }
  const scopes = (Array.isArray(payload.scopes) ? payload.scopes : []).filter((s) => typeof s === 'string' && s.trim());
  const principalRefs = (Array.isArray(payload.principal_refs) ? payload.principal_refs : []).filter(
    (r) => typeof r === 'string' && r.trim()
  );
  return {
    name,
    scopes,
    principal_refs: principalRefs,
    tenant: typeof payload.tenant === 'string' && payload.tenant.trim() ? payload.tenant.trim() : null,
    filters: Array.isArray(payload.filters) ? payload.filters : []
  };
}

/**
 * CREATE a context: resolve, freeze the snapshot, audit. Superadmin-gated at
 * the route; the service is the shape's only writer.
 */
async function createContext(payload = {}, opts = {}) {
  const input = validateInput(payload);
  if (input.filters.length) {
    // The resolver's output is the AUTHORITY's, byte-identical to
    // resolveGraphSet — so it cannot also apply a filter. An inert field
    // would be a promise the resolution does not keep; say so out loud.
    logger.warn('eval_context.filters_not_applied', { name: input.name, filters: input.filters.length });
  }
  const resolved = await resolveContext(input);
  const db = await dbService.getConnection();
  const col = await ensureCollection(db);
  const now = new Date().toISOString();
  const doc = {
    _key: `ec-${nodeCrypto.randomUUID()}`,
    name: input.name,
    scopes: input.scopes,
    principal_refs: input.principal_refs,
    tenant: input.tenant,
    filters: input.filters,
    resolved: {
      // The EFFECTIVE scopes — the union the authority actually resolved
      // from — not the input list. A context that names only groups has an
      // empty INPUT scope list, and storing that alone would under-report
      // the principal the snapshot was measured against.
      scopes: resolved.scopes,
      graph_names: resolved.graph_names,
      repos: resolved.repos,
      scope_mode: resolved.scope_mode,
      resolved_at: resolved.resolved_at,
      hash: resolved.hash
    },
    warnings: resolved.warnings,
    version: 1,
    // The snapshot is immutable: the ONLY way to change what a context
    // resolves to is a refresh, which bumps the version and is audited.
    immutable: true,
    created_at: now,
    created_by: (opts.actor && opts.actor.user_id) || 'system',
    approved_by: (opts.actor && opts.actor.user_id) || null
  };
  await col.save(doc);
  await writeAudit({
    action: 'eval_context.create',
    actor: doc.created_by,
    repo_id: null,
    details: {
      context_id: doc._key,
      name: doc.name,
      version: doc.version,
      scopes: doc.resolved.scopes.length,
      principal_refs: doc.principal_refs.length,
      graph_count: doc.resolved.graph_names.length,
      hash: doc.resolved.hash
    }
  });
  return doc;
}

/** READ one context. */
async function getContext(id) {
  const db = await dbService.getConnection();
  const col = await ensureCollection(db);
  let doc;
  try {
    doc = await col.document(id);
  } catch (err) {
    if (err && (err.code === 404 || err.errorNum === 1202 || err.errorNum === 1204)) {
      throw new EvalContextError('CONTEXT_NOT_FOUND', `evaluation context ${id} not found`, 404);
    }
    throw err;
  }
  if (!doc) {
    throw new EvalContextError('CONTEXT_NOT_FOUND', `evaluation context ${id} not found`, 404);
  }
  return doc;
}

/** LIST the contexts (newest first). */
async function listContexts() {
  const db = await dbService.getConnection();
  await ensureCollection(db);
  // `@@collection` is a COLLECTION-NAME bind parameter: the engine reads its
  // value under the key `@collection` — the sigil stays in the key. The key
  // `collection` leaves the placeholder empty and the engine refuses the
  // whole query ("no value specified for declared bind parameter
  // '@collection'") — measured live on 2026-11-22, which answered HTTP 500
  // on this endpoint while every unit test was green.
  const cursor = await db.query('FOR c IN @@collection SORT c.created_at DESC RETURN c', {
    '@collection': COLLECTION
  });
  const rows = await cursor.all();
  return rows || [];
}

/**
 * REFRESH a context: re-resolve, bump the version, audit. The snapshot is
 * never silently stale — a run that recorded version N stays readable, and
 * the refresh is a new version, not an edit.
 */
async function refreshContext(id, opts = {}) {
  const doc = await getContext(id);
  const resolved = await resolveContext({ scopes: doc.scopes, principal_refs: doc.principal_refs });
  const next = {
    ...doc,
    resolved: {
      scopes: resolved.scopes,
      graph_names: resolved.graph_names,
      repos: resolved.repos,
      scope_mode: resolved.scope_mode,
      resolved_at: resolved.resolved_at,
      hash: resolved.hash
    },
    warnings: resolved.warnings,
    version: (doc.version || 1) + 1,
    refreshed_at: new Date().toISOString(),
    refreshed_by: (opts.actor && opts.actor.user_id) || 'system'
  };
  delete next._id;
  delete next._rev;
  const db = await dbService.getConnection();
  const col = await ensureCollection(db);
  await col.replace(id, next);
  await writeAudit({
    action: 'eval_context.refresh',
    actor: next.refreshed_by,
    repo_id: null,
    details: {
      context_id: id,
      version: next.version,
      graph_count: next.resolved.graph_names.length,
      hash: next.resolved.hash
    }
  });
  return next;
}

/**
 * The CARRIER a request asks to be evaluated against: a context's STORED
 * snapshot, never a fresh resolution. The snapshot is the contract — a run
 * recorded against version N stays comparable with the run recorded against
 * version N, and CI resolves from snapshots with no Keycloak at all.
 *
 * @param {string} contextId
 * @returns {Promise<{context: {id, version, hash, name}, repo_ids: string[], graph_names: string[]}>}
 */
async function carrierOf(contextId) {
  const doc = await getContext(contextId);
  const resolved = doc.resolved || {};
  return {
    context: {
      id: doc._key,
      name: doc.name,
      version: doc.version,
      hash: resolved.hash || null
    },
    repo_ids: (resolved.repos || []).map((r) => r.repo_id),
    graph_names: resolved.graph_names || []
  };
}

module.exports = {
  COLLECTION,
  EvalContextError,
  resolveContext,
  effectiveScopes,
  repoSetHash,
  createContext,
  getContext,
  listContexts,
  refreshContext,
  carrierOf
};
