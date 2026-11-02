// keycloak-proxy-service unit suite (A6): global fetch mocked, dbService via the
// shared-lib manual mock. Pins the upstream port contract (service-account token
// cache + lazy 401 refresh, 204 → {}, error mapping, deleteUser KC-first +
// Arango PII nullify with 404 tolerance, Account-API updateOwnProfile) and the
// four LOCAL EXTENSIONS (assign/removeRealmRole, revokeUserSessions,
// sendVerifyEmail) the approval lifecycle calls.
//
// NOTE: fetch args are snapshotted at CALL time — the upstream _adminApiCall
// shallow-copies options and MUTATES the shared headers object on 401 refresh,
// so inspecting recorded args after the fact would show the mutated token.
const recorded = [];
const queue = [];
const mockFetch = jest.fn((url, opts = {}) => {
  recorded.push({
    url,
    method: opts.method || 'GET',
    body: opts.body ?? null,
    auth: opts.headers?.Authorization
  });
  const next = queue.shift();
  if (!next) return Promise.reject(new Error('test: no queued fetch response'));
  return Promise.resolve(next);
});
global.fetch = mockFetch;

/** Queue fetch responses in call order. */
function enqueue(...responses) {
  queue.push(...responses);
}

const KC = 'http://kc:8080';
const REALM = 'genie';
const UUID = '644b9004-1111-2222-3333-444b9004aaa';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function tokenResponse(token) {
  return jsonResponse(200, { access_token: token });
}

// Fake db for _resolveKeycloakUserId / deleteUser nullify.
// Returns { db, specs } — pass .db to freshService.
function makeDb(subByQuery) {
  const specs = [];
  const db = {
    query: async (spec) => {
      specs.push(spec);
      const next = Array.isArray(subByQuery) ? subByQuery.shift() : subByQuery;
      return { next: async () => (typeof next === 'function' ? next() : next) ?? null };
    }
  };
  return { db, specs };
}

function freshService(db) {
  jest.resetModules();
  process.env.KEYCLOAK_URL = KC;
  process.env.KEYCLOAK_REALM = REALM;
  process.env.KEYCLOAK_PROXY_CLIENT_ID = 'genie-proxy-client';
  process.env.KEYCLOAK_PROXY_CLIENT_SECRET = 'test-secret';
  const sharedLib = require('../mocks/shared-lib.js');
  sharedLib.dbService.getConnection.mockResolvedValue(db);
  const svc = require('../services/keycloak-proxy-service');
  svc._clearTokenCache();
  return svc;
}

// Fetch calls snapshotted at call time: [{url, method, body, auth}]
function calls() {
  return recorded;
}

describe('keycloakProxyService', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    recorded.length = 0;
    queue.length = 0;
  });

  it('service account token: client_credentials to the token endpoint, then cached', async () => {
    enqueue(tokenResponse('svc-token-1'));
    const svc = freshService(makeDb(null).db);

    const t1 = await svc.getServiceAccountToken();
    const t2 = await svc.getServiceAccountToken();

    expect(t1).toBe('svc-token-1');
    expect(t2).toBe(t1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const c = calls()[0];
    expect(c.url).toBe(`${KC}/realms/${REALM}/protocol/openid-connect/token`);
    expect(c.method).toBe('POST');
    expect(String(c.body)).toContain('grant_type=client_credentials');
    expect(String(c.body)).toContain('client_id=genie-proxy-client');
  });

  it('module load: throws at boot when a KEYCLOAK_* env var is missing (A5 verifier pattern)', () => {
    jest.resetModules();
    delete process.env.KEYCLOAK_PROXY_CLIENT_SECRET;
    expect(() => require('../services/keycloak-proxy-service')).toThrow(/KEYCLOAK_/);
    process.env.KEYCLOAK_PROXY_CLIENT_SECRET = 'test-secret';
  });

  it('token response without access_token throws and does not poison the cache', async () => {
    const svc = freshService(makeDb(null).db);
    enqueue(jsonResponse(200, { some: 'unexpected shape' }));

    await expect(svc.getServiceAccountToken()).rejects.toThrow(/no access_token/);

    // cache stayed empty → the next call fetches again instead of returning undefined
    enqueue(tokenResponse('svc-token-good'));
    await expect(svc.getServiceAccountToken()).resolves.toBe('svc-token-good');
  });

  it('_adminApiCall: 401 → token refreshed once and the call retried; 204 → {}', async () => {
    const svc = freshService(makeDb(null).db);
    enqueue(
      tokenResponse('svc-token-1'), // initial token
      jsonResponse(401, {}), // admin call → 401
      tokenResponse('svc-token-2'), // refreshed token
      jsonResponse(204, null) // retry → 204
    );

    const result = await svc._adminApiCall('DELETE', '/users/x/sessions');

    expect(result).toEqual({});
    const c = calls();
    expect(c).toHaveLength(4);
    expect(c[1]).toMatchObject({ url: `${KC}/admin/realms/${REALM}/users/x/sessions`, method: 'DELETE', auth: 'Bearer svc-token-1' });
    expect(c[3]).toMatchObject({ method: 'DELETE', auth: 'Bearer svc-token-2' });
  });

  it('_adminApiCall: non-401 error surfaces with the KC status attached', async () => {
    const svc = freshService(makeDb(null).db);
    enqueue(tokenResponse('svc-token-1'), jsonResponse(409, { errorMessage: 'email exists' }));

    await expect(svc._adminApiCall('PUT', '/users/x/execute-actions-email', [])).rejects.toMatchObject({
      status: 409
    });
  });

  it('assignRealmRole: resolves role id, then POSTs the realm role-mapping for the resolved uuid', async () => {
    const svc = freshService(makeDb(UUID).db);
    enqueue(
      tokenResponse('svc-token-1'),
      jsonResponse(200, { id: 'role-admin-1', name: 'admin' }), // GET /roles/admin
      jsonResponse(204, null) // POST mapping
    );

    await svc.assignRealmRole('user-key', 'admin');

    const c = calls();
    expect(c[1]).toMatchObject({ method: 'GET', url: `${KC}/admin/realms/${REALM}/roles/admin` });
    expect(c[2]).toMatchObject({ method: 'POST', url: `${KC}/admin/realms/${REALM}/users/${UUID}/role-mappings/realm` });
    expect(JSON.parse(c[2].body)).toEqual([{ id: 'role-admin-1', name: 'admin' }]);
  });

  it('removeRealmRole: DELETEs the realm role-mapping', async () => {
    const svc = freshService(makeDb(UUID).db);
    enqueue(
      tokenResponse('svc-token-1'),
      jsonResponse(200, { id: 'role-admin-1', name: 'admin' }),
      jsonResponse(204, null)
    );

    await svc.removeRealmRole('user-key', 'admin');

    const c = calls();
    expect(c[2]).toMatchObject({ method: 'DELETE', url: `${KC}/admin/realms/${REALM}/users/${UUID}/role-mappings/realm` });
    expect(JSON.parse(c[2].body)).toEqual([{ id: 'role-admin-1', name: 'admin' }]);
  });

  it('revokeUserSessions: POST /users/{uuid}/logout (KC 26 endpoint — DELETE …/sessions 404s live)', async () => {
    const svc = freshService(makeDb(UUID).db);
    enqueue(tokenResponse('svc-token-1'), jsonResponse(204, null));

    await svc.revokeUserSessions('user-key');

    expect(calls()[1]).toMatchObject({ method: 'POST', url: `${KC}/admin/realms/${REALM}/users/${UUID}/logout` });
  });

  it('sendVerifyEmail: PUT execute-actions-email with ["VERIFY_EMAIL"]', async () => {
    const svc = freshService(makeDb(UUID).db);
    enqueue(tokenResponse('svc-token-1'), jsonResponse(204, null));

    await svc.sendVerifyEmail('user-key');

    const c = calls();
    expect(c[1]).toMatchObject({ method: 'PUT', url: `${KC}/admin/realms/${REALM}/users/${UUID}/execute-actions-email` });
    expect(JSON.parse(c[1].body)).toEqual(['VERIFY_EMAIL']);
  });

  it('deleteUser: KC DELETE first, then Arango PII nullify (erasedAt + fields nulled)', async () => {
    const { db, specs } = makeDb(UUID);
    const svc = freshService(db);
    enqueue(tokenResponse('svc-token-1'), jsonResponse(204, null)); // KC DELETE

    await svc.deleteUser('user-key');

    const c = calls();
    expect(c[1]).toMatchObject({ method: 'DELETE', url: `${KC}/admin/realms/${REALM}/users/${UUID}` });
    // spec[0] = uuid resolve, spec[1] = nullify UPDATE
    expect(specs).toHaveLength(2);
    expect(specs[1].query).toContain('UPDATE');
    expect(specs[1].query).toContain('erasedAt');
    expect(Object.values(specs[1].bindVars)).toContain('user-key');
  });

  it('deleteUser: KC 404 (already gone) FALLS THROUGH to the Arango nullify — no PII survives a "success"', async () => {
    const { db, specs } = makeDb(UUID);
    const svc = freshService(db);
    enqueue(tokenResponse('svc-token-1'), jsonResponse(404, {}));

    await expect(svc.deleteUser('user-key')).resolves.toBeUndefined();

    // spec[0] = uuid resolve, spec[1] = nullify UPDATE — the nullify RAN despite the 404
    expect(specs).toHaveLength(2);
    expect(specs[1].query).toContain('erasedAt');
  });

  it('deleteUser: nullify wipes product PII too (loginName, addressResidency, farmerProfile)', async () => {
    const { db, specs } = makeDb(UUID);
    const svc = freshService(db);
    enqueue(tokenResponse('svc-token-1'), jsonResponse(204, null));

    await svc.deleteUser('user-key');

    const q = specs[1].query;
    expect(q).toContain('loginName: null');
    expect(q).toContain('addressResidency: null');
    expect(q).toContain('farmerProfile: null');
  });

  it('updateOwnProfile: PUT to the Account API with the USER token (no service account)', async () => {
    const svc = freshService(makeDb(null).db);
    enqueue(jsonResponse(204, null));

    await svc.updateOwnProfile('user-bearer-token', { email: 'new@example.com' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const c = calls()[0];
    expect(c.url).toBe(`${KC}/realms/${REALM}/account`);
    expect(c.method).toBe('PUT');
    expect(c.auth).toBe('Bearer user-bearer-token');
    expect(JSON.parse(c.body)).toEqual({ email: 'new@example.com' });
  });

  it('updateOwnProfile: KC 409 (duplicate email) surfaces with status 409', async () => {
    const svc = freshService(makeDb(null).db);
    enqueue(jsonResponse(409, {}));

    await expect(svc.updateOwnProfile('user-bearer-token', { email: 'taken@example.com' })).rejects.toMatchObject({
      status: 409
    });
  });

  it('_resolveKeycloakUserId: user without a KC uuid throws', async () => {
    const svc = freshService(makeDb(null).db); // cursor.next() → null

    await expect(svc._resolveKeycloakUserId('ghost-key')).rejects.toThrow(/no Keycloak UUID/);
  });
});
