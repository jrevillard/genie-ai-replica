"use strict";

require("../setup-env");

jest.mock("dotenv", () => ({ config: jest.fn() }));

jest.mock("arangojs", () => ({
  aql: (strings, ...values) => ({ _aql: true, strings, values }),
}));

jest.mock(
  "../../shared-lib",
  () => ({
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    },
    dbService: { getConnection: jest.fn() },
  }),
  { virtual: true },
);

jest.mock("../../middleware/errors", () => ({
  NotFoundError: class NotFoundError extends Error {
    constructor(msg) {
      super(msg);
      this.name = "NotFoundError";
    }
  },
  ValidationError: class ValidationError extends Error {
    constructor(msg) {
      super(msg);
      this.name = "ValidationError";
    }
  },
}));

const { dbService } = require("../../shared-lib");

function createMockCollection() {
  return {
    save: jest.fn().mockResolvedValue({ _key: "cat-1" }),
    update: jest.fn().mockResolvedValue({ _key: "cat-1" }),
    document: jest.fn().mockResolvedValue({ _key: "cat-1", nameEN: "Test" }),
    remove: jest.fn().mockResolvedValue({ _key: "cat-1" }),
    ensureIndex: jest.fn(),
  };
}

function createMockCursor(results) {
  return {
    next: jest.fn().mockResolvedValue(results.length > 0 ? results[0] : null),
    all: jest.fn().mockResolvedValue(results),
  };
}

let service;
let mockDb;
let mockServiceCategories;
let mockServices;
let mockCategoryServices;
let mockServiceCategoryTranslations;
let mockServiceTranslations;

beforeEach(() => {
  jest.clearAllMocks();

  mockServiceCategories = createMockCollection();
  mockServices = createMockCollection();
  mockCategoryServices = createMockCollection();
  mockServiceCategoryTranslations = createMockCollection();
  mockServiceTranslations = createMockCollection();

  mockDb = {
    collection: jest.fn().mockImplementation((name) => {
      const map = {
        serviceCategories: mockServiceCategories,
        services: mockServices,
        categoryServices: mockCategoryServices,
        serviceCategoryTranslations: mockServiceCategoryTranslations,
        serviceTranslations: mockServiceTranslations,
      };
      return map[name] || createMockCollection();
    }),
    query: jest.fn(),
  };

  dbService.getConnection.mockResolvedValue(mockDb);

  jest.isolateModules(() => {
    service = require("../../services/service-category-service");
  });
  service.initialized = false;
});

describe("ServiceCategoryService", () => {
  beforeEach(async () => {
    await service.init();
  });

  describe("init", () => {
    it("should initialize all 5 collections", async () => {
      expect(mockDb.collection).toHaveBeenCalledWith("serviceCategories");
      expect(mockDb.collection).toHaveBeenCalledWith("services");
      expect(mockDb.collection).toHaveBeenCalledWith("categoryServices");
      expect(mockDb.collection).toHaveBeenCalledWith(
        "serviceCategoryTranslations",
      );
      expect(mockDb.collection).toHaveBeenCalledWith("serviceTranslations");
      expect(service.initialized).toBe(true);
    });

    it("should skip re-initialization", async () => {
      service.initialized = true;
      await service.init();
      expect(dbService.getConnection).toHaveBeenCalledTimes(1);
    });
  });

  describe("upsertCategories", () => {
    it("should create categories with translations", async () => {
      const categories = [
        {
          name: "Taxes",
          catKey: "taxes",
          translations: [{ lang: "fr", text: "Impots" }],
        },
      ];

      const result = await service.upsertCategories(categories, "en");

      expect(result).toHaveLength(1);
      expect(mockServiceCategories.save).toHaveBeenCalledWith(
        expect.objectContaining({ nameEN: "Taxes", catCode: "taxes" }),
      );
      expect(mockServiceCategoryTranslations.save).toHaveBeenCalledTimes(2);
    });

    it("should create category with default name when missing", async () => {
      const categories = [{}];

      await service.upsertCategories(categories);
      expect(mockServiceCategories.save).toHaveBeenCalledWith(
        expect.objectContaining({ nameEN: "Category 1" }),
      );
    });

    it("should throw on database error", async () => {
      mockServiceCategories.save.mockRejectedValue(new Error("DB error"));

      await expect(
        service.upsertCategories([{ name: "Test" }]),
      ).rejects.toThrow("DB error");
    });
  });

  describe("upsertServices", () => {
    it("should create services with translations and edges", async () => {
      mockServices.save
        .mockResolvedValueOnce({ _key: "svc-1" })
        .mockResolvedValueOnce({ _key: "svc-2" });

      const result = await service.upsertServices(
        "cat-1",
        ["Service A", "Service B"],
        "en",
      );

      expect(result).toHaveLength(2);
      expect(mockServices.save).toHaveBeenCalledTimes(2);
      expect(mockServiceTranslations.save).toHaveBeenCalledTimes(2);
      expect(mockCategoryServices.save).toHaveBeenCalledTimes(2);
    });

    it("should return empty array when categoryKey is missing", async () => {
      const result = await service.upsertServices(null, ["Test"]);
      expect(result).toEqual([]);
    });

    it("should return empty array when services is not an array", async () => {
      const result = await service.upsertServices("cat-1", "not-array");
      expect(result).toEqual([]);
    });

    it("should skip empty service names", async () => {
      mockServices.save.mockResolvedValue({ _key: "svc-1" });

      const result = await service.upsertServices("cat-1", ["Valid", "", "  "]);
      expect(result).toHaveLength(1);
    });
  });

  describe("createServiceWithTranslations", () => {
    it("should create service with correct order", async () => {
      mockDb.query.mockResolvedValue(createMockCursor([2]));
      mockServices.save.mockResolvedValue({ _key: "svc-new" });

      const result = await service.createServiceWithTranslations("cat-1", {
        nameEN: "New Service",
        translations: [{ lang: "fr", text: "Nouveau" }],
      });

      expect(result._key).toBe("svc-new");
      expect(mockCategoryServices.save).toHaveBeenCalledWith(
        expect.objectContaining({ order: 3 }),
      );
    });

    it("should throw ValidationError when nameEN is missing", async () => {
      await expect(
        service.createServiceWithTranslations("cat-1", { nameEN: "" }),
      ).rejects.toThrow("nameEN is required");
    });

    it("should throw ValidationError when nameEN is not a string", async () => {
      await expect(
        service.createServiceWithTranslations("cat-1", { nameEN: 123 }),
      ).rejects.toThrow("nameEN is required");
    });
  });

  describe("updateServiceWithTranslations", () => {
    it("should update service with translations", async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));

      const result = await service.updateServiceWithTranslations("svc-1", {
        nameEN: "Updated",
        translations: [{ lang: "fr", text: "Mis a jour" }],
      });

      expect(result._key).toBe("svc-1");
      expect(result.status).toBe("updated");
      expect(mockServices.update).toHaveBeenCalledWith("svc-1", {
        nameEN: "Updated",
      });
    });

    it("should throw ValidationError when nameEN is missing", async () => {
      await expect(
        service.updateServiceWithTranslations("svc-1", {}),
      ).rejects.toThrow("nameEN is required");
    });

    it("should throw when service does not exist", async () => {
      mockServices.document.mockRejectedValue(new Error("Not found"));

      await expect(
        service.updateServiceWithTranslations("missing", { nameEN: "Test" }),
      ).rejects.toThrow("Not found");
    });
  });

  describe("categoryExists", () => {
    it("should return true when category exists", async () => {
      const result = await service.categoryExists("cat-1");
      expect(result).toBe(true);
    });

    it("should return false when category not found (404)", async () => {
      const err = new Error("Not found");
      err.code = 404;
      mockServiceCategories.document.mockRejectedValue(err);

      const result = await service.categoryExists("missing");
      expect(result).toBe(false);
    });

    it("should return false when categoryKey is missing", async () => {
      const result = await service.categoryExists(null);
      expect(result).toBe(false);
    });

    it("should return false on other errors", async () => {
      mockServiceCategories.document.mockRejectedValue(new Error("DB error"));

      const result = await service.categoryExists("cat-1");
      expect(result).toBe(false);
    });
  });

  describe("getAllCategoriesWithServices", () => {
    it("should return categories with services", async () => {
      mockDb.query.mockResolvedValue(
        createMockCursor([
          {
            catKey: "cat-1",
            catCode: "taxes",
            name: "Taxes",
            children: ["Tax Filing"],
          },
        ]),
      );

      const result = await service.getAllCategoriesWithServices("en");
      expect(result).toHaveLength(1);
      expect(result[0].children).toEqual(["Tax Filing"]);
    });

    it("should throw on database error", async () => {
      mockDb.query.mockRejectedValue(new Error("Query failed"));

      await expect(service.getAllCategoriesWithServices("en")).rejects.toThrow(
        "Query failed",
      );
    });
  });

  describe("getAdminAllCategoriesWithServices", () => {
    it("should return categories with detailed service objects", async () => {
      mockDb.query.mockResolvedValue(
        createMockCursor([
          {
            catKey: "cat-1",
            catCode: "taxes",
            name: "Taxes",
            children: [{ _key: "svc-1", name: "Tax Filing" }],
          },
        ]),
      );

      const result = await service.getAdminAllCategoriesWithServices("en");
      expect(result[0].children[0]).toEqual({
        _key: "svc-1",
        name: "Tax Filing",
      });
    });
  });

  describe("getCategoryWithServices", () => {
    it("should return category with services", async () => {
      mockDb.query.mockResolvedValue(
        createMockCursor([
          {
            catKey: "cat-1",
            catCode: "taxes",
            name: "Taxes",
            children: ["Tax Filing"],
          },
        ]),
      );

      const result = await service.getCategoryWithServices("cat-1", "en");
      expect(result.catKey).toBe("cat-1");
    });

    it("should throw NotFoundError when category not found", async () => {
      mockDb.query.mockResolvedValue(createMockCursor([null]));

      await expect(service.getCategoryWithServices("missing")).rejects.toThrow(
        "Category missing not found",
      );
    });

    it("should throw Error when categoryKey is missing", async () => {
      await expect(service.getCategoryWithServices(null)).rejects.toThrow(
        "Invalid category key",
      );
    });
  });

  describe("deleteCategory", () => {
    it("should delete category and related data", async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));
      mockServiceCategories.remove.mockResolvedValue({ _key: "cat-1" });

      const result = await service.deleteCategory("cat-1");
      expect(result._key).toBe("cat-1");
      expect(mockDb.query).toHaveBeenCalledTimes(3);
      expect(mockServiceCategories.remove).toHaveBeenCalledWith("cat-1");
    });

    it("should throw Error when categoryKey is missing", async () => {
      await expect(service.deleteCategory(null)).rejects.toThrow(
        "Invalid category key",
      );
    });
  });

  describe("deleteService", () => {
    it("should delete service and related data", async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));
      mockServices.remove.mockResolvedValue({ _key: "svc-1" });

      const result = await service.deleteService("svc-1");
      expect(result).toEqual({ _key: "svc-1", status: "deleted" });
      expect(mockDb.query).toHaveBeenCalledTimes(2);
      expect(mockServices.remove).toHaveBeenCalledWith("svc-1");
    });

    it("should throw Error when serviceKey is missing", async () => {
      await expect(service.deleteService(null)).rejects.toThrow(
        "Invalid service key",
      );
    });
  });

  describe("searchCategoriesAndServices", () => {
    it("should return empty results when no query provided", async () => {
      const result = await service.searchCategoriesAndServices("");
      expect(result).toEqual({ categories: [], services: [] });
    });

    it("should return matching categories and services", async () => {
      mockDb.query.mockResolvedValue(
        createMockCursor([
          {
            categories: [{ type: "category", key: "cat-1", name: "Taxes" }],
            services: [
              {
                type: "service",
                key: "svc-1",
                name: "Tax Filing",
                categoryKey: "cat-1",
                categoryName: "Taxes",
              },
            ],
          },
        ]),
      );

      const result = await service.searchCategoriesAndServices("tax", "en");
      expect(result.categories).toHaveLength(1);
      expect(result.services).toHaveLength(1);
    });

    it("should return empty results on database error", async () => {
      mockDb.query.mockRejectedValue(new Error("DB error"));

      const result = await service.searchCategoriesAndServices("tax");
      expect(result).toEqual({ categories: [], services: [] });
    });
  });

  describe("getCategoryTranslations", () => {
    it("should return translations for a category", async () => {
      mockDb.query.mockResolvedValue(
        createMockCursor([
          { lang: "en", text: "Taxes" },
          { lang: "fr", text: "Impots" },
        ]),
      );

      const result = await service.getCategoryTranslations("cat-1");
      expect(result).toHaveLength(2);
    });

    it("should throw Error when categoryKey is missing", async () => {
      await expect(service.getCategoryTranslations(null)).rejects.toThrow(
        "Invalid category key",
      );
    });
  });

  describe("getServiceTranslations", () => {
    it("should return translations for a service", async () => {
      mockDb.query.mockResolvedValue(
        createMockCursor([{ lang: "en", text: "Tax Filing" }]),
      );

      const result = await service.getServiceTranslations("svc-1");
      expect(result).toHaveLength(1);
    });

    it("should throw Error when serviceKey is missing", async () => {
      await expect(service.getServiceTranslations(null)).rejects.toThrow(
        "Invalid service key",
      );
    });
  });

  describe("createCategory", () => {
    it("should create category with correct order", async () => {
      mockDb.query.mockResolvedValue(createMockCursor([3]));
      mockServiceCategories.save.mockResolvedValue({ _key: "cat-new" });

      const result = await service.createCategory({
        nameEN: "New Category",
        translations: [{ lang: "fr", text: "Nouvelle" }],
      });

      expect(result._key).toBe("cat-new");
      expect(mockServiceCategories.save).toHaveBeenCalledWith(
        expect.objectContaining({ order: 4, nameEN: "New Category" }),
      );
    });

    it("should throw ValidationError when nameEN is missing", async () => {
      await expect(service.createCategory({ nameEN: "" })).rejects.toThrow(
        "nameEN is required",
      );
    });
  });

  describe("updateCategoryWithTranslations", () => {
    it("should update category and translations", async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));

      const result = await service.updateCategoryWithTranslations("cat-1", {
        nameEN: "Updated",
        translations: [{ lang: "fr", text: "Mis a jour" }],
      });

      expect(result).toEqual({ _key: "cat-1", status: "updated" });
      expect(mockServiceCategoryTranslations.save).toHaveBeenCalledWith(
        expect.objectContaining({ languageCode: "EN", translation: "Updated" }),
        expect.objectContaining({ overwrite: true }),
      );
      expect(mockServiceCategories.update).toHaveBeenCalledWith("cat-1", {
        nameEN: "Updated",
      });
    });

    it("should throw ValidationError when nameEN is missing", async () => {
      await expect(
        service.updateCategoryWithTranslations("cat-1", { nameEN: "" }),
      ).rejects.toThrow("nameEN is required");
    });
  });
});
