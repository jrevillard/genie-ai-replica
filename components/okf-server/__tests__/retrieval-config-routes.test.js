// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// HTTP-layer tests for the retrieval-governance endpoints (code-review fix
// 2026-09-20 — the security-relevant gates had no route coverage):
//   GET/PUT /api/okf/retrieval-config, GET /api/okf/authz/graphs
// Services are mocked (HTTP-layer concerns only — auth gates, status codes,
// error mapping); keycloak-auth-service is mocked because auth.js transitively
// loads jose (ESM-only under Jest). Pattern: __tests__/repos-routes.test.js.

jest.mock('../shared-lib/keycloak-auth-service', () => ({ verifyToken: jest.fn() }));
jest.mock('../services/audit-service', () => ({ writeAudit: jest.fn().mockResolvedValue(null) }));
jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
jest.mock('../shared-lib/db-connection-service', () => ({ getConnection: jest.fn() }));
jest.mock('../shared-lib/tracing', () => ({
  withSpan: jest.fn(async (name, fn) => fn({ setAttribute: jest.fn() }))
}));
jest.mock('../services/retrieval-config-service');
jest.mock('../services/authz-resolver-service');

const request = require('supertest');
const { createApp } = require('../index');
const keycloakAuthService = require('../shared-lib/keycloak-auth-service');
const retrievalConfigService = require('../services/retrieval-config-service');
const authzResolverService = require('../services/authz-resolver-service');

const TOKEN = 'Bearer test-token';

/** Admin caller (tools-admin bootstrap super-role). */
function authAdmin() {
  keycloakAuthService.verifyToken.mockResolvedValue({
    sub: 'steward-1',
    preferred_username: 'steward',
    realm_access: { roles: ['tools-admin'] }
  });
}

/** Scoped caller — exercises the parseOkfScopes path (okf_scopes claim). */
function authScoped(okfScopes) {
  keycloakAuthService.verifyToken.mockResolvedValue({
    sub: 'chat-user-1',
    preferred_username: 'chatter',
    okf_scopes: okfScopes,
    realm_access: { roles: ['user'] }
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  retrievalConfigService.getRetrievalConfig.mockResolvedValue({
    config: { mode: 'legacy' },
    source: 'env-defaults',
    serving_graph_count: 0,
    serving_repo_ids: [],
    serving_graphs: [],
    engaged: false,
    warnings: []
  });
});

describe('GET /api/okf/retrieval-config', () => {
  test('200 — the CALLER context reaches the service (per-caller serving view)', async () => {
    authScoped(['okf:itu:r-kenya:read']);
    const res = await request(createApp()).get('/api/okf/retrieval-config').set('Authorization', TOKEN);
    expect(res.status).toBe(200);
    expect(retrievalConfigService.getRetrievalConfig).toHaveBeenCalledWith({
      okfScopes: ['okf:itu:r-kenya:read'],
      isSuperAdmin: false
    });
    expect(res.body.config).toMatchObject({ mode: 'legacy' });
  });

  test('DEFAULT-OPEN (2026-10-16): 200 with NO okf scope — the serving read admits scopeless callers', async () => {
    // The route mounts BEFORE the router-wide gate with allowScopelessWhenOpen:
    // in open mode (the default) a regular user's chat path resolves the
    // serving view without holding any okf:* scope.
    authScoped([]);
    const res = await request(createApp()).get('/api/okf/retrieval-config').set('Authorization', TOKEN);
    expect(res.status).toBe(200);
    expect(retrievalConfigService.getRetrievalConfig).toHaveBeenCalledWith({
      okfScopes: [],
      isSuperAdmin: false
    });
  });

  test('401 without a token (router authenticate gate still applies to the serving read)', async () => {
    const res = await request(createApp()).get('/api/okf/retrieval-config');
    expect(res.status).toBe(401);
  });

  test('open mode: a token whose okf entries are ALL malformed still 403s (restriction intended)', async () => {
    // Route-level pin of the raw-claim-list rule (2026-10-16 review gap): the
    // gate must not fall open for a token carrying okf entries that are all
    // malformed — parseOkfScopes → middleware wiring is exercised end-to-end
    // here, not just the unit-level injected arrays.
    authScoped(['okf:only-three', 'okf:t1:repoA:write']);
    const res = await request(createApp()).get('/api/okf/retrieval-config').set('Authorization', TOKEN);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN_SCOPE');
  });

  test('403 with no okf scope while OKF_SCOPE_MODE=closed (historical default-deny)', async () => {
    process.env.OKF_SCOPE_MODE = 'closed';
    try {
      authScoped([]);
      const res = await request(createApp()).get('/api/okf/retrieval-config').set('Authorization', TOKEN);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN_SCOPE');
    } finally {
      delete process.env.OKF_SCOPE_MODE;
    }
  });
});

describe('PUT /api/okf/retrieval-config', () => {
  test('200 when tools-admin — service receives actor + ip', async () => {
    authAdmin();
    retrievalConfigService.putRetrievalConfig.mockResolvedValue({ mode: 'hybrid', revision: 1 });
    const res = await request(createApp())
      .put('/api/okf/retrieval-config')
      .set('Authorization', TOKEN)
      .send({ mode: 'hybrid' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, config: { revision: 1 } });
    expect(retrievalConfigService.putRetrievalConfig).toHaveBeenCalledWith(
      { mode: 'hybrid' },
      expect.objectContaining({ sub: 'steward-1' }),
      expect.stringMatching(/::ffff:|^127\.0\.0\.1$/)
    );
  });

  test('403 FORBIDDEN_ROLE for a merely-scoped caller (the governance gate)', async () => {
    authScoped(['okf:itu:*:read']); // even a wildcard-READ scope is not tools-admin
    const res = await request(createApp())
      .put('/api/okf/retrieval-config')
      .set('Authorization', TOKEN)
      .send({ mode: 'hybrid' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN_ROLE');
    expect(retrievalConfigService.putRetrievalConfig).not.toHaveBeenCalled();
  });

  test('400 VALIDATION_ERROR on a joi-invalid payload — service never called', async () => {
    authAdmin();
    const res = await request(createApp())
      .put('/api/okf/retrieval-config')
      .set('Authorization', TOKEN)
      .send({ mode: 'turbo' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(retrievalConfigService.putRetrievalConfig).not.toHaveBeenCalled();
  });

  test('service-thrown storage failures surface via next(err) → 500', async () => {
    authAdmin();
    retrievalConfigService.putRetrievalConfig.mockRejectedValue(new Error('cluster down'));
    const res = await request(createApp())
      .put('/api/okf/retrieval-config')
      .set('Authorization', TOKEN)
      .send({ mode: 'okf_only' });
    expect(res.status).toBe(500);
  });
});

describe('GET /api/okf/authz/graphs', () => {
  test('200 — token scopes reach the resolver; response passes through', async () => {
    authScoped(['okf:itu:r-kenya:read']);
    authzResolverService.resolveGraphSet.mockResolvedValue({
      superadmin: false,
      graph_names: ['OKF_kenya-gov_v3'],
      per_graph_labels: { 'OKF_kenya-gov_v3': null },
      domains: { 'OKF_kenya-gov_v3': 'government' },
      repos: [{ repo_id: 'r-kenya', graph_name: 'OKF_kenya-gov_v3' }],
      generated_at: '2026-09-20T00:00:00Z',
      ttl_seconds: 30
    });
    const res = await request(createApp()).get('/api/okf/authz/graphs').set('Authorization', TOKEN);
    expect(res.status).toBe(200);
    expect(authzResolverService.resolveGraphSet).toHaveBeenCalledWith({
      okfScopes: ['okf:itu:r-kenya:read'],
      isSuperAdmin: false
    });
    expect(res.body.graph_names).toEqual(['OKF_kenya-gov_v3']);
    expect(res.body.ttl_seconds).toBe(30);
  });

  test('resolver failure → 500 via next(err)', async () => {
    authAdmin();
    authzResolverService.resolveGraphSet.mockRejectedValue(new Error('boom'));
    const res = await request(createApp()).get('/api/okf/authz/graphs').set('Authorization', TOKEN);
    expect(res.status).toBe(500);
  });

  test('DEFAULT-OPEN (2026-10-16): 200 with NO okf scope — the BFF authz call succeeds for a regular user', async () => {
    authScoped([]);
    authzResolverService.resolveGraphSet.mockResolvedValue({
      superadmin: false,
      scope_mode: 'open',
      graph_names: ['OKF_kenya-gov_v3'],
      per_graph_labels: {},
      domains: {},
      repos: [{ repo_id: 'r-kenya', graph_name: 'OKF_kenya-gov_v3' }],
      generated_at: '2026-09-20T00:00:00Z',
      ttl_seconds: 30
    });
    const res = await request(createApp()).get('/api/okf/authz/graphs').set('Authorization', TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.scope_mode).toBe('open');
  });

  test('403 with no okf scope while OKF_SCOPE_MODE=closed', async () => {
    process.env.OKF_SCOPE_MODE = 'closed';
    try {
      authScoped([]);
      const res = await request(createApp()).get('/api/okf/authz/graphs').set('Authorization', TOKEN);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('FORBIDDEN_SCOPE');
    } finally {
      delete process.env.OKF_SCOPE_MODE;
    }
  });
});
