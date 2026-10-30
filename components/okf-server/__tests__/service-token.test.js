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
    // The authedAxios egress allowlist validates origins against the SAME
    // env the config module reads — the tests' http://docrepo URLs need it.
    process.env.DOCUMENT_REPOSITORY_URL = 'http://docrepo';
    delete process.env.KEYCLOAK_INTERNAL_URL;
    delete process.env.KEYCLOAK_PUBLIC_URL;
    delete process.env.KEYCLOAK_URL;
  });
  afterEach(() => {
    delete process.env.KC_OKF_SERVER_CLIENT_ID;
    delete process.env.KC_OKF_SERVER_CLIENT_SECRET;
    delete process.env.KEYCLOAK_INTERNAL_URL;
    delete process.env.KEYCLOAK_PUBLIC_URL;
    delete process.env.KEYCLOAK_URL;
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

  test('FAILOVER: an unreachable first endpoint falls through to the next (live-caught 2026-09-01)', async () => {
    process.env.KEYCLOAK_URL = 'https://localhost/auth'; // browser-facing alias — dead from inside a container
    // expires_in: 1 (< the 30s refresh buffer) so the SECOND getServiceToken
    // call re-mints — proving the WINNER endpoint is remembered (no dead-end retry).
    axios.post.mockImplementation((url) =>
      url.startsWith('https://localhost/auth')
        ? Promise.reject(new Error('Client network socket disconnected before secure TLS connection was established'))
        : Promise.resolve({ data: { access_token: 'tok-via-fallback', expires_in: 1 } })
    );
    const t = await getServiceToken();
    expect(t).toBe('tok-via-fallback');
    // first mint tried the dead public alias, then the next candidate
    expect(axios.post.mock.calls[0][0]).toContain('https://localhost/auth/realms/genie');
    expect(axios.post.mock.calls[1][0]).not.toContain('localhost');
    // the WINNER is cached: re-mint goes straight to the working endpoint
    axios.post.mockClear();
    await getServiceToken();
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][0]).not.toContain('localhost');
  });

  test('token failure surfaces a clear error (no silent null)', async () => {
    axios.post.mockRejectedValue(new Error('401 invalid_client'));
    await expect(getServiceToken()).rejects.toThrow(/token/i);
  });

  test('all-endpoints-down error NAMES every endpoint tried (Winston strips metadata)', async () => {
    process.env.KEYCLOAK_URL = 'http://kong:8000/auth';
    process.env.KEYCLOAK_PUBLIC_URL = 'https://localhost/auth';
    axios.post.mockRejectedValue(new Error('socket disconnected'));
    await expect(getServiceToken()).rejects.toThrow(/failed for \d+ endpoint\(s\): .*kong:8000.*localhost\/auth/s);
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

  test('egress guard: a non-docrepo URL is rejected BEFORE any request or mint (review 2026-10-29 wave 2)', async () => {
    // Link-local metadata address — the canonical SSRF target. The allowlist
    // must refuse it at the choke point, with no HTTP attempt and no
    // service-account mint fired for a call that can never be made.
    await expect(authedAxios.get('http://169.254.169.254/latest/meta-data')).rejects.toThrow(
      /not the configured document repository/
    );
    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('egress fallback: with DOCUMENT_REPOSITORY_URL unset the allowlist reads config.documentRepository.url', async () => {
    // The fallback literal was once duplicated here and in config.js — a config
    // default edit would have left this allowlist comparing against the stale
    // literal and fail-closed every okf-server → doc-repo call. The fallback
    // now comes FROM config; pin that the config default is accepted (and a
    // stray origin still is not) on a config instance loaded without the env
    // var (config.js snapshots process.env at require time, hence resetModules).
    delete process.env.DOCUMENT_REPOSITORY_URL;
    jest.resetModules();
    const freshAxios = require('axios');
    freshAxios.post.mockResolvedValue({ data: { access_token: 'tok-cfg', expires_in: 3600 } });
    freshAxios.get.mockResolvedValue({ status: 200, data: {} });
    const { authedAxios: freshAuthed } = require('../services/service-token');
    await expect(freshAuthed.get('http://document-repository:3001/api/files/x')).resolves.toBeDefined();
    await expect(freshAuthed.get('http://169.254.169.254/latest/meta-data')).rejects.toThrow(
      /not the configured document repository/
    );
  });
});
