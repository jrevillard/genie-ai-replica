"use strict";

require("../setup-env");

jest.mock("dotenv", () => ({ config: jest.fn() }));

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

jest.mock("arangojs", () => ({
  aql: (strings, ...values) => ({ _aql: true, strings, values }),
}));

jest.mock("../../services/service-category-service", () => ({
  init: jest.fn().mockResolvedValue(undefined),
  getAllCategoriesWithServices: jest.fn().mockResolvedValue([]),
  getCategoryTranslations: jest.fn().mockResolvedValue([]),
}));

function createMockCollection() {
  return {
    save: jest.fn().mockResolvedValue({ _key: "analytics-1" }),
    update: jest.fn(),
    document: jest.fn(),
    remove: jest.fn(),
    ensureIndex: jest.fn(),
  };
}

function createMockCursor(results) {
  return {
    next: jest.fn().mockResolvedValue(results.length > 0 ? results[0] : null),
    all: jest.fn().mockResolvedValue(results),
  };
}

let analyticsService;
let mockDb;
let mockAnalytics;
let mockEvents;
let mockQueries;
let mockUsers;
let mockSessions;
let mockServiceCategories;

beforeEach(() => {
  jest.clearAllMocks();

  mockAnalytics = createMockCollection();
  mockEvents = createMockCollection();
  mockQueries = createMockCollection();
  mockUsers = createMockCollection();
  mockSessions = createMockCollection();
  mockServiceCategories = createMockCollection();

  mockDb = {
    collection: jest.fn().mockImplementation((name) => {
      const map = {
        analytics: mockAnalytics,
        events: mockEvents,
        queries: mockQueries,
        users: mockUsers,
        sessions: mockSessions,
        serviceCategories: mockServiceCategories,
      };
      return map[name] || createMockCollection();
    }),
    query: jest.fn(),
  };

  const { dbService } = require("../../shared-lib");
  dbService.getConnection.mockResolvedValue(mockDb);

  jest.isolateModules(() => {
    analyticsService = require("../../services/analytics-service");
  });
  analyticsService.initialized = false;
});

describe("AnalyticsService", () => {
  beforeEach(async () => {
    await analyticsService.init();
  });

  describe("init", () => {
    it("should initialize all collections", async () => {
      expect(mockDb.collection).toHaveBeenCalledWith("analytics");
      expect(mockDb.collection).toHaveBeenCalledWith("events");
      expect(mockDb.collection).toHaveBeenCalledWith("queries");
      expect(mockDb.collection).toHaveBeenCalledWith("users");
      expect(mockDb.collection).toHaveBeenCalledWith("sessions");
      expect(mockDb.collection).toHaveBeenCalledWith("serviceCategories");
      expect(analyticsService.initialized).toBe(true);
    });

    it("should skip re-initialization", async () => {
      analyticsService.initialized = true;
      await analyticsService.init();
      const { dbService: ds } = require("../../shared-lib");
      expect(ds.getConnection).toHaveBeenCalledTimes(1);
    });

    it("should throw on DB connection failure", async () => {
      const { dbService: ds } = require("../../shared-lib");
      ds.getConnection.mockRejectedValueOnce(new Error("DB down"));
      jest.isolateModules(() => {
        analyticsService = require("../../services/analytics-service");
      });
      analyticsService.initialized = false;
      await expect(analyticsService.init()).rejects.toThrow("DB down");
    });
  });

  describe("recordQuery", () => {
    it("should save analytics record for a query", async () => {
      const queryDoc = {
        _key: "q1",
        userId: "u1",
        text: "tax",
        responseTime: 500,
        isAnswered: true,
      };
      const result = await analyticsService.recordQuery(queryDoc);
      expect(mockAnalytics.save).toHaveBeenCalledWith(
        expect.objectContaining({ type: "query", queryId: "q1" }),
      );
      expect(result).toBeDefined();
    });

    it("should throw on save failure", async () => {
      mockAnalytics.save.mockRejectedValueOnce(new Error("save fail"));
      await expect(
        analyticsService.recordQuery({ _key: "q1" }),
      ).rejects.toThrow("save fail");
    });
  });

  describe("recordFeedback", () => {
    it("should save analytics record for feedback", async () => {
      const result = await analyticsService.recordFeedback("q1", { rating: 5 });
      expect(mockAnalytics.save).toHaveBeenCalledWith(
        expect.objectContaining({ type: "feedback", queryId: "q1" }),
      );
      expect(result).toBeDefined();
    });

    it("should throw on save failure", async () => {
      mockAnalytics.save.mockRejectedValueOnce(new Error("save fail"));
      await expect(analyticsService.recordFeedback("q1", {})).rejects.toThrow(
        "save fail",
      );
    });
  });

  describe("trackEvent", () => {
    it("should save event record", async () => {
      const result = await analyticsService.trackEvent("u1", "page_view", {
        page: "/home",
      });
      expect(mockEvents.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "u1", eventType: "page_view" }),
      );
      expect(result).toBeDefined();
    });

    it("should use empty eventData by default", async () => {
      const result = await analyticsService.trackEvent("u1", "login");
      expect(mockEvents.save).toHaveBeenCalledWith(
        expect.objectContaining({ data: {} }),
      );
      expect(result).toBeDefined();
    });

    it("should throw on save failure", async () => {
      mockEvents.save.mockRejectedValueOnce(new Error("save fail"));
      await expect(analyticsService.trackEvent("u1", "login")).rejects.toThrow(
        "save fail",
      );
    });
  });

  describe("getUniqueUsersCount", () => {
    it("should return 0 on DB error (graceful degradation)", async () => {
      mockDb.query.mockRejectedValue(new Error("DB fail"));
      const result = await analyticsService.getUniqueUsersCount();
      expect(result).toBe(0);
    });

    it("should return count from query", async () => {
      mockDb.query.mockResolvedValue(createMockCursor([42]));
      const result = await analyticsService.getUniqueUsersCount(
        "2026-01-01",
        "2026-01-31",
      );
      expect(result).toBe(42);
    });
  });

  describe("getDashboardAnalytics", () => {
    it("should return empty data on DB error (graceful degradation)", async () => {
      mockDb.query.mockRejectedValue(new Error("DB fail"));
      const result = await analyticsService.getDashboardAnalytics();
      expect(result.queries.total).toBe(0);
      expect(result.feedback.total).toBe(0);
    });

    it("should return empty data when test query fails", async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));
      const result = await analyticsService.getDashboardAnalytics();
      expect(result.queries.total).toBe(0);
    });

    it("should handle ArangoDB-style category IDs (collection/key)", async () => {
      mockDb.query
        .mockResolvedValueOnce(
          createMockCursor([{ test: "Connection is working" }]),
        )
        .mockResolvedValueOnce(
          createMockCursor([
            {
              queries: {
                total: 5,
                unanswered: 2,
                answeredPercentage: 60,
                avgResponseTime: 200,
              },
              categories: [
                { categoryId: "serviceCategories/cat-123", count: 3, value: 3 },
                { categoryId: "serviceCategories/cat-456", count: 2, value: 2 },
              ],
              feedback: {
                total: 0,
                positive: 0,
                neutral: 0,
                negative: 0,
                positivePercentage: 0,
                negativePercentage: 0,
              },
              users: { activeCount: 2 },
              topQueries: [],
            },
          ]),
        );
      const result = await analyticsService.getDashboardAnalytics();
      expect(result.categories[0].categoryId).toBe("serviceCategories/cat-123");
      expect(result.categories[0].name).toBe("Category cat-123");
      expect(result.categories[1].categoryId).toBe("serviceCategories/cat-456");
      expect(result.categories[1].name).toBe("Category cat-456");
    });
  });

  describe("getTimeSeriesData", () => {
    it("should return empty array on DB error", async () => {
      mockDb.query.mockRejectedValue(new Error("DB fail"));
      const result = await analyticsService.getTimeSeriesData(
        "queries",
        "daily",
      );
      expect(result).toEqual([]);
    });

    it("should return empty array when no data found", async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));
      const result = await analyticsService.getTimeSeriesData(
        "queries",
        "daily",
      );
      expect(result).toEqual([]);
    });
  });

  describe("getSatisfactionGaugeData", () => {
    it("should return default structure on DB error (graceful degradation)", async () => {
      mockDb.query.mockRejectedValue(new Error("DB fail"));
      const result = await analyticsService.getSatisfactionGaugeData("daily");
      expect(result.currentValue).toBe(0);
      expect(result.previousValue).toBe(0);
      expect(result.changePercentage).toBe(0);
      expect(result.target).toBe(85);
      expect(result.historicalData).toEqual([]);
    });
  });

  describe("getSatisfactionHeatmapData", () => {
    it("should not throw on DB error (graceful degradation)", async () => {
      mockDb.query.mockRejectedValue(new Error("DB fail"));
      const result = await analyticsService.getSatisfactionHeatmapData("daily");
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("getEmptyDashboardData", () => {
    it("should return correct empty structure", () => {
      const data = analyticsService.getEmptyDashboardData();
      expect(data).toEqual({
        queries: {
          total: 0,
          unanswered: 0,
          answeredPercentage: 0,
          avgResponseTime: 0,
        },
        categories: [],
        feedback: {
          total: 0,
          positive: 0,
          neutral: 0,
          negative: 0,
          positivePercentage: 0,
          negativePercentage: 0,
        },
        users: { activeCount: 0 },
        topQueries: [],
      });
    });
  });

  describe("formatDateLabel", () => {
    it("should return empty string for null timestamp", () => {
      expect(analyticsService.formatDateLabel(null, "daily")).toBe("");
    });

    it("should return raw string for invalid timestamp", () => {
      expect(analyticsService.formatDateLabel("not-a-date", "daily")).toBe(
        "not-a-date",
      );
    });

    it("should format hourly interval", () => {
      const result = analyticsService.formatDateLabel(
        "2026-01-15T14:30:00Z",
        "hourly",
      );
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });

    it("should format daily interval", () => {
      const result = analyticsService.formatDateLabel(
        "2026-01-15T14:30:00Z",
        "daily",
      );
      expect(result).toMatch(/\w+/);
      expect(result).toMatch(/\d+/);
    });

    it("should format weekly interval", () => {
      const result = analyticsService.formatDateLabel(
        "2026-01-15T14:30:00Z",
        "weekly",
      );
      expect(result).toContain("Week");
    });

    it("should format monthly interval", () => {
      const result = analyticsService.formatDateLabel(
        "2026-01-15T14:30:00Z",
        "monthly",
      );
      expect(result).toBeDefined();
      expect(result).toContain("2026");
    });

    it("should use default format for unknown interval", () => {
      const result = analyticsService.formatDateLabel(
        "2026-01-15T14:30:00Z",
        "yearly",
      );
      expect(result).toBeDefined();
    });

    it("should accept Date object directly", () => {
      const result = analyticsService.formatDateLabel(
        new Date("2026-01-15"),
        "daily",
      );
      expect(result).toBeDefined();
    });
  });
});
