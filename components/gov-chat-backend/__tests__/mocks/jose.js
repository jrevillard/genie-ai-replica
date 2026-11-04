'use strict';

/**
 * Shared jose mock for suites that transitively load keycloak-auth-service
 * (jose is ESM-only and cannot be required as CommonJS by Jest). Use with:
 *
 *   jest.mock('jose', () => require('../mocks/jose'));
 */
module.exports = {
  jwtVerify: jest.fn(),
  createRemoteJWKSet: jest.fn()
};
