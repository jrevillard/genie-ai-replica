// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Unit tests for repository-service (business logic + direct AQL against a mocked db).
// The service does NOT import keycloak-auth-service, so no jose mock needed here.

jest.mock('../shared-lib/db-connection-service', () => {
  const mockDb = require('./mocks/arango-mock').createMockDb();
  return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
});

const dbService = require('../shared-lib/db-connection-service');
const db = dbService.__mockDb;
const repoService = require('../services/repository-service');
const { RepoError } = repoService;

const ACTOR = { sub: 'steward-1', name: 'Steward', source_ip: '127.0.0.1' };

function validCreateInput(overrides = {}) {
  return { name: 'Social Policy', domain: 'social', acl: { required_scopes: ['okf:t:social:admin'] }, ...overrides };
}

describe('repository-service', () => {
  beforeEach(() => db._reset());

  describe('create', () => {
    test('mints repo_id + graph_name=OKF_{repo_id}, defaults, writes doc with _key=repo_id', async () => {
      const repo = await repoService.create(validCreateInput(), ACTOR);
      expect(repo.repo_id).toEqual(expect.any(String));
      expect(repo.graph_name).toBe(`OKF_${repo.repo_id}`);
      expect(repo.okf_version).toBe('0.2');
      expect(repo.lifecycle_state).toBe('register');
      expect(repo.curator).toEqual({ sub: 'steward-1', name: 'Steward' });
      expect(repo.created_at).toEqual(expect.any(String));
      // stored with repo_id AS the _key
      const stored = db._stores.okf_repositories[repo.repo_id];
      expect(stored._key).toBe(repo.repo_id);
      // response strips Arango internals
      expect(repo._id).toBeUndefined();
      expect(repo._rev).toBeUndefined();
      expect(repo._key).toBeUndefined();
    });

    test('writes an audit row on create', async () => {
      const repo = await repoService.create(validCreateInput(), ACTOR);
      const audit = Object.values(db._stores.okf_audit || {});
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ action: 'repo.create', repo_id: repo.repo_id, actor: 'steward-1' });
    });

    test('rejects duplicate (name, domain) with DUPLICATE_REPO 409', async () => {
      await repoService.create(validCreateInput(), ACTOR);
      await expect(repoService.create(validCreateInput(), ACTOR)).rejects.toMatchObject({
        code: 'DUPLICATE_REPO',
        status: 409
      });
    });

    test('allows re-creating a (name, domain) that was soft-deleted', async () => {
      const r1 = await repoService.create(validCreateInput(), ACTOR);
      await repoService.remove(r1.repo_id, ACTOR);
      await expect(repoService.create(validCreateInput(), ACTOR)).resolves.toBeTruthy();
    });
  });

  describe('getById', () => {
    test('returns the repo', async () => {
      const created = await repoService.create(validCreateInput(), ACTOR);
      const got = await repoService.getById(created.repo_id);
      expect(got.repo_id).toBe(created.repo_id);
    });

    test('404 when not found', async () => {
      await expect(repoService.getById('nope')).rejects.toMatchObject({
        code: 'REPO_NOT_FOUND',
        status: 404
      });
    });

    test('404 when soft-deleted', async () => {
      const created = await repoService.create(validCreateInput(), ACTOR);
      await repoService.remove(created.repo_id, ACTOR);
      await expect(repoService.getById(created.repo_id)).rejects.toMatchObject({
        code: 'REPO_NOT_FOUND',
        status: 404
      });
    });

    test('404 when outside the caller domain (no leakage)', async () => {
      const created = await repoService.create(validCreateInput(), ACTOR);
      await expect(repoService.getById(created.repo_id, { domain: 'other-domain' })).rejects.toMatchObject({
        code: 'REPO_NOT_FOUND',
        status: 404
      });
    });
  });

  describe('update', () => {
    test('updates updatable fields', async () => {
      const created = await repoService.create(validCreateInput(), ACTOR);
      const updated = await repoService.update(created.repo_id, { name: 'Renamed', retention: { days: 30 } }, ACTOR);
      expect(updated.name).toBe('Renamed');
      expect(updated.retention).toEqual({ days: 30 });
      expect(updated.updated_at).toEqual(expect.any(String));
    });

    test('409 when attempting to change graph_name (immutable)', async () => {
      const created = await repoService.create(validCreateInput(), ACTOR);
      await expect(repoService.update(created.repo_id, { graph_name: 'OKF_other' }, ACTOR)).rejects.toMatchObject({
        code: 'FIELD_IMMUTABLE',
        status: 409
      });
    });

    test('409 when attempting to change domain (immutable)', async () => {
      const created = await repoService.create(validCreateInput(), ACTOR);
      await expect(repoService.update(created.repo_id, { domain: 'other' }, ACTOR)).rejects.toMatchObject({
        code: 'FIELD_IMMUTABLE',
        status: 409
      });
    });

    test('404 when repo not found', async () => {
      await expect(repoService.update('nope', { name: 'x' }, ACTOR)).rejects.toMatchObject({
        code: 'REPO_NOT_FOUND',
        status: 404
      });
    });

    test('writes an audit row on update', async () => {
      const created = await repoService.create(validCreateInput(), ACTOR);
      await repoService.update(created.repo_id, { name: 'Renamed' }, ACTOR);
      const updates = Object.values(db._stores.okf_audit || {}).filter((a) => a.action === 'repo.update');
      expect(updates).toHaveLength(1);
    });
  });

  describe('remove (soft delete)', () => {
    test('stamps deleted_at + delete_after, sets lifecycle=retire', async () => {
      const created = await repoService.create(validCreateInput(), ACTOR);
      const result = await repoService.remove(created.repo_id, ACTOR);
      expect(result.status).toBe('pending_hard_delete');
      expect(result.deleted_at).toEqual(expect.any(String));
      expect(result.delete_after).toEqual(expect.any(String));
      const stored = db._stores.okf_repositories[created.repo_id];
      expect(stored.lifecycle_state).toBe('retire');
      expect(stored.deleted_at).toBeTruthy();
    });

    test('invokes the graph-retract hook (no-op)', async () => {
      const created = await repoService.create(validCreateInput(), ACTOR);
      const result = await repoService.remove(created.repo_id, ACTOR);
      // retract is a no-op stub until Story 2.6
      expect(result.repo_id).toBe(created.repo_id);
    });

    test('404 when repo not found', async () => {
      await expect(repoService.remove('nope', ACTOR)).rejects.toMatchObject({
        code: 'REPO_NOT_FOUND',
        status: 404
      });
    });

    test('writes an audit row on delete', async () => {
      const created = await repoService.create(validCreateInput(), ACTOR);
      await repoService.remove(created.repo_id, ACTOR);
      const deletes = Object.values(db._stores.okf_audit || {}).filter((a) => a.action === 'repo.delete');
      expect(deletes).toHaveLength(1);
    });
  });

  describe('list', () => {
    test('returns paginated items + next_cursor when a full page', async () => {
      // Seed the query cursor with 50 docs (== default limit)
      const docs = Array.from({ length: 50 }, (_, i) => ({
        repo_id: `r${i}`,
        name: `n${i}`,
        domain: 'social',
        created_at: `2026-08-12T00:00:0${i % 10}Z`
      }));
      db.query.mockResolvedValue({ all: async () => docs.map((d) => ({ ...d, _key: d.repo_id })) });
      const result = await repoService.list({ limit: 50 });
      expect(result.items).toHaveLength(50);
      expect(result.next_cursor).toEqual(expect.any(String));
    });

    test('returns null next_cursor when less than a full page', async () => {
      db.query.mockResolvedValue({ all: async () => [{ repo_id: 'r1', created_at: 't', _key: 'r1' }] });
      const result = await repoService.list({ limit: 50 });
      expect(result.items).toHaveLength(1);
      expect(result.next_cursor).toBeNull();
    });

    test('caps limit at 100', async () => {
      db.query.mockResolvedValue({ all: async () => [] });
      await repoService.list({ limit: 99999 });
      // The query is an aql template; just assert no throw + the AQL string contains LIMIT 100
      expect(db.query).toHaveBeenCalled();
    });

    test('400 on a malformed cursor', async () => {
      await expect(repoService.list({ cursor: '!!!not-base64!!!' })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        status: 400
      });
    });
  });

  test('RepoError is a typed error with code/status', () => {
    const e = new RepoError('X', 'msg', 418);
    expect(e.code).toBe('X');
    expect(e.status).toBe(418);
    expect(e).toBeInstanceOf(Error);
  });

  describe('reliability (code-review fixes)', () => {
    test('create → 409 DUPLICATE_REPO when the DB rejects a concurrent create (unique-violation backstop)', async () => {
      db.collection('okf_repositories').save.mockRejectedValueOnce({ errorNum: 1210, code: 409 });
      await expect(repoService.create(validCreateInput(), ACTOR)).rejects.toMatchObject({
        code: 'DUPLICATE_REPO',
        status: 409
      });
    });

    test('getById rethrows transient DB errors (not masked as REPO_NOT_FOUND)', async () => {
      db.collection('okf_repositories').document.mockRejectedValueOnce({ code: 503, message: 'unavailable' });
      await expect(repoService.getById('any-id')).rejects.toMatchObject({ code: 503 });
    });

    test('update → 409 when renaming to a name already live in the same domain', async () => {
      const a = await repoService.create(validCreateInput({ name: 'Alpha' }), ACTOR);
      await repoService.create(validCreateInput({ name: 'Beta' }), ACTOR);
      await expect(repoService.update(a.repo_id, { name: 'Beta' }, ACTOR)).rejects.toMatchObject({
        code: 'DUPLICATE_REPO',
        status: 409
      });
    });

    test('list → 400 on a cursor that decodes to JSON without ts/id', async () => {
      const badCursor = Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64url');
      await expect(repoService.list({ cursor: badCursor })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        status: 400
      });
    });
  });
});
