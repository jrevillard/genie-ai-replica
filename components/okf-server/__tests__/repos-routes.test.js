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
// Auto-mock (no factory) so all exports become jest.fn() and tests can stub.
jest.mock('../services/concept-meta-service');
jest.mock('../services/parser-service');
// ingest-service is mocked further down (line 296) — that factory is the
// authoritative one and already includes `resplitRepo` for Story #978.

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

// ─── Story 2.9.1: POST /api/okf/repos/:repo_id/ingest ─────────────────────────

jest.mock('../services/ingest-service', () => ({
  ingestRepoConcepts: jest.fn(),
  resplitRepo: jest.fn(), // Story #978 — Editor "Re-split from source"
  deleteConcept: jest.fn(), // Story #978 — delete one concept (meta+chunks+edges)
  maxConceptsFromEnv: jest.fn(() => 200)
}));
jest.mock('../services/version-service', () => ({
  mintVersion: jest.fn(),
  listVersions: jest.fn(),
  getVersion: jest.fn(),
  VersionError: class VersionError extends Error {
    constructor(code, message, status) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
  TRIGGERS: ['manual', 'publish', 'crawl']
}));
const ingestService = require('../services/ingest-service');
const versionService = require('../services/version-service');

describe('POST /api/okf/repos/:repo_id/ingest (Story 2.9.1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authzAwareServiceMock();
  });

  const ingestBody = (extra = {}) => ({ concepts: [{ frontmatter: { title: 'Alpha' }, body: '# Alpha' }], ...extra });

  test('admin scope + valid body → 202 with the orchestrator summary', async () => {
    authScoped([`okf:t1:repoA:admin`]);
    repoService.getById.mockResolvedValue({ repo_id: 'repoA', domain: 'smoke', graph_name: 'OKF_repoA', version: 1 });
    ingestService.ingestRepoConcepts.mockResolvedValue({
      repo_id: 'repoA',
      total: 1,
      created: 1,
      updated: 0,
      skipped_dedup: 0,
      pii: { clean: 1, hit: 0, error: 0 },
      enqueued: 1,
      enqueue_errors: []
    });
    const res = await request(createApp())
      .post('/api/okf/repos/repoA/ingest')
      .set('Authorization', TOKEN)
      .send(ingestBody());
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ repo_id: 'repoA', enqueued: 1 });
    expect(repoService.getById).toHaveBeenCalledWith('repoA', expect.anything()); // existence+authz gate BEFORE ingest
    expect(ingestService.ingestRepoConcepts).toHaveBeenCalledWith(
      'repoA',
      expect.objectContaining({ concepts: expect.any(Array) }),
      expect.objectContaining({ sub: 'steward-1' })
    );
  });

  test('repo-scope gate: read ≠ admin → 403 FORBIDDEN_SCOPE', async () => {
    authScoped(['okf:t1:repoA:read']);
    const res = await request(createApp())
      .post('/api/okf/repos/repoA/ingest')
      .set('Authorization', TOKEN)
      .send(ingestBody());
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN_SCOPE');
    expect(ingestService.ingestRepoConcepts).not.toHaveBeenCalled();
  });

  test('foreign repo → 403 at requireRepoScope (scoped caller, route layer) / 404 via getById (super-admin)', async () => {
    // Layered: a scoped caller on a foreign repo is stopped by the route's
    // requireRepoScope (403, scope never matches repoB)…
    authScoped(['okf:t1:repoA:admin']);
    let res = await request(createApp())
      .post('/api/okf/repos/repoB/ingest')
      .set('Authorization', TOKEN)
      .send(ingestBody());
    expect(res.status).toBe(403);
    expect(ingestService.ingestRepoConcepts).not.toHaveBeenCalled();
    // …while a super-admin hitting a nonexistent repo is stopped by the
    // controller's getById gate (404, anti-enumeration — same as pii-scan).
    authScoped([], ['tools-admin']);
    repoService.getById.mockRejectedValue(Object.assign(new Error('nf'), { code: 'REPO_NOT_FOUND', status: 404 }));
    res = await request(createApp()).post('/api/okf/repos/repoB/ingest').set('Authorization', TOKEN).send(ingestBody());
    expect(res.status).toBe(404);
    expect(ingestService.ingestRepoConcepts).not.toHaveBeenCalled();
  });

  test('400 VALIDATION_ERROR when no concepts/file_ids/discover', async () => {
    authScoped(['okf:t1:repoA:admin']);
    repoService.getById.mockResolvedValue({ repo_id: 'repoA', domain: 'smoke', graph_name: 'OKF_repoA' });
    const res = await request(createApp()).post('/api/okf/repos/repoA/ingest').set('Authorization', TOKEN).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  test('400 VALIDATION_ERROR on empty-body concepts (review fix — nothing to parse/index)', async () => {
    authScoped(['okf:t1:repoA:admin']);
    repoService.getById.mockResolvedValue({ repo_id: 'repoA', domain: 'smoke', graph_name: 'OKF_repoA' });
    const res = await request(createApp())
      .post('/api/okf/repos/repoA/ingest')
      .set('Authorization', TOKEN)
      .send({ concepts: [{ frontmatter: { title: 'Hollow' } }, { frontmatter: { title: 'Ok' }, body: '# ok' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body.details)).toContain('concepts[0].body');
    expect(ingestService.ingestRepoConcepts).not.toHaveBeenCalled();
  });

  test('discover must be strictly true at the route too — truthy non-boolean is a 400 (review fix)', async () => {
    authScoped(['okf:t1:repoA:admin']);
    repoService.getById.mockResolvedValue({ repo_id: 'repoA', domain: 'smoke', graph_name: 'OKF_repoA' });
    const res = await request(createApp())
      .post('/api/okf/repos/repoA/ingest')
      .set('Authorization', TOKEN)
      .send({ discover: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(ingestService.ingestRepoConcepts).not.toHaveBeenCalled();
  });

  test('TOO_MANY_CONCEPTS (4e cap) surfaces as 400', async () => {
    authScoped(['okf:t1:repoA:admin']);
    repoService.getById.mockResolvedValue({ repo_id: 'repoA', domain: 'smoke', graph_name: 'OKF_repoA' });
    ingestService.ingestRepoConcepts.mockRejectedValue(
      Object.assign(new Error('too many'), { code: 'TOO_MANY_CONCEPTS', status: 400 })
    );
    const res = await request(createApp())
      .post('/api/okf/repos/repoA/ingest')
      .set('Authorization', TOKEN)
      .send(ingestBody());
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('TOO_MANY_CONCEPTS');
  });

  test('tools-admin (no scopes) passes via super-role — operator regression', async () => {
    authScoped([], ['tools-admin']);
    repoService.getById.mockResolvedValue({ repo_id: 'repoA', domain: 'smoke', graph_name: 'OKF_repoA' });
    ingestService.ingestRepoConcepts.mockResolvedValue({
      repo_id: 'repoA',
      total: 0,
      enqueued: 0,
      enqueue_errors: [],
      pii: { clean: 0, hit: 0, error: 0 }
    });
    const res = await request(createApp())
      .post('/api/okf/repos/repoA/ingest')
      .set('Authorization', TOKEN)
      .send({ discover: true });
    expect(res.status).toBe(202);
  });

  test('zip body (base64 bundle) is accepted and passed through to the service', async () => {
    authScoped(['okf:t1:repoA:admin']);
    repoService.getById.mockResolvedValue({ repo_id: 'repoA', domain: 'smoke', graph_name: 'OKF_repoA' });
    ingestService.ingestRepoConcepts.mockResolvedValue({
      repo_id: 'repoA',
      total: 2,
      parsed: 2,
      enqueued: 2,
      enqueue_errors: [],
      pii: { clean: 2, hit: 0, error: 0 }
    });
    const res = await request(createApp())
      .post('/api/okf/repos/repoA/ingest')
      .set('Authorization', TOKEN)
      .send({ zip: 'UEsDBAoAAAAAAA' });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ repo_id: 'repoA', enqueued: 2 });
    expect(ingestService.ingestRepoConcepts).toHaveBeenCalledWith(
      'repoA',
      expect.objectContaining({ zip: 'UEsDBAoAAAAAAA' }),
      expect.anything()
    );
  });

  test('zip ingest passes bundle_name through to the service (bundle-zip file doc name)', async () => {
    authScoped(['okf:t1:repoA:admin']);
    repoService.getById.mockResolvedValue({ repo_id: 'repoA', domain: 'smoke', graph_name: 'OKF_repoA' });
    ingestService.ingestRepoConcepts.mockResolvedValue({
      repo_id: 'repoA',
      total: 1,
      parsed: 1,
      enqueued: 1,
      enqueue_errors: [],
      pii: { clean: 1, hit: 0, error: 0 }
    });
    const res = await request(createApp())
      .post('/api/okf/repos/repoA/ingest')
      .set('Authorization', TOKEN)
      .send({ zip: 'UEsDBAoAAAAAAA', bundle_name: 'kenya-bundle.zip' });
    expect(res.status).toBe(202);
    expect(ingestService.ingestRepoConcepts).toHaveBeenCalledWith(
      'repoA',
      expect.objectContaining({ zip: 'UEsDBAoAAAAAAA', bundle_name: 'kenya-bundle.zip' }),
      expect.anything()
    );
  });
});

// ─── Story 2.9.7: version mint + manifests ─────────────────────────────────────

describe('POST /api/okf/repos/:repo_id/versions (Story 2.9.7)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authzAwareServiceMock();
  });

  test('admin scope + valid trigger → 201 with the mint summary', async () => {
    authScoped(['okf:t1:repoA:admin']);
    repoService.getById.mockResolvedValue({ repo_id: 'repoA', domain: 'smoke', graph_name: 'OKF_repoA' });
    versionService.mintVersion.mockResolvedValue({
      repo_id: 'repoA',
      bundle_version: 1,
      okf_tag: 'okf:v1',
      concept_count: 6,
      manifest_key: 'repoA_1',
      minted_at: '2026-08-16T00:00:00Z'
    });
    const res = await request(createApp())
      .post('/api/okf/repos/repoA/versions')
      .set('Authorization', TOKEN)
      .send({ trigger: 'crawl', source_ref: 'https://example.gov' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ repo_id: 'repoA', bundle_version: 1, okf_tag: 'okf:v1' });
    // gate order: getById BEFORE mint
    expect(repoService.getById).toHaveBeenCalledWith('repoA', expect.anything());
    expect(versionService.mintVersion).toHaveBeenCalledWith(
      'repoA',
      { trigger: 'crawl', source_ref: 'https://example.gov' },
      expect.objectContaining({ sub: 'steward-1' })
    );
  });

  test('read scope → 403 FORBIDDEN_SCOPE (minting is an admin mutation)', async () => {
    authScoped(['okf:t1:repoA:read']);
    const res = await request(createApp()).post('/api/okf/repos/repoA/versions').set('Authorization', TOKEN).send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN_SCOPE');
    expect(versionService.mintVersion).not.toHaveBeenCalled();
  });

  test('foreign repo (super-admin) → 404 via getById gate; mint never called', async () => {
    authScoped([], ['tools-admin']);
    repoService.getById.mockRejectedValue(Object.assign(new Error('nf'), { code: 'REPO_NOT_FOUND', status: 404 }));
    const res = await request(createApp()).post('/api/okf/repos/repoB/versions').set('Authorization', TOKEN).send({});
    expect(res.status).toBe(404);
    expect(versionService.mintVersion).not.toHaveBeenCalled();
  });

  test('invalid trigger propagates 400 VALIDATION_ERROR', async () => {
    authScoped(['okf:t1:repoA:admin']);
    repoService.getById.mockResolvedValue({ repo_id: 'repoA', domain: 'smoke' });
    versionService.mintVersion.mockRejectedValue(
      Object.assign(new Error('trigger must be one of manual|publish|crawl'), { code: 'VALIDATION_ERROR', status: 400 })
    );
    const res = await request(createApp())
      .post('/api/okf/repos/repoA/versions')
      .set('Authorization', TOKEN)
      .send({ trigger: 'oops' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/okf/repos/:repo_id/versions (list + manifest)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authzAwareServiceMock();
  });

  test('read scope → 200 newest-first list', async () => {
    authScoped(['okf:t1:repoA:read']);
    repoService.getById.mockResolvedValue({ repo_id: 'repoA', domain: 'smoke' });
    versionService.listVersions.mockResolvedValue([
      { bundle_version: 2, okf_tag: 'okf:v2' },
      { bundle_version: 1, okf_tag: 'okf:v1' }
    ]);
    const res = await request(createApp()).get('/api/okf/repos/repoA/versions').set('Authorization', TOKEN);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ repo_id: 'repoA' });
    expect(res.body.versions.map((v) => v.bundle_version)).toEqual([2, 1]);
  });

  test('manifest read → 200 full manifest', async () => {
    authScoped(['okf:t1:repoA:read']);
    repoService.getById.mockResolvedValue({ repo_id: 'repoA', domain: 'smoke' });
    versionService.getVersion.mockResolvedValue({
      repo_id: 'repoA',
      bundle_version: 1,
      concepts: [{ concept_id: 'x' }]
    });
    const res = await request(createApp()).get('/api/okf/repos/repoA/versions/1').set('Authorization', TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.concepts).toEqual([{ concept_id: 'x' }]);
    expect(versionService.getVersion).toHaveBeenCalledWith('repoA', 1);
  });

  test('unknown version → 404 VERSION_NOT_FOUND', async () => {
    authScoped(['okf:t1:repoA:read']);
    repoService.getById.mockResolvedValue({ repo_id: 'repoA', domain: 'smoke' });
    versionService.getVersion.mockRejectedValue(
      Object.assign(new Error('nope'), { code: 'VERSION_NOT_FOUND', status: 404 })
    );
    const res = await request(createApp()).get('/api/okf/repos/repoA/versions/9').set('Authorization', TOKEN);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('VERSION_NOT_FOUND');
  });

  test('scopeless caller → 403 default-deny', async () => {
    authScoped([]);
    const res = await request(createApp()).get('/api/okf/repos/repoA/versions').set('Authorization', TOKEN);
    expect(res.status).toBe(403);
  });
});

// ─── Story 4.8: POST /api/okf/repos/:source_id/clone ──────────────────────────

describe('POST /api/okf/repos/:source_id/clone (Story 4.8 — D-V5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authzAwareServiceMock();
    repoService.cloneRepository.mockResolvedValue({
      repo_id: 'clone-1',
      graph_name: 'OKF_clone-1',
      lifecycle_state: 'draft',
      cloned_from: { repo_id: 'repoA', version: 2 },
      copied_concepts: 3
    });
  });

  test('admin scope + empty body → 201 with the clone (defaults derived by the service)', async () => {
    authScoped(['okf:t1:repoA:admin']);
    repoService.getById.mockResolvedValue({ repo_id: 'repoA', domain: 'smoke', graph_name: 'OKF_repoA', version: 2 });
    const res = await request(createApp()).post('/api/okf/repos/repoA/clone').set('Authorization', TOKEN).send({});
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ repo_id: 'clone-1', lifecycle_state: 'draft', copied_concepts: 3 });
    // gate order: getById (existence+authz) BEFORE clone — asserted, not just called
    expect(repoService.getById).toHaveBeenCalledWith('repoA', expect.anything());
    expect(repoService.cloneRepository).toHaveBeenCalledWith(
      'repoA',
      {},
      expect.objectContaining({ sub: 'steward-1' })
    );
    expect(repoService.getById.mock.invocationCallOrder[0]).toBeLessThan(
      repoService.cloneRepository.mock.invocationCallOrder[0]
    );
  });

  test('explicit body fields are validated + passed through', async () => {
    authScoped(['okf:t1:repoA:admin']);
    repoService.getById.mockResolvedValue({ repo_id: 'repoA', domain: 'smoke' });
    const res = await request(createApp())
      .post('/api/okf/repos/repoA/clone')
      .set('Authorization', TOKEN)
      .send({ name: 'My Fork', domain: 'health' });
    expect(res.status).toBe(201);
    expect(repoService.cloneRepository).toHaveBeenCalledWith(
      'repoA',
      expect.objectContaining({ name: 'My Fork', domain: 'health' }),
      expect.anything()
    );
  });

  test('read scope → 403 FORBIDDEN_SCOPE (clone is an admin mutation)', async () => {
    authScoped(['okf:t1:repoA:read']);
    const res = await request(createApp()).post('/api/okf/repos/repoA/clone').set('Authorization', TOKEN).send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN_SCOPE');
    expect(repoService.cloneRepository).not.toHaveBeenCalled();
  });

  test('missing/soft-deleted source (super-admin) → 404 via getById gate; clone never called', async () => {
    // A real foreign source for a scoped caller is 403 at requireRepoScope (leaks
    // nothing about existence); this 404 is the missing/soft-deleted case.
    authScoped([], ['tools-admin']);
    repoService.getById.mockRejectedValue(Object.assign(new Error('nf'), { code: 'REPO_NOT_FOUND', status: 404 }));
    const res = await request(createApp()).post('/api/okf/repos/repoB/clone').set('Authorization', TOKEN).send({});
    expect(res.status).toBe(404);
    expect(repoService.cloneRepository).not.toHaveBeenCalled();
  });

  test('409 DUPLICATE_REPO surfaces from the service (target (name,domain) collision)', async () => {
    authScoped(['okf:t1:repoA:admin']);
    repoService.getById.mockResolvedValue({ repo_id: 'repoA', domain: 'smoke' });
    repoService.cloneRepository.mockRejectedValue(
      Object.assign(new Error('dup'), { code: 'DUPLICATE_REPO', status: 409 })
    );
    const res = await request(createApp()).post('/api/okf/repos/repoA/clone').set('Authorization', TOKEN).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('DUPLICATE_REPO');
  });

  test('tools-admin (no scopes) passes via super-role — operator regression', async () => {
    authScoped([], ['tools-admin']);
    repoService.getById.mockResolvedValue({ repo_id: 'repoA', domain: 'smoke' });
    const res = await request(createApp()).post('/api/okf/repos/repoA/clone').set('Authorization', TOKEN).send({});
    expect(res.status).toBe(201);
  });
});

// ─── Story #978 — Editor surface (Wizard | Editor sub-tabs) ───────────────
//
// Three new admin-scope routes: PATCH concept, POST resplit, POST autocorrect.
// HTTP-layer concerns only — services are mocked at module level above.

const parserService = require('../services/parser-service');
const conceptMetaService = require('../services/concept-meta-service');

describe('PATCH /api/okf/repos/:repo_id/concepts/:concept_id (Story #978)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authzAwareServiceMock();
  });

  test('200 admin scope + valid markdown — updates the concept', async () => {
    authScoped(['okf:t1:repoA:admin']);
    parserService.parseConcept.mockResolvedValue({
      concept_id: 'conceptA',
      repo_id: 'repoA',
      path: 'conceptA.md',
      frontmatter: { type: 'topic', title: 'Concept A v2' },
      body: '# Body v2'
    });
    conceptMetaService.patchConceptMeta.mockResolvedValue({
      concept_id: 'conceptA',
      repo_id: 'repoA',
      content_hash: 'NEWHASH',
      index_status: 'parsed',
      updated_at: '2026-08-27T10:00:00Z'
    });
    const res = await request(createApp())
      .patch('/api/okf/repos/repoA/concepts/conceptA')
      .set('Authorization', TOKEN)
      .send({ markdown: '---\ntype: topic\ntitle: Concept A v2\n---\n# Body v2' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      concept_id: 'conceptA',
      content_hash: 'NEWHASH',
      index_status: 'parsed'
    });
    expect(conceptMetaService.patchConceptMeta).toHaveBeenCalledWith(
      'repoA',
      'conceptA',
      expect.objectContaining({ body: '# Body v2', frontmatter: expect.any(Object) })
    );
  });

  test('404 when the concept does not exist in the repo', async () => {
    authScoped(['okf:t1:repoA:admin']);
    conceptMetaService.patchConceptMeta.mockResolvedValue(null);
    const res = await request(createApp())
      .patch('/api/okf/repos/repoA/concepts/missing')
      .set('Authorization', TOKEN)
      .send({ markdown: '# x' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('CONCEPT_NOT_FOUND');
  });

  test('400 when markdown is missing', async () => {
    authScoped(['okf:t1:repoA:admin']);
    const res = await request(createApp())
      .patch('/api/okf/repos/repoA/concepts/conceptA')
      .set('Authorization', TOKEN)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  test('400 when parser fails (malformed frontmatter)', async () => {
    authScoped(['okf:t1:repoA:admin']);
    parserService.parseConcept.mockRejectedValue(Object.assign(new Error('bad'), { code: 'PARSE_ERROR', status: 400 }));
    const res = await request(createApp())
      .patch('/api/okf/repos/repoA/concepts/conceptA')
      .set('Authorization', TOKEN)
      .send({ markdown: 'no frontmatter' });
    expect(res.status).toBe(400);
  });

  test('403 when scoped-read-only (no admin)', async () => {
    authScoped(['okf:t1:repoA:read']); // read scope, not admin
    const res = await request(createApp())
      .patch('/api/okf/repos/repoA/concepts/conceptA')
      .set('Authorization', TOKEN)
      .send({ markdown: '# x' });
    expect(res.status).toBe(403);
    expect(conceptMetaService.patchConceptMeta).not.toHaveBeenCalled();
  });
});

describe('GET /api/okf/repos/:repo_id/concepts (Story #978 — editor list)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authzAwareServiceMock();
  });

  test('200 read scope — returns the concept list (errors-first sort in service)', async () => {
    authScoped(['okf:t1:repoA:read']);
    conceptMetaService.listConceptsMeta.mockResolvedValue([
      { concept_id: 'c-failed', title: 'Broken', index_status: 'failed' },
      { concept_id: 'c-ok', title: 'Fine', index_status: 'indexed' }
    ]);
    const res = await request(createApp()).get('/api/okf/repos/repoA/concepts').set('Authorization', TOKEN);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(conceptMetaService.listConceptsMeta).toHaveBeenCalledWith('repoA');
  });

  test('404 when the repo is foreign (anti-enumeration pre-gate)', async () => {
    authScoped(['okf:t1:otherRepo:read']);
    const res = await request(createApp()).get('/api/okf/repos/repoA/concepts').set('Authorization', TOKEN);
    expect(res.status).toBe(404);
    expect(conceptMetaService.listConceptsMeta).not.toHaveBeenCalled();
  });

  test('403 when unauthenticated', async () => {
    const res = await request(createApp()).get('/api/okf/repos/repoA/concepts');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/okf/repos/:repo_id/concepts/:concept_id (Story #978 — editor read)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authzAwareServiceMock();
  });

  test('200 read scope — returns the full meta row (frontmatter + body)', async () => {
    authScoped(['okf:t1:repoA:read']);
    conceptMetaService.getConceptMeta.mockResolvedValue({
      concept_id: 'conceptA',
      repo_id: 'repoA',
      title: 'Concept A',
      index_status: 'indexed',
      frontmatter: { type: 'topic', title: 'Concept A', sources: [] },
      body: '# Concept A\n\nBody.'
    });
    const res = await request(createApp()).get('/api/okf/repos/repoA/concepts/conceptA').set('Authorization', TOKEN);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ concept_id: 'conceptA', body: '# Concept A\n\nBody.' });
    expect(conceptMetaService.getConceptMeta).toHaveBeenCalledWith('repoA', 'conceptA');
  });

  test('404 when the concept does not exist in this repo', async () => {
    authScoped(['okf:t1:repoA:read']);
    conceptMetaService.getConceptMeta.mockResolvedValue(null);
    const res = await request(createApp()).get('/api/okf/repos/repoA/concepts/missing').set('Authorization', TOKEN);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('CONCEPT_NOT_FOUND');
  });

  test('404 when the repo is foreign', async () => {
    authScoped(['okf:t1:otherRepo:read']);
    const res = await request(createApp()).get('/api/okf/repos/repoA/concepts/conceptA').set('Authorization', TOKEN);
    expect(res.status).toBe(404);
    expect(conceptMetaService.getConceptMeta).not.toHaveBeenCalled();
  });
});

describe('POST /api/okf/repos/:repo_id/resplit (Story #978)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authzAwareServiceMock();
  });

  test('200 admin scope + mode B + file_id → returns the ingest summary', async () => {
    authScoped(['okf:t1:repoA:admin']);
    ingestService.resplitRepo.mockResolvedValue({
      total: 3,
      parsed: 3,
      created: 3,
      updated: 0,
      skipped_dedup: 0,
      rejected: 0,
      enqueued: 3
    });
    const res = await request(createApp())
      .post('/api/okf/repos/repoA/resplit')
      .set('Authorization', TOKEN)
      .send({ mode: 'B', file_id: 'file-1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, mode: 'B', total: 3, enqueued: 3 });
    expect(ingestService.resplitRepo).toHaveBeenCalledWith(
      'repoA',
      'B',
      expect.objectContaining({ file_id: 'file-1', sub: 'steward-1' })
    );
  });

  test('400 when mode is unknown', async () => {
    authScoped(['okf:t1:repoA:admin']);
    const res = await request(createApp())
      .post('/api/okf/repos/repoA/resplit')
      .set('Authorization', TOKEN)
      .send({ mode: 'Z' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  test('400 MODE_NOT_IMPLEMENTED when mode=C (Story 10.6 deferred)', async () => {
    authScoped(['okf:t1:repoA:admin']);
    ingestService.resplitRepo.mockRejectedValue(
      Object.assign(new Error('not implemented'), { code: 'MODE_NOT_IMPLEMENTED', status: 400 })
    );
    const res = await request(createApp())
      .post('/api/okf/repos/repoA/resplit')
      .set('Authorization', TOKEN)
      .send({ mode: 'C', file_id: 'file-1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MODE_NOT_IMPLEMENTED');
  });

  test('404 FILE_NOT_FOUND when no file_id is provided', async () => {
    authScoped(['okf:t1:repoA:admin']);
    ingestService.resplitRepo.mockRejectedValue(
      Object.assign(new Error('no file'), { code: 'FILE_NOT_FOUND', status: 404 })
    );
    const res = await request(createApp())
      .post('/api/okf/repos/repoA/resplit')
      .set('Authorization', TOKEN)
      .send({ mode: 'B' });
    expect(res.status).toBe(404);
  });

  test('403 when read-scope only', async () => {
    authScoped(['okf:t1:repoA:read']);
    const res = await request(createApp())
      .post('/api/okf/repos/repoA/resplit')
      .set('Authorization', TOKEN)
      .send({ mode: 'B', file_id: 'file-1' });
    expect(res.status).toBe(403);
    expect(ingestService.resplitRepo).not.toHaveBeenCalled();
  });
});

describe('POST /api/okf/repos/:repo_id/autocorrect (Story #978)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authzAwareServiceMock();
  });

  test('200 dry_run=true returns the planned changes without applying', async () => {
    authScoped(['okf:t1:repoA:admin']);
    conceptMetaService.autocorrectRepo.mockResolvedValue({
      changes: [
        { concept_id: 'conceptA', changes: [{ field: 'type', before: null, after: 'topic', reason: 'MISSING_TYPE' }] }
      ],
      warnings: [],
      applied: 0,
      total_concepts: 1
    });
    const res = await request(createApp())
      .post('/api/okf/repos/repoA/autocorrect')
      .set('Authorization', TOKEN)
      .send({ dry_run: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      changes: expect.any(Array),
      applied: 0,
      total_concepts: 1
    });
    expect(conceptMetaService.autocorrectRepo).toHaveBeenCalledWith('repoA', true, expect.anything());
  });

  test('200 dry_run=false applies changes (applied > 0)', async () => {
    authScoped(['okf:t1:repoA:admin']);
    conceptMetaService.autocorrectRepo.mockResolvedValue({
      changes: [
        {
          concept_id: 'conceptA',
          changes: [{ field: 'title', before: null, after: 'Derived', reason: 'MISSING_TITLE' }]
        }
      ],
      warnings: [{ concept_id: 'conceptA', warnings: [{ rule: 'INVALID_TYPE', severity: 'warning', message: 'bad' }] }],
      applied: 1,
      total_concepts: 1
    });
    const res = await request(createApp())
      .post('/api/okf/repos/repoA/autocorrect')
      .set('Authorization', TOKEN)
      .send({ dry_run: false });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(1);
    expect(res.body.warnings).toHaveLength(1);
  });

  test('200 with no body — defaults to dry_run=true', async () => {
    authScoped(['okf:t1:repoA:admin']);
    conceptMetaService.autocorrectRepo.mockResolvedValue({ changes: [], warnings: [], applied: 0, total_concepts: 0 });
    await request(createApp()).post('/api/okf/repos/repoA/autocorrect').set('Authorization', TOKEN).send({});
    expect(conceptMetaService.autocorrectRepo).toHaveBeenCalledWith('repoA', true, expect.anything());
  });

  test('403 when read-scope only', async () => {
    authScoped(['okf:t1:repoA:read']);
    const res = await request(createApp())
      .post('/api/okf/repos/repoA/autocorrect')
      .set('Authorization', TOKEN)
      .send({});
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/okf/repos/:repo_id/concepts/:concept_id (Story #978)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authzAwareServiceMock();
  });

  test('200 admin scope — removes the concept (meta + chunks + edges)', async () => {
    authScoped(['okf:t1:repoA:admin']);
    ingestService.deleteConcept.mockResolvedValue({
      meta: { concept_id: 'conceptA' },
      chunks: 4,
      has_source: 4,
      links_to: 1,
      entity: 1
    });
    const res = await request(createApp()).delete('/api/okf/repos/repoA/concepts/conceptA').set('Authorization', TOKEN);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, concept_id: 'conceptA', chunks: 4 });
    expect(ingestService.deleteConcept).toHaveBeenCalledWith(
      'repoA',
      'conceptA',
      expect.objectContaining({ actor: expect.any(Object) })
    );
  });

  test('404 when the concept is absent', async () => {
    authScoped(['okf:t1:repoA:admin']);
    ingestService.deleteConcept.mockResolvedValue(null);
    const res = await request(createApp()).delete('/api/okf/repos/repoA/concepts/ghost').set('Authorization', TOKEN);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('CONCEPT_NOT_FOUND');
  });

  test('403 when scoped-read-only (no admin)', async () => {
    authScoped(['okf:t1:repoA:read']);
    const res = await request(createApp()).delete('/api/okf/repos/repoA/concepts/conceptA').set('Authorization', TOKEN);
    expect(res.status).toBe(403);
    expect(ingestService.deleteConcept).not.toHaveBeenCalled();
  });
});
