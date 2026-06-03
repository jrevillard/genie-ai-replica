"use strict";

require("../setup-env");

// Mock ioredis BEFORE requiring service — constructor creates Redis client
const mockRedis = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue("OK"),
  del: jest.fn().mockResolvedValue(1),
  quit: jest.fn().mockResolvedValue("OK"),
  on: jest.fn(),
};

jest.mock("ioredis", () => jest.fn().mockImplementation(() => mockRedis));

jest.mock("crypto", () => ({
  createHash: jest.fn().mockReturnValue({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue("abc123"),
  }),
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
  }),
  { virtual: true },
);

// Shared mock functions for backends — allows tests to configure
// behavior of instances created internally by the service
const mockCpuTranslate = jest.fn().mockResolvedValue(["translated text"]);
const mockGpuTranslate = jest.fn().mockResolvedValue(["gpu translated text"]);

jest.mock("../../services/translation/cpu-translate-backend", () =>
  jest.fn().mockImplementation(() => ({
    translate: mockCpuTranslate,
    getSupportedLanguages: jest
      .fn()
      .mockReturnValue({ en: "English", fr: "French", es: "Spanish" }),
    getLanguageCode: jest.fn().mockImplementation((lang) => lang),
    isLanguageSupported: jest.fn().mockReturnValue(true),
    getFallbackLanguage: jest.fn().mockReturnValue(null),
    init: jest.fn().mockResolvedValue(undefined),
  })),
);

jest.mock("../../services/translation/gpu-translate-backend", () =>
  jest.fn().mockImplementation(() => ({
    translate: mockGpuTranslate,
    getSupportedLanguages: jest
      .fn()
      .mockReturnValue({ en: "English", fr: "French", es: "Spanish" }),
    getLanguageCode: jest.fn().mockImplementation((lang) => lang),
    isLanguageSupported: jest.fn().mockReturnValue(true),
    getFallbackLanguage: jest.fn().mockReturnValue(null),
    init: jest.fn().mockResolvedValue(undefined),
  })),
);

jest.mock("unified", () => ({ unified: jest.fn() }), { virtual: true });
jest.mock("remark-parse", () => ({ default: jest.fn() }), { virtual: true });
jest.mock("remark-stringify", () => ({ default: jest.fn() }), {
  virtual: true,
});
jest.mock("unist-util-visit", () => ({ visit: jest.fn() }), { virtual: true });

// TODO: translateMarkdown tests are blocked by ESM dynamic imports.
// The service loads unified/remark-parse/remark-stringify via `await import()`
// in init(), which jest.mock() cannot intercept. To test properly:
// 1. Run integration tests in a Docker container with real ESM support, or
// 2. Refactor the service to accept a markdown processor via dependency injection.

const CpuTranslateBackend = require("../../services/translation/cpu-translate-backend");
const GpuTranslateBackend = require("../../services/translation/gpu-translate-backend");

let translationService;
let savedEnvVars;

beforeEach(() => {
  jest.clearAllMocks();
  mockRedis.get.mockResolvedValue(null);
  savedEnvVars = {};

  jest.isolateModules(() => {
    translationService = require("../../services/translation-service");
  });
  translationService.initialized = false;
});

afterEach(() => {
  Object.keys(savedEnvVars).forEach((key) => {
    if (savedEnvVars[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnvVars[key];
    }
  });
});

function setEnv(key, value) {
  savedEnvVars[key] = process.env[key];
  process.env[key] = value;
}

describe("TranslationService", () => {
  describe("constructor", () => {
    it("should create instance with correct defaults", () => {
      expect(translationService.backend).toBeNull();
      expect(translationService.initialized).toBe(false);
      expect(translationService.inFlightTranslations).toBeInstanceOf(Map);
    });
  });

  describe("selectBackend", () => {
    it("should force CPU backend when TRANSLATION_BACKEND=cpu", async () => {
      setEnv("TRANSLATION_BACKEND", "cpu");
      jest.isolateModules(() => {
        translationService = require("../../services/translation-service");
      });
      translationService.initialized = false;
      translationService.backend = null;
      await translationService.selectBackend();
      expect(translationService.backendType).toBe("cpu");
    });

    it("should force GPU backend when TRANSLATION_BACKEND=gpu", async () => {
      setEnv("TRANSLATION_BACKEND", "gpu");
      jest.isolateModules(() => {
        translationService = require("../../services/translation-service");
      });
      translationService.initialized = false;
      translationService.backend = null;
      await translationService.selectBackend();
      expect(translationService.backendType).toBe("gpu");
    });

    it("should return existing backend if already selected", async () => {
      setEnv("TRANSLATION_BACKEND", "cpu");
      jest.isolateModules(() => {
        translationService = require("../../services/translation-service");
      });
      translationService.initialized = false;
      translationService.backend = new CpuTranslateBackend();
      translationService.backendType = "cpu";
      const result = await translationService.selectBackend();
      expect(result).toBe(translationService.backend);
      expect(result.translate).toBe(mockCpuTranslate);
    });

    it("should throw on invalid backend value", async () => {
      setEnv("TRANSLATION_BACKEND", "invalid");
      jest.isolateModules(() => {
        translationService = require("../../services/translation-service");
      });
      translationService.initialized = false;
      translationService.backend = null;
      await expect(translationService.selectBackend()).rejects.toThrow(
        "Invalid TRANSLATION_BACKEND",
      );
    });
  });

  describe("getSupportedLanguages", () => {
    it("should return languages from backend", () => {
      setEnv("TRANSLATION_BACKEND", "cpu");
      jest.isolateModules(() => {
        translationService = require("../../services/translation-service");
      });
      translationService.initialized = false;
      translationService.backend = new CpuTranslateBackend();
      translationService.backendType = "cpu";
      const langs = translationService.getSupportedLanguages();
      expect(langs).toEqual({ en: "English", fr: "French", es: "Spanish" });
    });
  });

  describe("getBackendInfo", () => {
    it("should return none type when no backend selected", () => {
      const info = translationService.getBackendInfo();
      expect(info.type).toBe("none");
      expect(info.initialized).toBe(false);
    });
  });

  describe("translate", () => {
    it("should throw when not initialized", async () => {
      translationService.initialized = false;
      translationService.backend = null;
      await expect(
        translationService.translate(["hello"], "en", "fr"),
      ).rejects.toThrow("not ready");
    });

    it("should return empty array for empty texts", async () => {
      translationService.initialized = true;
      translationService.backend = new CpuTranslateBackend();
      const result = await translationService.translate([], "en", "fr");
      expect(result).toEqual([]);
    });

    it("should throw for unsupported source language", async () => {
      translationService.initialized = true;
      const backend = new CpuTranslateBackend();
      backend.getLanguageCode.mockReturnValueOnce(null);
      translationService.backend = backend;
      await expect(
        translationService.translate(["hello"], "invalid", "fr"),
      ).rejects.toThrow("Unsupported source language");
    });

    it("should translate texts via backend", async () => {
      translationService.initialized = true;
      translationService.backend = new CpuTranslateBackend();
      const result = await translationService.translate(
        ["hello", "world"],
        "en",
        "fr",
      );
      expect(translationService.backend.translate).toHaveBeenCalledWith(
        ["hello", "world"],
        "en",
        "fr",
      );
      expect(result).toEqual(["translated text"]);
    });
  });

  describe("GPU to CPU fallback", () => {
    it("should fall back to CPU when GPU fails in auto mode", async () => {
      setEnv("TRANSLATION_BACKEND", "auto");
      jest.isolateModules(() => {
        translationService = require("../../services/translation-service");
      });
      translationService.initialized = true;
      translationService.backendType = "gpu";

      const badGpu = new GpuTranslateBackend();
      badGpu.translate.mockRejectedValueOnce(new Error("GPU OOM"));
      translationService.backend = badGpu;

      const result = await translationService.translate(["hello"], "en", "fr");
      expect(result).toEqual(["translated text"]);
    });

    it("should throw when both backends fail", async () => {
      setEnv("TRANSLATION_BACKEND", "auto");
      jest.isolateModules(() => {
        translationService = require("../../services/translation-service");
      });
      translationService.initialized = true;
      translationService.backendType = "gpu";

      const badGpu = new GpuTranslateBackend();
      badGpu.translate.mockRejectedValueOnce(new Error("GPU OOM"));
      translationService.backend = badGpu;

      mockCpuTranslate.mockRejectedValueOnce(new Error("CPU fail"));

      await expect(
        translationService.translate(["hello"], "en", "fr"),
      ).rejects.toThrow("Translation failed on both GPU and CPU");
    });
  });
});
