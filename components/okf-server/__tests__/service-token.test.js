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

  test('401 from doc-repo → cache reset, re-mint, retried ONCE with the fresh token (review fix)', async () => {
    const unauthorized = Object.assign(new Error('Request failed with status code 401'), {
      response: { status: 401 }
    });
    let call = 0;
    axios.post.mockImplementation((_url) => {
      call += 1;
      if (call === 1) return Promise.resolve({ data: { access_token: 'stale-token', expires_in: 3600 } });
      if (call === 2) return Promise.reject(unauthorized);
      if (call === 3) return Promise.resolve({ data: { access_token: 'fresh-token', expires_in: 3600 } });
      return Promise.resolve({ status: 202, data: { file_id: 'f1' } });
    });
    const res = await authedAxios.post(
      'http://docrepo/api/files/ingest-bundle',
      { bundle: 'eA==' },
      { timeout: 30000 }
    );
    expect(res.status).toBe(202);
    // call 1 = mint (stale), 2 = ingest attempt (401), 3 = re-mint, 4 = retry with fresh
    const retryHeaders = axios.post.mock.calls[3][2].headers;
    expect(retryHeaders.Authorization).toBe('Bearer fresh-token');
    expect(axios.post).toHaveBeenCalledTimes(4);
  });

  test('a SECOND 401 propagates (retry is once, not a loop)', async () => {
    const unauthorized = Object.assign(new Error('401'), { response: { status: 401 } });
    let call = 0;
    axios.post.mockImplementation(() => {
      call += 1;
      if (call === 1) return Promise.resolve({ data: { access_token: 't1', expires_in: 3600 } });
      if (call === 2 || call === 4) return Promise.reject(unauthorized);
      if (call === 3) return Promise.resolve({ data: { access_token: 't2', expires_in: 3600 } });
      return Promise.reject(unauthorized);
    });
    await expect(authedAxios.post('http://docrepo/api/files/ingest-bundle', {})).rejects.toMatchObject({
      response: { status: 401 }
    });
    expect(axios.post).toHaveBeenCalledTimes(4); // mint, attempt, re-mint, retry — then stop
  });

  test('non-401 errors do NOT trigger a re-mint', async () => {
    axios.post.mockImplementation((url) =>
      url.includes('/token')
        ? Promise.resolve({ data: { access_token: 'tok-9', expires_in: 3600 } })
        : Promise.reject(Object.assign(new Error('500'), { response: { status: 500 } }))
    );
    await expect(authedAxios.post('http://docrepo/api/files/ingest-bundle', {})).rejects.toMatchObject({
      response: { status: 500 }
    });
    // exactly one mint + one attempt
    expect(axios.post).toHaveBeenCalledTimes(2);
  });
});
