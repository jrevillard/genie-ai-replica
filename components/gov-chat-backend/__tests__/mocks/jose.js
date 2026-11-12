'use strict';

/**
 * Shared jose mock for suites that transitively load keycloak-auth-service
 * (jose is ESM-only and cannot be required as CommonJS by Jest). Use with:
 *
 *   jest.mock('jose', () => require('../mocks/jose'));
 */
/**
 * Decode a compact JWS's protected header, the way jose does it: a
 * compact JWS has three parts, the header segment is strict base64url,
 * and the decoded value must be a plain object. The verifier reads the
 * token's own header with jose's decoder, so a mock without it fails
 * closed — and the symptom (the token is rejected) hides the incomplete
 * mock.
 */
const decodeProtectedHeader = (token) => {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[0])) {
    throw new TypeError('Invalid Compact JWS');
  }
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  if (typeof header !== 'object' || header === null || Array.isArray(header)) {
    throw new TypeError('Invalid Compact JWS');
  }
  return header;
};

module.exports = {
  jwtVerify: jest.fn(),
  createRemoteJWKSet: jest.fn(),
  decodeProtectedHeader
};
