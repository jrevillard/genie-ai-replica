"use strict";

require("../setup-env");

// Mock shared-lib — virtual because it only exists after Docker packaging
jest.mock("../../shared-lib", () => require("../mocks/shared-lib"), {
  virtual: true,
});

// Mock keycloak-auth-service (used by middleware)
jest.mock("../../services/keycloak-auth-service", () => ({
  verifyToken: jest.fn(),
  checkUserStatusInKeycloak: jest.fn(),
}));

// Mock user-provisioning-service (used by middleware)
jest.mock("../../services/user-provisioning-service", () => ({
  provisionUser: jest.fn(),
  initialize: jest.fn(),
  markUserAsDeleted: jest.fn(),
}));

// Mock ALL other services loaded by index.js (even unused ones)
jest.mock("../../services/admin-dashboard-service", () => ({
  getSystemHealth: jest.fn(),
  getDatabaseStats: jest.fn(),
  getLogs: jest.fn(),
  rolloverLogs: jest.fn(),
  getUserStats: jest.fn(),
  searchLogs: jest.fn(),
  debugYesterdayLogs: jest.fn(),
  backupDatabase: jest.fn(),
  optimizeDatabase: jest.fn(),
  searchUsers: jest.fn(),
  runDiagnostics: jest.fn(),
}));
jest.mock("../../services/user-profile-service", () => ({}));
jest.mock("../../services/analytics-service", () => ({}));
jest.mock("../../services/query-service", () => ({}));
jest.mock("../../services/chat-history-service", () => ({}));
jest.mock("../../services/service-category-service", () => ({}));
jest.mock("../../services/database-operations-service", () => ({}));
jest.mock("../../services/weather-service", () => ({}));
jest.mock("../../services/translation-service", () => ({}));
jest.mock("../../services/session-service", () => ({
  getUserSessions: jest.fn(),
  endSession: jest.fn(),
  createSession: jest.fn(),
}));
jest.mock("../../services/logs-service", () => ({
  getLogsSummary: jest.fn(),
}));
jest.mock("../../services/security-scan-service", () => ({
  getLastScanDetails: jest.fn(),
  runSecurityScan: jest.fn(),
}));

// Mock swagger dependencies
jest.mock(
  "swagger-jsdoc",
  () => () => ({
    openapi: "3.0.0",
    info: {},
    components: {},
    security: [],
  }),
  { virtual: true },
);
jest.mock(
  "swagger-ui-express",
  () => ({
    serve: [],
    setup: () => (req, res, next) => next(),
  }),
  { virtual: true },
);

// Mock keycloak-auth-middleware — allow pass-through, override for 401/403 tests
jest.mock("../../middleware/keycloak-auth-middleware", () => ({
  keycloakAuthMiddleware: {
    authenticate: jest.fn((req, res, next) => next()),
    requireAdmin: jest.fn((req, res, next) => next()),
  },
}));

// Prevent process.exit during tests
const originalExit = process.exit;
beforeAll(() => {
  process.exit = jest.fn();
});
afterAll(() => {
  process.exit = originalExit;
});

const { createApp } = require("../../index");
const request = require("supertest");
const { createValidToken } = require("../fixtures/tokens");

const sharedLib = require("../../shared-lib");
const {
  keycloakAuthMiddleware,
} = require("../../middleware/keycloak-auth-middleware");

const validToken = createValidToken();

let app;
beforeAll(() => {
  app = createApp();
});

beforeEach(() => {
  jest.clearAllMocks();
  keycloakAuthMiddleware.authenticate.mockImplementation((req, res, next) =>
    next(),
  );
  keycloakAuthMiddleware.requireAdmin.mockImplementation((req, res, next) =>
    next(),
  );
});

function authPost(path, body) {
  return request(app)
    .post(path)
    .set("Authorization", `Bearer ${validToken}`)
    .send(body);
}

// ============================================================
// AC5.1: Auth guard — both endpoints require authentication + admin
// ============================================================
describe("Auth guard", () => {
  it("should return 401 on POST /api/logger/configure without token", async () => {
    keycloakAuthMiddleware.authenticate.mockImplementation((req, res) => {
      res
        .status(401)
        .json({ error: "TOKEN_INVALID", message: "Authentication required" });
    });

    const response = await request(app)
      .post("/api/logger/configure")
      .send({ level: "debug" });
    expect(response.status).toBe(401);
  });

  it("should return 403 for non-admin user on POST /api/logger/configure", async () => {
    keycloakAuthMiddleware.requireAdmin.mockImplementation((req, res) => {
      res
        .status(403)
        .json({ error: "FORBIDDEN", message: "Admin access required" });
    });

    const response = await authPost("/api/logger/configure", {
      level: "debug",
    });
    expect(response.status).toBe(403);
  });

  it("should return 401 on POST /api/logger/rollover without token", async () => {
    keycloakAuthMiddleware.authenticate.mockImplementation((req, res) => {
      res
        .status(401)
        .json({ error: "TOKEN_INVALID", message: "Authentication required" });
    });

    const response = await request(app).post("/api/logger/rollover");
    expect(response.status).toBe(401);
  });

  it("should return 403 for non-admin user on POST /api/logger/rollover", async () => {
    keycloakAuthMiddleware.requireAdmin.mockImplementation((req, res) => {
      res
        .status(403)
        .json({ error: "FORBIDDEN", message: "Admin access required" });
    });

    const response = await authPost("/api/logger/rollover", {});
    expect(response.status).toBe(403);
  });
});

// ============================================================
// AC5.2: POST /api/logger/configure
// ============================================================
describe("POST /api/logger/configure", () => {
  it("should return 200 with valid level", async () => {
    const response = await authPost("/api/logger/configure", {
      level: "debug",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: "Logger configuration updated successfully",
    });
    expect(sharedLib.reconfigureLogger).toHaveBeenCalledWith({
      level: "debug",
      errorMaxSize: undefined,
      combinedMaxSize: undefined,
      errorMaxFiles: undefined,
      combinedMaxFiles: undefined,
      zippedArchive: undefined,
    });
  });

  it("should return 200 with all valid parameters", async () => {
    const response = await authPost("/api/logger/configure", {
      level: "info",
      errorMaxSize: "10m",
      combinedMaxSize: "20m",
      errorMaxFiles: "14d",
      combinedMaxFiles: "7d",
      zippedArchive: true,
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(sharedLib.reconfigureLogger).toHaveBeenCalledWith({
      level: "info",
      errorMaxSize: "10m",
      combinedMaxSize: "20m",
      errorMaxFiles: "14d",
      combinedMaxFiles: "7d",
      zippedArchive: true,
    });
  });

  it("should return 400 when no parameters provided", async () => {
    const response = await authPost("/api/logger/configure", {});

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain("At least one");
  });

  it("should return 400 for invalid level", async () => {
    const response = await authPost("/api/logger/configure", {
      level: "trace",
    });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain("Invalid log level");
  });

  it("should return 400 for invalid errorMaxSize format", async () => {
    const response = await authPost("/api/logger/configure", {
      errorMaxSize: "10x",
    });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain("errorMaxSize");
  });

  it("should return 400 for invalid combinedMaxSize format", async () => {
    const response = await authPost("/api/logger/configure", {
      combinedMaxSize: "abc",
    });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain("combinedMaxSize");
  });

  it("should return 400 for invalid errorMaxFiles format", async () => {
    const response = await authPost("/api/logger/configure", {
      errorMaxFiles: "14m",
    });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain("errorMaxFiles");
  });

  it("should return 400 for invalid combinedMaxFiles format", async () => {
    const response = await authPost("/api/logger/configure", {
      combinedMaxFiles: "7m",
    });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain("combinedMaxFiles");
  });

  it("should return 500 when reconfigureLogger throws", async () => {
    sharedLib.reconfigureLogger.mockImplementation(() => {
      throw new Error("Config failed");
    });

    const response = await authPost("/api/logger/configure", {
      level: "debug",
    });

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
  });
});

// ============================================================
// AC5.3: POST /api/logger/rollover
// ============================================================
describe("POST /api/logger/rollover", () => {
  it("should return 200 on successful rollover", async () => {
    const response = await authPost("/api/logger/rollover", {});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: "Log rollover triggered successfully",
    });
    expect(sharedLib.triggerLogRollover).toHaveBeenCalled();
  });

  it("should return 500 when triggerLogRollover throws", async () => {
    sharedLib.triggerLogRollover.mockImplementation(() => {
      throw new Error("Rollover failed");
    });

    const response = await authPost("/api/logger/rollover", {});

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain("Failed");
  });
});
