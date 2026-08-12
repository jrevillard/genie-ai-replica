// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Integration tests for /api/okf/repos via createApp() + supertest.
// repository-service is mocked (HTTP-layer concerns only); keycloak-auth-service
// is mocked because loading auth.js transitively loads jose (ESM-only under Jest).

jest.mock('../shared-lib/keycloak-auth-service', () => ({ verifyToken: jest.fn() }));
jest.mock('../services/repository-service');

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
    authUser(['user']);
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
    authUser(['user']);
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
    authUser(['user']);
    repoService.getById.mockResolvedValue({ repo_id: 'r1' });
    const res = await request(createApp()).get('/api/okf/repos/r1').set('Authorization', TOKEN);
    expect(res.status).toBe(200);
  });

  test('404 REPO_NOT_FOUND surfaced from the service', async () => {
    authUser(['user']);
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
    authUser(['user']);
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
