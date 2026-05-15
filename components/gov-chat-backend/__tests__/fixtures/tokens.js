'use strict';

const jwt = require('jsonwebtoken');

const TEST_JWT_SECRET = 'test-secret-key-for-fixtures';

const defaultTokenClaims = {
  sub: 'user-123',
  iss: 'http://localhost:8080/realms/genie',
  iss_sub: 'http://localhost:8080/realms/genie#user-123',
  name: 'Test User',
  email: 'test@example.com',
  realm_access: { roles: ['user'] },
  resource_access: { 'genie-app': { roles: ['user'] } }
};

function createValidToken(claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    ...defaultTokenClaims,
    exp: now + 3600,
    iat: now,
    ...claims
  };
  return jwt.sign(payload, TEST_JWT_SECRET);
}

function createExpiredToken(claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    ...defaultTokenClaims,
    exp: now - 3600,
    iat: now - 7200,
    ...claims
  };
  return jwt.sign(payload, TEST_JWT_SECRET);
}

module.exports = { createValidToken, createExpiredToken, TEST_JWT_SECRET };
