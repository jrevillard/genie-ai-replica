// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Unit tests for keycloak-access-service's HTTP seam — specifically the
// Keycloak response shapes that broke the grant-group path live (2026-10-17):
// POST /roles and POST /groups return 201 with an EMPTY body, and the old
// jsonOrThrow called r.json() on it ("Unexpected end of JSON input" → 500).

jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));

const svc = require('../services/keycloak-access-service');

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

describe('keycloak-access-service HTTP seam', () => {
  const SCOPE = 'okf:t:r-unit:read';

  beforeEach(() => {
    process.env = { ...realEnv, KEYCLOAK_URL: 'http://kc:8080', KEYCLOAK_REALM: 'genie' };
    global.fetch = jest.fn();
    svc._clearTokenCache(); // module-level cache persists across tests — reset the fetch order
  });
  afterAll(() => {
    process.env = realEnv;
  });

  test('ensureRole survives the empty 201 Keycloak returns for POST /roles', async () => {
    global.fetch
      // token
      .mockResolvedValueOnce(respond(200, { access_token: 'tok' }))
      // role fetch → 404 (first grant for this repo)
      .mockResolvedValueOnce(respond(404, JSON.stringify({ error: 'Could not find role' })))
      // role create → 201 with EMPTY body (the trap)
      .mockResolvedValueOnce(respond(201, null))
      // role re-fetch → full representation
      .mockResolvedValueOnce(respond(200, { id: 'role-1', name: SCOPE }));

    const role = await svc.ensureRole(SCOPE);
    expect(role).toMatchObject({ id: 'role-1', name: SCOPE });
    const createCall = global.fetch.mock.calls[2];
    expect(createCall[1].method).toBe('POST');
    expect(createCall[0]).toContain('/roles');
  });

  test('ensureGroup survives the empty 201 Keycloak returns for POST /groups', async () => {
    global.fetch
      .mockResolvedValueOnce(respond(200, { access_token: 'tok' }))
      // group search → not found
      .mockResolvedValueOnce(respond(200, []))
      // group create → 201 EMPTY body
      .mockResolvedValueOnce(respond(201, null))
      // group re-search → found
      .mockResolvedValueOnce(respond(200, [{ id: 'g1', name: 'curators' }]));

    const grp = await svc.ensureGroup('curators');
    expect(grp).toMatchObject({ id: 'g1', name: 'curators' });
  });

  test('204 mapping writes still resolve to null (revoke path)', async () => {
    global.fetch.mockResolvedValueOnce(respond(200, { access_token: 'tok' })).mockResolvedValueOnce(respond(204, null));
    await expect(
      svc.setGroupRole({ id: 'g1', name: 'curators' }, { id: 'r1', name: SCOPE }, true)
    ).resolves.toBeUndefined();
  });
});
