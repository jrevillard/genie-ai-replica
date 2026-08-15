// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Integration tests for /api/okf/repos via createApp() + supertest.
// repository-service is mocked (HTTP-layer concerns only); keycloak-auth-service
// is mocked because loading auth.js transitively loads jose (ESM-only under Jest).

jest.mock('../shared-lib/keycloak-auth-service', () => ({ verifyToken: jest.fn() }));
jest.mock('../services/repository-service');
jest.mock('../services/audit-service', () => ({ writeAudit: jest.fn().mockResolvedValue(null) }));
jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
jest.mock('../shared-lib/db-connection-service', () => ({ getConnection: jest.fn() }));

const request = require('supertest');
const { createApp } = require('../index');
const keycloakAuthService = require('../shared-lib/keycloak-auth-service');
const repoService = require('../services/repository-service');

const TOKEN = 'Bearer test-token';

/** Configure the mocked token verifier to resolve a user with the given roles. */
function authUser(roles) {
  keycloakAuthService.verifyToken.mockResolvedValue({
    sub: 'steward-1',
    preferred_username: 'steward',
    realm_access: { roles }
  });
}

const validBody = { name: 'Social Policy', domain: 'social', acl: { required_scopes: ['okf:t:social:admin'] } };

beforeEach(() => jest.clearAllMocks());

describe('GET /api/okf/repos (list)', () => {
  test('200 → {items, next_cursor}', async () => {
    authScoped(['okf:t1:r1:read']); // scoped caller (Story 6.1 router gate)
    repoService.list.mockResolvedValue({ items: [{ repo_id: 'r1' }], next_cursor: null });
    const res = await request(createApp()).get('/api/okf/repos').set('Authorization', TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.next_cursor).toBeNull();
  });
});

describe('POST /api/okf/repos (create)', () => {
  test('201 when tools-admin + valid body', async () => {
    authUser(['tools-admin']);
    repoService.create.mockResolvedValue({ repo_id: 'r1', graph_name: 'OKF_r1', lifecycle_state: 'register' });
    const res = await request(createApp()).post('/api/okf/repos').set('Authorization', TOKEN).send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.repo_id).toBe('r1');
    expect(repoService.create).toHaveBeenCalledTimes(1);
  });

  test('403 FORBIDDEN_ROLE when authenticated but not tools-admin', async () => {
    authScoped(['okf:t1:r1:read']); // scoped caller (Story 6.1 router gate)
    const res = await request(createApp()).post('/api/okf/repos').set('Authorization', TOKEN).send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN_ROLE');
    expect(repoService.create).not.toHaveBeenCalled();
  });

  test('400 VALIDATION_ERROR when required fields missing', async () => {
    authUser(['tools-admin']);
    const res = await request(createApp()).post('/api/okf/repos').set('Authorization', TOKEN).send({ name: 'x' }); // missing domain + acl
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(res.body.details).toEqual(expect.any(Array));
    expect(repoService.create).not.toHaveBeenCalled();
  });

  test('409 DUPLICATE_REPO surfaced from the service', async () => {
    authUser(['tools-admin']);
    repoService.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'DUPLICATE_REPO', status: 409 }));
    const res = await request(createApp()).post('/api/okf/repos').set('Authorization', TOKEN).send(validBody);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('DUPLICATE_REPO');
  });
});

describe('GET /api/okf/repos/:repo_id', () => {
  test('200 when found', async () => {
    authScoped(['okf:t1:r1:read']); // scoped caller (Story 6.1 router gate)
    repoService.getById.mockResolvedValue({ repo_id: 'r1' });
    const res = await request(createApp()).get('/api/okf/repos/r1').set('Authorization', TOKEN);
    expect(res.status).toBe(200);
  });

  test('404 REPO_NOT_FOUND surfaced from the service', async () => {
    authScoped(['okf:t1:r1:read']); // scoped caller (Story 6.1 router gate)
    repoService.getById.mockRejectedValue(Object.assign(new Error('nf'), { code: 'REPO_NOT_FOUND', status: 404 }));
    const res = await request(createApp()).get('/api/okf/repos/r1').set('Authorization', TOKEN);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('REPO_NOT_FOUND');
  });
});

describe('PATCH /api/okf/repos/:repo_id', () => {
  test('200 on valid update', async () => {
    authUser(['tools-admin']);
    repoService.update.mockResolvedValue({ repo_id: 'r1', name: 'New' });
    const res = await request(createApp()).patch('/api/okf/repos/r1').set('Authorization', TOKEN).send({ name: 'New' });
    expect(res.status).toBe(200);
  });

  test('409 FIELD_IMMUTABLE when changing graph_name', async () => {
    authUser(['tools-admin']);
    repoService.update.mockRejectedValue(Object.assign(new Error('imm'), { code: 'FIELD_IMMUTABLE', status: 409 }));
    const res = await request(createApp())
      .patch('/api/okf/repos/r1')
      .set('Authorization', TOKEN)
      .send({ graph_name: 'OKF_x' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('FIELD_IMMUTABLE');
  });
});

describe('DELETE /api/okf/repos/:repo_id', () => {
  test('202 when tools-admin', async () => {
    authUser(['tools-admin']);
    repoService.remove.mockResolvedValue({ repo_id: 'r1', status: 'pending_hard_delete' });
    const res = await request(createApp()).delete('/api/okf/repos/r1').set('Authorization', TOKEN);
    expect(res.status).toBe(202);
  });

  test('403 when not tools-admin', async () => {
    authScoped(['okf:t1:r1:read']); // scoped caller (Story 6.1 router gate)
    const res = await request(createApp()).delete('/api/okf/repos/r1').set('Authorization', TOKEN);
    expect(res.status).toBe(403);
    expect(repoService.remove).not.toHaveBeenCalled();
  });
});

describe('auth (inherited from /api/okf)', () => {
  test('401 TOKEN_INVALID when Authorization header is missing', async () => {
    const res = await request(createApp()).get('/api/okf/repos');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('TOKEN_INVALID');
  });

  test('401 when token verification fails', async () => {
    keycloakAuthService.verifyToken.mockRejectedValue(new Error('bad token'));
    const res = await request(createApp()).get('/api/okf/repos').set('Authorization', 'Bearer bad');
    expect(res.status).toBe(401);
  });
});

// ─── Story 6.1: AC-8 isolation matrix (requireScope + requireRepoScope) ──────

/** User with okf scopes (roles default to plain 'user'). */
function authScoped(okfScopes, roles = ['user']) {
  keycloakAuthService.verifyToken.mockResolvedValue({
    sub: 'steward-1',
    preferred_username: 'steward',
    okf_scopes: okfScopes,
    realm_access: { roles }
  });
}

/** Faithful service mock: honors the authz Set exactly like repository-service. */
function authzAwareServiceMock() {
  repoService.list.mockImplementation(async ({ authz } = {}) =>
    authz instanceof Set && authz.size === 0
      ? { items: [], next_cursor: null }
      : { items: [{ repo_id: 'repoA' }], next_cursor: null }
  );
  repoService.getById.mockImplementation(async (repoId, { authz } = {}) => {
    if (authz instanceof Set && !authz.has(repoId)) {
      return Promise.reject(Object.assign(new Error('not found'), { code: 'REPO_NOT_FOUND', status: 404 }));
    }
    return { repo_id: repoId };
  });
  repoService.update.mockResolvedValue({ repo_id: 'repoA', updated: true });
}

describe('Story 6.1 — AC-8 isolation matrix', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authzAwareServiceMock();
  });

  test('(a) okf:t1:repoA:read — GET repoA 200, GET repoB 404 (identical to missing)', async () => {
    authScoped(['okf:t1:repoA:read']);
    const a = await request(createApp()).get('/api/okf/repos/repoA').set('Authorization', TOKEN);
    expect(a.status).toBe(200);
    const b = await request(createApp()).get('/api/okf/repos/repoB').set('Authorization', TOKEN);
    expect(b.status).toBe(404);
  });

  test('(a) list is scoped: controller passes the authorized repo set to the service', async () => {
    authScoped(['okf:t1:repoA:read']);
    const res = await request(createApp()).get('/api/okf/repos').set('Authorization', TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([{ repo_id: 'repoA' }]);
  });

  test('(b) scopeless non-admin caller — 403 FORBIDDEN_SCOPE at the router gate (service empty-list stays defense-in-depth, unreachable over HTTP)', async () => {
    authScoped([]);
    const list = await request(createApp()).get('/api/okf/repos').set('Authorization', TOKEN);
    expect(list.status).toBe(403);
    expect(list.body.error).toBe('FORBIDDEN_SCOPE');
    const get = await request(createApp()).get('/api/okf/repos/repoA').set('Authorization', TOKEN);
    expect(get.status).toBe(403);
  });

  test('(c) read scope does NOT grant mutation — PATCH/DELETE/pii-scan on repoA are 403', async () => {
    authScoped(['okf:t1:repoA:read']);
    const patch = await request(createApp())
      .patch('/api/okf/repos/repoA')
      .set('Authorization', TOKEN)
      .send({ name: 'X' });
    expect(patch.status).toBe(403);
    expect(patch.body.error).toBe('FORBIDDEN_SCOPE');
    const del = await request(createApp()).delete('/api/okf/repos/repoA').set('Authorization', TOKEN);
    expect(del.status).toBe(403);
    const pii = await request(createApp())
      .post('/api/okf/repos/repoA/pii-scan')
      .set('Authorization', TOKEN)
      .send({ concepts: [{ concept_id: 'c1', frontmatter: {}, body: 'x' }] });
    expect(pii.status).toBe(403);
  });

  test('(d) admin scope on repoA — PATCH repoA 200; PATCH repoB 403 (cross-tenant, G15)', async () => {
    authScoped(['okf:t1:repoA:admin']);
    const a = await request(createApp()).patch('/api/okf/repos/repoA').set('Authorization', TOKEN).send({ name: 'X' });
    expect(a.status).toBe(200);
    const b = await request(createApp()).patch('/api/okf/repos/repoB').set('Authorization', TOKEN).send({ name: 'X' });
    expect(b.status).toBe(403);
  });

  test('(e) tools-admin with NO scopes — sees all, mutates all (operator regression, D7)', async () => {
    authScoped([], ['tools-admin']);
    const list = await request(createApp()).get('/api/okf/repos').set('Authorization', TOKEN);
    expect(list.status).toBe(200);
    const patch = await request(createApp())
      .patch('/api/okf/repos/repoA')
      .set('Authorization', TOKEN)
      .send({ name: 'X' });
    expect(patch.status).toBe(200);
  });

  test('(f) wildcard okf:*:*:admin — full access without the realm role', async () => {
    authScoped(['okf:*:*:admin']);
    const patch = await request(createApp())
      .patch('/api/okf/repos/repoB')
      .set('Authorization', TOKEN)
      .send({ name: 'X' });
    expect(patch.status).toBe(200);
  });

  test('POST / (create) keeps the tools-admin role gate (platform-level act, D4)', async () => {
    authScoped(['okf:t1:repoA:admin']); // scopes alone do NOT grant create
    const res = await request(createApp()).post('/api/okf/repos').set('Authorization', TOKEN).send(validBody);
    expect(res.status).toBe(403);
    authScoped([], ['tools-admin']);
    repoService.create.mockResolvedValue({ repo_id: 'new' });
    const ok = await request(createApp()).post('/api/okf/repos').set('Authorization', TOKEN).send(validBody);
    expect(ok.status).toBe(201);
  });
});

describe('getRepo denial audit (AC7 review fix)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('foreign-repo 404 with a scoped caller writes authz.denied.repo', async () => {
    jest.mock('../services/audit-service', () => ({ writeAudit: jest.fn().mockResolvedValue(null) }), {
      virtual: false
    });
    authScoped(['okf:t1:repoA:read']);
    repoService.getById.mockRejectedValue(Object.assign(new Error('nf'), { code: 'REPO_NOT_FOUND', status: 404 }));
    const res = await request(createApp()).get('/api/okf/repos/repoB').set('Authorization', TOKEN);
    expect(res.status).toBe(404);
    const { writeAudit } = require('../services/audit-service');
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'authz.denied.repo', actor: 'steward-1', repo_id: 'repoB' })
    );
  });

  test('super-admin (null authz) 404 writes NO denial audit', async () => {
    authScoped([], ['tools-admin']);
    repoService.getById.mockRejectedValue(Object.assign(new Error('nf'), { code: 'REPO_NOT_FOUND', status: 404 }));
    const res = await request(createApp()).get('/api/okf/repos/repoB').set('Authorization', TOKEN);
    expect(res.status).toBe(404);
    const { writeAudit } = require('../services/audit-service');
    expect(writeAudit).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'authz.denied.repo' }));
  });
});
