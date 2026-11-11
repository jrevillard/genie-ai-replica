'use strict';

/**
 * Shared jose mock for suites that transitively load keycloak-auth-service
 * (jose is ESM-only and cannot be required as CommonJS by Jest). Use with:
 *
 *   jest.mock('jose', () => require('../mocks/jose'));
 */
module.exports = {
  jwtVerify: jest.fn(),
  createRemoteJWKSet: jest.fn(),
  // The verifier reads a token's protected header with jose's own decoder;
  // a mock without it fails closed, and the symptom (the token is
  // rejected) hides the incomplete mock.
  decodeProtectedHeader: (token) => {
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
    if (typeof header !== 'object' || header === null || Array.isArray(header)) {
      throw new TypeError('Invalid Compact JWS');
    }
    return header;
  }
};
