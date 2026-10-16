// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 6-1c — HTTP-layer tests for the access-control admin facility
// (GET/PUT /:repo_id/access, POST grant/revoke): gates, status codes, the
// Keycloak interaction contract, audit. Pattern: retrieval-config-routes.test.js.

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
  listUsersWithScopes: jest.fn(),
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
  // clearAllMocks does NOT undo mockReturnValue set by the unconfigured-case
  // tests — re-pin the default every time so it cannot leak forward.
  keycloakAccess.isConfigured.mockReturnValue(true);
});

describe('GET /api/okf/repos/:repo_id/access', () => {
  test('200 — read holder sees the panel model with holders computed from Keycloak', async () => {
    authReader();
    seedRepo({ acl: { restricted: true, required_scopes: ['okf:t:island-tourism:admin'] } });
    keycloakAccess.listUsersWithScopes.mockResolvedValue([
      { id: 'u1', username: 'alice', attributes: { okf_scopes: [`okf:itu:${RID}:read`, 'okf:itu:r-other:admin'] } },
      { id: 'u2', username: 'bob', attributes: { okf_scopes: ['okf:itu:r-other:read'] } }
    ]);
    const res = await request(createApp()).get(`/api/okf/repos/${RID}/access`).set('Authorization', TOKEN);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ repo_id: RID, restricted: true, configured: true });
    expect(res.body.holders).toEqual([{ user_id: 'u1', username: 'alice', levels: ['read'] }]);
  });

  test('unconfigured deployment: 200 with configured=false and empty holders (enforcement unaffected)', async () => {
    authReader();
    seedRepo();
    keycloakAccess.isConfigured.mockReturnValue(false);
    const res = await request(createApp()).get(`/api/okf/repos/${RID}/access`).set('Authorization', TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.holders).toEqual([]);
    expect(keycloakAccess.listUsersWithScopes).not.toHaveBeenCalled();
  });

  test('404 for an unknown repo', async () => {
    // tools-admin (not a repo-scoped holder) so the ROUTE gate passes for an
    // arbitrary repo id — the 404 must come from the repo lookup itself.
    keycloakAuthService.verifyToken.mockResolvedValue({
      sub: 'steward-1',
      preferred_username: 'steward',
      realm_access: { roles: ['tools-admin'] }
    });
    mockDb._reset();
    const res = await request(createApp()).get('/api/okf/repos/r-none/access').set('Authorization', TOKEN);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('REPO_NOT_FOUND');
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

describe('POST /api/okf/repos/:repo_id/access/grant', () => {
  test('admin grants read — scope appended (deduped), user written, audited', async () => {
    authAdmin();
    seedRepo();
    keycloakAccess.findUserByUsername.mockResolvedValue({
      id: 'u1',
      username: 'alice',
      attributes: { okf_scopes: ['okf:itu:r-other:read'] }
    });
    const res = await request(createApp())
      .post(`/api/okf/repos/${RID}/access/grant`)
      .set('Authorization', TOKEN)
      .send({ username: 'alice', level: 'read' });
    expect(res.status).toBe(200);
    expect(res.body.scopes).toEqual(['okf:itu:r-other:read', `okf:t:${RID}:read`]);
    expect(keycloakAccess.setUserScopes).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }), [
      'okf:itu:r-other:read',
      `okf:t:${RID}:read`
    ]);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'repo.access.grant',
        repo_id: RID,
        details: { username: 'alice', level: 'read', scope: `okf:t:${RID}:read` }
      })
    );
  });

  test('idempotent: granting the same scope twice does not duplicate it', async () => {
    authAdmin();
    seedRepo();
    keycloakAccess.findUserByUsername.mockResolvedValue({
      id: 'u1',
      username: 'alice',
      attributes: { okf_scopes: [`okf:t:${RID}:read`] }
    });
    const res = await request(createApp())
      .post(`/api/okf/repos/${RID}/access/grant`)
      .set('Authorization', TOKEN)
      .send({ username: 'alice', level: 'read' });
    expect(res.status).toBe(200);
    expect(res.body.scopes).toEqual([`okf:t:${RID}:read`]);
  });

  test('503 ACCESS_CONTROL_UNCONFIGURED when no Keycloak credentials', async () => {
    authAdmin();
    seedRepo();
    keycloakAccess.isConfigured.mockReturnValue(false);
    const res = await request(createApp())
      .post(`/api/okf/repos/${RID}/access/grant`)
      .set('Authorization', TOKEN)
      .send({ username: 'alice', level: 'read' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('ACCESS_CONTROL_UNCONFIGURED');
  });

  test('404 USER_NOT_FOUND', async () => {
    authAdmin();
    seedRepo();
    keycloakAccess.findUserByUsername.mockResolvedValue(null);
    const res = await request(createApp())
      .post(`/api/okf/repos/${RID}/access/grant`)
      .set('Authorization', TOKEN)
      .send({ username: 'ghost', level: 'read' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('USER_NOT_FOUND');
  });
});

describe('POST /api/okf/repos/:repo_id/access/revoke', () => {
  test('admin revokes — only THIS repo scopes stripped, others kept', async () => {
    authAdmin();
    seedRepo();
    keycloakAccess.findUserByUsername.mockResolvedValue({
      id: 'u1',
      username: 'alice',
      attributes: { okf_scopes: [`okf:itu:${RID}:read`, 'okf:itu:r-other:admin', `okf:itu:${RID}:admin`] }
    });
    const res = await request(createApp())
      .post(`/api/okf/repos/${RID}/access/revoke`)
      .set('Authorization', TOKEN)
      .send({ username: 'alice' });
    expect(res.status).toBe(200);
    expect(res.body.scopes).toEqual(['okf:itu:r-other:admin']);
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'repo.access.revoke', repo_id: RID }));
  });
});
