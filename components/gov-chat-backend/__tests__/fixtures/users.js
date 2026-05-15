'use strict';

const defaultUser = {
  _key: 'user-123',
  sub: 'user-123',
  iss_sub: 'http://localhost:8080/realms/genie#user-123',
  iss: 'http://localhost:8080/realms/genie',
  name: 'Test User',
  email: 'test@example.com',
  email_verified: true,
  realm_roles: ['user'],
  resource_access: { 'genie-app': { roles: ['user'] } },
  preferred_username: 'testuser'
};

function createMockUser(overrides = {}) {
  return { ...defaultUser, ...overrides };
}

function createMockAdmin(overrides = {}) {
  return createMockUser({
    realm_roles: ['admin'],
    resource_access: { 'genie-app': { roles: ['admin'] } },
    ...overrides
  });
}

module.exports = { createMockUser, createMockAdmin, defaultUser };
