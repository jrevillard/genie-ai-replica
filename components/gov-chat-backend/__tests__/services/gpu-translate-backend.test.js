"use strict";

require("../setup-env");

// Mock shared-lib (virtual module, same pattern as other tests)
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

let capturedOptions = null;
let mockResponseData = null;

/**
 * Mock http/https.request(options, callback).
 * Node.js signature: request(options[, callback]) → ClientRequest.
 * The source passes the response handler as the 2nd arg, not via req.on('response').
 */
function mockRequestFn(opts, callback) {
  capturedOptions = opts;

  const res = {
    statusCode: 200,
    on: jest.fn().mockImplementation((event, cb) => {
      if (event === "data" && mockResponseData !== null) {
        cb(mockResponseData);
      }
      if (event === "end") {
        cb();
      }
    }),
  };

  if (callback) setImmediate(() => callback(res));

  return {
    write: jest.fn(),
    end: jest.fn(),
    setTimeout: jest.fn(),
    destroy: jest.fn(),
    on: jest.fn(),
  };
}

// Hoisted by Jest — factory references mockRequestFn at call time
jest.mock("http", () => ({ request: (...args) => mockRequestFn(...args) }));
jest.mock("https", () => ({ request: (...args) => mockRequestFn(...args) }));

// Set env vars BEFORE require — VLLM_API_KEY is a module-level const
process.env.VLLM_API_KEY = "test-key-123";
process.env.VLLM_TRANSLATION_ENDPOINT = "http://vllm:9031";
process.env.VLLM_TRANSLATION_MODEL_ID = "google/gemma-3-4b-it";

const GpuTranslateBackend = require("../../services/translation/gpu-translate-backend");

beforeEach(() => {
  capturedOptions = null;
  mockResponseData = null;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GpuTranslateBackend", () => {
  describe("_buildHeaders", () => {
    it("should include Authorization: Bearer when VLLM_API_KEY is set", () => {
      const instance = new GpuTranslateBackend();
      const headers = instance._buildHeaders();
      expect(headers["Authorization"]).toBe("Bearer test-key-123");
      expect(Object.keys(headers)).toHaveLength(1);
    });

    it("should merge extra headers with API key", () => {
      const instance = new GpuTranslateBackend();
      const headers = instance._buildHeaders({
        "Content-Type": "application/json",
      });
      expect(headers["Authorization"]).toBe("Bearer test-key-123");
      expect(headers["Content-Type"]).toBe("application/json");
    });

    it("should let _buildHeaders overwrite Authorization with env value", () => {
      // Env var always takes precedence over extra headers
      const instance = new GpuTranslateBackend();
      const headers = instance._buildHeaders({ Authorization: "override-key" });
      expect(headers["Authorization"]).toBe("Bearer test-key-123");
    });
  });

  describe("callVllmService", () => {
    it("should inject Authorization: Bearer and POST to /v1/chat/completions", async () => {
      mockResponseData = JSON.stringify({
        choices: [{ message: { content: "traduit" } }],
      });

      const instance = new GpuTranslateBackend();
      instance.initialized = true;

      const result = await instance.callVllmService({
        messages: [{ role: "user", content: "hello" }],
      });
      expect(result).toBe("traduit");
      expect(capturedOptions.headers["Authorization"]).toBe("Bearer test-key-123");
      expect(capturedOptions.method).toBe("POST");
      expect(capturedOptions.path).toBe("/v1/chat/completions");
    });
  });

  describe("healthCheck", () => {
    it("should inject Authorization: Bearer and GET /health", async () => {
      const instance = new GpuTranslateBackend();
      await instance.healthCheck();
      expect(capturedOptions.headers["Authorization"]).toBe("Bearer test-key-123");
      expect(capturedOptions.method).toBe("GET");
      expect(capturedOptions.path).toBe("/health");
    });
  });

  describe("remote GPU node endpoint with path prefix", () => {
    it("should prepend endpoint path to health check path", async () => {
      process.env.VLLM_TRANSLATION_ENDPOINT =
        "https://gpu-node.example.com/translation";
      const instance = new GpuTranslateBackend();
      await instance.healthCheck();
      expect(capturedOptions.hostname).toBe("gpu-node.example.com");
      expect(capturedOptions.port).toBe(443);
      expect(capturedOptions.path).toBe("/translation/health");
    });

    it("should prepend endpoint path to model info path", async () => {
      process.env.VLLM_TRANSLATION_ENDPOINT =
        "https://gpu-node.example.com/translation";
      mockResponseData = JSON.stringify({
        data: [{ id: "google/gemma-3-4b-it", max_model_len: 8192 }],
      });
      const instance = new GpuTranslateBackend();
      await instance.fetchModelInfo();
      expect(capturedOptions.path).toBe("/translation/v1/models");
    });

    it("should prepend endpoint path to chat completions path", async () => {
      process.env.VLLM_TRANSLATION_ENDPOINT =
        "https://gpu-node.example.com/translation";
      mockResponseData = JSON.stringify({
        choices: [{ message: { content: "traduit" } }],
      });
      const instance = new GpuTranslateBackend();
      instance.initialized = true;
      await instance.callVllmService({
        messages: [{ role: "user", content: "hello" }],
      });
      expect(capturedOptions.path).toBe("/translation/v1/chat/completions");
    });

    it("should strip trailing slash from endpoint path", async () => {
      process.env.VLLM_TRANSLATION_ENDPOINT =
        "https://gpu-node.example.com/translation/";
      const instance = new GpuTranslateBackend();
      await instance.healthCheck();
      expect(capturedOptions.path).toBe("/translation/health");
    });
  });
});
