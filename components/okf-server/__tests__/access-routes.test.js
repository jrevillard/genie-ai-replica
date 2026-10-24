// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 6-1c — HTTP-layer tests for the access-control admin facility at
// ENTERPRISE SCALE: bulk user grants, group grants via roles, SERVER-SIDE
// holder search (no realm listing). Pattern: retrieval-config-routes.test.js.

jest.mock('../shared-lib/keycloak-auth-service', () => ({ verifyToken: jest.fn() }));
jest.mock('../services/audit-service', () => ({ writeAudit: jest.fn().mockResolvedValue(null) }));
jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
jest.mock('../shared-lib/db-connection-service', () => {
  const mockDb = require('./mocks/arango-mock').createMockDb();
  return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
});
jest.mock('../shared-lib/tracing', () => ({
  withSpan: jest.fn(async (name, fn) => fn({ setAttribute: jest.fn() }))
}));
jest.mock('../services/keycloak-access-service', () => ({
  isConfigured: jest.fn(() => true),
  findUserByUsername: jest.fn(),
  searchUsers: jest.fn(async () => []),
  searchGroups: jest.fn(async () => []),
  countUsers: jest.fn(async () => 0),
  usersMatching: jest.fn(async () => []),
  usersWithAttribute: jest.fn(async () => []),
  ensureRole: jest.fn(async (scope) => ({ id: 'role-' + scope, name: scope })),
  ensureGroup: jest.fn(async (name) => ({ id: 'grp-' + name, name })),
  findGroupByName: jest.fn(async (name) => ({ id: 'grp-' + name, name })),
  setGroupRole: jest.fn(),
  roleMembers: jest.fn(async () => ({ users: [], groups: [] })),
  userScopes: jest.fn((u) => (u && u.attributes && u.attributes.okf_scopes) || []),
  setUserScopes: jest.fn(),
  _clearTokenCache: jest.fn()
}));

const request = require('supertest');
const { createApp } = require('../index');
const keycloakAuthService = require('../shared-lib/keycloak-auth-service');
const keycloakAccess = require('../services/keycloak-access-service');
const { writeAudit } = require('../services/audit-service');
const mockDb = require('../shared-lib/db-connection-service').__mockDb;

const TOKEN = 'Bearer test-token';
const RID = 'r-bali-0001';

/** Repo admin (exact repo admin scope). */
function authAdmin() {
  keycloakAuthService.verifyToken.mockResolvedValue({
    sub: 'steward-1',
    preferred_username: 'steward',
    okf_scopes: [`okf:itu:${RID}:admin`],
    realm_access: { roles: ['user'] }
  });
}
/** Repo read-only holder. */
function authReader() {
  keycloakAuthService.verifyToken.mockResolvedValue({
    sub: 'reader-1',
    preferred_username: 'reader',
    okf_scopes: [`okf:itu:${RID}:read`],
    realm_access: { roles: ['user'] }
  });
}

function seedRepo(overrides) {
  mockDb._reset();
  mockDb.collection('okf_repositories').save({
    _key: RID,
    repo_id: RID,
    name: 'Bali',
    domain: 'island-tourism',
    lifecycle_state: 'publish',
    acl: { required_scopes: ['okf:t:island-tourism:admin'] },
    ...overrides
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  keycloakAccess.isConfigured.mockReturnValue(true);
});

describe('GET /api/okf/repos/:repo_id/access', () => {
  test('200 — SERVER-SIDE holders: attribute search per level + role members', async () => {
    authReader();
    seedRepo({ acl: { restricted: true, required_scopes: ['okf:t:island-tourism:admin'] } });
    keycloakAccess.usersWithAttribute.mockImplementation(async (scope) =>
      scope.endsWith(':read') ? [{ id: 'u1', username: 'alice' }] : []
    );
    keycloakAccess.roleMembers.mockImplementation(async (scope) =>
      scope.endsWith(':admin')
        ? { users: [{ id: 'u2', username: 'bob' }], groups: [{ id: 'g1', name: 'curators' }] }
        : { users: [], groups: [] }
    );
    const res = await request(createApp()).get(`/api/okf/repos/${RID}/access`).set('Authorization', TOKEN);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ repo_id: RID, restricted: true, configured: true });
    // attribute search per level — NEVER a realm listing
    expect(keycloakAccess.usersWithAttribute).toHaveBeenCalledWith(`okf:t:${RID}:read`);
    expect(keycloakAccess.usersWithAttribute).toHaveBeenCalledWith(`okf:t:${RID}:admin`);
    expect(res.body.user_holders).toEqual([
      { user_id: 'u1', username: 'alice', levels: ['read'], via: 'user' },
      { user_id: 'u2', username: 'bob', levels: ['admin'], via: 'role' }
    ]);
    expect(res.body.group_holders).toEqual([{ group_id: 'g1', name: 'curators', levels: ['admin'] }]);
  });

  test('unconfigured deployment: 200 with configured=false and no Keycloak calls', async () => {
    authReader();
    seedRepo();
    keycloakAccess.isConfigured.mockReturnValue(false);
    const res = await request(createApp()).get(`/api/okf/repos/${RID}/access`).set('Authorization', TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.user_holders).toEqual([]);
    expect(keycloakAccess.usersWithAttribute).not.toHaveBeenCalled();
  });

  test('404 for an unknown repo', async () => {
    keycloakAuthService.verifyToken.mockResolvedValue({
      sub: 'steward-1',
      realm_access: { roles: ['tools-admin'] }
    });
    mockDb._reset();
    const res = await request(createApp()).get('/api/okf/repos/r-none/access').set('Authorization', TOKEN);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('REPO_NOT_FOUND');
  });
});

describe('GET /api/okf/repos/:repo_id/access/users (picker search)', () => {
  test('server-side search + has_access marks + total_matching for select-all', async () => {
    authAdmin();
    seedRepo();
    keycloakAccess.searchUsers.mockResolvedValue([
      { id: 'u1', username: 'alice', name: 'Alice A', email: 'a@x', enabled: true },
      { id: 'u2', username: 'bob', name: 'Bob B', email: 'b@x', enabled: true }
    ]);
    keycloakAccess.countUsers.mockResolvedValue(1200);
    keycloakAccess.usersWithAttribute.mockResolvedValue([{ id: 'u2', username: 'bob' }]);
    keycloakAccess.roleMembers.mockResolvedValue({ users: [], groups: [] });
    const res = await request(createApp()).get(`/api/okf/repos/${RID}/access/users?q=ali`).set('Authorization', TOKEN);
    expect(res.status).toBe(200);
    expect(keycloakAccess.searchUsers).toHaveBeenCalledWith('ali', 50);
    expect(keycloakAccess.countUsers).toHaveBeenCalledWith('ali');
    expect(res.body.total_matching).toBe(1200);
    expect(res.body.users[0]).toMatchObject({ username: 'alice', has_access: false });
    expect(res.body.users[1]).toMatchObject({ username: 'bob', has_access: true });
  });

  test('read-only holder gets 403 (the picker is steward-only)', async () => {
    authReader();
    seedRepo();
    const res = await request(createApp()).get(`/api/okf/repos/${RID}/access/users?q=a`).set('Authorization', TOKEN);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN_SCOPE');
  });
});

describe('GET /api/okf/repos/:repo_id/access/groups (combobox search)', () => {
  test('server-side group search + has_access marks from the read role', async () => {
    authAdmin();
    seedRepo();
    keycloakAccess.searchGroups.mockResolvedValue([
      { id: 'g1', name: 'ministry-of-health' },
      { id: 'g2', name: 'contractors' }
    ]);
    keycloakAccess.roleMembers.mockImplementation(async (scope) =>
      scope.endsWith(':read')
        ? { users: [], groups: [{ id: 'g1', name: 'ministry-of-health' }] }
        : { users: [], groups: [] }
    );
    const res = await request(createApp()).get(`/api/okf/repos/${RID}/access/groups?q=min`).set('Authorization', TOKEN);
    expect(res.status).toBe(200);
    expect(keycloakAccess.searchGroups).toHaveBeenCalledWith('min', 50);
    expect(res.body.groups[0]).toMatchObject({ name: 'ministry-of-health', has_access: true });
    expect(res.body.groups[1]).toMatchObject({ name: 'contractors', has_access: false });
  });
});

describe('PUT /api/okf/repos/:repo_id/access (toggle)', () => {
  test('admin toggles restriction on a SERVING repo — direct doc write + audit', async () => {
    authAdmin();
    seedRepo({ ingested_at: '2026-10-16T00:00:00Z' });
    const res = await request(createApp())
      .put(`/api/okf/repos/${RID}/access`)
      .set('Authorization', TOKEN)
      .send({ restricted: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, restricted: true });
    const update = mockDb.collection('okf_repositories').update.mock.calls[0];
    expect(update[0]).toBe(RID);
    expect(update[1].acl).toMatchObject({ restricted: true, required_scopes: ['okf:t:island-tourism:admin'] });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'repo.access.restrict', repo_id: RID, details: { restricted: true } })
    );
  });

  test('read-only holder gets 403 (admin gate)', async () => {
    authReader();
    seedRepo();
    const res = await request(createApp())
      .put(`/api/okf/repos/${RID}/access`)
      .set('Authorization', TOKEN)
      .send({ restricted: true });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN_SCOPE');
  });
});

describe('POST /api/okf/repos/:repo_id/access/grant (bulk users)', () => {
  test('BULK grant: every username processed, missing users reported not fatal', async () => {
    authAdmin();
    seedRepo();
    keycloakAccess.findUserByUsername.mockImplementation(async (u) =>
      u === 'ghost' ? null : { id: 'u-' + u, username: u, attributes: { okf_scopes: [] } }
    );
    const res = await request(createApp())
      .post(`/api/okf/repos/${RID}/access/grant`)
      .set('Authorization', TOKEN)
      .send({ usernames: ['alice', 'bob', 'ghost'], level: 'read' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, granted: ['alice', 'bob'], missing: ['ghost'] });
    expect(keycloakAccess.setUserScopes).toHaveBeenCalledTimes(2);
    expect(keycloakAccess.setUserScopes).toHaveBeenCalledWith(expect.objectContaining({ username: 'alice' }), [
      `okf:t:${RID}:read`
    ]);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'repo.access.grant',
        repo_id: RID,
        details: {
          usernames: ['alice', 'bob'],
          missing: ['ghost'],
          level: 'read',
          scope: `okf:t:${RID}:read`
        }
      })
    );
  });

  test('SINGLE username still works (back-compat shape)', async () => {
    authAdmin();
    seedRepo();
    keycloakAccess.findUserByUsername.mockResolvedValue({
      id: 'u1',
      username: 'alice',
      attributes: { okf_scopes: [] }
    });
    const res = await request(createApp())
      .post(`/api/okf/repos/${RID}/access/grant`)
      .set('Authorization', TOKEN)
      .send({ username: 'alice', level: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body.granted).toEqual(['alice']);
  });

  test('NO LEVEL → defaults to read (query access, the only UI grant)', async () => {
    authAdmin();
    seedRepo();
    keycloakAccess.findUserByUsername.mockResolvedValue({
      id: 'u1',
      username: 'alice',
      attributes: { okf_scopes: [] }
    });
    const res = await request(createApp())
      .post(`/api/okf/repos/${RID}/access/grant`)
      .set('Authorization', TOKEN)
      .send({ username: 'alice' });
    expect(res.status).toBe(200);
    expect(keycloakAccess.setUserScopes).toHaveBeenCalledWith(expect.anything(), [`okf:t:${RID}:read`]);
  });

  test('GRANT-BY-SEARCH: one query grants EVERY matching user server-side', async () => {
    authAdmin();
    seedRepo();
    // 1000 users matched by the query — granted via the worker pool, no
    // username list on the wire.
    const users = Array.from({ length: 1000 }, (_, i) => ({
      id: 'u' + i,
      username: 'user' + i,
      attributes: { okf_scopes: [] }
    }));
    keycloakAccess.usersMatching.mockResolvedValue(users);
    const res = await request(createApp())
      .post(`/api/okf/repos/${RID}/access/grant`)
      .set('Authorization', TOKEN)
      .send({ query: 'contractor' });
    expect(res.status).toBe(200);
    expect(keycloakAccess.usersMatching).toHaveBeenCalledWith('contractor');
    expect(keycloakAccess.setUserScopes).toHaveBeenCalledTimes(1000);
    expect(keycloakAccess.setUserScopes).toHaveBeenCalledWith(expect.objectContaining({ username: 'user0' }), [
      `okf:t:${RID}:read`
    ]);
    expect(res.body).toMatchObject({ ok: true, query: 'contractor', matched: 1000, granted: 1000 });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'repo.access.grant',
        details: expect.objectContaining({ query: 'contractor', granted: 1000, level: 'read' })
      })
    );
  });

  test('all users unknown → 404 with the full missing list', async () => {
    authAdmin();
    seedRepo();
    keycloakAccess.findUserByUsername.mockResolvedValue(null);
    const res = await request(createApp())
      .post(`/api/okf/repos/${RID}/access/grant`)
      .set('Authorization', TOKEN)
      .send({ usernames: ['ghost1', 'ghost2'], level: 'read' });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ ok: false, missing: ['ghost1', 'ghost2'] });
  });

  test('503 ACCESS_CONTROL_UNCONFIGURED when no Keycloak credentials', async () => {
    authAdmin();
    seedRepo();
    keycloakAccess.isConfigured.mockReturnValue(false);
    const res = await request(createApp())
      .post(`/api/okf/repos/${RID}/access/grant`)
      .set('Authorization', TOKEN)
      .send({ usernames: ['alice'], level: 'read' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('ACCESS_CONTROL_UNCONFIGURED');
  });
});

describe('POST /api/okf/repos/:repo_id/access/grant-group (scale path)', () => {
  test('ONE operation: ensure role (named as the scope) + ensure group + assign + audit', async () => {
    authAdmin();
    seedRepo();
    const res = await request(createApp())
      .post(`/api/okf/repos/${RID}/access/grant-group`)
      .set('Authorization', TOKEN)
      .send({ group: 'curators', level: 'read' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, group: 'curators', scope: `okf:t:${RID}:read` });
    expect(keycloakAccess.ensureRole).toHaveBeenCalledWith(`okf:t:${RID}:read`);
    expect(keycloakAccess.ensureGroup).toHaveBeenCalledWith('curators');
    expect(keycloakAccess.setGroupRole).toHaveBeenCalledWith(
      { id: 'grp-curators', name: 'curators' },
      { id: `role-okf:t:${RID}:read`, name: `okf:t:${RID}:read` },
      true
    );
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'repo.access.grant_group', repo_id: RID })
    );
  });

  test('revoke-group with no level strips BOTH levels', async () => {
    authAdmin();
    seedRepo();
    const res = await request(createApp())
      .post(`/api/okf/repos/${RID}/access/revoke-group`)
      .set('Authorization', TOKEN)
      .send({ group: 'curators' });
    expect(res.status).toBe(200);
    expect(res.body.removed.sort()).toEqual(['admin', 'read']);
    expect(keycloakAccess.setGroupRole).toHaveBeenCalledTimes(2);
  });
});

describe('POST /api/okf/repos/:repo_id/access/revoke', () => {
  test('only THIS repo scopes stripped, others kept, bulk-safe', async () => {
    authAdmin();
    seedRepo();
    keycloakAccess.findUserByUsername.mockResolvedValue({
      id: 'u1',
      username: 'alice',
      attributes: { okf_scopes: [`okf:t:${RID}:read`, 'okf:itu:r-other:admin', `okf:t:${RID}:admin`] }
    });
    const res = await request(createApp())
      .post(`/api/okf/repos/${RID}/access/revoke`)
      .set('Authorization', TOKEN)
      .send({ usernames: ['alice'] });
    expect(res.status).toBe(200);
    expect(keycloakAccess.setUserScopes).toHaveBeenCalledWith(expect.anything(), ['okf:itu:r-other:admin']);
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'repo.access.revoke', repo_id: RID }));
  });
});
