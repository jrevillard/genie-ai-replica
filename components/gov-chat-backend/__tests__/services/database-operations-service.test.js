"use strict";

require("../setup-env");

jest.mock("dotenv", () => ({ config: jest.fn() }));

jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    stat: jest.fn().mockResolvedValue({ size: 1024 }),
    readdir: jest.fn().mockResolvedValue([]),
    unlink: jest.fn().mockResolvedValue(undefined),
  },
}));

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

const { dbService } = require("../../shared-lib");

function createMockCollection(name) {
  return {
    name,
    compact: jest.fn().mockResolvedValue(undefined),
    indexes: jest.fn().mockResolvedValue([]),
  };
}

let service;
let mockDb;

beforeEach(() => {
  jest.clearAllMocks();

  mockDb = {
    query: jest
      .fn()
      .mockResolvedValue({
        all: jest.fn().mockResolvedValue([]),
        next: jest.fn().mockResolvedValue(null),
      }),
    listCollections: jest.fn().mockResolvedValue([]),
    collections: jest.fn().mockResolvedValue([]),
    collection: jest
      .fn()
      .mockImplementation((name) => createMockCollection(name)),
    version: jest.fn().mockResolvedValue("3.12.0"),
    route: jest
      .fn()
      .mockReturnValue({ get: jest.fn().mockResolvedValue({ body: {} }) }),
  };

  dbService.getConnection.mockResolvedValue(mockDb);

  jest.isolateModules(() => {
    service = require("../../services/database-operations-service");
  });
  service.initialized = false;
});

describe("DatabaseOperationsService", () => {
  describe("init", () => {
    it("should initialize successfully", async () => {
      await service.init();
      expect(service.initialized).toBe(true);
      expect(dbService.getConnection).toHaveBeenCalledWith("default");
    });

    it("should skip re-initialization", async () => {
      await service.init();
      await service.init();
      expect(dbService.getConnection).toHaveBeenCalledTimes(1);
    });

    it("should throw on database connection failure", async () => {
      dbService.getConnection.mockRejectedValue(new Error("Connection failed"));
      await expect(service.init()).rejects.toThrow("Connection failed");
    });
  });

  describe("backupDatabase", () => {
    let mockWriteStream;

    beforeEach(async () => {
      mockWriteStream = {
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn().mockImplementation(function (event, cb) {
          if (event === "finish") {
            setTimeout(cb, 0);
          }
          return this;
        }),
      };

      jest
        .spyOn(require("fs"), "createWriteStream")
        .mockReturnValue(mockWriteStream);

      await service.init();
    });

    it("should return success result on successful backup", async () => {
      mockDb.listCollections.mockResolvedValue([
        { name: "users", isSystem: false },
        { name: "conversations", isSystem: false },
        { name: "_system", isSystem: true },
      ]);

      mockDb.query.mockResolvedValue({
        all: jest.fn().mockResolvedValue([{ _key: "doc1" }]),
      });

      const result = await service.backupDatabase();

      expect(result.success).toBe(true);
      expect(result.message).toBe("Database backup completed");
      expect(result.collections).toBe(2);
      expect(result.backupFile).toMatch(/^huduma_backup_.*\.json$/);
    });

    it("should skip system collections during backup", async () => {
      mockDb.listCollections.mockResolvedValue([
        { name: "_graphs", isSystem: true },
        { name: "_statistics", isSystem: true },
      ]);

      const result = await service.backupDatabase();
      expect(result.success).toBe(true);
      expect(result.collections).toBe(0);
    });

    it("should return failure result on backup error", async () => {
      mockDb.listCollections.mockRejectedValue(new Error("List failed"));

      const result = await service.backupDatabase();
      expect(result.success).toBe(false);
      expect(result.error).toBe("List failed");
    });
  });

  describe("optimizeDatabase", () => {
    beforeEach(async () => {
      await service.init();
    });

    it("should optimize all collections and return results", async () => {
      const mockColl1 = createMockCollection("users");
      const mockColl2 = createMockCollection("messages");

      mockDb.collections.mockResolvedValue([mockColl1, mockColl2]);

      const result = await service.optimizeDatabase();

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toEqual({
        collection: "users",
        status: "success",
        indexSuggestions: [],
      });
      expect(mockColl1.compact).toHaveBeenCalled();
    });

    it("should handle collection optimization error gracefully", async () => {
      const mockColl = createMockCollection("bad_coll");
      mockColl.compact.mockRejectedValue(new Error("Compact failed"));

      mockDb.collections.mockResolvedValue([mockColl]);

      const result = await service.optimizeDatabase();

      expect(result.success).toBe(true);
      expect(result.results[0]).toEqual({
        collection: "bad_coll",
        status: "error",
        error: "Compact failed",
      });
    });

    it("should return failure when collections() throws", async () => {
      mockDb.collections.mockRejectedValue(new Error("No collections"));

      const result = await service.optimizeDatabase();
      expect(result.success).toBe(false);
      expect(result.error).toBe("No collections");
    });

    it("should include index suggestions for low selectivity hash indexes", async () => {
      const mockColl = createMockCollection("users");
      mockColl.indexes.mockResolvedValue([
        { type: "hash", fields: ["status"], selectivityEstimate: 0.1 },
      ]);
      mockDb.collections.mockResolvedValue([mockColl]);

      const result = await service.optimizeDatabase();
      expect(result.results[0].indexSuggestions).toContain(
        "Low selectivity for hash index on status",
      );
    });

    it("should include suggestions for complex multi-field skiplist indexes", async () => {
      const mockColl = createMockCollection("messages");
      mockColl.indexes.mockResolvedValue([
        { type: "skiplist", fields: ["a", "b", "c", "d"] },
      ]);
      mockDb.collections.mockResolvedValue([mockColl]);

      const result = await service.optimizeDatabase();
      expect(result.results[0].indexSuggestions).toContain(
        "Consider breaking down complex multi-field skiplist index on a, b, c, d",
      );
    });
  });

  describe("getDatabaseStats", () => {
    beforeEach(async () => {
      await service.init();
    });

    it("should return database statistics", async () => {
      const mockColl = createMockCollection("users");
      mockColl.figures = jest.fn().mockResolvedValue({
        figures: { alive: 100, documentsSize: 4096 },
      });

      mockDb.collections.mockResolvedValue([mockColl]);
      mockDb.route.mockReturnValue({
        get: jest.fn().mockResolvedValue({ body: { system: "stats" } }),
      });

      const result = await service.getDatabaseStats();

      expect(result.success).toBe(true);
      expect(result.totalTables).toBe(1);
      expect(result.collections).toHaveLength(1);
      expect(result.collections[0]).toEqual({
        name: "users",
        count: 100,
        size: "4 KB",
      });
      expect(result.systemStats).toEqual({ system: "stats" });
    });

    it("should handle empty collections", async () => {
      mockDb.collections.mockResolvedValue([]);

      const result = await service.getDatabaseStats();

      expect(result.success).toBe(true);
      expect(result.totalTables).toBe(0);
      expect(result.collections).toEqual([]);
    });

    it("should return failure on stats error", async () => {
      mockDb.collections.mockRejectedValue(new Error("DB error"));

      const result = await service.getDatabaseStats();

      expect(result.success).toBe(false);
      expect(result.error).toBe("DB error");
    });

    it("should skip collections without figures", async () => {
      const mockColl = createMockCollection("orphan");
      mockColl.figures = jest.fn().mockResolvedValue(null);

      mockDb.collections.mockResolvedValue([mockColl]);

      const result = await service.getDatabaseStats();
      expect(result.collections).toEqual([]);
    });
  });

  describe("_formatSize", () => {
    beforeEach(async () => {
      await service.init();
    });

    it("should format 0 bytes", () => {
      expect(service._formatSize(0)).toBe("0 B");
    });

    it("should format bytes", () => {
      expect(service._formatSize(512)).toBe("512 B");
    });

    it("should format kilobytes", () => {
      expect(service._formatSize(1024)).toBe("1 KB");
    });

    it("should format megabytes", () => {
      expect(service._formatSize(1048576)).toBe("1 MB");
    });

    it("should format gigabytes", () => {
      expect(service._formatSize(1073741824)).toBe("1 GB");
    });
  });
});
