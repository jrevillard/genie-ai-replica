// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Coverage for keycloak-access-service's user/group enumeration surface
// (picker + bulk paths) and the token seam's failure/retry arms. The
// ensureRole/ensureGroup empty-201 seam lives in keycloak-access-unit.test.js.

jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));

const realEnv = { ...process.env };

function respond(status, body) {
  const text = body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text)
  };
}

/** Fresh module load (env is captured at require time — resetModules per test). */
function loadSvc(envPatch = {}) {
  jest.resetModules();
  const prev = process.env;
  process.env = { ...prev, KEYCLOAK_URL: 'http://kc:8080', KEYCLOAK_REALM: 'genie', ...envPatch };
  try {
    return require('../services/keycloak-access-service');
  } finally {
    process.env = prev;
  }
}

const mkUser = (id, username, extra = {}) => ({
  id,
  username,
  firstName: 'First' + id,
  lastName: 'Last' + id,
  email: `${username}@x.io`,
  enabled: true,
  ...extra
});

describe('keycloak-access-service coverage', () => {
  let svc;
  beforeEach(() => {
    global.fetch = jest.fn();
    svc = loadSvc({ KC_OKF_ACCESS_CLIENT_SECRET: 's3cret' });
  });
  afterAll(() => {
    process.env = realEnv;
  });

  test('isConfigured reflects the load-time credentials', () => {
    expect(svc.isConfigured()).toBe(true);
    expect(loadSvc({ KC_OKF_ACCESS_CLIENT_SECRET: '' }).isConfigured()).toBe(false);
  });

  test('a failed service-account token is a 502, with the body logged', async () => {
    global.fetch.mockResolvedValueOnce(respond(401, 'invalid client credentials'));
    await expect(svc.countUsers()).rejects.toMatchObject({ statusCode: 502 });
  });

  test('a 401 on an admin call clears the cached token and retries once', async () => {
    global.fetch
      .mockResolvedValueOnce(respond(200, { access_token: 'tok-1' }))
      .mockResolvedValueOnce(respond(401, 'stale')) // first admin call — expired
      .mockResolvedValueOnce(respond(200, { access_token: 'tok-2' })) // refresh
      .mockResolvedValueOnce(respond(200, 7)); // retried call succeeds
    await expect(svc.countUsers()).resolves.toBe(7);
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  test('findUserByUsername: exactly one hit returns it, anything else null', async () => {
    global.fetch
      .mockResolvedValueOnce(respond(200, { access_token: 't' }))
      .mockResolvedValueOnce(respond(200, [mkUser('u1', 'alice')]));
    await expect(svc.findUserByUsername('alice')).resolves.toMatchObject({ id: 'u1' });
    global.fetch.mockResolvedValueOnce(respond(200, { access_token: 't' })).mockResolvedValueOnce(respond(200, []));
    await expect(svc.findUserByUsername('ghost')).resolves.toBeNull();
    global.fetch
      .mockResolvedValueOnce(respond(200, { access_token: 't' }))
      .mockResolvedValueOnce(respond(200, [mkUser('u1', 'a'), mkUser('u2', 'b')]));
    await expect(svc.findUserByUsername('a')).resolves.toBeNull(); // ambiguous
  });

  test('searchUsers maps to minimal users and clamps the limit', async () => {
    global.fetch
      .mockResolvedValueOnce(respond(200, { access_token: 't' }))
      .mockResolvedValueOnce(respond(200, [mkUser('u1', 'alice')]));
    await expect(svc.searchUsers('ali', 500)).resolves.toEqual([
      { id: 'u1', username: 'alice', name: 'Firstu1 Lastu1', email: 'alice@x.io', enabled: true }
    ]);
    expect(global.fetch.mock.calls[1][0]).toContain('/users?q=ali&first=0&max=100');
    global.fetch.mockResolvedValueOnce(respond(200, []));
    await svc.searchUsers('  ');
    // cached token — the second leg makes exactly one more call
    expect(global.fetch.mock.calls[2][0]).toContain('/users?first=0&max=50'); // blank term → no q
  });

  test('countUsers routes with and without a term', async () => {
    global.fetch.mockResolvedValueOnce(respond(200, { access_token: 't' })).mockResolvedValueOnce(respond(200, 42));
    await expect(svc.countUsers('agri')).resolves.toBe(42);
    expect(global.fetch.mock.calls[1][0]).toContain('/users/count?q=agri');
    global.fetch.mockResolvedValueOnce(respond(200, 42));
    await svc.countUsers();
    expect(global.fetch.mock.calls[2][0]).toContain('/users/count');
    expect(global.fetch.mock.calls[2][0]).not.toContain('?');
  });

  test('usersMatching walks pages to exhaustion and honours the cap', async () => {
    const full = Array.from({ length: 100 }, (_, i) => mkUser('u' + i, 'u' + i));
    global.fetch
      .mockResolvedValueOnce(respond(200, { access_token: 't' }))
      .mockResolvedValueOnce(respond(200, full))
      .mockResolvedValueOnce(respond(200, full.slice(0, 30))); // short page ends the walk
    const all = await svc.usersMatching('term');
    expect(all).toHaveLength(130);
    expect(global.fetch.mock.calls[2][0]).toContain('first=100');
    global.fetch.mockResolvedValueOnce(respond(200, full)); // token stays cached
    expect(await svc.usersMatching('term', 50)).toHaveLength(50); // cap short-circuits
  });

  test('usersWithAttribute paginates the attribute search', async () => {
    const full = Array.from({ length: 100 }, (_, i) => mkUser('h' + i, 'h' + i));
    global.fetch
      .mockResolvedValueOnce(respond(200, { access_token: 't' }))
      .mockResolvedValueOnce(respond(200, full))
      .mockResolvedValueOnce(respond(200, [mkUser('hX', 'hx')]));
    const holders = await svc.usersWithAttribute('okf:t:r1:read');
    expect(holders).toHaveLength(101);
    expect(global.fetch.mock.calls[1][0]).toContain('q=okf_scopes%3Aokf%3At%3Ar1%3Aread');
  });

  test('searchGroups returns {id,name} pairs with a clamped limit', async () => {
    global.fetch
      .mockResolvedValueOnce(respond(200, { access_token: 't' }))
      .mockResolvedValueOnce(respond(200, [{ id: 'g1', name: 'curators', path: '/curators' }]));
    await expect(svc.searchGroups('cur', 500)).resolves.toEqual([{ id: 'g1', name: 'curators' }]);
    expect(global.fetch.mock.calls[1][0]).toContain('/groups?search=cur&max=100');
  });

  test('userScopes reads the attribute defensively; setUserScopes writes merge-preserving', async () => {
    expect(svc.userScopes(null)).toEqual([]);
    expect(svc.userScopes({ attributes: { okf_scopes: 'not-an-array' } })).toEqual([]);
    expect(svc.userScopes({ attributes: { okf_scopes: ['a', 7, 'a'] } })).toEqual(['a', 'a']);
    const user = { id: 'u1', username: 'alice', attributes: { locale: ['en'] } };
    global.fetch.mockResolvedValueOnce(respond(200, { access_token: 't' })).mockResolvedValueOnce(respond(204, null)); // Keycloak's mapping-write style 204
    await expect(svc.setUserScopes(user, ['s1', 's1', 's2'])).resolves.toBeUndefined();
    const put = global.fetch.mock.calls[1];
    expect(put[1].method).toBe('PUT');
    expect(put[0]).toContain('/users/u1');
    expect(JSON.parse(put[1].body).attributes).toEqual({
      locale: ['en'],
      okf_scopes: ['s1', 's2']
    });
  });

  test('setUserScopes surfaces a failed attribute write as 502', async () => {
    global.fetch.mockResolvedValueOnce(respond(200, { access_token: 't' })).mockResolvedValueOnce(respond(500, 'boom'));
    await expect(svc.setUserScopes({ id: 'u1' }, ['s'])).rejects.toMatchObject({ statusCode: 502 });
  });
});
