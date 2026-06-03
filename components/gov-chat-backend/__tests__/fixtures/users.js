"use strict";

const defaultUser = {
  _key: "user-123",
  sub: "user-123",
  iss_sub: "http://localhost:8080/realms/genie#user-123",
  iss: "http://localhost:8080/realms/genie",
  name: "Test User",
  email: "test@example.com",
  email_verified: true,
  realm_roles: ["user"],
  resource_access: { "genie-app": { roles: ["user"] } },
  preferred_username: "testuser",
};

function createMockUser(overrides = {}) {
  const safeOverrides = overrides || {};
  return { ...defaultUser, ...safeOverrides };
}

function createMockAdmin(overrides = {}) {
  const safeOverrides = overrides || {};
  return createMockUser({
    realm_roles: ["admin"],
    resource_access: { "genie-app": { roles: ["admin"] } },
    ...safeOverrides,
  });
}

module.exports = { createMockUser, createMockAdmin, defaultUser };
