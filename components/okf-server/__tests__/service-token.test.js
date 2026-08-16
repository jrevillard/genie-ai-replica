// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 2.9.1 T1 — service-account token client (client_credentials, cached).
// Red-green: FAILS before services/service-token.js exists.

jest.mock('axios');
const axios = require('axios');
axios.post = jest.fn();
axios.get = jest.fn();
axios.create = jest.fn(() => axios);

jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));

const { getServiceToken, authedAxios } = require('../services/service-token');

describe('service-token (client_credentials, cached, single-flight)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    require('../services/service-token')._resetForTesting();
    process.env.KC_OKF_SERVER_CLIENT_ID = 'okf-server';
    process.env.KC_OKF_SERVER_CLIENT_SECRET = 'test-secret';
    delete process.env.KEYCLOAK_INTERNAL_URL;
    delete process.env.KEYCLOAK_PUBLIC_URL;
  });
  afterEach(() => {
    delete process.env.KC_OKF_SERVER_CLIENT_ID;
    delete process.env.KC_OKF_SERVER_CLIENT_SECRET;
    delete process.env.KEYCLOAK_INTERNAL_URL;
    delete process.env.KEYCLOAK_PUBLIC_URL;
  });

  test('mints via client_credentials against the realm token endpoint', async () => {
    axios.post.mockResolvedValue({
      data: { access_token: 'tok-1', expires_in: 300 }
    });
    const t = await getServiceToken();
    expect(t).toBe('tok-1');
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/realms/genie/protocol/openid-connect/token'),
      expect.any(URLSearchParams),
      expect.any(Object)
    );
    const body = axios.post.mock.calls[0][1];
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_id')).toBe('okf-server');
    expect(body.get('client_secret')).toBe('test-secret');
  });

  test('caches: a second call within the expiry does NOT re-mint', async () => {
    axios.post.mockResolvedValue({ data: { access_token: 'tok-2', expires_in: 3600 } });
    await getServiceToken();
    await getServiceToken();
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test('prefers KEYCLOAK_INTERNAL_URL (split-URL/local) for the token endpoint', async () => {
    axios.post.mockResolvedValue({ data: { access_token: 't', expires_in: 60 } });
    process.env.KEYCLOAK_INTERNAL_URL = 'http://keycloak:8080';
    await getServiceToken();
    expect(axios.post.mock.calls[0][0]).toContain('http://keycloak:8080/realms/genie/protocol/openid-connect/token');
  });

  test('token failure surfaces a clear error (no silent null)', async () => {
    axios.post.mockRejectedValue(new Error('401 invalid_client'));
    await expect(getServiceToken()).rejects.toThrow(/token/i);
  });

  test('authedAxios injects the Bearer header on requests', async () => {
    axios.post.mockResolvedValue({ data: { access_token: 'tok-3', expires_in: 3600 } });
    axios.get.mockResolvedValue({ status: 200, data: {} });
    await authedAxios.get('http://docrepo/api/files/x/view');
    expect(axios.get).toHaveBeenCalledWith(
      'http://docrepo/api/files/x/view',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok-3' }) })
    );
  });
});
