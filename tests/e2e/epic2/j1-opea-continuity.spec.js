const { test, expect } = require('@playwright/test');
const { getUserToken, request: authRequest } = require('../helpers/auth');

test.describe('Phase J: OPEA Continuity', () => {
  let userToken;
  let userKey;
  const serviceToken = process.env.SERVICE_AUTH_TOKEN;

  test.beforeAll(async () => {
    if (!serviceToken) {
      throw new Error('SERVICE_AUTH_TOKEN env var is required for Phase J tests');
    }
    userToken = await getUserToken('testuser', 'TestPass123!');

    // Get user _key from authenticated profile
    const profile = await authRequest('GET', '/api/users/me', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    userKey = profile.data._key;
    if (!userKey) {
      throw new Error('Could not determine user _key from profile response');
    }
  });

  test('J.1 — OPEA callback returns sanitized profile', async () => {
    const res = await authRequest('GET', `/api/users/${userKey}/context`, {
      headers: { 'X-Service-Token': serviceToken },
    });
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('name');
    expect(res.data).toHaveProperty('role');
    expect(res.data).toHaveProperty('emailVerified');
    // Only these 3 fields should exist
    const keys = Object.keys(res.data).sort();
    expect(keys).toEqual(['emailVerified', 'name', 'role'].sort());
  });

  test('J.2 — OPEA callback rejects requests without valid X-Service-Token', async () => {
    // No auth header
    const res1 = await authRequest('GET', `/api/users/${userKey}/context`);
    expect(res1.status).toBe(401);

    // Keycloak JWT (should be ignored)
    const res2 = await authRequest('GET', `/api/users/${userKey}/context`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res2.status).toBe(401);

    // Wrong service token
    const res3 = await authRequest('GET', `/api/users/${userKey}/context`, {
      headers: { 'X-Service-Token': 'wrong-token-value' },
    });
    expect(res3.status).toBe(401);
  });

  test('J.3 — no Keycloak artifacts leak to OPEA', async () => {
    const res = await authRequest('GET', `/api/users/${userKey}/context`, {
      headers: { 'X-Service-Token': serviceToken },
    });
    expect(res.status).toBe(200);

    const sensitiveKeys = ['iss', 'sub', 'iss_sub', 'realm_access', 'azp', 'Authorization', 'token'];
    for (const key of sensitiveKeys) {
      expect(res.data).not.toHaveProperty(key);
    }
  });
});
