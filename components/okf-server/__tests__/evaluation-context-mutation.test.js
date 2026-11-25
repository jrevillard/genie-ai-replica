// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// #2061 phase 4 amendment (David, 2026-11-25): evaluation contexts are
// MANAGEABLE — an operator can rename one, add/remove its groups, and
// delete one. Deletion is REFUSED while any test suite is bound to the
// context (the suite's frozen snapshot must never outlive its principal's
// catalogue entry silently).
//
//   1. updateContext: name + principal_refs changes re-resolve, bump the
//      version, and audit; an unreadable membership refuses (the refresh
//      rule — never silently widen to the public corpus).
//   2. deleteContext: refused with the in-use suites NAMED while any suite
//      (head or RAGAS) carries payload.context.id; otherwise removed+audited.
//   3. both routes are superadmin-gated and the pairing is pinned.

jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
jest.mock('../shared-lib/keycloak-auth-service', () => ({ verifyToken: jest.fn() }));
jest.mock('../shared-lib/tracing', () => ({
  withSpan: jest.fn(async (name, fn) => fn({ setAttribute: jest.fn() }))
}));
jest.mock('../shared-lib/db-connection-service', () => {
  const mockDb = require('./mocks/arango-mock').createMockDb();
  return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
});
jest.mock('../services/audit-service', () => ({ writeAudit: jest.fn().mockResolvedValue(null) }));

jest.mock('../services/keycloak-access-service', () => ({
  isConfigured: jest.fn(() => true),
  searchGroups: jest.fn(async () => [
    { id: 'g-a', name: 'group-a' },
    { id: 'g-b', name: 'group-b' },
    { id: 'g-c', name: 'group-c' }
  ]),
  findGroupByName: jest.fn(async (name) => {
    const known = { 'group-a': 'g-a', 'group-b': 'g-b', 'group-c': 'g-c', 'group-ghost': 'g-ghost' };
    return known[name] ? { id: known[name], name } : null;
  }),
  groupRealmRoles: jest.fn(async (groupId) => {
    const roles = {
      'g-a': [{ name: 'okf:t:r-a:read' }],
      'g-b': [{ name: 'okf:t:r-b:read' }],
      'g-c': [{ name: 'okf:t:r-c:read' }],
      // The ghost group EXISTS in the realm directory but its roles read
      // fails — the unreadable-membership shape.
      'g-ghost': null
    };
    if (groupId === 'g-ghost') throw new Error('realm read failed');
    return roles[groupId] || [];
  }),
  groupMembers: jest.fn(async () => ({ members: [], truncated: false }))
}));

const { __mockDb } = require('../shared-lib/db-connection-service');
const retrievalConfigService = require('../services/retrieval-config-service');
const { writeAudit } = require('../services/audit-service');
const evalCtx = require('../services/evaluation-context-service');

function servingRow(repo_id) {
  return {
    repo_id,
    name: repo_id.replace(/^r-/, ''),
    domain: 'general',
    version: 1,
    lifecycle_state: 'publish',
    ingested_at: '2026-11-01T00:00:00Z',
    // FENCED, not public: a public row (acl null) sits in EVERY principal's
    // set, which would make the scoping assertions meaningless.
    acl: { restricted: true }
  };
}

function seedServing(rows) {
  __mockDb.query.mockResolvedValueOnce({ all: async () => rows });
  retrievalConfigService._resetServingCache();
}

describe('#2061 phase-4 amendment: managing an evaluation context', () => {
  beforeEach(() => {
    __mockDb._reset();
    retrievalConfigService._resetServingCache();
    writeAudit.mockClear();
  });

  async function makeContext() {
    seedServing([servingRow('r-a'), servingRow('r-b')]);
    const doc = await evalCtx.createContext(
      { name: 'readers', principal_refs: ['group-a'] },
      { actor: { user_id: 'u-admin' } }
    );
    return doc;
  }

  test('a context can be RENAMED without touching its memberships', async () => {
    const doc = await makeContext();
    const updated = await evalCtx.updateContext(doc._key, { name: 'readers-v2' }, { actor: { user_id: 'u-admin' } });
    expect(updated.name).toBe('readers-v2');
    expect(updated.principal_refs).toEqual(['group-a']);
    expect(updated.version).toBe(doc.version + 1);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'eval_context.update', actor: 'u-admin' })
    );
  });

  test('memberships can be added and removed — the resolution follows, version bumps', async () => {
    const doc = await makeContext();
    seedServing([servingRow('r-a'), servingRow('r-b'), servingRow('r-c')]);
    const updated = await evalCtx.updateContext(
      doc._key,
      { principal_refs: ['group-b', 'group-c'] },
      { actor: { user_id: 'u-admin' } }
    );
    expect(updated.principal_refs).toEqual(['group-b', 'group-c']);
    // The union re-resolved through the one authority: r-b and r-c, not r-a.
    expect(updated.resolved.repos.map((r) => r.repo_id).sort()).toEqual(['r-b', 'r-c']);
    expect(updated.version).toBe(doc.version + 1);
  });

  test('an update naming an unreadable membership is REFUSED — the stored snapshot stands', async () => {
    const doc = await makeContext();
    await expect(
      evalCtx.updateContext(doc._key, { principal_refs: ['group-ghost'] }, { actor: { user_id: 'u-admin' } })
    ).rejects.toMatchObject({ code: 'PRINCIPAL_UNREADABLE', status: 422 });
    const still = await evalCtx.getContext(doc._key);
    expect(still.principal_refs).toEqual(['group-a']);
    expect(still.version).toBe(doc.version);
  });

  test('a delete is REFUSED while any suite is bound to the context — and NAMES the suites', async () => {
    const doc = await makeContext();
    // The in-use guard's query answers with the bound suites.
    __mockDb.query.mockResolvedValueOnce({
      all: async () => [
        { _key: 'rs-1', kind: 'routing_suite', suite_key: 'rs-1', name: 'Head suite A' },
        { _key: 'rx-1', kind: 'ragas_suite', suite_key: 'rx-1', name: 'Benchmark B' }
      ]
    });
    const err = await evalCtx
      .deleteContext(doc._key, { actor: { user_id: 'u-admin' } })
      .catch((e) => e);
    expect(err.code).toBe('CONTEXT_IN_USE');
    expect(err.status).toBe(409);
    // The refusal NAMES what holds the context in place.
    expect(err.message).toContain('Head suite A');
    expect(err.message).toContain('Benchmark B');
    const still = await evalCtx.getContext(doc._key);
    expect(still).toBeTruthy();
  });

  test('a delete with no bound suites removes the context and audits it', async () => {
    const doc = await makeContext();
    __mockDb.query.mockResolvedValueOnce({ all: async () => [] });
    await evalCtx.deleteContext(doc._key, { actor: { user_id: 'u-admin' } });
    await expect(evalCtx.getContext(doc._key)).rejects.toMatchObject({ code: 'CONTEXT_NOT_FOUND', status: 404 });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'eval_context.delete', actor: 'u-admin' })
    );
  });

  test('a rename to a blank name is refused as INVALID_NAME — nothing is written', async () => {
    const doc = await makeContext();
    await expect(
      evalCtx.updateContext(doc._key, { name: '   ' }, { actor: { user_id: 'u-admin' } })
    ).rejects.toMatchObject({ code: 'INVALID_NAME', status: 400 });
    // A non-string name is the same refusal (the type arm, not the blank arm).
    await expect(
      evalCtx.updateContext(doc._key, { name: 42 }, { actor: { user_id: 'u-admin' } })
    ).rejects.toMatchObject({ code: 'INVALID_NAME', status: 400 });
    const still = await evalCtx.getContext(doc._key);
    expect(still.name).toBe('readers');
    expect(still.version).toBe(doc.version);
  });

  test('a malformed membership list is refused as INVALID_REFS — nothing is written', async () => {
    const doc = await makeContext();
    await expect(
      evalCtx.updateContext(doc._key, { principal_refs: 'group-a' }, { actor: { user_id: 'u-admin' } })
    ).rejects.toMatchObject({ code: 'INVALID_REFS', status: 400 });
    // A non-string ELEMENT is the same refusal (the element arm).
    await expect(
      evalCtx.updateContext(doc._key, { principal_refs: ['group-a', 7] }, { actor: { user_id: 'u-admin' } })
    ).rejects.toMatchObject({ code: 'INVALID_REFS', status: 400 });
    const still = await evalCtx.getContext(doc._key);
    expect(still.principal_refs).toEqual(['group-a']);
  });

  test('updating or deleting a context that does not exist says CONTEXT_NOT_FOUND', async () => {
    await expect(evalCtx.updateContext('ghost', { name: 'x' }, { actor: { user_id: 'u-admin' } })).rejects.toMatchObject(
      { code: 'CONTEXT_NOT_FOUND', status: 404 }
    );
    await expect(evalCtx.deleteContext('ghost', { actor: { user_id: 'u-admin' } })).rejects.toMatchObject({
      code: 'CONTEXT_NOT_FOUND',
      status: 404
    });
  });

  // The two new endpoints' HTTP ADAPTER contract: the status code on the
  // happy path and the error handoff to the shared handler on the refusal
  // path (what a supertest against the app would pin — this component's
  // tests reach the controller directly).
  describe('the manage endpoints answer through the controller', () => {
    const controller = require('../controllers/evaluation-context-controller');
    const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

    test('a successful update answers 200 with the updated doc', async () => {
      const doc = await makeContext();
      const r = res();
      await controller.updateContext({ params: { id: doc._key }, body: { name: 'readers-v2' } }, r, jest.fn());
      expect(r.status).toHaveBeenCalledWith(200);
      expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ name: 'readers-v2' }));
      // A request with NO body is a valid no-op update, not a crash — the
      // empty payload bumps the version and changes nothing else.
      const r2 = res();
      await controller.updateContext({ params: { id: doc._key } }, r2, jest.fn());
      expect(r2.status).toHaveBeenCalledWith(200);
      expect(r2.json).toHaveBeenCalledWith(expect.objectContaining({ name: 'readers-v2' }));
    });

    test('a refused update hands the error to the shared handler, not a 200', async () => {
      const doc = await makeContext();
      const r = res();
      const next = jest.fn();
      await controller.updateContext({ params: { id: doc._key }, body: { name: '   ' } }, r, next);
      expect(r.status).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_NAME', status: 400 }));
    });

    test('a delete with no bound suites answers 200; the refusal path hands off too', async () => {
      const doc = await makeContext();
      __mockDb.query.mockResolvedValueOnce({ all: async () => [] });
      const r = res();
      await controller.deleteContext({ params: { id: doc._key } }, r, jest.fn());
      expect(r.status).toHaveBeenCalledWith(200);

      const doc2 = await makeContext();
      __mockDb.query.mockResolvedValueOnce({
        all: async () => [{ _key: 'rs-9', kind: 'routing_suite', suite_key: 'rs-9', name: 'Holder suite' }]
      });
      const r2 = res();
      const next2 = jest.fn();
      await controller.deleteContext({ params: { id: doc2._key } }, r2, next2);
      expect(r2.status).not.toHaveBeenCalled();
      expect(next2).toHaveBeenCalledWith(expect.objectContaining({ code: 'CONTEXT_IN_USE', status: 409 }));
    });
  });

  test('an update that changes nothing still bumps the version — audited, unattributed to system', async () => {
    const doc = await makeContext();
    // No name, no memberships, no actor: the version still moves and the
    // audit row falls back to 'system'.
    const updated = await evalCtx.updateContext(doc._key, {}, {});
    expect(updated.version).toBe(doc.version + 1);
    expect(updated.name).toBe('readers');
    expect(updated.resolved.repos.map((r) => r.repo_id).sort()).toEqual(['r-a']);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'eval_context.update', actor: 'system' })
    );
  });

  test('the manage routes carry the superadmin gate', () => {
    const router = require('../routes/okf-routes');
    const layers = router.stack
      .filter((l) => l.route)
      .map((l) => ({ path: l.route.path, methods: l.route.methods, handlers: l.route.stack.map((h) => h.name) }));
    const update = layers.find((l) => l.path === '/eval-contexts/:id/update');
    const remove = layers.find((l) => l.path === '/eval-contexts/:id' && l.methods.delete);
    expect(update).toBeTruthy();
    expect(remove).toBeTruthy();
    expect(update.handlers).toContain('requireSuperadmin');
    expect(remove.handlers).toContain('requireSuperadmin');
  });
});
