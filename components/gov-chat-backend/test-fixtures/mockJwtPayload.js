"use strict";

// Minimum valid JWT payload for Keycloak tokens
const mockJwtPayload = {
  sub: "12345678-1234-1234-1234-123456789012",
  iss: "http://localhost:8080/realms/genie",
  iss_sub:
    "http://localhost:8080/realms/genie#12345678-1234-1234-1234-123456789012",
  aud: "genie-app",
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
  email: "testuser@example.com",
  name: "Test User",
  preferred_username: "testuser",
  realm_access: {
    roles: ["user", "admin"],
  },
  resource_access: {
    "genie-app": {
      roles: ["user"],
    },
  },
  typ: "Bearer",
  azp: "genie-app",
  session_state: "abc123-session",
  acr: "1",
};

// Payload with expired token
const mockExpiredPayload = {
  ...mockJwtPayload,
  exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
};

// Payload with wrong audience
const mockWrongAudPayload = {
  ...mockJwtPayload,
  aud: "wrong-client-id",
};

// Payload missing required claims
const mockMissingClaimsPayload = {
  sub: "12345678-1234-1234-1234-123456789012",
  // Missing: iss, aud, exp, iat
};

/**
 * Generate a mock JWT string (3 base64url parts separated by dots)
 * This is NOT cryptographically valid — used only for testing middleware
 * token extraction and parsing logic.
 */
function generateMockJwtString(payload = {}) {
  const merged = { ...mockJwtPayload, ...payload };
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "test-key-id", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(merged)).toString("base64url");
  const sig = Buffer.from("mock-signature").toString("base64url");
  return `${header}.${body}.${sig}`;
}

module.exports = {
  mockJwtPayload,
  mockExpiredPayload,
  mockWrongAudPayload,
  mockMissingClaimsPayload,
  generateMockJwtString,
};
