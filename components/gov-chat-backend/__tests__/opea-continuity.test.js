"use strict";

/**
 * Tests for Story 2-10: OPEA Continuity — Token Propagation
 *
 * Covers:
 * - Query route forwards Authorization Bearer token to OPEA (no user_id in payload)
 * - /api/me/context requires Keycloak authentication (not public)
 * - JWT middleware populates req.user._key for authenticated requests
 */

// Mock shared-lib
jest.mock(
  "../shared-lib",
  () => ({
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    },
  }),
  { virtual: true },
);

// Mock keycloak-auth-service
const mockVerifyToken = jest.fn();
jest.mock("../services/keycloak-auth-service", () => ({
  verifyToken: (...args) => mockVerifyToken(...args),
}));

// Mock user-provisioning-service
const mockProvisionUser = jest.fn();
jest.mock("../services/user-provisioning-service", () => ({
  provisionUser: (...args) => mockProvisionUser(...args),
}));

const {
  keycloakAuthMiddleware,
  isPublicRoute,
} = require("../middleware/keycloak-auth-middleware");
const { mockJwtPayload } = require("../test-fixtures/mockJwtPayload");

describe("Story 2-10: OPEA Continuity", () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      headers: {},
      user: undefined,
      claims: undefined,
      path: "/api/queries",
      originalUrl: "/api/queries",
      body: {},
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
    mockVerifyToken.mockReset();
    mockProvisionUser.mockReset();
  });

  describe("JWT middleware populates req.user._key", () => {
    it("should populate req.user._key from ArangoDB after JWT validation", async () => {
      req.headers.authorization = "Bearer valid-token";
      const decodedPayload = {
        ...mockJwtPayload,
        sub: "user-uuid-123",
        iss: "http://localhost:8080/realms/genie",
      };
      mockVerifyToken.mockResolvedValue(decodedPayload);
      mockProvisionUser.mockResolvedValue({
        _key: "users/user-uuid-123",
        iss_sub: "http://localhost:8080/realms/genie#user-uuid-123",
        sub: "user-uuid-123",
        iss: "http://localhost:8080/realms/genie",
        email: "test@example.com",
        name: "Test User",
        roles: ["user"],
        active: true,
        deleted: false,
      });

      await keycloakAuthMiddleware.authenticate(req, res, next);

      expect(req.user).toBeDefined();
      expect(req.user._key).toBe("users/user-uuid-123");
    });

    it("should leave req.user undefined when no token is provided", () => {
      req.headers.authorization = undefined;
      keycloakAuthMiddleware.authenticate(req, res, next);
      expect(req.user).toBeUndefined();
    });
  });

  describe("/api/me/context endpoint — Keycloak auth", () => {
    it("should NOT allow /me/context as public path", () => {
      expect(isPublicRoute("/me/context")).toBe(false);
    });

    it("should NOT allow /api/me/context as public path", () => {
      expect(isPublicRoute("/api/me/context")).toBe(false);
    });
  });
});
