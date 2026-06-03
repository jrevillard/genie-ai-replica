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

// Mock the TARGET service
jest.mock("../../services/service-category-service", () => ({
  getAllCategoriesWithServices: jest.fn(),
  getCategoryWithServices: jest.fn(),
  searchCategoriesAndServices: jest.fn(),
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

const serviceCategoryService = require("../../services/service-category-service");
const {
  keycloakAuthMiddleware,
} = require("../../middleware/keycloak-auth-middleware");

const validToken = createValidToken();

let app;
beforeAll(() => {
  app = createApp({ services: { serviceCategoryService } });
});

beforeEach(() => {
  jest.clearAllMocks();
  keycloakAuthMiddleware.authenticate.mockImplementation((req, res, next) =>
    next(),
  );
});

function authGet(path) {
  return request(app).get(path).set("Authorization", `Bearer ${validToken}`);
}

// ============================================================
// AC3.1: Auth guard — all endpoints require authentication
// ============================================================
describe("Auth guard", () => {
  it("should return 401 on GET /api/services/categories without token", async () => {
    keycloakAuthMiddleware.authenticate.mockImplementation((req, res) => {
      res
        .status(401)
        .json({ error: "TOKEN_INVALID", message: "Authentication required" });
    });

    const response = await request(app).get("/api/services/categories");
    expect(response.status).toBe(401);
  });

  it("should return 401 on GET /api/services/categories/:id without token", async () => {
    keycloakAuthMiddleware.authenticate.mockImplementation((req, res) => {
      res
        .status(401)
        .json({ error: "TOKEN_INVALID", message: "Authentication required" });
    });

    const response = await request(app).get("/api/services/categories/cat1");
    expect(response.status).toBe(401);
  });

  it("should return 401 on GET /api/services/search without token", async () => {
    keycloakAuthMiddleware.authenticate.mockImplementation((req, res) => {
      res
        .status(401)
        .json({ error: "TOKEN_INVALID", message: "Authentication required" });
    });

    const response = await request(app).get("/api/services/search");
    expect(response.status).toBe(401);
  });
});

// ============================================================
// AC3.2: GET /api/services/categories
// ============================================================
describe("GET /api/services/categories", () => {
  it("should return 200 with categories using default locale en", async () => {
    const categories = [{ _key: "cat1", nameEN: "Health" }];
    serviceCategoryService.getAllCategoriesWithServices.mockResolvedValue(
      categories,
    );

    const response = await authGet("/api/services/categories");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(categories);
    expect(
      serviceCategoryService.getAllCategoriesWithServices,
    ).toHaveBeenCalledWith("en");
  });

  it("should pass locale query parameter", async () => {
    serviceCategoryService.getAllCategoriesWithServices.mockResolvedValue([]);

    const response = await authGet("/api/services/categories?locale=fr");

    expect(response.status).toBe(200);
    expect(
      serviceCategoryService.getAllCategoriesWithServices,
    ).toHaveBeenCalledWith("fr");
  });

  it("should return 500 on service error", async () => {
    serviceCategoryService.getAllCategoriesWithServices.mockRejectedValue(
      new Error("DB error"),
    );

    const response = await authGet("/api/services/categories");

    expect(response.status).toBe(500);
    expect(response.body.message).toBe("DB error");
  });
});

// ============================================================
// AC3.3: GET /api/services/categories/:categoryId
// ============================================================
describe("GET /api/services/categories/:categoryId", () => {
  it("should return 200 with category", async () => {
    const category = { _key: "cat1", nameEN: "Health", services: [] };
    serviceCategoryService.getCategoryWithServices.mockResolvedValue(category);

    const response = await authGet("/api/services/categories/cat1");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(category);
    expect(serviceCategoryService.getCategoryWithServices).toHaveBeenCalledWith(
      "cat1",
      "en",
    );
  });

  it("should return 500 via next(error) on service failure", async () => {
    serviceCategoryService.getCategoryWithServices.mockRejectedValue(
      new Error("Not found"),
    );

    const response = await authGet("/api/services/categories/nonexistent");

    expect(response.status).toBe(500);
  });
});

// ============================================================
// AC3.4: GET /api/services/search
// ============================================================
describe("GET /api/services/search", () => {
  it("should return 200 with search results", async () => {
    const results = {
      categories: [],
      services: [{ _key: "s1", nameEN: "Service A" }],
    };
    serviceCategoryService.searchCategoriesAndServices.mockResolvedValue(
      results,
    );

    const response = await authGet("/api/services/search?query=health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(results);
    expect(
      serviceCategoryService.searchCategoriesAndServices,
    ).toHaveBeenCalledWith("health", "en");
  });

  it("should return 400 when query param is missing", async () => {
    const response = await authGet("/api/services/search");

    expect(response.status).toBe(400);
    expect(response.body.message).toContain("required");
  });

  it("should return 500 on service error", async () => {
    serviceCategoryService.searchCategoriesAndServices.mockRejectedValue(
      new Error("Search failed"),
    );

    const response = await authGet("/api/services/search?query=test");

    expect(response.status).toBe(500);
    expect(response.body.message).toBe("Search failed");
  });
});
