/**
 * Copyright (C) 2026 International Telecommunication Union (ITU)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Opt-in audience binding (RFC 8707) — Story 6.1 contract test.
 *
 * verifyToken(token, { audience }) passes `audience` to jose's jwtVerify so
 * tokens minted for a different resource are rejected. OMITTED opts = the
 * historical behavior, byte-identical (no audience check) — pinned here so
 * existing callers (backend routes, doc-repo middleware) cannot regress.
 */

const mockJwtVerify = jest.fn();
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => jest.fn()),
  jwtVerify: mockJwtVerify
}));

jest.mock(
  '../../shared-lib',
  () => ({
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
  }),
  { virtual: true }
);

const REAL_FETCH = global.fetch;

function loadService() {
  jest.resetModules();
  process.env.KEYCLOAK_URL = 'https://idp.example/auth';
  process.env.KEYCLOAK_REALM = 'genie';
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      issuer: 'https://idp.example/auth/realms/genie',
      jwks_uri: 'https://idp.example/auth/realms/genie/protocol/openid-connect/certs'
    })
  });
  return require('../../services/keycloak-auth-service');
}

function tokenWith(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({ iss: 'https://idp.example/auth/realms/genie', exp: 9999999999, ...payload })
  ).toString('base64url');
  return `${header}.${body}.signature`;
}

describe('keycloak-auth-service — opt-in audience binding (RFC 8707)', () => {
  beforeEach(() => mockJwtVerify.mockClear());
  afterEach(() => {
    global.fetch = REAL_FETCH;
  });

  test('passes audience to jwtVerify when opts.audience is provided', async () => {
    const svc = loadService();
    mockJwtVerify.mockResolvedValue({ payload: { sub: 'u1', iss: 'https://idp.example/auth/realms/genie', exp: 1 } });
    await svc.verifyToken(tokenWith({ aud: 'okf-server' }), { audience: 'okf-server' });

    expect(mockJwtVerify).toHaveBeenCalledTimes(1);
    const options = mockJwtVerify.mock.calls[0][2];
    expect(options.audience).toBe('okf-server');
  });

  test('OMITTED opts → NO audience key in jwtVerify options (historical default path)', async () => {
    const svc = loadService();
    mockJwtVerify.mockResolvedValue({ payload: { sub: 'u1', iss: 'https://idp.example/auth/realms/genie', exp: 1 } });
    await svc.verifyToken(tokenWith({}));

    const options = mockJwtVerify.mock.calls[0][2];
    expect(options).not.toHaveProperty('audience');
  });

  test('jose aud-claim rejection (JWTClaimValidationFailed) maps to TOKEN_INVALID', async () => {
    const svc = loadService();
    // jose rejects an audience mismatch with JWTClaimValidationFailed (unexpected "aud" claim)
    const audErr = new Error('unexpected "aud" claim value');
    audErr.name = 'JWTClaimValidationFailed';
    audErr.claim = 'aud';
    mockJwtVerify.mockRejectedValue(audErr);

    await expect(
      svc.verifyToken(tokenWith({ aud: 'some-other-client' }), { audience: 'okf-server' })
    ).rejects.toMatchObject({
      code: 'TOKEN_INVALID'
    });
  });

  test('empty-opts object behaves like omitted opts (no audience check)', async () => {
    const svc = loadService();
    mockJwtVerify.mockResolvedValue({ payload: { sub: 'u1', iss: 'https://idp.example/auth/realms/genie', exp: 1 } });
    await svc.verifyToken(tokenWith({}), {});
    const options = mockJwtVerify.mock.calls[0][2];
    expect(options).not.toHaveProperty('audience');
  });
});
