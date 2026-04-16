const { test, expect } = require('@playwright/test');
const { getUserToken, request: authRequest } = require('../helpers/auth');

test.describe('Phase J: OPEA Continuity', () => {
  let userToken;
  let userKey;

  test.beforeAll(async () => {
    userToken = await getUserToken('testuser', 'TestPass123!');

    // Get user id (ArangoDB _key) from authenticated profile
    const profile = await authRequest('GET', '/api/auth/me', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    userKey = profile.data.user.id;
    if (!userKey) {
      throw new Error('Could not determine user id from profile response');
    }
  });

  test('J.1 — OPEA callback returns sanitized profile via Bearer token', async () => {
    const res = await authRequest('GET', `/api/users/${userKey}/context`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('name');
    expect(res.data).toHaveProperty('role');
    expect(res.data).toHaveProperty('emailVerified');
    // Only these 3 fields should exist
    const keys = Object.keys(res.data).sort();
    expect(keys).toEqual(['emailVerified', 'name', 'role'].sort());
  });

  test('J.2 — OPEA callback rejects unauthenticated requests', async () => {
    // No auth header
    const res1 = await authRequest('GET', `/api/users/${userKey}/context`);
    expect(res1.status).toBe(401);

    // Wrong token
    const res2 = await authRequest('GET', `/api/users/${userKey}/context`, {
      headers: { Authorization: 'Bearer invalid-token' },
    });
    expect(res2.status).toBe(401);
  });

  test('J.3 — no Keycloak artifacts leak to OPEA', async () => {
    const res = await authRequest('GET', `/api/users/${userKey}/context`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(200);

    const sensitiveKeys = ['iss', 'sub', 'iss_sub', 'realm_access', 'azp', 'Authorization', 'token'];
    for (const key of sensitiveKeys) {
      expect(res.data).not.toHaveProperty(key);
    }
  });
});
