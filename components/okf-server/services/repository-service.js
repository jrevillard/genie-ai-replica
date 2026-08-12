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
const { retractRepoGraph } = require('./graph-retract-service');

const COLLECTION = 'okf_repositories';

// FR-9 lifecycle states — inlined per story; extract to lifecycle.js in Story 4.3.
const LIFECYCLE_STATES = ['register', 'validate', 'review', 'approve', 'publish', 'version', 'deprecate', 'retire'];
const INITIAL_STATE = 'register';
const DELETE_STATE = 'retire';
const IMMUTABLE_FIELDS = ['graph_name', 'repo_id', 'domain'];
const UPDATABLE_FIELDS = ['name', 'source', 'acl', 'retention'];

// ArangoDB error codes used for control flow.
const ARANGO_NOT_FOUND = (err) => err && (err.code === 404 || err.errorNum === 1204 || err.statusCode === 404);
const ARANGO_UNIQUE_VIOLATION = (err) =>
  err && (err.errorNum === 1210 || err.errorNum === 1185 || err.code === 409 || err.statusCode === 409);

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
 */
async function create(input, actor) {
  return withSpan('okf.repo.create', async (span) => {
    span.setAttribute('okf.operation', 'create');
    span.setAttribute('okf.domain', input.domain);
    logger.info('Creating OKF repository', { name: input.name, domain: input.domain });
    const db = await getDb();

    // App-layer dup-check (clean 409 fast path). firstExample may return a soft-deleted
    // tombstone (deleted_at set) — that does NOT block re-create; the DB index is the
    // authoritative guard for the live-uniqueness invariant.
    const dup = await db.collection(COLLECTION).firstExample({ name: input.name, domain: input.domain });
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
      okf_version: '0.2',
      lifecycle_state: INITIAL_STATE,
      version: null,
      curator: actor ? { sub: actor.sub || null, name: actor.name || null } : null,
      acl: input.acl || {},
      retention: input.retention || null,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
      delete_after: null
    };
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
      action: 'repo.create',
      repo_id,
      source_ip: (actor && actor.source_ip) || null
    });
    recordOp('create', 'success');
    logger.info('OKF repository created', { repo_id, graph_name, domain: input.domain });
    return toResponse(doc);
  });
}

/**
 * List repositories, optionally domain-filtered, cursor-paginated (created_at DESC).
 * @param {object} opts {domain?, cursor?, limit?}
 */
async function list({ domain, cursor, limit } = {}) {
  return withSpan('okf.repo.list', async (span) => {
    span.setAttribute('okf.operation', 'list');
    if (domain) span.setAttribute('okf.domain', domain);
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
    // Sort is created_at DESC, repo_id ASC — so "after the cursor" within the same
    // created_at means repo_id STRICTLY GREATER than the cursor's repo_id.
    const cursorFilter = cursor
      ? aql`FILTER d.created_at < ${cursorTs} OR (d.created_at == ${cursorTs} AND d.repo_id > ${cursorId})`
      : aql``;

    const query = aql`
      FOR d IN ${db.collection(COLLECTION)}
        FILTER d.deleted_at == null
        ${domainFilter}
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
async function getById(repo_id, { domain } = {}) {
  return withSpan('okf.repo.getById', async (span) => {
    span.setAttribute('okf.operation', 'get');
    span.setAttribute('okf.repo_id', repo_id);
    const db = await getDb();
    let doc;
    try {
      doc = await db.collection(COLLECTION).document(repo_id);
    } catch (err) {
      if (!ARANGO_NOT_FOUND(err)) throw err; // transient — surface, don't mask as 404
    }
    if (!doc || doc.deleted_at || (domain && doc.domain !== domain)) {
      recordOp('get', 'not_found');
      throw new RepoError('REPO_NOT_FOUND', `Repository ${repo_id} not found`, 404);
    }
    recordOp('get', 'success');
    return toResponse(doc);
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
      const clash = await db.collection(COLLECTION).firstExample({ name: patch.name, domain: existing.domain });
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
 * Soft-delete: stamp deleted_at + delete_after (grace window), set lifecycle=retire,
 * invoke graph-retract hook (no-op until 2.6). No scheduled sweep (deferred to 4.6).
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

    const graceHours = parseInt(process.env.OKF_DELETE_GRACE_HOURS || '168', 10);
    const ts = nowIso();
    const delete_after = DateTime.now().plus({ hours: graceHours }).toUTC().toISO();
    await db
      .collection(COLLECTION)
      .update(repo_id, { lifecycle_state: DELETE_STATE, deleted_at: ts, delete_after, updated_at: ts });

    // Graph retract — no-op until Story 2.6; never fatal.
    try {
      await retractRepoGraph(repo_id);
    } catch (err) {
      logger.warn('Graph retract failed (non-fatal)', { repo_id, error: err.message });
    }

    await auditService.writeAudit({
      actor: (actor && actor.sub) || 'system',
      action: 'repo.delete',
      repo_id,
      source_ip: (actor && actor.source_ip) || null
    });
    recordOp('delete', 'success');
    logger.info('OKF repository soft-deleted', { repo_id, delete_after });
    return { repo_id, deleted_at: ts, delete_after, status: 'pending_hard_delete' };
  });
}

module.exports = {
  create,
  list,
  getById,
  update,
  remove,
  RepoError,
  LIFECYCLE_STATES
};
