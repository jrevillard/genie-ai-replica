// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Repository CRUD service — business logic + direct AQL via the SHARED
// db-connection-service (components/shared/lib) — no reinvented connection,
// no ORM/repository pattern. The shared service manages the connection lifecycle
// (pooling, self-healing, recovery) and exposes the arangojs Database interface.
// Every method is MELT-instrumented: OTel span (withSpan) + structured log +
// okf_repo_operations_total business counter. Audit rows written on mutations.
// Per ADR-okf-018: same ArangoDB database as the graphs. Repository uniqueness
// on (name, domain) is DB-ENFORCED via a unique index on [name, domain, deleted_at]
// (live docs share deleted_at=null → collide; soft-deleted tombstones have a unique
// timestamp → re-create allowed). repo_id is used AS the document _key.

const { v4: uuidv4 } = require('uuid');
const { DateTime } = require('luxon');
const { aql } = require('arangojs');
const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');
const { getMeter } = require('../shared-lib/metrics');
const auditService = require('./audit-service');
const conformanceService = require('./conformance-service');
const piiService = require('./pii-service');
const { retractRepoGraph } = require('./graph-retract-service');

const COLLECTION = 'okf_repositories';

// FR-9 lifecycle states — inlined per story; extract to lifecycle.js in Story 4.3.
// 'draft' (Story 4.8, design addendum D-V5): a CLONED repository enters 'draft' —
// a fork not yet in the register→…→retire flow. Story 4.3's TRANSITIONS map must
// include a 'draft' entry (noted in the 4.8 scope boundary). Manually-created
// repos keep INITIAL_STATE='register' — two distinct entry states, both valid.
const LIFECYCLE_STATES = [
  'draft',
  'register',
  'validate',
  'review',
  'approve',
  'publish',
  'retracted', // Story #978 lifecycle: a pulled-from-service repo (own lane)
  'version',
  'deprecate',
  'retire'
];
const INITIAL_STATE = 'register';
const IMMUTABLE_FIELDS = ['graph_name', 'repo_id', 'domain'];
const UPDATABLE_FIELDS = ['name', 'source', 'acl', 'retention'];

// ArangoDB error codes used for control flow.
const ARANGO_NOT_FOUND = (err) => err && (err.code === 404 || err.errorNum === 1204 || err.statusCode === 404);
const ARANGO_UNIQUE_VIOLATION = (err) =>
  err && (err.errorNum === 1210 || err.errorNum === 1185 || err.code === 409 || err.statusCode === 409);

/** firstExample that treats a no-match as null (real arangojs + the shared db
 * wrapper THROW "no match"; the unit mock returns null). API smoke test caught
 * this divergence in repo-create's dup-check — a no-match caused a 500. */
function notFoundAsNull(err) {
  return err && (ARANGO_NOT_FOUND(err) || (err.message && /no match|not found/i.test(String(err.message))));
}
async function findExampleOrNull(col, example) {
  try {
    return await col.firstExample(example);
  } catch (err) {
    if (!notFoundAsNull(err)) throw err; // transient — surface, don't mask
    return null;
  }
}

// MELT — OKF business operations counter (no-op when observability is off).
const meter = getMeter();
const opsCounter = meter.createCounter('okf_repo_operations_total', {
  description: 'OKF repository operations (create/list/get/update/delete)'
});

function recordOp(operation, status) {
  try {
    opsCounter.add(1, { operation, status });
  } catch {
    /* meter is a no-op when observability is disabled — ignore */
  }
}

function nowIso() {
  return DateTime.now().toUTC().toISO();
}

// Shared DB connection — cache the RESOLVED proxy (not the promise), mirroring
// gov-chat-backend's chat-history-service. On failure _db stays null, so the next
// call retries (resilient: a transient boot-time outage does NOT permanently wedge
// the service, unlike caching a rejected promise).
let _db = null;
async function getDb() {
  if (_db) return _db;
  _db = await dbService.getConnection('default');
  return _db;
}

class RepoError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Strip Arango internals; repo_id already carries identity (it IS _key). */
function toResponse(doc) {
  if (!doc) return null;
  const out = { ...doc };
  delete out._id;
  delete out._rev;
  delete out._key;
  return out;
}

function encodeCursor(created_at, repo_id) {
  return Buffer.from(JSON.stringify({ ts: created_at, id: repo_id })).toString('base64url');
}

function decodeCursor(cursor) {
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new RepoError('VALIDATION_ERROR', 'Invalid cursor', 400);
  }
  if (!decoded || typeof decoded.ts !== 'string' || typeof decoded.id !== 'string') {
    throw new RepoError('VALIDATION_ERROR', 'Invalid cursor payload', 400);
  }
  return decoded;
}

/**
 * Create a repository: mint repo_id, reserve graph_name=OKF_{repo_id}, bind domain.
 * Uniqueness on (name, domain) is DB-ENFORCED (unique index on [name,domain,deleted_at]);
 * the app-layer check is a clean-error fast path, and save() catches the unique-violation
 * so concurrent creates cannot produce duplicates.
 * @param {object} input {name, domain, source?, acl, retention?}
 * @param {object} actor {sub, name?, source_ip?}
 * @param {object} [opts] ADDITIVE (Story 4.8, R5) — { lifecycle_state?, cloned_from?,
 *        audit_action?, okf_version? }. Defaults reproduce the pre-4.8 behavior
 *        byte-identically ('register', no cloned_from field, audit 'repo.create',
 *        okf_version '0.2') so existing callers are untouched. The clone passes
 *        { lifecycle_state:'draft', cloned_from:{repo_id,version},
 *        audit_action:'repo.clone', okf_version: source.okf_version }.
 */
async function create(input, actor, opts = {}) {
  return withSpan('okf.repo.create', async (span) => {
    span.setAttribute('okf.operation', 'create');
    span.setAttribute('okf.domain', input.domain);
    // Review fix (4.8): the additive opts are a public API surface now — validate
    // them so a typo'd lifecycle_state or malformed cloned_from can never persist
    // an out-of-invariant registry doc (the clone path itself is hardcoded safe).
    if (opts.lifecycle_state != null && !LIFECYCLE_STATES.includes(opts.lifecycle_state)) {
      throw new RepoError(
        'VALIDATION_ERROR',
        `invalid lifecycle_state '${opts.lifecycle_state}' (must be one of ${LIFECYCLE_STATES.join('|')})`,
        400
      );
    }
    if (opts.cloned_from != null && typeof opts.cloned_from.repo_id !== 'string') {
      throw new RepoError('VALIDATION_ERROR', 'cloned_from.repo_id must be a string', 400);
    }
    logger.info('Creating OKF repository', { name: input.name, domain: input.domain });
    const db = await getDb();

    // App-layer dup-check (clean 409 fast path). firstExample may return a soft-deleted
    // tombstone (deleted_at set) — that does NOT block re-create; the DB index is the
    // authoritative guard for the live-uniqueness invariant.
    const dup = await findExampleOrNull(db.collection(COLLECTION), { name: input.name, domain: input.domain });
    if (dup && !dup.deleted_at) {
      recordOp('create', 'duplicate');
      throw new RepoError(
        'DUPLICATE_REPO',
        `Repository "${input.name}" already exists in domain "${input.domain}"`,
        409
      );
    }

    const repo_id = uuidv4();
    const graph_name = `OKF_${repo_id}`;
    const ts = nowIso();
    const doc = {
      _key: repo_id, // repo_id AS the document _key
      repo_id,
      name: input.name,
      domain: input.domain,
      source: input.source || null,
      graph_name,
      okf_version: opts.okf_version || '0.2', // Story 4.8: the clone inherits the source's okf_version (additive; default '0.2')
      lifecycle_state: opts.lifecycle_state || INITIAL_STATE, // Story 4.8: the clone enters 'draft' (additive; default = register)
      version: null,
      curator: actor ? { sub: actor.sub || null, name: actor.name || null } : null,
      acl: input.acl || {},
      retention: input.retention || null,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
      delete_after: null
    };
    // Story 4.8 (D-V5): a clone records its origin lineage. Additive — a regular
    // create carries NO cloned_from field, so its doc shape is byte-identical.
    if (opts.cloned_from) {
      doc.cloned_from = opts.cloned_from;
    }
    try {
      await db.collection(COLLECTION).save(doc);
    } catch (err) {
      // Race-proof backstop: a concurrent create that raced past the app-layer check
      // hits the DB unique index → unique-violation → clean 409.
      if (ARANGO_UNIQUE_VIOLATION(err)) {
        recordOp('create', 'duplicate');
        throw new RepoError(
          'DUPLICATE_REPO',
          `Repository "${input.name}" already exists in domain "${input.domain}"`,
          409
        );
      }
      throw err;
    }
    span.setAttribute('okf.repo_id', repo_id);

    await auditService.writeAudit({
      actor: (actor && actor.sub) || 'system',
      action: opts.audit_action || 'repo.create', // Story 4.8: the clone audits 'repo.clone' (additive)
      repo_id,
      source_ip: (actor && actor.source_ip) || null
    });
    recordOp('create', 'success');
    logger.info('OKF repository created', { repo_id, graph_name, domain: input.domain });
    return toResponse(doc);
  });
}

/**
 * Clone an OKF repository (Story 4.8 — design addendum D-V5 backend semantics).
 * Creates a NEW repository (new repo_id + OKF_{repo_id} graph, unique registry
 * entry, lifecycle_state='draft') whose registry doc records the origin lineage
 * `cloned_from: { repo_id, version }`, then copies the source's okf_concepts_meta
 * rows VERBATIM — the D-V1 ingestion-identity triple (title, bundle_version,
 * content_hash) AND the indexing state (index_status/pii_state/conformance_issues/
 * lifecycle_status/trust_tier/labels/links/frontmatter/sources/created_at) are
 * preserved; `concept_id` is copied AS-IS (never re-derived — the 2.9.3
 * `concepts/`-prefix lesson). The copy is METADATA-ONLY (D-V5 v1 semantics):
 * chunks/edges are NOT copied; content materializes into the clone's OWN graph on
 * re-ingest through the EXISTING write path (2.9.1 orchestrator → 2.9.4 worker →
 * 2.9.6 graph wiring). Because index_status is preserved, an unchanged+indexed
 * concept dedup-skips on the clone's re-ingest (the 4e rule); a MODIFIED concept
 * re-ingests into the clone graph. The SOURCE is never written (isolation).
 * @param {string} source_id — the repository to fork
 * @param {object} [input] { name?, domain?, acl?, source?, retention? } — target
 *        identity overrides (defaults: `<source> (clone)`, source domain/acl)
 * @param {object} [actor] { sub, name?, source_ip? } — audit
 * @returns {Promise<{...repo, cloned_from, copied_concepts}>}
 * @throws RepoError REPO_NOT_FOUND (404) | DUPLICATE_REPO (409)
 */
async function cloneRepository(source_id, input, actor) {
  return withSpan('okf.repo.clone', async (span) => {
    span.setAttribute('okf.operation', 'clone');
    span.setAttribute('okf.source_repo_id', source_id);
    const db = await getDb();

    // Resolve the source — the same getById semantics (404 when missing or
    // soft-deleted; transient DB errors surface, never masked). The controller's
    // authz-aware getById pre-gate ran FIRST (anti-enumeration); this fetch is
    // the authoritative existence check + the derivation fields.
    const source = await getById(source_id);

    // Target identity (D-V5 §8.1): defaults `<source> (clone)` + the source's
    // domain + the source's ACL (a fork keeps the source's access policy). The
    // (name, domain, deleted_at) unique index + create()'s dup-check backstop
    // enforce the D-V2 unique-registry invariant → 409 DUPLICATE_REPO.
    // Review fix (4.8): the fork does NOT inherit the source's external
    // `source` (git/s3 origin + syncSchedule) or `retention` — D-V5 says
    // "upstream updates never propagate automatically"; a clone is an in-app
    // fork with no external origin and its own lifecycle.
    // The derived name is clamped to the 200-char registry bound (a source
    // named at the Joi max would otherwise derive a 209-char name past it).
    const derivedName = String(source.name || '').slice(0, 190) + ' (clone)';
    const target = {
      name: (input && input.name) || derivedName,
      domain: (input && input.domain) || source.domain,
      acl: (input && input.acl) || source.acl || {}
    };

    // New registry entry via the shared create() registry logic — additive opts
    // (lifecycle_state='draft', cloned_from lineage, audit 'repo.clone',
    // okf_version from the source).
    const clone = await create(target, actor, {
      lifecycle_state: 'draft',
      cloned_from: { repo_id: source_id, version: source.version != null ? source.version : null },
      audit_action: 'repo.clone',
      okf_version: source.okf_version || '0.2'
    });

    // Copy the source's concepts + meta VERBATIM into the clone's repo. The
    // (repo_id, concept_id) unique index guards each inserted row. Bounded: a
    // source's concept set is ingest-capped (OKF_INGEST_MAX_CONCEPTS per ingest),
    // so the sequential copy is bounded per-repo in practice (review note).
    // COMPENSATION (review fix, 4.8): create() commits the registry entry before
    // the copy — a mid-copy failure must NEVER leave an orphaned partial fork.
    // On any error we hard-delete the fresh registry doc + any copied rows and
    // rethrow (with a clone failure metric), so a retry starts clean.
    const metaCol = db.collection('okf_concepts_meta');
    let copied = 0;
    try {
      const sourceRows = await (
        await db.query('FOR m IN okf_concepts_meta FILTER m.repo_id == @source_id RETURN m', { source_id })
      ).all();
      const ts = nowIso();
      for (const row of sourceRows) {
        const copy = { ...row };
        delete copy._key;
        delete copy._id;
        delete copy._rev;
        copy.repo_id = clone.repo_id;
        copy.graph_name = `OKF_${clone.repo_id}`;
        copy.updated_at = ts; // created_at preserved (the content's origin lineage)
        await metaCol.save(copy);
        copied += 1;
      }
    } catch (err) {
      try {
        await db.collection(COLLECTION).remove(clone.repo_id);
        await db.query('FOR m IN okf_concepts_meta FILTER m.repo_id == @clone_id REMOVE m IN okf_concepts_meta', {
          clone_id: clone.repo_id
        });
        logger.warn('OKF clone compensated (rolled back partial fork)', { source_id, repo_id: clone.repo_id });
      } catch (cleanupErr) {
        logger.error('OKF clone compensation cleanup failed', {
          source_id,
          repo_id: clone.repo_id,
          error: cleanupErr.message
        });
      }
      recordOp('clone', 'error');
      throw err;
    }

    span.setAttribute('okf.clone.repo_id', clone.repo_id);
    span.setAttribute('okf.clone.copied_concepts', copied);
    recordOp('clone', 'success');
    logger.info('OKF repository cloned', { source_id, repo_id: clone.repo_id, copied_concepts: copied });
    return { ...clone, copied_concepts: copied };
  });
}

/**
 * List repositories, optionally domain-filtered, cursor-paginated (created_at DESC).
 * @param {object} opts {domain?, cursor?, limit?}
 */
/**
 * List repositories. Default-deny (Story 6.1): `authz` is a Set of authorized
 * repo_ids (empty ⇒ NOTHING — never the full catalog) or null/absent ⇒
 * unrestricted (super-admin / internal callers). Any other type THROWS —
 * a wrong-typed authz must never fail open to unrestricted (review fix).
 * @param {object} opts { domain?, authz?: Set<string>|null, cursor?, limit? }
 */
async function list({ domain, authz, cursor, limit } = {}) {
  return withSpan('okf.repo.list', async (span) => {
    span.setAttribute('okf.operation', 'list');
    if (domain) span.setAttribute('okf.domain', domain);
    if (authz != null && !(authz instanceof Set)) {
      throw new RepoError('AUTHZ_TYPE_ERROR', 'authz must be a Set of repo_ids or null', 500);
    }
    // Default-deny (Story 6.1, G3): an EMPTY authorized set sees NOTHING —
    // short-circuit before the query; it must never fall through to the full
    // catalog. authz = null/absent ⇒ unrestricted (super-admin / internal).
    if (authz instanceof Set && authz.size === 0) {
      span.setAttribute('okf.result_count', 0);
      recordOp('list', 'success');
      logger.info('OKF repositories listed (empty authorized set)', { count: 0 });
      return { items: [], next_cursor: null };
    }
    const db = await getDb();

    const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 50, 100));
    let cursorTs = null;
    let cursorId = null;
    if (cursor) {
      const c = decodeCursor(cursor);
      cursorTs = c.ts;
      cursorId = c.id;
    }

    const domainFilter = domain ? aql`FILTER d.domain == ${domain}` : aql``;
    const authzFilter = authz instanceof Set ? aql`FILTER d.repo_id IN ${[...authz]}` : aql``;
    // Sort is created_at DESC, repo_id ASC — so "after the cursor" within the same
    // created_at means repo_id STRICTLY GREATER than the cursor's repo_id.
    const cursorFilter = cursor
      ? aql`FILTER d.created_at < ${cursorTs} OR (d.created_at == ${cursorTs} AND d.repo_id > ${cursorId})`
      : aql``;

    const query = aql`
      FOR d IN ${db.collection(COLLECTION)}
        FILTER d.deleted_at == null
        ${domainFilter}
        ${authzFilter}
        ${cursorFilter}
        SORT d.created_at DESC, d.repo_id ASC
        LIMIT ${safeLimit}
        RETURN d
    `;
    const result = await db.query(query);
    const docs = await result.all();
    const items = docs.map(toResponse);
    const next_cursor =
      items.length === safeLimit && items.length > 0
        ? encodeCursor(items[items.length - 1].created_at, items[items.length - 1].repo_id)
        : null;
    span.setAttribute('okf.result_count', items.length);
    recordOp('list', 'success');
    logger.info('OKF repositories listed', { count: items.length, domain: domain || 'all' });
    return { items, next_cursor };
  });
}

/**
 * Read one repository by repo_id. Domain-scoped callers get 404 for foreign repos
 * (avoid leakage; ADR-okf-006 philosophy). Transient DB errors are NOT masked as 404.
 * @param {string} repo_id
 * @param {object} opts {domain?}
 */
/**
 * Read one repository by repo_id. Domain-scoped callers get 404 for foreign repos
 * (avoid leakage; ADR-okf-006 philosophy). Transient DB errors are NOT masked as 404.
 * `authz` (Story 6.1): Set of authorized repo_ids — a repo outside the set 404s
 * identically to a missing one (anti-enumeration). null/absent ⇒ unrestricted;
 * any other type THROWS (never fail open — review fix).
 * @param {string} repo_id
 * @param {object} opts {domain?, authz?: Set<string>|null}
 */
async function getById(repo_id, { domain, authz } = {}) {
  return withSpan('okf.repo.getById', async (span) => {
    span.setAttribute('okf.operation', 'get');
    span.setAttribute('okf.repo_id', repo_id);
    if (authz != null && !(authz instanceof Set)) {
      throw new RepoError('AUTHZ_TYPE_ERROR', 'authz must be a Set of repo_ids or null', 500);
    }
    const db = await getDb();
    let doc;
    try {
      doc = await db.collection(COLLECTION).document(repo_id);
    } catch (err) {
      if (!ARANGO_NOT_FOUND(err)) throw err; // transient — surface, don't mask as 404
    }
    // authz (Story 6.1): a repo outside the caller's authorized set is
    // indistinguishable from a missing one (same 404 — anti-enumeration).
    const outsideAuthz = authz instanceof Set && !authz.has(repo_id);
    if (!doc || doc.deleted_at || (domain && doc.domain !== domain) || outsideAuthz) {
      recordOp('get', 'not_found');
      throw new RepoError('REPO_NOT_FOUND', `Repository ${repo_id} not found`, 404);
    }
    recordOp('get', 'success');
    const repo = toResponse(doc);
    try {
      repo.metrics = await conformanceService.getRepoMetrics(repo_id);
    } catch (err) {
      logger.warn('Failed to compute repo metrics (non-fatal)', { repo_id, error: err.message });
      repo.metrics = null;
    }
    // FR-28: stable document references (doc-repo view/download URLs) for the
    // repo's uploaded files. Non-fatal — a doc-repo blip must not 404 the repo.
    try {
      repo.document_references = await piiService.getRepoDocumentReferences(repo_id);
    } catch (err) {
      logger.warn('Failed to list document references (non-fatal)', { repo_id, error: err.message });
      repo.document_references = [];
    }
    return repo;
  });
}

/**
 * Partial update of updatable fields only. graph_name/repo_id/domain are immutable.
 * Renaming to a name that already exists (live) in the same domain is rejected 409.
 * @param {string} repo_id
 * @param {object} patch subset of {name, source, acl, retention}
 * @param {object} actor
 */
async function update(repo_id, patch, actor) {
  return withSpan('okf.repo.update', async (span) => {
    span.setAttribute('okf.operation', 'update');
    span.setAttribute('okf.repo_id', repo_id);
    const db = await getDb();

    const attempted = IMMUTABLE_FIELDS.filter((f) => Object.prototype.hasOwnProperty.call(patch, f));
    if (attempted.length) {
      recordOp('update', 'immutable');
      throw new RepoError('FIELD_IMMUTABLE', `Immutable fields cannot be changed: ${attempted.join(', ')}`, 409);
    }

    let existing;
    try {
      existing = await db.collection(COLLECTION).document(repo_id);
    } catch (err) {
      if (!ARANGO_NOT_FOUND(err)) throw err;
    }
    if (!existing || existing.deleted_at) {
      recordOp('update', 'not_found');
      throw new RepoError('REPO_NOT_FOUND', `Repository ${repo_id} not found`, 404);
    }

    // If renaming, reject collision with another LIVE repo in the same domain.
    if (Object.prototype.hasOwnProperty.call(patch, 'name') && patch.name !== existing.name) {
      const clash = await findExampleOrNull(db.collection(COLLECTION), { name: patch.name, domain: existing.domain });
      if (clash && !clash.deleted_at && clash.repo_id !== repo_id) {
        recordOp('update', 'duplicate');
        throw new RepoError(
          'DUPLICATE_REPO',
          `Repository "${patch.name}" already exists in domain "${existing.domain}"`,
          409
        );
      }
    }

    const setFields = {};
    for (const f of UPDATABLE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(patch, f)) setFields[f] = patch[f];
    }
    setFields.updated_at = nowIso();
    try {
      await db.collection(COLLECTION).update(repo_id, setFields);
    } catch (err) {
      // Race-proof backstop for the rename dup-check (DB unique index on [name,domain,deleted_at]).
      if (ARANGO_UNIQUE_VIOLATION(err)) {
        recordOp('update', 'duplicate');
        throw new RepoError('DUPLICATE_REPO', `Repository name already exists in this domain`, 409);
      }
      throw err;
    }

    await auditService.writeAudit({
      actor: (actor && actor.sub) || 'system',
      action: 'repo.update',
      repo_id,
      source_ip: (actor && actor.source_ip) || null
    });
    recordOp('update', 'success');
    logger.info('OKF repository updated', { repo_id, fields: Object.keys(setFields) });
    const refreshed = await db.collection(COLLECTION).document(repo_id);
    return toResponse(refreshed);
  });
}

/**
 * Delete a repository — CLEANS EVERYTHING UP (David, 2026-08-18): the cascade
 * retract (per-repo graph drop + meta rows + dangling files docs + version
 * manifests) AND the registry entry itself are removed — no lingering tombstone.
 * The `delete_after` grace metadata is retained in the response for the audit
 * trail, but deletion is immediate (the soft-delete grace window is superseded;
 * re-create of the same (name, domain) is allowed because the doc is gone).
 * @param {string} repo_id
 * @param {object} actor
 */
async function remove(repo_id, actor) {
  return withSpan('okf.repo.delete', async (span) => {
    span.setAttribute('okf.operation', 'delete');
    span.setAttribute('okf.repo_id', repo_id);
    const db = await getDb();

    let existing;
    try {
      existing = await db.collection(COLLECTION).document(repo_id);
    } catch (err) {
      if (!ARANGO_NOT_FOUND(err)) throw err;
    }
    if (!existing || existing.deleted_at) {
      recordOp('delete', 'not_found');
      throw new RepoError('REPO_NOT_FOUND', `Repository ${repo_id} not found`, 404);
    }

    // Story #978 lifecycle (David, 2026-08-28): an INGESTED repository is
    // serving content — deletion is blocked until the steward retracts it
    // (retract clears ingested_at; then delete is allowed and cascades fully).
    if (existing.ingested_at) {
      recordOp('delete', 'ingested-block');
      throw new RepoError(
        'INGESTED_DELETE_BLOCKED',
        'repository has an ingested version — retract it before deleting',
        409
      );
    }

    const graceHours = parseInt(process.env.OKF_DELETE_GRACE_HOURS || '168', 10);
    const ts = nowIso();
    const delete_after = DateTime.now().plus({ hours: graceHours }).toUTC().toISO();

    // Cascade retract FIRST — retractRepoGraph reads the registry doc for the
    // graph_name, so the registry entry must still exist while it runs. It drops
    // the per-repo graph (definition + 4 collections) + the repo's meta rows +
    // dangling files docs + version manifests. Never fatal (best-effort).
    try {
      await retractRepoGraph(repo_id);
    } catch (err) {
      logger.warn('Graph retract failed (non-fatal)', { repo_id, error: err.message });
    }

    // Then remove the registry entry entirely — the delete service cleans
    // everything up (no tombstone). Re-create of the same identity is now
    // allowed (no unique-index tombstone collision).
    await db.collection(COLLECTION).remove(repo_id);

    await auditService.writeAudit({
      actor: (actor && actor.sub) || 'system',
      action: 'repo.delete',
      repo_id,
      source_ip: (actor && actor.source_ip) || null
    });
    recordOp('delete', 'success');
    logger.info('OKF repository deleted (fully cleaned)', { repo_id });
    return { repo_id, deleted_at: ts, delete_after, status: 'deleted' };
  });
}

module.exports = {
  create,
  cloneRepository,
  list,
  getById,
  update,
  remove,
  RepoError,
  LIFECYCLE_STATES
};
