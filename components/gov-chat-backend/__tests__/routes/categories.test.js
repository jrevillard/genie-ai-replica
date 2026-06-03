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

// Mock session-service singleton (loaded by index.js)
jest.mock("../../services/session-service", () => ({
  getUserSessions: jest.fn(),
  endSession: jest.fn(),
  createSession: jest.fn(),
}));

// Mock service-category-service with ALL required methods (route constructor validates getAllCategoriesWithServices)
jest.mock("../../services/service-category-service", () => ({
  getAllCategoriesWithServices: jest.fn(),
  getAdminAllCategoriesWithServices: jest.fn(),
  getCategoryWithServices: jest.fn(),
  getCategoryTranslations: jest.fn(),
  getServiceTranslations: jest.fn(),
  searchCategoriesAndServices: jest.fn(),
  createCategory: jest.fn(),
  createServiceWithTranslations: jest.fn(),
  updateCategoryWithTranslations: jest.fn(),
  updateServiceWithTranslations: jest.fn(),
  deleteCategory: jest.fn(),
  deleteService: jest.fn(),
  categoryExists: jest.fn(),
  initializeDefaultCategoriesAndServices: jest.fn(),
  upsertCategories: jest.fn(),
  upsertServices: jest.fn(),
  init: jest.fn(),
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

// Mock all other services loaded by index.js
jest.mock("../../services/user-profile-service", () => ({}));
jest.mock("../../services/admin-dashboard-service", () => ({}));
jest.mock("../../services/analytics-service", () => ({}));
jest.mock("../../services/query-service", () => ({}));
jest.mock("../../services/chat-history-service", () => ({}));
jest.mock("../../services/logs-service", () => ({}));
jest.mock("../../services/database-operations-service", () => ({}));
jest.mock("../../services/weather-service", () => ({}));
jest.mock("../../services/security-scan-service", () => ({}));
jest.mock("../../services/translation-service", () => ({}));

// Mock analytics controller (required to prevent errors when index.js loads analytics-routes)
jest.mock("../../controllers/analyticsController", () => {
  return function () {
    return {};
  };
});

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
const { createMockUser } = require("../fixtures/users");

// Get references to mocked modules
const keycloakAuthService = require("../../services/keycloak-auth-service");
const userProvisioningService = require("../../services/user-provisioning-service");
const serviceCategoryService = require("../../services/service-category-service");

const mockUser = createMockUser();
const validToken = createValidToken();

// Create app once for all tests
let app;
beforeAll(() => {
  app = createApp({ services: { serviceCategoryService } });
});

beforeEach(() => {
  jest.clearAllMocks();

  // Default: middleware passes through with valid user
  keycloakAuthService.verifyToken.mockResolvedValue({
    sub: "user-123",
    iss: "http://localhost:8080/realms/genie",
    iss_sub: "http://localhost:8080/realms/genie#user-123",
    realm_access: { roles: ["user"] },
  });
  keycloakAuthService.checkUserStatusInKeycloak.mockResolvedValue(null);
  userProvisioningService.provisionUser.mockResolvedValue(mockUser);
});

// Helpers for authenticated requests
function authGet(path) {
  return request(app).get(path).set("Authorization", `Bearer ${validToken}`);
}
function authPost(path, body) {
  return request(app)
    .post(path)
    .set("Authorization", `Bearer ${validToken}`)
    .send(body);
}
function authPut(path, body) {
  return request(app)
    .put(path)
    .set("Authorization", `Bearer ${validToken}`)
    .send(body);
}
function authDelete(path) {
  return request(app).delete(path).set("Authorization", `Bearer ${validToken}`);
}

// ============================================================
// Auth guard — all service-categories routes require authentication
// ============================================================
describe("Auth guard", () => {
  it("should return 401 on GET /api/service-categories/categories without token", async () => {
    const response = await request(app).get(
      "/api/service-categories/categories",
    );
    expect(response.status).toBe(401);
  });

  it("should return 401 on POST /api/service-categories without token", async () => {
    const response = await request(app)
      .post("/api/service-categories")
      .send({ nameEN: "test" });
    expect(response.status).toBe(401);
  });
});

// ============================================================
// AC10: GET /api/service-categories/categories
// ============================================================
describe("GET /api/service-categories/categories (AC10)", () => {
  it("should return 200 with category list", async () => {
    const categories = [
      { catKey: "cat-1", name: "Health", children: ["service-1"] },
    ];
    serviceCategoryService.getAllCategoriesWithServices.mockResolvedValue(
      categories,
    );

    const response = await authGet("/api/service-categories/categories");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(categories);
    expect(
      serviceCategoryService.getAllCategoriesWithServices,
    ).toHaveBeenCalledWith("en");
  });

  it("should pass locale query param", async () => {
    serviceCategoryService.getAllCategoriesWithServices.mockResolvedValue([]);

    const response = await authGet(
      "/api/service-categories/categories?locale=fr",
    );

    expect(response.status).toBe(200);
    expect(
      serviceCategoryService.getAllCategoriesWithServices,
    ).toHaveBeenCalledWith("fr");
  });
});

// ============================================================
// AC11: GET /api/service-categories/categories/detailed
// ============================================================
describe("GET /api/service-categories/categories/detailed (AC11)", () => {
  it("should return 200 with detailed category data", async () => {
    const detailedCategories = [
      {
        catKey: "cat-1",
        name: "Health",
        services: [{ _key: "svc-1", nameEN: "Vaccination" }],
      },
    ];
    serviceCategoryService.getAdminAllCategoriesWithServices.mockResolvedValue(
      detailedCategories,
    );

    const response = await authGet(
      "/api/service-categories/categories/detailed",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(detailedCategories);
    expect(
      serviceCategoryService.getAdminAllCategoriesWithServices,
    ).toHaveBeenCalledWith("en");
  });
});

// ============================================================
// AC12: GET /api/service-categories/categories/:categoryId
// ============================================================
describe("GET /api/service-categories/categories/:categoryId (AC12)", () => {
  it("should return 200 with single category when valid ID", async () => {
    const category = {
      catKey: "cat-1",
      name: "Health",
      children: ["service-1"],
    };
    serviceCategoryService.getCategoryWithServices.mockResolvedValue(category);

    const response = await authGet("/api/service-categories/categories/cat-1");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(category);
    expect(serviceCategoryService.getCategoryWithServices).toHaveBeenCalledWith(
      "cat-1",
      "en",
    );
  });

  it("should return 404 when category not found", async () => {
    const notFoundError = new Error("Category not found");
    notFoundError.statusCode = 404;
    serviceCategoryService.getCategoryWithServices.mockRejectedValue(
      notFoundError,
    );

    const response = await authGet(
      "/api/service-categories/categories/nonexistent",
    );

    expect(response.status).toBe(404);
  });
});

// ============================================================
// AC13: Translation endpoints
// ============================================================
describe("GET /api/service-categories/:categoryId/translations (AC13)", () => {
  it("should return 200 with translation list", async () => {
    const translations = [
      { lang: "FR", text: "Santé et services sociaux" },
      { lang: "SW", text: "Afya na huduma za kijamii" },
    ];
    serviceCategoryService.getCategoryTranslations.mockResolvedValue(
      translations,
    );

    const response = await authGet(
      "/api/service-categories/cat-1/translations",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(translations);
    expect(serviceCategoryService.getCategoryTranslations).toHaveBeenCalledWith(
      "cat-1",
    );
  });
});

describe("GET /api/service-categories/services/:serviceId/translations (AC13)", () => {
  it("should return 200 with service translations", async () => {
    const translations = [{ lang: "FR", text: "Vaccination" }];
    serviceCategoryService.getServiceTranslations.mockResolvedValue(
      translations,
    );

    const response = await authGet(
      "/api/service-categories/services/svc-1/translations",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(translations);
    expect(serviceCategoryService.getServiceTranslations).toHaveBeenCalledWith(
      "svc-1",
    );
  });
});

// ============================================================
// AC14: GET /api/service-categories/search
// ============================================================
describe("GET /api/service-categories/search (AC14)", () => {
  it("should return 200 with search results containing categories and services arrays", async () => {
    const searchResults = {
      categories: [{ type: "category", key: "cat-1", name: "Health" }],
      services: [
        {
          type: "service",
          key: "svc-1",
          name: "Vaccination",
          categoryKey: "cat-1",
          categoryName: "Health",
        },
      ],
    };
    serviceCategoryService.searchCategoriesAndServices.mockResolvedValue(
      searchResults,
    );

    const response = await authGet(
      "/api/service-categories/search?query=health",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(searchResults);
    expect(
      serviceCategoryService.searchCategoriesAndServices,
    ).toHaveBeenCalledWith("health", "en");
  });

  it("should return 400 when query param missing", async () => {
    const response = await authGet("/api/service-categories/search");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: "Search query is required" });
  });
});

// ============================================================
// AC15: POST /api/service-categories
// ============================================================
describe("POST /api/service-categories (AC15)", () => {
  it("should return 201 with created category when valid nameEN provided", async () => {
    const createdCategory = { _key: "cat-new", nameEN: "Education" };
    serviceCategoryService.createCategory.mockResolvedValue(createdCategory);

    const response = await authPost("/api/service-categories", {
      nameEN: "Education",
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(createdCategory);
    expect(serviceCategoryService.createCategory).toHaveBeenCalledWith({
      nameEN: "Education",
    });
  });

  it("should return 400 when nameEN missing", async () => {
    const response = await authPost("/api/service-categories", {});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: "Payload with nameEN is required",
    });
  });
});

// ============================================================
// AC16: DELETE endpoints
// ============================================================
describe("DELETE /api/service-categories/:categoryId (AC16)", () => {
  it("should return 200 when category exists", async () => {
    serviceCategoryService.categoryExists.mockResolvedValue(true);
    serviceCategoryService.deleteCategory.mockResolvedValue({});

    const response = await authDelete("/api/service-categories/cat-1");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: "Category cat-1 deleted successfully",
    });
    expect(serviceCategoryService.categoryExists).toHaveBeenCalledWith("cat-1");
    expect(serviceCategoryService.deleteCategory).toHaveBeenCalledWith("cat-1");
    // Verify categoryExists is called before deleteCategory
    const existsOrder =
      serviceCategoryService.categoryExists.mock.invocationCallOrder[0];
    const deleteOrder =
      serviceCategoryService.deleteCategory.mock.invocationCallOrder[0];
    expect(existsOrder).toBeLessThan(deleteOrder);
  });

  it("should return 404 when category not found", async () => {
    serviceCategoryService.categoryExists.mockResolvedValue(false);

    const response = await authDelete("/api/service-categories/nonexistent");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      message: "Category nonexistent not found",
    });
    expect(serviceCategoryService.deleteCategory).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/service-categories/services/:serviceId (AC16)", () => {
  it("should return 200 when service exists", async () => {
    serviceCategoryService.deleteService.mockResolvedValue({});

    const response = await authDelete("/api/service-categories/services/svc-1");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: "Service svc-1 deleted successfully",
    });
    expect(serviceCategoryService.deleteService).toHaveBeenCalledWith("svc-1");
  });

  it("should return 404 when service not found", async () => {
    const notFoundError = new Error("Service not found");
    notFoundError.code = 404;
    serviceCategoryService.deleteService.mockRejectedValue(notFoundError);

    const response = await authDelete(
      "/api/service-categories/services/nonexistent",
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: "Service not found" });
  });
});

// ============================================================
// AC17: PUT endpoints
// ============================================================
describe("PUT /api/service-categories/:categoryId (AC17)", () => {
  it("should return 200 with updated category", async () => {
    const updatedCategory = { _key: "cat-1", nameEN: "Health Updated" };
    serviceCategoryService.updateCategoryWithTranslations.mockResolvedValue(
      updatedCategory,
    );

    const response = await authPut("/api/service-categories/cat-1", {
      nameEN: "Health Updated",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(updatedCategory);
    expect(
      serviceCategoryService.updateCategoryWithTranslations,
    ).toHaveBeenCalledWith("cat-1", {
      nameEN: "Health Updated",
    });
  });
});

describe("PUT /api/service-categories/services/:serviceId (AC17)", () => {
  it("should return 200 with updated service", async () => {
    const updatedService = { _key: "svc-1", nameEN: "Vaccination Updated" };
    serviceCategoryService.updateServiceWithTranslations.mockResolvedValue(
      updatedService,
    );

    const response = await authPut("/api/service-categories/services/svc-1", {
      nameEN: "Vaccination Updated",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(updatedService);
    expect(
      serviceCategoryService.updateServiceWithTranslations,
    ).toHaveBeenCalledWith("svc-1", {
      nameEN: "Vaccination Updated",
    });
  });
});

// ============================================================
// AC21: POST /api/service-categories/:categoryId/services
// ============================================================
describe("POST /api/service-categories/:categoryId/services (AC21)", () => {
  it("should return 201 with created service when valid payload provided", async () => {
    const newService = {
      _key: "svc-new",
      nameEN: "Emergency Care",
      categoryKey: "cat-1",
    };
    serviceCategoryService.createServiceWithTranslations.mockResolvedValue(
      newService,
    );

    const response = await authPost("/api/service-categories/cat-1/services", {
      nameEN: "Emergency Care",
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(newService);
    expect(
      serviceCategoryService.createServiceWithTranslations,
    ).toHaveBeenCalledWith("cat-1", {
      nameEN: "Emergency Care",
    });
  });
});

// ============================================================
// AC22: POST /api/service-categories/init
// ============================================================
describe("POST /api/service-categories/init (AC22)", () => {
  it("should return 200 with initialization result", async () => {
    const initResult = {
      message: "Default categories initialized",
      categoriesCreated: 5,
    };
    serviceCategoryService.initializeDefaultCategoriesAndServices.mockResolvedValue(
      initResult,
    );

    const response = await authPost("/api/service-categories/init", {});

    expect(response.status).toBe(200);
    expect(response.body).toEqual(initResult);
    expect(
      serviceCategoryService.initializeDefaultCategoriesAndServices,
    ).toHaveBeenCalled();
  });
});
