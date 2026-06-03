"use strict";

// Set env vars BEFORE any module that reads them is loaded
process.env.KEYCLOAK_URL = "https://localhost/auth";
process.env.KEYCLOAK_REALM = "genie";
process.env.KEYCLOAK_PROXY_CLIENT_ID = "genie-proxy-client";
process.env.KEYCLOAK_PROXY_CLIENT_SECRET = "test-secret";

// Mock arangojs with aql helper that returns proper object structure
const mockAql = jest.fn((strings, ...values) => {
  // Simplified mock that returns an object with query property
  let query = strings.raw[0];
  for (let i = 0; i < values.length; i++) {
    // Replace placeholders with actual values for test inspection
    query += JSON.stringify(values[i]) + strings.raw[i + 1];
  }
  return { query, bindVars: {} };
});

jest.mock(
  "arangojs",
  () => ({
    aql: mockAql,
  }),
  { virtual: true },
);

// Mock shared-lib
jest.mock(
  "../shared-lib",
  () => ({
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
    dbService: {
      getConnection: jest.fn(),
    },
  }),
  { virtual: true },
);

const keycloakProxyService = require("../services/keycloak-proxy-service");
const { dbService } = require("../shared-lib");

function mockCursor(result) {
  return { next: jest.fn().mockResolvedValue(result) };
}

function setupDbForResolve(result = "uuid-12345") {
  const db = { query: jest.fn().mockResolvedValueOnce(mockCursor(result)) };
  dbService.getConnection.mockResolvedValueOnce(db);
  return db;
}

function mockTokenResponse() {
  return {
    ok: true,
    json: async () => ({ access_token: "test-token-123" }),
  };
}

function mockOkResponse(status = 204) {
  const resp = { ok: true, status };
  if (status !== 204) resp.json = async () => ({});
  return resp;
}

describe("keycloak-proxy-service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    delete process.env.KEYCLOAK_PROXY_CLIENT_ID;
    delete process.env.KEYCLOAK_PROXY_CLIENT_SECRET;
  });

  describe("_resolveKeycloakUserId", () => {
    it("should throw if user not found", async () => {
      const db = {
        query: jest
          .fn()
          .mockResolvedValueOnce({
            next: jest.fn().mockResolvedValue(undefined),
          }),
      };
      dbService.getConnection.mockResolvedValueOnce(Promise.resolve(db));

      await expect(
        keycloakProxyService._resolveKeycloakUserId("missing-key"),
      ).rejects.toThrow("has no Keycloak UUID");
    });

    it("should resolve Keycloak UUID from ArangoDB sub field", async () => {
      const db = {
        query: jest
          .fn()
          .mockResolvedValueOnce({
            next: jest.fn().mockResolvedValue("uuid-12345"),
          }),
      };
      dbService.getConnection.mockResolvedValueOnce(Promise.resolve(db));

      const uuid =
        await keycloakProxyService._resolveKeycloakUserId("user-key-1");
      expect(uuid).toBe("uuid-12345");
    });
  });

  describe("getServiceAccountToken", () => {
    it("should obtain a token via client credentials grant", async () => {
      keycloakProxyService._clearTokenCache();
      global.fetch = jest.fn().mockResolvedValueOnce(mockTokenResponse());

      const result = await keycloakProxyService.getServiceAccountToken();
      expect(result).toBe("test-token-123");
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/protocol/openid-connect/token"),
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("should throw on token acquisition failure", async () => {
      keycloakProxyService._clearTokenCache();
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Invalid client",
      });

      await expect(
        keycloakProxyService.getServiceAccountToken(),
      ).rejects.toThrow("Failed to obtain service account token");
    });
  });

  describe("deleteUser", () => {
    it("should delete from Keycloak and set deleted=true in ArangoDB", async () => {
      keycloakProxyService._clearTokenCache();
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(mockTokenResponse())
        .mockResolvedValueOnce(mockOkResponse(204));

      const db = { query: jest.fn() };
      db.query.mockResolvedValueOnce(mockCursor("uuid-abc")); // UUID resolution
      db.query.mockResolvedValueOnce({}); // ArangoDB update
      dbService.getConnection.mockResolvedValue(Promise.resolve(db));

      await keycloakProxyService.deleteUser("user-key");
      expect(db.query).toHaveBeenCalledTimes(2);
    });

    it("should nullify all PII fields (email, name, sub, iss, iss_sub)", async () => {
      keycloakProxyService._clearTokenCache();
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(mockTokenResponse())
        .mockResolvedValueOnce(mockOkResponse(204));

      const capturedAql = [];
      const db = {
        query: jest.fn().mockImplementation((aqlObj) => {
          capturedAql.push(aqlObj);
          if (capturedAql.length === 1)
            return Promise.resolve(mockCursor("uuid-abc"));
          return Promise.resolve({});
        }),
      };
      dbService.getConnection.mockResolvedValue(Promise.resolve(db));

      await keycloakProxyService.deleteUser("user-key");

      expect(capturedAql).toHaveLength(2);
      const updateAql = capturedAql[1];
      expect(updateAql).toHaveProperty("query");
      expect(updateAql.query).toContain("email: null");
      expect(updateAql.query).toContain("name: null");
      expect(updateAql.query).toContain("sub: null");
      expect(updateAql.query).toContain("iss: null");
      expect(updateAql.query).toContain("iss_sub: null");
    });

    it("should set roles, active, deleted, and erasedAt", async () => {
      keycloakProxyService._clearTokenCache();
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(mockTokenResponse())
        .mockResolvedValueOnce(mockOkResponse(204));

      const capturedAql = [];
      const db = {
        query: jest.fn().mockImplementation((aqlObj) => {
          capturedAql.push(aqlObj);
          if (capturedAql.length === 1)
            return Promise.resolve(mockCursor("uuid-abc"));
          return Promise.resolve({});
        }),
      };
      dbService.getConnection.mockResolvedValue(Promise.resolve(db));

      await keycloakProxyService.deleteUser("user-key");

      const updateAql = capturedAql[1];
      expect(updateAql.query).toContain("roles: []");
      expect(updateAql.query).toContain("active: false");
      expect(updateAql.query).toContain("deleted: true");
      expect(updateAql.query).toContain("erasedAt: DATE_ISO8601(DATE_NOW())");
    });

    it("should UNSET personalIdentification custom PII field", async () => {
      keycloakProxyService._clearTokenCache();
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(mockTokenResponse())
        .mockResolvedValueOnce(mockOkResponse(204));

      const capturedAql = [];
      const db = {
        query: jest.fn().mockImplementation((aqlObj) => {
          capturedAql.push(aqlObj);
          if (capturedAql.length === 1)
            return Promise.resolve(mockCursor("uuid-abc"));
          return Promise.resolve({});
        }),
      };
      dbService.getConnection.mockResolvedValue(Promise.resolve(db));

      await keycloakProxyService.deleteUser("user-key");

      const updateAql = capturedAql[1];
      expect(updateAql.query).toContain("personalIdentification: null");
    });

    it('should log "User erased" message (distinct from soft-delete)', async () => {
      keycloakProxyService._clearTokenCache();
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(mockTokenResponse())
        .mockResolvedValueOnce(mockOkResponse(204));

      const { logger } = require("../shared-lib");
      const db = { query: jest.fn() };
      db.query.mockResolvedValueOnce(mockCursor("uuid-abc"));
      db.query.mockResolvedValueOnce({});
      dbService.getConnection.mockResolvedValue(Promise.resolve(db));

      await keycloakProxyService.deleteUser("user-key");

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("User erased"),
        expect.any(Object),
      );
    });

    it("should handle double-erase gracefully (idempotent on 404)", async () => {
      keycloakProxyService._clearTokenCache();
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(mockTokenResponse())
        .mockResolvedValueOnce(mockOkResponse(204)); // First delete

      const db = { query: jest.fn() };
      db.query.mockResolvedValueOnce(mockCursor("uuid-abc"));
      db.query.mockResolvedValueOnce({});
      dbService.getConnection.mockResolvedValue(Promise.resolve(db));

      // First delete
      await keycloakProxyService.deleteUser("user-key");
      expect(db.query).toHaveBeenCalledTimes(2);

      // Second delete - Keycloak will return 404 (user already gone)
      // deleteUser() is idempotent: 404 is handled gracefully (no throw)
      keycloakProxyService._clearTokenCache();
      db.query = jest.fn();
      db.query.mockResolvedValueOnce(mockCursor("uuid-abc"));
      dbService.getConnection.mockResolvedValue(Promise.resolve(db));

      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(mockTokenResponse())
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: async () => "Not found",
        });

      // Keycloak 404 should NOT throw — erasure is idempotent
      await expect(
        keycloakProxyService.deleteUser("user-key"),
      ).resolves.not.toThrow();
    });

    it("should throw partial erasure error if ArangoDB update fails after Keycloak delete", async () => {
      keycloakProxyService._clearTokenCache();
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(mockTokenResponse())
        .mockResolvedValueOnce(mockOkResponse(204)); // Keycloak DELETE succeeds

      const db = { query: jest.fn() };
      db.query.mockResolvedValueOnce(mockCursor("uuid-abc"));
      db.query.mockRejectedValueOnce(new Error("ArangoDB connection lost")); // ArangoDB fails
      dbService.getConnection.mockResolvedValue(Promise.resolve(db));

      const { logger } = require("../shared-lib");

      // Should throw partial erasure error
      await expect(keycloakProxyService.deleteUser("user-key")).rejects.toThrow(
        "Partial erasure: user deleted from Keycloak but ArangoDB erasure failed",
      );

      // Should log the error state
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          "ArangoDB erasure failed after Keycloak delete",
        ),
        expect.objectContaining({
          userKey: "user-key",
          state: "PARTIAL_ERASURE",
        }),
      );
    });
  });

  // Soft-delete vs Erasure Distinction (documented here for reference)
  //
  // markUserAsDeleted() in user-provisioning-service.js:
  //   - Sets: deleted: true, deletedAt: now, updatedAt: now
  //   - Preserves: sub, iss_sub, email, name, roles (re-activatable via Story 3.6)
  //
  // deleteUser() in keycloak-proxy-service.js (this file):
  //   - Sets: deleted: true, erasedAt: now, AND nullifies all PII including sub, iss_sub
  //   - Permanent, not re-activatable
  //
  // Actual verification of markUserAsDeleted behavior is in user-provisioning-service.test.js

  describe("updateOwnProfile", () => {
    it("should update profile via Account API with user token", async () => {
      global.fetch = jest.fn().mockResolvedValueOnce(mockOkResponse(200));

      await keycloakProxyService.updateOwnProfile("user-access-token", {
        email: "new@test.com",
      });

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toContain("/realms/genie/account");
      expect(options.method).toBe("PUT");
      expect(options.headers.Authorization).toBe("Bearer user-access-token");
    });

    it("should throw on Account API error", async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 409,
          text: async () => "Duplicate email",
        });

      await expect(
        keycloakProxyService.updateOwnProfile("token", {
          email: "dup@test.com",
        }),
      ).rejects.toThrow("Conflict in Keycloak operation");
    });
  });

  describe("_mapKeycloakError", () => {
    it("should map 404 to user not found", () => {
      const error = keycloakProxyService._mapKeycloakError(
        404,
        "Not found",
        "/users/x",
      );
      expect(error.message).toBe("User not found in Keycloak");
      expect(error.status).toBe(404);
    });

    it("should map 403 to insufficient permissions", () => {
      const error = keycloakProxyService._mapKeycloakError(
        403,
        "Forbidden",
        "/users/x",
      );
      expect(error.message).toBe(
        "Insufficient permissions for Keycloak operation",
      );
    });

    it("should map 409 to conflict", () => {
      const error = keycloakProxyService._mapKeycloakError(
        409,
        "Conflict",
        "/users/x",
      );
      expect(error.message).toBe(
        "Conflict in Keycloak operation (e.g. duplicate email)",
      );
    });
  });

  describe("_adminApiCall", () => {
    it("should lazy-refresh token on 401", async () => {
      keycloakProxyService._clearTokenCache();
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(mockTokenResponse()) // initial token
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          text: async () => "Expired",
        })
        .mockResolvedValueOnce(mockTokenResponse()) // refreshed token
        .mockResolvedValueOnce(mockOkResponse(204)); // retry

      setupDbForResolve("uuid-abc");

      await keycloakProxyService.deleteUser("user-key");
      expect(global.fetch).toHaveBeenCalledTimes(4);
    });
  });
});
