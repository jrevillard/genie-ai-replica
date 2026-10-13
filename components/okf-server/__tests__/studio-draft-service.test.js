// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Unit tests for studio-draft-service (Story 10.5 — the resumable wizard
// curation draft). The service is re-required per test (jest.resetModules) so
// its module-level state — the collection sentinel and the sweep throttle
// timestamp — starts clean in each case; both are load-bearing behaviour.

/**
 * Fresh module graph per test: fresh mock db, fresh logger spy, fresh
 * repository-service stub, fresh studio-draft-service.
 */
function loadService() {
  jest.resetModules();
  const db = require('./mocks/arango-mock').createMockDb();
  jest.doMock('../shared-lib/db-connection-service', () => ({
    getConnection: jest.fn(() => Promise.resolve(db))
  }));
  jest.doMock('../services/repository-service', () => ({
    getById: jest.fn(async (repo_id) => ({ repo_id }))
  }));
  jest.doMock('../shared-lib/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
  }));
  const repoService = require('../services/repository-service');
  const logger = require('../shared-lib/logger').logger;
  const service = require('../services/studio-draft-service');
  return { db, service, repoService, logger };
}

const ACTOR = { sub: 'steward-1', name: 'Steward', source_ip: '127.0.0.1' };
const COLLECTION = 'okf_studio_drafts';

/** Wire draft as the Vuex store sends it (flat, camel-free, open map). */
function wireDraft(overrides = {}) {
  return {
    repo_id: 'r1',
    studio_step: 3,
    name: 'El Salvador Agriculture',
    domain: 'agriculture',
    source: 'crawl',
    source_file_id: 'f-42',
    concept_count: 12,
    ...overrides
  };
}

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('studio-draft-service', () => {
  describe('ensureCollection', () => {
    test('creates the collection and ONE persistent index on updated_at, then no-ops', async () => {
      const { db, service } = loadService();
      await service.ensureCollection(db);
      expect(db.createCollection).toHaveBeenCalledWith(COLLECTION);
      const col = db.collection(COLLECTION);
      expect(col.ensureIndex).toHaveBeenCalledWith({ type: 'persistent', fields: ['updated_at'] });
      expect(col.ensureIndex).toHaveBeenCalledTimes(1); // exactly ONE index
      // Second call is gated by the module-level sentinel — no repeat create.
      await service.ensureCollection(db);
      expect(db.createCollection).toHaveBeenCalledTimes(1);
      expect(col.ensureIndex).toHaveBeenCalledTimes(1);
    });

    test('skips creation when the collection already exists', async () => {
      const { db, service } = loadService();
      await db.createCollection(COLLECTION);
      db.createCollection.mockClear(); // only the ensure path's call is under test
      await service.ensureCollection(db);
      expect(db.createCollection).not.toHaveBeenCalled();
    });
  });

  describe('saveDraft → getDraft round-trip', () => {
    test('persists the flat wire draft and reads it back verbatim', async () => {
      const { service } = loadService();
      const put = await service.saveDraft('r1', wireDraft(), { actor: ACTOR });
      expect(put.created).toBe(true);
      expect(put.repo_id).toBe('r1');
      // FLAT wire shape — the frontend reads these off the top level.
      expect(put.draft).toMatchObject({
        name: 'El Salvador Agriculture',
        domain: 'agriculture',
        source: 'crawl',
        source_file_id: 'f-42',
        concept_count: 12,
        studio_step: 3,
        repo_id: 'r1'
      });

      const got = await service.getDraft('r1');
      expect(got.repo_id).toBe('r1');
      expect(got.draft).toEqual(put.draft);
    });

    test('stored shape nests the open map under studio_state with _key === repo_id', async () => {
      const { db, service } = loadService();
      await service.saveDraft('r1', wireDraft(), { actor: ACTOR });
      const stored = db._stores[COLLECTION].r1;
      expect(stored._key).toBe('r1'); // one-draft-per-repo is structural
      expect(stored.repo_id).toBe('r1');
      expect(stored.schema_version).toBe(1);
      expect(stored.updated_by).toBe('steward-1');
      expect(stored.studio_state).toMatchObject({ name: 'El Salvador Agriculture', concept_count: 12 });
      // The wire-visible fields are NOT duplicated into studio_state.
      expect(stored.studio_state).not.toHaveProperty('studio_step');
      expect(stored.studio_state).not.toHaveProperty('repo_id');
      expect(stored.studio_state).not.toHaveProperty('updated_at');
      // And the wire shape never leaks Arango internals.
      expectNoSystemFields(await service.getDraft('r1'));
    });

    test('an unknown key lands in studio_state verbatim (open map — no whitelist)', async () => {
      const { service } = loadService();
      await service.saveDraft('r1', wireDraft({ step_7_selection: { open: 4 }, 'x-odd key': [1, 2] }), {
        actor: ACTOR
      });
      const got = await service.getDraft('r1');
      expect(got.draft.step_7_selection).toEqual({ open: 4 });
      expect(got.draft['x-odd key']).toEqual([1, 2]);
    });

    test("stamps its OWN ISO timestamps — the client's epoch-ms updated_at is ignored", async () => {
      const { db, service } = loadService();
      // The client sends updated_at: Date.now() (epoch ms) — a NUMBER.
      const put = await service.saveDraft('r1', wireDraft({ updated_at: 1750000000000, created_at: 1 }), {
        actor: ACTOR
      });
      expect(typeof put.draft.updated_at).toBe('string');
      expect(put.draft.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(put.draft.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      const stored = db._stores[COLLECTION].r1;
      expect(stored.updated_at).toBe(put.draft.updated_at); // not the client's number
      expect(stored.created_at).toBe(put.draft.created_at);
    });

    test('an epoch-ms field that is NOT reserved survives inside studio_state', async () => {
      const { service } = loadService();
      await service.saveDraft('r1', wireDraft({ last_clicked_at: 1750000000000 }), { actor: ACTOR });
      expect((await service.getDraft('r1')).draft.last_clicked_at).toBe(1750000000000);
    });
  });

  describe('write mechanism — update vs insert (the bug a green jest run hides)', () => {
    test('FIRST save INSERTs, the SECOND updates — save() is never called twice', async () => {
      const { db, service } = loadService();
      await service.saveDraft('r1', wireDraft({ studio_step: 1 }), { actor: ACTOR });
      const col = db.collection(COLLECTION);
      expect(col.save).toHaveBeenCalledTimes(1);
      expect(col.update).toHaveBeenCalledTimes(0);

      const second = await service.saveDraft('r1', wireDraft({ studio_step: 2 }), { actor: ACTOR });
      // save() on an existing _key throws "unique constraint violated" in
      // production; arango-mock silently OVERWRITES, so this asserts the branch
      // rather than the resulting store contents.
      expect(col.save).toHaveBeenCalledTimes(1);
      expect(col.update).toHaveBeenCalledTimes(1);
      expect(second.created).toBe(false);
      expect(second.draft.studio_step).toBe(2);
    });

    test('an update preserves created_at (never re-derived from the client)', async () => {
      const { service } = loadService();
      const first = await service.saveDraft('r1', wireDraft(), { actor: ACTOR });
      await service.saveDraft('r1', wireDraft({ created_at: 'client-lies' }), { actor: ACTOR });
      expect((await service.getDraft('r1')).draft.created_at).toBe(first.draft.created_at);
    });

    test('a re-save replaces studio_state wholesale, it does not deep-merge', async () => {
      const { service } = loadService();
      await service.saveDraft('r1', wireDraft({ stale_key: 'gone' }), { actor: ACTOR });
      const second = await service.saveDraft('r1', wireDraft({ studio_step: 4 }), { actor: ACTOR });
      expect(second.draft.stale_key).toBeUndefined();
    });
  });

  describe('missing draft / missing repo', () => {
    test('no draft yet → {repo_id, draft: null} (NEVER a 404)', async () => {
      const { service } = loadService();
      const got = await service.getDraft('r1');
      expect(got).toEqual({ repo_id: 'r1', draft: null });
    });

    test('a foreign or deleted repo → REPO_NOT_FOUND 404 from the pre-gate', async () => {
      const { service, repoService } = loadService();
      repoService.getById.mockRejectedValue(
        Object.assign(new Error('Repository r1 not found'), { code: 'REPO_NOT_FOUND', status: 404 })
      );
      await expect(service.getDraft('r1')).rejects.toMatchObject({ code: 'REPO_NOT_FOUND', status: 404 });
      await expect(service.saveDraft('r1', wireDraft(), {})).rejects.toMatchObject({
        code: 'REPO_NOT_FOUND',
        status: 404
      });
      await expect(service.clearDraft('r1', {})).rejects.toMatchObject({
        code: 'REPO_NOT_FOUND',
        status: 404
      });
    });

    test('the pre-gate receives the caller authz (anti-enumeration lives there)', async () => {
      const { service, repoService } = loadService();
      const authz = new Set(['r-other']);
      await service.getDraft('r1', { authz });
      expect(repoService.getById).toHaveBeenCalledWith('r1', { authz });
    });
  });

  describe('validation', () => {
    test.each([
      ['a string', 'three'],
      ['a float', 3.5],
      ['out of range (10)', 10],
      ['negative', -1]
    ])('400 VALIDATION_ERROR naming the field and the received type — %s', async (_label, value) => {
      const { service } = loadService();
      await expect(service.saveDraft('r1', wireDraft({ studio_step: value }), {})).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        status: 400
      });
      await expect(service.saveDraft('r1', wireDraft({ studio_step: value }), {})).rejects.toThrow(
        /studio_step.*received string|received number/
      );
    });

    test('studio_step 0 and 9 are the valid bounds; null is allowed', async () => {
      const { service } = loadService();
      await expect(service.saveDraft('r1', wireDraft({ studio_step: 0 }), {})).resolves.toMatchObject({
        draft: { studio_step: 0 }
      });
      await expect(service.saveDraft('r1', wireDraft({ studio_step: 9 }), {})).resolves.toMatchObject({
        draft: { studio_step: 9 }
      });
      await expect(service.saveDraft('r1', wireDraft({ studio_step: null }), {})).resolves.toMatchObject({
        draft: { studio_step: null }
      });
    });

    test('an ABSENT studio_step is stored as null (not an error)', async () => {
      const { service } = loadService();
      const body = wireDraft();
      delete body.studio_step;
      expect((await service.saveDraft('r1', body, {})).draft.studio_step).toBeNull();
    });

    test('400 DRAFT_TOO_LARGE — rejects, never truncates', async () => {
      process.env.OKF_STUDIO_DRAFT_MAX_BYTES = '256';
      const { service } = loadService();
      await expect(service.saveDraft('r1', wireDraft({ blob: 'x'.repeat(512) }), {})).rejects.toMatchObject({
        code: 'DRAFT_TOO_LARGE',
        status: 400
      });
      // Nothing was written — a rejected draft must not half-persist.
      const got = await service.getDraft('r1');
      expect(got.draft).toBeNull();
    });

    test('a draft exactly at the limit is accepted', async () => {
      const { service } = loadService();
      // studio_state is the wire draft minus the reserved keys.
      const state = { name: 'x', domain: 'y', source: 'crawl', source_file_id: 'f', concept_count: 1 };
      process.env.OKF_STUDIO_DRAFT_MAX_BYTES = String(Buffer.byteLength(JSON.stringify(state), 'utf8'));
      await expect(service.saveDraft('r1', { ...state, studio_step: 2 }, {})).resolves.toBeTruthy();
    });
  });

  describe('concurrency — optional optimistic guard', () => {
    test('default is last-write-wins when expected_rev is absent', async () => {
      const { service } = loadService();
      await service.saveDraft('r1', wireDraft({ studio_step: 1 }), { actor: ACTOR });
      const second = await service.saveDraft('r1', wireDraft({ studio_step: 5 }), { actor: ACTOR });
      expect(second.draft.studio_step).toBe(5);
    });

    test('a stale expected_rev → 409 DRAFT_CONFLICT carrying the CURRENT doc', async () => {
      const { service } = loadService();
      await service.saveDraft('r1', wireDraft({ studio_step: 1 }), { actor: ACTOR });
      const err = await service
        .saveDraft('r1', wireDraft({ studio_step: 9, expected_rev: 'stale' }), {})
        .catch((e) => e);
      expect(err).toMatchObject({ code: 'DRAFT_CONFLICT', status: 409 });
      expect(err.details.repo_id).toBe('r1');
      expect(err.details.draft.studio_step).toBe(1); // the current doc, not the rejected write
    });

    test('a MATCHING expected_rev proceeds', async () => {
      const { service } = loadService();
      await service.saveDraft('r1', wireDraft(), { actor: ACTOR }); // mock stamps _rev '1'
      const second = await service.saveDraft('r1', wireDraft({ studio_step: 6, expected_rev: '1' }), {});
      expect(second.created).toBe(false);
      expect(second.draft.studio_step).toBe(6);
    });

    test('expected_rev with nothing stored is ignored, not a conflict', async () => {
      const { service } = loadService();
      const put = await service.saveDraft('r1', wireDraft({ expected_rev: 'whatever' }), {});
      expect(put.created).toBe(true);
    });
  });

  describe('clearDraft', () => {
    test('removes a stored draft', async () => {
      const { db, service } = loadService();
      await service.saveDraft('r1', wireDraft(), { actor: ACTOR });
      const result = await service.clearDraft('r1', { actor: ACTOR });
      expect(result).toEqual({ repo_id: 'r1', deleted: true });
      expect(db._stores[COLLECTION].r1).toBeUndefined();
    });

    test('a missing draft is 200 deleted:false — idempotent, NEVER a 404', async () => {
      const { service } = loadService();
      expect(await service.clearDraft('r1', {})).toEqual({ repo_id: 'r1', deleted: false });
    });

    test('clearing twice stays idempotent', async () => {
      const { service } = loadService();
      await service.saveDraft('r1', wireDraft(), { actor: ACTOR });
      await service.clearDraft('r1', {});
      expect(await service.clearDraft('r1', {})).toEqual({ repo_id: 'r1', deleted: false });
    });
  });

  describe('sweepStaleDrafts — retention', () => {
    /** Program the two AQL passes: pass 1 is the age filter, pass 2 the orphan filter. */
    function programSweep(db, { aged = [], orphans = [] } = {}) {
      db.query.mockImplementation((q) => {
        const text = typeof q === 'string' ? q : String((q && q.query) || '');
        const rows = text.includes('updated_at < @cutoff') ? aged : orphans;
        return Promise.resolve({ all: async () => rows.map((k) => ({ _key: k })) });
      });
    }

    const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

    test('removes an aged draft and KEEPS a fresh one', async () => {
      const { db, service } = loadService();
      const col = db.collection(COLLECTION);
      await col.save({ _key: 'r-old', repo_id: 'r-old', updated_at: daysAgo(45) });
      await col.save({ _key: 'r-new', repo_id: 'r-new', updated_at: daysAgo(1) });
      programSweep(db, { aged: ['r-old'] });

      const result = await service.sweepStaleDrafts();
      expect(result.removed).toBe(1);
      expect(db._stores[COLLECTION]['r-old']).toBeUndefined();
      expect(db._stores[COLLECTION]['r-new']).toBeDefined();
    });

    test('the age cutoff honours OKF_STUDIO_DRAFT_TTL_DAYS', async () => {
      process.env.OKF_STUDIO_DRAFT_TTL_DAYS = '7';
      const { db, service } = loadService();
      programSweep(db, { aged: ['r-old'] });
      const { cutoff } = await service.sweepStaleDrafts();
      const ageDays = (Date.now() - Date.parse(cutoff)) / (24 * 60 * 60 * 1000);
      expect(ageDays).toBeCloseTo(7, 1);
    });

    test('the orphan pass removes a draft whose repo is gone', async () => {
      const { db, service } = loadService();
      await db.collection(COLLECTION).save({ _key: 'r-ghost', repo_id: 'r-ghost', updated_at: daysAgo(0) });
      programSweep(db, { orphans: ['r-ghost'] });
      const result = await service.sweepStaleDrafts();
      expect(result.orphans).toBe(1);
      expect(result.removed).toBe(1);
      expect(db._stores[COLLECTION]['r-ghost']).toBeUndefined();
    });

    test('a draft matched by BOTH passes is removed once', async () => {
      const { db, service } = loadService();
      await db.collection(COLLECTION).save({ _key: 'r-both', repo_id: 'r-both', updated_at: daysAgo(90) });
      programSweep(db, { aged: ['r-both'], orphans: ['r-both'] });
      expect((await service.sweepStaleDrafts()).removed).toBe(1);
    });

    test('is a no-op (and still logs) when nothing is stale', async () => {
      const { db, service, logger } = loadService();
      programSweep(db);
      const result = await service.sweepStaleDrafts();
      expect(result.removed).toBe(0);
      expect(logger.info).toHaveBeenCalledWith(
        'okf.studio_draft.swept',
        expect.objectContaining({ removed: 0, orphans: 0, cutoff: expect.any(String) })
      );
    });

    test('a DB failure is logged and swallowed — the sweep is never fatal', async () => {
      const { service, logger } = loadService();
      const dbService = require('../shared-lib/db-connection-service');
      dbService.getConnection.mockRejectedValue(new Error('arango down'));
      await expect(service.sweepStaleDrafts()).resolves.toMatchObject({ removed: 0 });
      expect(logger.error).toHaveBeenCalledWith(
        'okf.studio_draft.sweep_failed',
        expect.objectContaining({
          error: 'arango down'
        })
      );
    });

    test('a per-key removal failure does not abort the rest of the sweep', async () => {
      const { db, service } = loadService();
      const col = db.collection(COLLECTION);
      await col.save({ _key: 'r-a', updated_at: daysAgo(90) });
      await col.save({ _key: 'r-b', updated_at: daysAgo(90) });
      programSweep(db, { aged: ['r-a', 'r-b'] });
      col.remove.mockImplementation(async (key) => {
        if (key === 'r-a') throw new Error('conflict');
        delete db._stores[COLLECTION][key];
        return { _key: key };
      });
      expect((await service.sweepStaleDrafts()).removed).toBe(1);
      expect(db._stores[COLLECTION]['r-b']).toBeUndefined();
    });
  });

  describe('sweep trigger — boot + throttled-opportunistic', () => {
    test('the FIRST save schedules a sweep; later saves within the interval are throttled', async () => {
      const { service, logger } = loadService();
      await service.saveDraft('r1', wireDraft(), { actor: ACTOR });
      const scheduled = () => logger.info.mock.calls.filter((c) => c[0] === 'okf.studio_draft.sweep_scheduled').length;
      expect(scheduled()).toBe(1); // the first write reaps (idle studio, new process)
      await service.saveDraft('r1', wireDraft({ studio_step: 2 }), { actor: ACTOR });
      await service.saveDraft('r1', wireDraft({ studio_step: 3 }), { actor: ACTOR });
      expect(scheduled()).toBe(1); // throttled — not once per step change
    });

    test('a save NEVER awaits the sweep (the PUT stays fast)', async () => {
      const { db, service } = loadService();
      // A sweep that would take forever if it were on the critical path.
      db.query.mockImplementation(() => new Promise(() => {}));
      // Must resolve despite the query never settling.
      const put = await service.saveDraft('r1', wireDraft(), { actor: ACTOR });
      expect(put.created).toBe(true);
    });
  });

  describe('collection name', () => {
    test('is exactly okf_studio_drafts', () => {
      const { service } = loadService();
      expect(service.DRAFTS_COLLECTION).toBe('okf_studio_drafts');
    });
  });
});

/** The wire shape must never expose Arango system attributes. */
function expectNoSystemFields(result) {
  for (const key of ['_key', '_id', '_rev', 'schema_version', 'updated_by']) {
    expect(result.draft[key]).toBeUndefined();
  }
}
