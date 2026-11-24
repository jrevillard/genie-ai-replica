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
//
// A principal that CANNOT BE READ is neither the open context nor a silent
// empty carrier: it is REFUSED. The failure mode it must never have is the
// one that reads best and means least — a context that names a group which
// cannot be resolved quietly resolving to the whole public corpus, and
// measuring it as if it had measured the group.

const nodeCrypto = require('crypto');
const dbService = require('../shared-lib/db-connection-service');
const { resolveGraphSet } = require('./authz-resolver-service');
const { servingRepos } = require('./retrieval-config-service');
const { parseOkfScope } = require('./scope-authz-service');
const keycloakAccess = require('./keycloak-access-service');
const { writeAudit } = require('./audit-service');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');

const COLLECTION = 'okf_evaluation_contexts';
const SUPERADMIN_REALM_ROLE = 'tools-admin';
// A Keycloak group id is an opaque uuid. A principal reference that is NOT
// uuid-shaped and does not resolve by name is a name that does not exist —
// it never becomes a path segment.
const UUID_SHAPED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (!(await col.exists())) {
    try {
      await col.create();
    } catch (err) {
      // 1207 = duplicate collection: another request created it first, which
      // is fine — the collection is there either way. Any other failure is
      // real and propagates.
      const code = err && (err.errorNum || err.code);
      if (Number(code) !== 1207) throw err;
    }
  }
  return col;
}

/**
 * The scope list of ONE group: the realm roles it carries whose names are
 * scope strings. A group that carries `tools-admin` makes the union
 * privileged — the same reduction a multi-group token gets, where the
 * super-role rides in realm_access.roles.
 *
 * A group that CANNOT be read is reported as `failed`, never as "grants
 * nothing": the difference matters because "grants nothing" resolves to the
 * deployment's default (public) set, which is exactly the widening an
 * unreadable principal must never get.
 *
 * @param {string} ref - a Keycloak group name OR a uuid-shaped group id
 * @returns {Promise<{scopes: string[], isSuperAdmin: boolean, failed: boolean, reason?: string}>}
 */
async function groupScopes(ref) {
  let group = null;
  try {
    if (typeof keycloakAccess.findGroupByName === 'function') {
      group = await keycloakAccess.findGroupByName(ref);
    }
    let groupId = group && group.id ? group.id : null;
    if (!groupId && UUID_SHAPED.test(ref)) {
      // The reference may be a group ID. ONLY a uuid-shaped one: anything
      // else is a name that does not exist and never reaches a URL path.
      groupId = ref;
    }
    if (!groupId) {
      return { scopes: [], isSuperAdmin: false, failed: true, reason: 'not_found' };
    }
    const roles = (await keycloakAccess.groupRealmRoles(groupId)) || [];
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
    return { scopes, isSuperAdmin, failed: false };
  } catch (err) {
    // A group that cannot be read grants NOTHING — and the caller asked for
    // it, so it is worth saying out loud. It is NOT the same as the open
    // context: the resolution refuses rather than widening.
    logger.warn('eval_context.group_unreadable', { group_ref: ref, error: err.message });
    return { scopes: [], isSuperAdmin: false, failed: true, reason: 'unreadable' };
  }
}

/**
 * The unioned effective scope list of a context's inputs.
 *
 * An explicit scope that is not a scope string contributes NOTHING — the
 * authority ignores it, and the resolution must stay byte-identical to the
 * authority's answer for the same list. It is REPORTED, though: a typo that
 * silently granted nothing would leave the operator believing the context
 * was narrower than it is.
 *
 * @param {string[]} scopes - explicit scope strings
 * @param {string[]} principalRefs - Keycloak group names or ids
 * @returns {Promise<{scopes: string[], isSuperAdmin: boolean, unreadable: string[], invalid: string[]}>}
 */
async function effectiveScopes(scopes = [], principalRefs = []) {
  const out = new Set();
  const invalid = [];
  const unreadable = [];
  let isSuperAdmin = false;
  for (const raw of Array.isArray(scopes) ? scopes : []) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const trimmed = raw.trim();
    if (!parseOkfScope(trimmed)) {
      invalid.push(trimmed);
      continue;
    }
    out.add(trimmed);
  }
  for (const ref of Array.isArray(principalRefs) ? principalRefs : []) {
    if (typeof ref !== 'string' || !ref.trim()) continue;
    const group = await groupScopes(ref.trim());
    if (group.failed) {
      unreadable.push(ref.trim());
      continue;
    }
    for (const s of group.scopes) out.add(s);
    if (group.isSuperAdmin) isSuperAdmin = true;
  }
  return { scopes: [...out].sort(), isSuperAdmin, unreadable, invalid };
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
 * The HEAD-version hash: sha256 over the sorted (repo_id, head_version)
 * pairs.
 *
 * The second comparison key, and it is not a duplicate of the repo-set hash.
 * The repo-set hash answers "did the evaluation see the same SERVING set?" —
 * the graph name carries the serving version. The head leg races the head
 * VECTOR, so two evaluations over the same serving set are still different
 * measurements when a head was re-built in between (the frontmatter changed,
 * the head was recomputed, the serving graph did not move). One key cannot
 * answer both questions, so the record carries both.
 *
 * A repository with NO head contributes `repo_id:` — the missing head is a
 * fact about the measurement, not an absence from it.
 */
function headVersionHash(repos) {
  const pairs = (repos || [])
    .map((r) => `${r.repo_id}:${r.head_version === null || r.head_version === undefined ? '' : r.head_version}`)
    .sort()
    .join('\n');
  return nodeCrypto.createHash('sha256').update(pairs).digest('hex').slice(0, 32);
}

/**
 * The head versions of the given repositories, read from the repository
 * documents (the head is stored on the repo doc — `head.version`).
 */
async function headVersionsFor(db, repoIds) {
  const ids = (repoIds || []).filter(Boolean);
  const out = new Map();
  if (!ids.length) return out;
  const cursor = await db.query(
    'FOR r IN okf_repositories FILTER r._key IN @ids ' +
      'RETURN { repo_id: r._key, head_version: r.head ? r.head.version : null }',
    { ids }
  );
  for (const row of (await cursor.all()) || []) {
    if (row && row.repo_id) out.set(row.repo_id, row.head_version === undefined ? null : row.head_version);
  }
  return out;
}

/**
 * RESOLVE a context's inputs into a snapshot. The authority's answer is used
 * verbatim — no recomposition.
 *
 * @param {{scopes?: string[], principal_refs?: string[]}} input
 * @returns {Promise<{scopes: string[], graph_names: string[], repos: Array, scope_mode: string, resolved_at: string, hash: string, warnings: string[], open_context: boolean, unreadable: string[], invalid: string[]}>}
 */
async function resolveContext(input = {}) {
  return withSpan('okf.evalctx.resolve', async (span) => {
    const scopes = Array.isArray(input.scopes) ? input.scopes : [];
    const principalRefs = Array.isArray(input.principal_refs) ? input.principal_refs : [];
    const { scopes: effective, isSuperAdmin, unreadable, invalid } = await effectiveScopes(scopes, principalRefs);
    const view = await resolveGraphSet({ okfScopes: effective, isSuperAdmin });

    const openContext = effective.length === 0 && principalRefs.length === 0;
    const warnings = [];
    if (unreadable.length) {
      // The principal could not be read. The resolution below is whatever the
      // authority answers for an empty scope list — the caller REFUSES this
      // context (createContext / refreshContext), because the open corpus is
      // never the fallback for an unreadable principal.
      warnings.push(
        `the principal reference(s) ${unreadable.join(', ')} could not be read, so the context ` +
          "resolves NOTHING that can be trusted: the deployment's public set is NOT a fallback for " +
          'a principal that could not be read. Fix the reference, or refresh once the group resolves.'
      );
    }
    if (invalid.length) {
      warnings.push(
        `the scope string(s) ${invalid.join(', ')} are not valid okf scope strings and granted ` +
          "nothing. The resolution is the authority's answer for the remaining scopes."
      );
    }
    if (effective.length === 0 && view.scope_mode === 'closed') {
      // The default posture in a default-deny deployment resolves to NOTHING.
      // That is correct, and it must be LOUD: a context that silently scored
      // an empty universe would look like a passing run.
      const message =
        'the OPEN evaluation context resolves to an EMPTY carrier: OKF_SCOPE_MODE is "closed" and the ' +
        'context names no scope and no group. Give the context a scope or a group, or run the ' +
        'evaluation in open mode.';
      warnings.push(message);
      logger.warn('eval_context.open_context_empty', { scope_mode: view.scope_mode });
    } else if (effective.length === 0 && principalRefs.length) {
      // The group resolved and carries NO scope role. In open mode that
      // principal still traverses the PUBLIC set — which is a true answer,
      // but not the one an operator naming a "restricted" group expects.
      warnings.push(
        "the referenced group(s) carry no okf scope, so this context resolves the deployment's " +
          'DEFAULT (public) set — not a restricted one. If that is not what you meant, the group ' +
          'holds no scope.'
      );
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
      open_context: openContext,
      unreadable,
      invalid
    };
  });
}

/** The input shape: a name is required; scopes and group refs are lists.
 *  `requireName: false` is the PREVIEW's shape — an operator composes the
 *  memberships BEFORE naming the thing they are composing. */
function validateInput(payload = {}, { requireName = true } = {}) {
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  if (!name && requireName) {
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
  const resolved = await resolveContext(input);
  if (resolved.unreadable.length) {
    // REFUSE, rather than store a context that measures the public corpus
    // under a principal's name.
    throw new EvalContextError(
      'PRINCIPAL_UNREADABLE',
      `the principal reference(s) ${resolved.unreadable.join(', ')} could not be read, so the context ` +
        "cannot be resolved. The deployment's public set is not a fallback for a principal that " +
        'could not be read.',
      422
    );
  }
  const warnings = [...resolved.warnings];
  if (input.filters.length) {
    // The resolver's output is the AUTHORITY's, byte-identical to
    // resolveGraphSet — so it cannot also apply a filter. An inert field
    // would be a promise the resolution does not keep; say so out loud, ON
    // THE WIRE as well as in the log.
    warnings.push(
      `the ${input.filters.length} filter(s) were NOT applied: the resolution is the authority's ` +
        'answer for the scope list, and it applies no filter. The filters are stored as given.'
    );
    logger.warn('eval_context.filters_not_applied', { name: input.name, filters: input.filters.length });
  }
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
      hash: resolved.hash,
      // Whether THIS resolution is the open posture. The snapshot records it
      // because the question "is this the open context?" is asked later, by a
      // gate that reads a STORED document — and an answer that lives only in
      // memory can never satisfy a stored gate.
      open_context: resolved.open_context
    },
    warnings,
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

/**
 * PREVIEW a composition: the resolution the create WOULD freeze, without
 * writing anything.
 *
 * WHY it exists: a context is IMMUTABLE and there is no DELETE route — a
 * membership an operator got wrong would be a permanent, undeletable
 * document. So the composer must be able to SEE the union (the scopes it
 * would hold, the repositories it would reach, the warnings) BEFORE it
 * commits to a name. The resolution is the SAME `resolveContext` the create
 * calls, so the preview and the created context cannot disagree.
 */
async function previewContext(payload = {}) {
  const input = validateInput(payload, { requireName: false });
  const resolved = await resolveContext(input);
  return {
    name: input.name,
    scopes: input.scopes,
    principal_refs: input.principal_refs,
    resolved: {
      scopes: resolved.scopes,
      graph_names: resolved.graph_names,
      repos: resolved.repos,
      scope_mode: resolved.scope_mode,
      resolved_at: resolved.resolved_at,
      hash: resolved.hash,
      open_context: resolved.open_context
    },
    warnings: resolved.warnings,
    unreadable: resolved.unreadable,
    invalid: resolved.invalid
  };
}

/**
 * The deployment's GROUPS, each with the GRANTS it carries and the MEMBERS
 * it holds — the composer's source of truth.
 *
 * A membership is a group; the group carries realm roles whose names are
 * scope strings; the union of those is the principal the context resolves.
 * The composer shows the operator exactly that: which grants a membership
 * brings, and whose view it is. `privileged` says the membership carries
 * `tools-admin` — the union would then be a superadmin union, which the
 * resolution honours, so the composer must not hide it.
 */
async function listGroups(term = '') {
  const groups = await keycloakAccess.searchGroups(term, 100);
  // Per-group enrichment is TWO Keycloak round-trips (roles + members); a
  // serial loop over a ~100-group realm is ~200 sequential calls, each with
  // its own timeout. A small worker pool keeps the fan-out polite without
  // serializing it — the pool preserves nothing about ORDER, so the realm's
  // search order is re-applied at the end.
  const CONCURRENCY = 8;
  const queue = [...(groups || [])];
  const enriched = [];
  const enrichOne = async (g) => {
    const grants = [];
    let privileged = false;
    let roles = [];
    try {
      roles = await keycloakAccess.groupRealmRoles(g.id);
    } catch (err) {
      logger.warn('eval_context.group_grants_unreadable', { group: g.name, error: err.message });
    }
    for (const role of roles || []) {
      const name = role && role.name;
      if (!name) continue;
      if (name === SUPERADMIN_REALM_ROLE) {
        privileged = true;
        continue;
      }
      // Only GRAMMAR-VALID scopes count: a typo level grants nothing,
      // exactly as it would in a token.
      if (parseOkfScope(name)) grants.push(name);
    }
    let members = [];
    let membersTruncated = false;
    try {
      const raw = await keycloakAccess.groupMembers(g.id);
      members = ((raw && raw.members) || []).map((u) => u.username).filter(Boolean);
      membersTruncated = Boolean(raw && raw.truncated);
    } catch (err) {
      // A group whose members cannot be read is still a membership an
      // operator may compose — it is the GRANTS that decide what it reaches.
      logger.warn('eval_context.group_members_unreadable', { group: g.name, error: err.message });
    }
    enriched.push({
      id: g.id,
      name: g.name,
      grants: grants.sort(),
      privileged,
      members: members.sort(),
      members_truncated: membersTruncated
    });
  };
  const workers = Array.from({ length: Math.min(CONCURRENCY, Math.max(queue.length, 1)) }, () =>
    (async () => {
      for (let g = queue.shift(); g; g = queue.shift()) await enrichOne(g);
    })()
  );
  await Promise.all(workers);
  const byId = new Map(enriched.map((r) => [r.id, r]));
  return (groups || []).map((g) => byId.get(g.id)).filter(Boolean);
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
  if (resolved.unreadable.length) {
    // The refresh FAILS and the stored snapshot stands: a context whose
    // principal became unreadable must not silently re-resolve to the
    // public corpus, and it must not lose its version history either.
    throw new EvalContextError(
      'PRINCIPAL_UNREADABLE',
      `the principal reference(s) ${resolved.unreadable.join(', ')} could not be read, so the context ` +
        "could not be refreshed. Its stored snapshot stands; the deployment's public set is not a " +
        'fallback for a principal that could not be read.',
      422
    );
  }
  const next = {
    ...doc,
    resolved: {
      scopes: resolved.scopes,
      graph_names: resolved.graph_names,
      repos: resolved.repos,
      scope_mode: resolved.scope_mode,
      resolved_at: resolved.resolved_at,
      hash: resolved.hash,
      open_context: resolved.open_context
    },
    warnings: resolved.warnings,
    version: (doc.version || 1) + 1,
    refreshed_at: new Date().toISOString(),
    refreshed_by: (opts.actor && opts.actor.user_id) || 'system'
  };
  delete next._id;
  // `_rev` STAYS: the replace is then revision-checked, so two concurrent
  // refreshes cannot silently clobber each other — the loser gets a
  // conflict instead of an overwritten snapshot.
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
 * NOT EXPORTED: an ungated read of the context document is exactly the
 * side-door the carrier boundary closes. `carrierFor` is the only way in.
 *
 * @param {string} contextId
 * @returns {Promise<{context: {id, version, hash, name}, repo_ids: string[], graph_names: string[], repos: Array}>}
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
    graph_names: resolved.graph_names || [],
    // The frozen serving ROWS (repo_id + name + domain + graph_name — the
    // projection resolveGraphSet makes; it does NOT carry `acl`, the per-repo
    // gate having already been applied when the snapshot was resolved).
    repos: resolved.repos || []
  };
}

/**
 * The STALENESS gate: the snapshot froze the serving graph NAMES, and a
 * re-publish renames the serving graph (promoteGraph: `OKF_x_v1` ->
 * `OKF_x_v2`). A frozen name that is no longer the live name for that
 * repository names a corpus that does not exist — the retriever answers a
 * missing graph with an empty result, so the run would be scored over
 * nothing, or over a PARTLY stale corpus (the fail-open case: 13 of 14
 * repositories re-published, the run completes and the record lists 14
 * graph names while 13 corpora were measured).
 *
 * So the carrier is REFUSED, in total, with the remedy. The live name comes
 * from `servingRepos()` — the SAME derivation the snapshot was built from —
 * and the comparison is per REPOSITORY, never per name: a graph name is
 * slug-derived, so a freed name can be re-minted by another repository and
 * a name-only comparison would silently match the wrong corpus.
 *
 * A repository that no longer serves at all (retracted) is stale too.
 *
 * Two honest caveats. The serving set is memoized for 30s, so the check can
 * lag a publish by up to that long — the refusal is fail-closed, never
 * fail-open. And the version is bumped at MINT while the rename happens at
 * SETTLE, so a publish in progress also reads as stale; the message names
 * the live name so the operator can tell the two apart, and it does NOT
 * claim that a refresh is the only remedy.
 *
 * @param {{context: object, repos: Array}} carrier
 */
async function assertCarrierCurrent(carrier, allowed = null) {
  const rows = Array.isArray(carrier.repos) ? carrier.repos : [];
  if (!rows.length) return; // nothing frozen to check
  const serving = await servingRepos();
  const live = new Map(serving.map((r) => [r.repo_id, r.graph_name]));
  const stale = [];
  for (const row of rows) {
    const liveName = live.get(row.repo_id);
    if (!liveName) {
      stale.push({
        repo_id: row.repo_id,
        repo: row.name || row.repo_id,
        frozen: row.graph_name || null,
        live: null
      });
    } else if (liveName !== row.graph_name) {
      stale.push({
        repo_id: row.repo_id,
        repo: row.name || row.repo_id,
        frozen: row.graph_name || null,
        live: liveName
      });
    }
  }
  if (!stale.length) return;
  // The refusal NAMES what is stale — but only what this caller may
  // traverse. A repository outside their reach is counted, never named: the
  // check still sees it (the context's hash covers the FULL frozen set), but
  // a caller must not learn the identity, or the live graph name, of a
  // repository they cannot read.
  const lines = [];
  let withheld = 0;
  for (const s of stale) {
    if (allowed && !allowed.has(s.repo_id)) {
      withheld += 1;
      continue;
    }
    lines.push(
      s.live
        ? `  repository "${s.repo}" now serves ${s.live}, but the context froze ${s.frozen}.`
        : `  repository "${s.repo}" no longer serves anything, but the context froze ${s.frozen}.`
    );
  }
  if (withheld) {
    lines.push(`  ${withheld} further repository(ies) this caller may not traverse are also stale (names withheld).`);
  }
  throw new EvalContextError(
    'EVAL_CONTEXT_STALE',
    `the evaluation context "${carrier.context.name}" (version ${carrier.context.version}) names serving ` +
      `graphs that are no longer current:\n${lines.join('\n')}\n` +
      'Refresh the evaluation context (POST /api/okf/eval-contexts/' +
      `${carrier.context.id}/refresh) to measure the current corpus — ask a superadmin to refresh it. ` +
      'A publish in progress also reads this way.',
    409
  );
}

/**
 * The carrier as THIS CALLER may measure it.
 *
 * The catalogue is superadmin-gated because "a context names the
 * repositories a PRINCIPAL traverses" — but the carrier is read on the RUN
 * routes, which are repo-scoped-admin, and the run RECORDS are read-scoped.
 * So the carrier is filtered through the CALLER's own authority, resolved
 * the same way a live caller's is: `resolveGraphSet` (mode + scope + acl,
 * one rule). A superadmin's carrier stands; a repo-scoped admin's carrier is
 * narrowed to what that admin may traverse; an empty intersection is
 * REFUSED rather than answered with the deployment.
 *
 * The snapshot is not rewritten — the stored context still says what it
 * resolved. This is the CARRIER, i.e. what this caller's run measures.
 *
 * ORDER: the staleness gate runs over the carrier's FROZEN rows, BEFORE the
 * narrowing. Narrowing first would drop the repositories this caller may not
 * traverse, and the check would never see a stale one — and the context's
 * hash (over the full frozen set) would no longer describe the measured set.
 *
 * @param {string} contextId
 * @param {{okfScopes?: string[], isSuperAdmin?: boolean}} caller
 */
async function carrierFor(contextId, caller = {}) {
  const carrier = await carrierOf(contextId);
  return narrowCarrier(carrier, caller);
}

/**
 * Narrow a FROZEN carrier to what this caller may measure — the staleness
 * gate, then the authority, then the intersection (refused when empty).
 *
 * The one rule, shared: `carrierFor` and `bindingFor` must never disagree
 * about what a caller may measure.
 */
async function narrowCarrier(carrier, caller = {}, authority = null) {
  const okfScopes = Array.isArray(caller.okfScopes) ? caller.okfScopes : [];
  const isSuperAdmin = !!caller.isSuperAdmin;
  const view = authority || (await resolveGraphSet({ okfScopes, isSuperAdmin }));
  const allowed = new Set((view.repos || []).map((r) => r.repo_id));
  // The staleness gate runs over the carrier's FROZEN rows — BEFORE the
  // narrowing, because narrowing first would drop the repositories this
  // caller may not traverse and the check would never see a stale one. The
  // CALLER'S AUTHORITY is resolved first so the gate can WITHHOLD what is
  // outside their reach: the check still sees it, the refusal does not
  // describe it.
  await assertCarrierCurrent(carrier, allowed);
  const rows = (carrier.repos || []).filter((r) => allowed.has(r.repo_id));
  if (!rows.length) {
    throw new EvalContextError(
      'CARRIER_NOT_TRAVERSABLE',
      allowed.size
        ? `this caller may traverse ${allowed.size} serving repository(ies) and the evaluation context ` +
            'names none of them, so the run would measure nothing this caller may read'
        : 'this caller may traverse no serving repository, so the evaluation context measures ' + 'nothing it can read',
      403
    );
  }
  return {
    ...carrier,
    repo_ids: rows.map((r) => r.repo_id),
    graph_names: rows.map((r) => r.graph_name).filter(Boolean),
    repos: rows,
    // The MEASURED set's own hash — over the repositories this caller may
    // actually measure. The context's own hash is over its FULL frozen set,
    // so the two are DIFFERENT populations after a narrowing, and the record
    // carries both under names that say which is which.
    measured_hash: repoSetHash(rows)
  };
}

/**
 * The BINDING: what a suite minted for this context measures, what it does
 * NOT measure, and the two keys two runs must share to be comparable.
 *
 * Three parts, and the middle one is the load-bearing:
 *
 *   repos    — the MEASURED set (the carrier, narrowed to this caller) with
 *              the head versions the head leg races;
 *   out_set  — the EXCLUDED set: what this caller may read but the context
 *              does NOT name. These are the abstention probes' source — a
 *              query about a repository the evaluated group cannot traverse
 *              must not be routed to the repository under test. It is empty
 *              for a caller who may not read those repositories (a
 *              repo-scoped admin), because a probe that leaks a repository
 *              the caller cannot see is worse than no probe;
 *   the keys — repo_set_hash (the serving set) and head_version_hash (the
 *              head vectors), both over the measured set.
 *
 * @param {string} contextId
 * @param {{okfScopes?: string[], isSuperAdmin?: boolean}} caller
 * @returns {Promise<{context: object, carrier: object, repos: Array, out_set: Array, repo_set_hash: string, head_version_hash: string}>}
 */
async function bindingFor(contextId, caller = {}) {
  const frozen = await carrierOf(contextId);
  const okfScopes = Array.isArray(caller.okfScopes) ? caller.okfScopes : [];
  const isSuperAdmin = !!caller.isSuperAdmin;
  const authority = await resolveGraphSet({ okfScopes, isSuperAdmin });
  const carrier = await narrowCarrier(frozen, caller, authority);

  const frozenIds = new Set(frozen.repo_ids || []);
  const outSet = (authority.repos || []).filter((r) => !frozenIds.has(r.repo_id));

  const db = await dbService.getConnection();
  const versions = await headVersionsFor(db, carrier.repo_ids);
  const repos = (carrier.repos || []).map((r) => ({
    ...r,
    head_version: versions.has(r.repo_id) ? versions.get(r.repo_id) : null
  }));

  return {
    context: carrier.context,
    carrier,
    repos,
    out_set: outSet,
    repo_set_hash: repoSetHash(repos),
    head_version_hash: headVersionHash(repos)
  };
}

module.exports = {
  COLLECTION,
  EvalContextError,
  resolveContext,
  effectiveScopes,
  repoSetHash,
  headVersionHash,
  createContext,
  previewContext,
  listGroups,
  getContext,
  listContexts,
  refreshContext,
  carrierFor,
  bindingFor
};
