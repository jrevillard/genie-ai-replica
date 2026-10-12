// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// studio-draft-service — Story 10.5 (server half): the OKF Studio wizard's
// RESUMABLE curation draft.
//
// Why this exists: the wizard saves its per-step curation view-state on every
// step change and every step `@update` (store/modules/okf.js saveDraft), but
// that state lived only in the Vuex store. A refresh reopens the wizard at the
// right STEP and throws away everything else — the curation selections, the
// concept being mid-edit, unsaved annotations. That gap is logged as D9 in the
// 2026-10 Story 1-8 analysis ("wizard draft state is volatile"). This service
// is the durable half of the fix.
//
// STORAGE SHAPE vs WIRE SHAPE (the load-bearing distinction). The stored
// document nests the open-ended draft map under `studio_state`:
//
//   { _key, repo_id, studio_step, studio_state, schema_version,
//     created_at, updated_at, updated_by }
//
// but EVERY request and response body is the FLAT wire shape the existing
// frontend already speaks (`{ ...studio_state, repo_id, studio_step,
// created_at, updated_at }`). The frontend reads `draft.name`, `draft.domain`,
// `draft.source`, `draft.source_file_id`, `draft.concept_count` off the top
// level (StudioTab.vue, StudioWizard.vue) and must not be rewritten to reach
// into a nested field. `toWire` / `fromWire` below are therefore MANDATORY, not
// cosmetic: they are the whole reason this endpoint is additive for the client.
//
// ONE DRAFT PER REPO IS STRUCTURAL, NOT A CONVENTION: `_key === repo_id`, so a
// second insert is a unique-constraint violation that ArangoDB enforces for us.
//
// NO AUDIT ROW PER SAVE (StudioWizard saves far more often than the audited
// studio_step PATCH it replaced — see directive G4 in StudioWizard.vue, where
// one audit row per write drowned the Review step's Action log). Ephemeral
// curator working state is not governed content (FR-12 auditability targets
// repos/concepts/versions). Structured `logger.info` instead.

'use strict';

const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');
const dbService = require('../shared-lib/db-connection-service');
const { isArangoNotFound } = require('./arango-errors');
const repositoryService = require('./repository-service');

// ---------- constants ----------

/** FIXED name (design decision 1): no plural/singular drift anywhere. */
const DRAFTS_COLLECTION = 'okf_studio_drafts';

/** Bumped only on a breaking studio_state shape change — never per release. */
const SCHEMA_VERSION = 1;

const STUDIO_STEP_MIN = 0;
const STUDIO_STEP_MAX = 9;

// Defaults live in code (not in `env`) per the project DRY convention; each is
// read FRESH per call so a redeploy-free env change takes effect on restart
// without a module-level freeze (the codebase idiom: parseInt(env || 'x', 10)).
const DEFAULT_MAX_BYTES = 262144; // 256 KiB
const DEFAULT_TTL_DAYS = 30; // matches VICTORIALOGS_RETENTION; > repo-delete grace (168h)
const DEFAULT_SWEEP_INTERVAL_MS = 3600000; // same value as workers/ingestWorker.js DEFAULT_SWEEP_INTERVAL_MS

/**
 * Keys the service OWNS: promoted to top-level fields, server-stamped, or
 * ArangoDB system attributes. Everything else lands in `studio_state` verbatim
 * — deliberately NOT whitelisted. A new wizard step adding a field must not
 * require a server change; the design doc calls per-key whitelisting the
 * "change-request treadmill". `_key`/`_id`/`_rev` are stripped too: they are
 * Arango system attributes, and letting a client plant one inside the wire
 * shape would round-trip a bogus system field back out of `toWire`.
 */
const RESERVED_KEYS = new Set([
  '_key',
  '_id',
  '_rev',
  'repo_id',
  'studio_step',
  'created_at',
  'updated_at',
  'schema_version',
  'expected_rev'
]);

let _draftsCollectionEnsured = false;
let _lastSweepAt = 0;

// ---------- collection bootstrap (head-suite-service pattern) ----------

function maxBytes() {
  const n = parseInt(process.env.OKF_STUDIO_DRAFT_MAX_BYTES || String(DEFAULT_MAX_BYTES), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_BYTES;
}

function ttlDays() {
  const n = parseInt(process.env.OKF_STUDIO_DRAFT_TTL_DAYS || String(DEFAULT_TTL_DAYS), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_DAYS;
}

function sweepIntervalMs() {
  const n = parseInt(process.env.OKF_STUDIO_DRAFT_SWEEP_INTERVAL_MS || String(DEFAULT_SWEEP_INTERVAL_MS), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SWEEP_INTERVAL_MS;
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Create `okf_studio_drafts` on first use with ONE persistent index on
 * `updated_at` (the sweep's only age signal). Mirrors head-suite-service.js
 * ensureCollection — including the module-level sentinel, so the list/create
 * round-trip happens once per process rather than once per draft save.
 *
 * Deliberately NOT registered in db/collections.js: that list is the
 * repos/concepts control-plane bootstrap, and okf_head_test_runs is likewise
 * bootstrapped here rather than there.
 */
async function ensureCollection(db) {
  if (_draftsCollectionEnsured) return;
  logger.info('okf.studio_draft.ensure_collection', { name: DRAFTS_COLLECTION });
  const existing = new Set((await db.listCollections()).map((c) => c.name));
  if (!existing.has(DRAFTS_COLLECTION)) {
    await db.createCollection(DRAFTS_COLLECTION);
    logger.info('okf.studio_draft.collection_created', { name: DRAFTS_COLLECTION });
  }
  const col = db.collection(DRAFTS_COLLECTION);
  const idx = (await col.indexes()).map((i) => i.fields.join(','));
  if (!idx.includes('updated_at')) {
    await col.ensureIndex({ type: 'persistent', fields: ['updated_at'] });
    logger.info('okf.studio_draft.index_ensured', { name: DRAFTS_COLLECTION, fields: ['updated_at'] });
  }
  _draftsCollectionEnsured = true;
}

// ---------- wire <-> storage ----------

/** Stored document → FLAT wire draft (exactly what the frontend already reads). */
function toWire(doc) {
  if (!doc) return null;
  return {
    ...(doc.studio_state || {}),
    repo_id: doc.repo_id || doc._key,
    studio_step: doc.studio_step === undefined ? null : doc.studio_step,
    created_at: doc.created_at || null,
    updated_at: doc.updated_at || null
  };
}

/**
 * FLAT wire draft → the two stored fields. The reserved keys are dropped (the
 * service owns them); everything else becomes `studio_state` as-is.
 * `studio_step` absent → null, which is the honest "not started yet" value and
 * matches the stored field's declared domain.
 */
function fromWire(body) {
  const src = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    logger.warn('okf.studio_draft.body_not_an_object', { received: Array.isArray(body) ? 'array' : typeof body });
  }
  const studio_state = {};
  for (const key of Object.keys(src)) {
    if (RESERVED_KEYS.has(key)) continue;
    studio_state[key] = src[key];
  }
  return {
    studio_step: src.studio_step === undefined ? null : src.studio_step,
    studio_state
  };
}

// ---------- validation ----------

function typeName(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** studio_step must be an integer in [0,9] or null. The message names the field AND the received type. */
function validateStudioStep(value) {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isInteger(value) && value >= STUDIO_STEP_MIN && value <= STUDIO_STEP_MAX) {
    return value;
  }
  const err = new Error(
    `studio_step must be an integer between ${STUDIO_STEP_MIN} and ${STUDIO_STEP_MAX}, or null (received ${typeName(value)})`
  );
  err.code = 'VALIDATION_ERROR';
  err.status = 400;
  throw err;
}

/**
 * REJECT oversized drafts — never truncate. Silently dropping curation
 * view-state is how a steward loses an afternoon of work without being told.
 */
function assertWithinSizeCap(studio_state) {
  const limit = maxBytes();
  const bytes = Buffer.byteLength(JSON.stringify(studio_state), 'utf8');
  if (bytes > limit) {
    logger.warn('okf.studio_draft.too_large', { bytes, limit });
    const err = new Error(
      `studio_state is ${bytes} bytes, over the ${limit} byte draft limit — the client is storing more than a wizard draft should carry`
    );
    err.code = 'DRAFT_TOO_LARGE';
    err.status = 400;
    throw err;
  }
  return bytes;
}

// ---------- internals ----------

async function loadDoc(col, repo_id) {
  try {
    return await col.document(repo_id);
  } catch (err) {
    // Strict arango classification: a transient outage must surface, not be
    // masked as "no draft yet" (arango-errors.js rejects message-regex matching).
    if (!isArangoNotFound(err)) throw err;
    return null;
  }
}

/**
 * 404 REPO_NOT_FOUND for a missing / soft-deleted / out-of-scope repo —
 * identical for all three (repository-service.getById's anti-enumeration rule:
 * never 403, never a distinct code). Also the guard that makes an ORPHAN draft
 * unwritable: a draft is never addressable without a live repo.
 */
async function assertRepoExists(repo_id, authz) {
  await repositoryService.getById(repo_id, { authz });
  logger.info('okf.studio_draft.repo_verified', { repo_id });
}

// ---------- public API ----------

/**
 * GET /api/okf/repos/:repo_id/draft (read scope, inherited from the router).
 *
 * "No draft yet" is 200 `{repo_id, draft: null}` — NEVER 404. The frontend
 * already treats 404 as its NOT_READY signal, so a 404-for-empty would make a
 * brand-new repo permanently indistinguishable from a missing endpoint. With
 * this route shipped, 404 means exactly one thing (the repo is gone or
 * foreign) and 200-with-null means "no draft yet". Precedent:
 * getTopicLinks returns 200 `{success:true, run:null}` for an unrun state.
 */
async function getDraft(repo_id, { authz } = {}) {
  return withSpan('okf.studio_draft.get', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    await assertRepoExists(repo_id, authz);
    const db = await dbService.getConnection();
    await ensureCollection(db);
    const doc = await loadDoc(db.collection(DRAFTS_COLLECTION), repo_id);
    if (!doc) {
      logger.info('okf.studio_draft.get.miss', { repo_id });
      return { repo_id, draft: null };
    }
    logger.info('okf.studio_draft.get.hit', {
      repo_id,
      studio_step: doc.studio_step,
      updated_at: doc.updated_at
    });
    return { repo_id, draft: toWire(doc) };
  });
}

/**
 * PUT /api/okf/repos/:repo_id/draft (admin scope). Upsert — the client treats
 * any 2xx as ok, so a repeat save of unchanged content is a 200, not a 409.
 *
 * WRITE MECHANISM (the bug a green jest run hides): `save()` is an INSERT and
 * throws "unique constraint violated" on an existing `_key` — proven live at
 * head-suite-service.js:1843-1852, where save() on a placeholder destroyed
 * ~60s of completed work and reported every run failed. So: READ first, then
 * `update()` when the doc exists and `save()` when it does not. arango-mock
 * OVERWRITES on save (mocks/arango-mock.js), so a save-twice test passes in jest
 * and fails in production — the unit test asserts the branch via spies.
 *
 * CONCURRENCY: last-write-wins by default. `expected_rev` (the `_rev` the
 * client last saw) opts into an optimistic guard: a stale value is a 409
 * DRAFT_CONFLICT carrying the current doc so the client can decide whether to
 * re-apply. updated_by/updated_at are stamped on every write so a plain-LWW
 * overwrite is still attributable.
 */
async function saveDraft(repo_id, body, { authz, actor } = {}) {
  return withSpan('okf.studio_draft.save', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    await assertRepoExists(repo_id, authz);

    const { studio_step, studio_state } = fromWire(body);
    const step = validateStudioStep(studio_step);
    const bytes = assertWithinSizeCap(studio_state);

    const src = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const expectedRev = typeof src.expected_rev === 'string' ? src.expected_rev : null;

    const db = await dbService.getConnection();
    await ensureCollection(db);
    const col = db.collection(DRAFTS_COLLECTION);
    const existing = await loadDoc(col, repo_id);
    const created = !existing;

    if (expectedRev) {
      if (!existing) {
        // Nothing to compare against — the client saw a doc that is gone.
        // Creating over it is plain LWW, not a conflict.
        logger.info('okf.studio_draft.expected_rev_ignored', {
          repo_id,
          expected_rev: expectedRev,
          reason: 'no stored draft to compare'
        });
      } else if (existing._rev !== expectedRev) {
        logger.info('okf.studio_draft.conflict', {
          repo_id,
          expected_rev: expectedRev,
          current_rev: existing._rev
        });
        const err = new Error(
          `draft was modified by another steward (expected _rev ${expectedRev}, current ${existing._rev})`
        );
        err.code = 'DRAFT_CONFLICT';
        err.status = 409;
        // error-handler.js passes `details` through on client errors, so the
        // current doc reaches the client without a second round-trip.
        err.details = { repo_id, draft: toWire(existing) };
        throw err;
      }
    }

    const stamp = nowIso();
    const actorSub = (actor && actor.sub) || null;

    if (existing) {
      // update() (not save(), not replace()) so created_at is preserved
      // server-side rather than re-derived from an untrusted client field.
      const saved = await col.update(repo_id, {
        studio_step: step,
        studio_state,
        schema_version: SCHEMA_VERSION,
        updated_at: stamp,
        updated_by: actorSub
      });
      logger.info('okf.studio_draft.saved', { repo_id, studio_step: step, bytes, created });
      maybeSweepStaleDrafts();
      return { repo_id, draft: toWire(saved), created };
    }

    const doc = {
      _key: repo_id,
      repo_id,
      studio_step: step,
      studio_state,
      schema_version: SCHEMA_VERSION,
      created_at: stamp,
      updated_at: stamp,
      updated_by: actorSub
    };
    const saved = await col.save(doc);
    logger.info('okf.studio_draft.saved', { repo_id, studio_step: step, bytes, created });
    maybeSweepStaleDrafts();
    return { repo_id, draft: toWire(saved), created };
  });
}

/**
 * DELETE /api/okf/repos/:repo_id/draft (admin scope).
 *
 * Deliberately NOT a purge-all (`DELETE /okf/studio_drafts` is not built here:
 * no such UI action exists, and a collection-wide delete is a footgun that
 * belongs with the 2.9.9 retention worker).
 *
 * Idempotent 200 — a missing draft is `deleted:false`, never a 404, so the
 * frontend's existing `catch -> {ok:true}` stays correct.
 */
async function clearDraft(repo_id, { authz, actor } = {}) {
  return withSpan('okf.studio_draft.clear', async (span) => {
    span.setAttribute('okf.repo_id', repo_id);
    await assertRepoExists(repo_id, authz);
    const db = await dbService.getConnection();
    await ensureCollection(db);
    try {
      await db.collection(DRAFTS_COLLECTION).remove(repo_id);
      logger.info('okf.studio_draft.cleared', {
        repo_id,
        actor: (actor && actor.sub) || null
      });
      return { repo_id, deleted: true };
    } catch (err) {
      if (!isArangoNotFound(err)) throw err;
      logger.info('okf.studio_draft.clear.noop', { repo_id, reason: 'no draft stored' });
      return { repo_id, deleted: false };
    }
  });
}

// ---------- retention ----------

/**
 * Retention sweep: TTL by age + an orphan pass.
 *
 *   AGE — a draft whose `updated_at` is older than OKF_STUDIO_DRAFT_TTL_DAYS
 *   (default 30) is removed. `updated_at` is the SOLE age signal — a
 *   schema_version or studio_state shape change deliberately does not reset the
 *   clock. 30 days is longer than the repo-delete grace (168h) on purpose: a
 *   half-finished curation must survive a month-end, and a draft is a few KB, so
 *   a slow TTL costs storage while an early one costs a steward an afternoon.
 *
 *   ORPHANS — a draft whose `_key` has no live row in okf_repositories. Covers
 *   repos deleted BEFORE this shipped (orphaned on day one) and any future
 *   deletion path that forgets the cascade. One AQL pass bounded by repo count.
 *
 * Auditability: every removal logs the count and the cutoff — a silent sweep is
 * unauditable, the same standard the ingest worker's sweep holds itself to. NO
 * writeAudit row: these are ephemeral curator working state, not governed
 * content (FR-12 targets repos/concepts/versions).
 *
 * Stamps `_lastSweepAt` itself so that BOTH trigger paths (boot one-shot in
 * index.js and the throttled opportunistic call from saveDraft) share one
 * throttle window and a container does not sweep twice within the interval.
 */
async function sweepStaleDrafts() {
  const days = ttlDays();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  let removed = 0;
  let orphans = 0;
  try {
    const db = await dbService.getConnection();
    await ensureCollection(db);
    const col = db.collection(DRAFTS_COLLECTION);

    // Pass 1 — age.
    const ageCursor = await db.query('FOR d IN okf_studio_drafts FILTER d.updated_at < @cutoff RETURN d._key', {
      cutoff
    });
    const aged = await ageCursor.all();

    // Pass 2 — orphans (drafts with no live repo row).
    const orphanCursor = await db.query(
      'FOR d IN okf_studio_drafts ' +
        'LET live = (FOR r IN okf_repositories FILTER r.deleted_at == null RETURN r._key) ' +
        'FILTER !(d._key IN live) RETURN d._key'
    );
    const ghosted = await orphanCursor.all();

    const keys = [...new Set([...aged.map((r) => r._key), ...ghosted.map((r) => r._key)])];
    orphans = ghosted.length;
    for (const key of keys) {
      try {
        await col.remove(key);
        removed += 1;
      } catch (err) {
        // A racing save recreated it, or the TTL/orphan passes both matched it —
        // either way the end state is fine. Never fail the sweep for one key.
        logger.info('okf.studio_draft.sweep.remove_skipped', { repo_id: key, error: err.message });
      }
    }
    logger.info('okf.studio_draft.swept', { removed, cutoff, orphans });
  } catch (err) {
    // Boot sweep and the opportunistic call are both fire-and-forget; a sweep
    // failure must be visible but must never propagate to a caller.
    logger.error('okf.studio_draft.sweep_failed', { error: err.message, cutoff });
  } finally {
    _lastSweepAt = Date.now();
  }
  return { removed, cutoff, orphans };
}

/**
 * Opportunistic, THROTTLED sweep trigger for saveDraft. The throttle is checked
 * BEFORE the work and the call is DETACHED — a slow sweep must never delay a
 * step-change write (the topic-link-authoring-service.js:816 idiom).
 *
 * Boot-only would mean a long-lived container never sweeps; per-write-only
 * would mean a quiet studio never sweeps. Hence both, sharing this one gate.
 */
function maybeSweepStaleDrafts() {
  const now = Date.now();
  if (now - _lastSweepAt < sweepIntervalMs()) return false;
  // Stamped inside sweepStaleDrafts' finally, but a same-tick burst of writes
  // could still queue two runners before the first lands — claim the window now.
  _lastSweepAt = now;
  const runner = sweepStaleDrafts();
  runner.catch(() => {}); // the runner never rejects; belt-and-braces
  logger.info('okf.studio_draft.sweep_scheduled', { interval_ms: sweepIntervalMs() });
  return true;
}

module.exports = {
  DRAFTS_COLLECTION,
  SCHEMA_VERSION,
  ensureCollection,
  getDraft,
  saveDraft,
  clearDraft,
  sweepStaleDrafts,
  maybeSweepStaleDrafts
};
