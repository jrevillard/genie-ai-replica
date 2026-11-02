// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Coverage for access-controller's aggregation and grant/revoke shapes that
// the routes suite (Story 6-1c) does not reach: holder merging across
// levels, the role-never-created 404 continues, grant-by-search worker
// failures, the KEYCLOAK_FORBIDDEN translation and the restriction toggle.

jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
jest.mock('../shared-lib/db-connection-service', () => {
  const mockDb = require('./mocks/arango-mock').createMockDb();
  return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
});
jest.mock('../services/audit-service', () => ({ writeAudit: jest.fn().mockResolvedValue(null) }));
jest.mock('../services/keycloak-access-service', () => ({
  isConfigured: jest.fn(() => true),
  usersWithAttribute: jest.fn(async () => []),
  roleMembers: jest.fn(async () => ({ users: [], groups: [] })),
  searchUsers: jest.fn(async () => []),
  countUsers: jest.fn(async () => 0),
  findUserByUsername: jest.fn(),
  usersMatching: jest.fn(async () => []),
  userScopes: jest.fn(() => []),
  setUserScopes: jest.fn(),
  ensureRole: jest.fn(),
  ensureGroup: jest.fn(),
  findGroupByName: jest.fn(),
  setGroupRole: jest.fn()
}));

const mockDb = require('../shared-lib/db-connection-service').__mockDb;
const kc = require('../services/keycloak-access-service');
const controller = require('../controllers/access-controller');

const REPO = 'acc-0000-0000-0000-000000000001';
const notFound = () => {
  const e = new Error('Could not find role');
  e.statusCode = 404;
  return e;
};

const fakeReq = (over = {}) => ({
  params: { repo_id: REPO, ...(over.params || {}) },
  body: over.body || {},
  query: over.query || {},
  user: { sub: 'u1', preferred_username: 'alice' },
  ip: '1.2.3.4',
  okfIsSuperAdmin: true
});

const fakeRes = () => {
  const res = { statusCode: 0, body: undefined };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
};

async function drive(handler, over = {}) {
  const req = fakeReq(over);
  const res = fakeRes();
  const next = jest.fn();
  await handler(req, res, next);
  return { req, res, next };
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockDb._reset();
  kc.isConfigured.mockReturnValue(true);
  await mockDb.collection('okf_repositories').save({ repo_id: REPO, name: 'R' });
});

describe('access-controller.getAccess — server-side holder aggregation', () => {
  test('a user holding BOTH levels is ONE row with both; groups merge the same way', async () => {
    kc.usersWithAttribute.mockImplementation(async (scope) =>
      scope.endsWith(':admin') ? [{ id: 'u9', username: 'admin-user' }] : [{ id: 'u9', username: 'admin-user' }]
    );
    kc.roleMembers.mockImplementation(async (scope) =>
      scope.endsWith(':admin')
        ? { users: [], groups: [{ id: 'g1', name: 'curators' }] }
        : { users: [{ id: 'u9', username: 'admin-user' }], groups: [{ id: 'g1', name: 'curators' }] }
    );
    const { res } = await drive(controller.getAccess);
    expect(res.statusCode).toBe(200);
    const userRow = res.body.user_holders.find((h) => h.user_id === 'u9');
    expect(userRow.levels.sort()).toEqual(['admin', 'read']); // attribute + role legs merged
    const groupRow = res.body.group_holders.find((h) => h.group_id === 'g1');
    expect(groupRow.levels.sort()).toEqual(['admin', 'read']);
  });

  test('a role that was never created is EMPTY members on BOTH legs, not an error', async () => {
    // clearAllMocks does NOT drop implementations set by earlier tests —
    // reset the attribute search back to its empty default explicitly.
    kc.usersWithAttribute.mockReset().mockResolvedValue([]);
    kc.roleMembers.mockReset().mockRejectedValue(notFound());
    const { res, next } = await drive(controller.getAccess);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.user_holders).toEqual([]);
    expect(res.body.group_holders).toEqual([]);
  });

  test('an unconfigured facility reports the panel read model with no holders', async () => {
    kc.isConfigured.mockReturnValue(false);
    const { res } = await drive(controller.getAccess);
    expect(res.statusCode).toBe(200);
    expect(res.body.user_holders).toEqual([]);
    expect(kc.usersWithAttribute).not.toHaveBeenCalled();
  });

  test('a missing repo is a 404 AccessError', async () => {
    const { res, next } = await drive(controller.getAccess, { params: { repo_id: 'ghost' } });
    expect(res.statusCode).toBe(0);
    expect(next).toHaveBeenCalledWith(expect.objectMatching ? expect.anything() : expect.anything());
    expect(next.mock.calls[0][0]).toMatchObject({ code: 'REPO_NOT_FOUND', status: 404 });
  });
});

describe('access-controller.getAccessUsers — the grant picker directory', () => {
  test('has_access merges attribute holders with role members; empty query has no total', async () => {
    kc.usersWithAttribute.mockResolvedValueOnce([{ id: 'u1', username: 'holder' }]);
    kc.roleMembers.mockResolvedValueOnce({ users: [{ id: 'u2', username: 'via-role' }], groups: [] });
    kc.searchUsers.mockResolvedValueOnce([
      { id: 'u1', username: 'holder' },
      { id: 'u3', username: 'plain' }
    ]);
    const { res } = await drive(controller.getAccessUsers, { query: { q: 'hol' } });
    expect(res.statusCode).toBe(200);
    expect(res.body.total_matching).toBe(0); // countUsers mocked 0
    const byName = Object.fromEntries(res.body.users.map((u) => [u.username, u.has_access]));
    expect(byName).toEqual({ holder: true, plain: false });
  });

  test('a never-created read role contributes no holders; empty q keeps total_matching null', async () => {
    kc.roleMembers.mockRejectedValue(notFound());
    const { res } = await drive(controller.getAccessUsers, { query: {} });
    expect(res.statusCode).toBe(200);
    expect(res.body.total_matching).toBeNull();
    expect(kc.countUsers).not.toHaveBeenCalled();
  });
});

describe('access-controller.putAccess — the restriction toggle (6-1c)', () => {
  test('merges restricted into the existing ACL and audits', async () => {
    const { res } = await drive(controller.putAccess, { body: { restricted: true } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, restricted: true });
    const [, patch] = mockDb.collection('okf_repositories').update.mock.calls[0];
    expect(patch.acl).toMatchObject({ restricted: true });
  });

  test('restricted is required', async () => {
    const { res, next } = await drive(controller.putAccess, { body: {} });
    expect(res.statusCode).toBe(0);
    expect(next).toHaveBeenCalled();
  });
});

describe('access-controller.grantAccess — the three shapes', () => {
  test('usernames[] grants found users and 404s only when NOTHING was granted', async () => {
    kc.findUserByUsername.mockImplementation(async (u) => (u === 'ghost' ? null : { id: 'u1', username: u }));
    const { res } = await drive(controller.grantAccess, {
      body: { usernames: ['alice', 'ghost'], level: 'admin' }
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, granted: ['alice'], missing: ['ghost'], level: 'admin' });
    expect(kc.setUserScopes).toHaveBeenCalledWith({ id: 'u1', username: 'alice' }, ['okf:t:' + REPO + ':admin']);
  });

  test('grant-by-search reports per-user failures without failing the batch', async () => {
    kc.usersMatching.mockResolvedValue([
      { id: 'u1', username: 'ok-one' },
      { id: 'u2', username: 'bad-one' }
    ]);
    kc.userScopes.mockReturnValue([]);
    kc.setUserScopes.mockImplementation(async (user) => {
      if (user.username === 'bad-one') throw new Error('attr write failed');
    });
    const { res } = await drive(controller.grantAccess, { body: { query: 'agri' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, granted: 1, failed: ['bad-one'], matched: 2 });
  });

  test('an unconfigured facility is a 503 ACCESS_CONTROL_UNCONFIGURED', async () => {
    kc.isConfigured.mockReturnValue(false);
    const { res, next } = await drive(controller.grantAccess, { body: { usernames: ['a'] } });
    expect(res.statusCode).toBe(0);
    expect(next.mock.calls[0][0]).toMatchObject({ code: 'ACCESS_CONTROL_UNCONFIGURED', status: 503 });
  });
});

describe('access-controller.revokeAccess — scope-stripping', () => {
  test('removes only THIS repo’s scopes; unknown users land in missing', async () => {
    kc.findUserByUsername.mockImplementation(async (u) => (u === 'ghost' ? null : { id: 'u1', username: u }));
    kc.userScopes.mockReturnValue(['okf:t:' + REPO + ':read', 'okf:t:other-repo:read', 'unrelated']);
    const { res } = await drive(controller.revokeAccess, { body: { usernames: ['alice', 'ghost'] } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, revoked: ['alice'], missing: ['ghost'] });
    expect(kc.setUserScopes).toHaveBeenCalledWith({ id: 'u1', username: 'alice' }, [
      'okf:t:other-repo:read',
      'unrelated'
    ]);
  });
});

describe('access-controller group grants', () => {
  test('a Keycloak 502 on the role/group operation becomes KEYCLOAK_FORBIDDEN', async () => {
    const e = new Error('service account token failed: role create refused');
    e.statusCode = 502;
    kc.ensureRole.mockRejectedValue(e);
    const { res, next } = await drive(controller.grantGroupAccess, { body: { group: 'curators' } });
    expect(res.statusCode).toBe(0);
    expect(next.mock.calls[0][0]).toMatchObject({ code: 'KEYCLOAK_FORBIDDEN', status: 502 });
    expect(next.mock.calls[0][0].message).toContain('realm-management');
  });

  test('revoke-group skips missing roles and groups, removes what it finds (both levels when omitted)', async () => {
    kc.ensureRole.mockImplementation(async (scope) => {
      if (scope.endsWith(':admin')) throw notFound(); // the admin role was never created
      return { id: 'r1', name: scope };
    });
    kc.findGroupByName.mockResolvedValue({ id: 'g1', name: 'curators' });
    const { res } = await drive(controller.revokeGroupAccess, { body: { group: 'curators' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, removed: ['read'] }); // admin role never existed
    expect(kc.setGroupRole).toHaveBeenCalledWith(
      { id: 'g1', name: 'curators' },
      { id: 'r1', name: 'okf:t:' + REPO + ':read' }, // the FULL representation the endpoint needs
      false
    );
  });
});
