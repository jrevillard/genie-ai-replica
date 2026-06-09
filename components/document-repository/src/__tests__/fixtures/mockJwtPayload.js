'use strict';

const mockJwtPayload = {
  sub: '12345678-1234-1234-1234-123456789012',
  iss: 'http://localhost:8080/realms/genie',
  aud: 'genie-app',
  azp: 'genie-app',
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
  email: 'testuser@example.com',
  name: 'Test User',
  preferred_username: 'testuser',
  realm_access: {
    roles: ['user', 'admin']
  },
  session_state: 'abc123-session',
  typ: 'Bearer',
  acr: '1'
};

const mockAdminPayload = {
  ...mockJwtPayload,
  realm_access: { roles: ['admin'] }
};

const mockUserOnlyPayload = {
  ...mockJwtPayload,
  realm_access: { roles: ['user'] }
};

const mockDataprepServicePayload = {
  ...mockJwtPayload,
  realm_access: { roles: ['dataprep-service'] },
  azp: 'genie-dataprep'
};

const mockExpiredPayload = {
  ...mockJwtPayload,
  exp: Math.floor(Date.now() / 1000) - 3600
};

function generateMockJwtString(payload = {}) {
  const merged = { ...mockJwtPayload, ...payload };
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key-id', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(merged)).toString('base64url');
  const sig = Buffer.from('mock-signature').toString('base64url');
  return `${header}.${body}.${sig}`;
}

module.exports = {
  mockJwtPayload,
  mockAdminPayload,
  mockUserOnlyPayload,
  mockDataprepServicePayload,
  mockExpiredPayload,
  generateMockJwtString
};
