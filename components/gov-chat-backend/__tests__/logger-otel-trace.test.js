// Mock @opentelemetry/api before requiring the logger
const mockGetSpan = jest.fn();
const mockContextActive = jest.fn();

jest.mock("@opentelemetry/api", () => ({
  trace: {
    getSpan: mockGetSpan,
  },
  context: {
    active: mockContextActive,
  },
}));

// Ensure logs directory exists for DailyRotateFile transport
const fs = require("fs");
const path = require("path");
const logsDir = path.join(__dirname, "..", "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Now require the actual logger from shared/lib
const { traceFormat } = require("../../shared/lib/logger");
const { format, createLogger, transports } = require("winston");
const { PassThrough } = require("stream");

// Helper: capture log entries from a winston logger
function createCapturingLogger(loggerFormat) {
  const entries = [];
  const passThrough = new PassThrough();
  passThrough.on("data", (chunk) => {
    entries.push(JSON.parse(chunk.toString().trim()));
  });
  const transport = new transports.Stream({
    stream: passThrough,
  });
  const testLogger = createLogger({
    level: "debug",
    format: loggerFormat,
    transports: [transport],
    exitOnError: false,
  });
  return { testLogger, entries };
}

describe("logger OTel trace correlation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("traceFormat — no active span", () => {
    it("includes zeroed trace_id and span_id when no span is active", () => {
      mockGetSpan.mockReturnValue(undefined);
      mockContextActive.mockReturnValue({});

      const { testLogger, entries } = createCapturingLogger(
        format.combine(format.timestamp(), traceFormat, format.json()),
      );
      testLogger.info("test message");

      expect(entries).toHaveLength(1);
      expect(entries[0].trace_id).toBe("00000000000000000000000000000000");
      expect(entries[0].span_id).toBe("0000000000000000");
    });

    it("returns zeroed IDs when span context has all-zero trace flags (not sampled)", () => {
      const mockSpan = {
        spanContext: () => ({
          traceId: "0".repeat(32),
          spanId: "0".repeat(16),
          traceFlags: 0,
        }),
      };
      mockGetSpan.mockReturnValue(mockSpan);
      mockContextActive.mockReturnValue({});

      const { testLogger, entries } = createCapturingLogger(
        format.combine(format.timestamp(), traceFormat, format.json()),
      );
      testLogger.info("test message");

      expect(entries).toHaveLength(1);
      expect(entries[0].trace_id).toBe("00000000000000000000000000000000");
      expect(entries[0].span_id).toBe("0000000000000000");
    });
  });

  describe("traceFormat — active span", () => {
    it("includes trace_id and span_id from active span", () => {
      const fakeTraceId = "4bf92f3577b34da6a3ce929d0e0e4736";
      const fakeSpanId = "00f067aa0ba902b7";
      mockGetSpan.mockReturnValue({
        spanContext: () => ({
          traceId: fakeTraceId,
          spanId: fakeSpanId,
          traceFlags: 1,
        }),
      });
      mockContextActive.mockReturnValue({});

      const { testLogger, entries } = createCapturingLogger(
        format.combine(format.timestamp(), traceFormat, format.json()),
      );
      testLogger.info("test message");

      expect(entries).toHaveLength(1);
      expect(entries[0].trace_id).toBe(fakeTraceId);
      expect(entries[0].span_id).toBe(fakeSpanId);
    });

    it("preserves other log fields alongside trace context", () => {
      const fakeTraceId = "abcdef1234567890abcdef1234567890";
      const fakeSpanId = "1234567890abcdef";
      mockGetSpan.mockReturnValue({
        spanContext: () => ({
          traceId: fakeTraceId,
          spanId: fakeSpanId,
          traceFlags: 1,
        }),
      });

      const { testLogger, entries } = createCapturingLogger(
        format.combine(format.timestamp(), traceFormat, format.json()),
      );
      testLogger.info("test message", { extraField: "value" });

      expect(entries).toHaveLength(1);
      expect(entries[0].trace_id).toBe(fakeTraceId);
      expect(entries[0].span_id).toBe(fakeSpanId);
      expect(entries[0].message).toBe("test message");
      expect(entries[0].extraField).toBe("value");
      expect(entries[0].level).toBe("info");
      expect(entries[0].timestamp).toBeDefined();
    });

    it("handles warn level with trace context", () => {
      const fakeTraceId = "aaaabbbbccccddddeeeeffff00001111";
      const fakeSpanId = "aabbccddeeff0011";
      mockGetSpan.mockReturnValue({
        spanContext: () => ({
          traceId: fakeTraceId,
          spanId: fakeSpanId,
          traceFlags: 1,
        }),
      });

      const { testLogger, entries } = createCapturingLogger(
        format.combine(format.timestamp(), traceFormat, format.json()),
      );
      testLogger.warn("warning message");

      expect(entries[0].trace_id).toBe(fakeTraceId);
      expect(entries[0].span_id).toBe(fakeSpanId);
      expect(entries[0].level).toBe("warn");
    });
  });

  describe("traceFormat — edge cases", () => {
    it("handles error log entries with trace context", () => {
      const fakeTraceId = "aaaabbbbccccddddeeeeffff00001111";
      const fakeSpanId = "aabbccddeeff0011";
      mockGetSpan.mockReturnValue({
        spanContext: () => ({
          traceId: fakeTraceId,
          spanId: fakeSpanId,
          traceFlags: 1,
        }),
      });

      const { testLogger, entries } = createCapturingLogger(
        format.combine(format.timestamp(), traceFormat, format.json()),
      );
      testLogger.error("something failed", { err: "stack trace here" });

      expect(entries).toHaveLength(1);
      expect(entries[0].trace_id).toBe(fakeTraceId);
      expect(entries[0].span_id).toBe(fakeSpanId);
      expect(entries[0].level).toBe("error");
      expect(entries[0].err).toBe("stack trace here");
    });

    it("handles multiple sequential log entries with different span contexts", () => {
      const span1 = {
        spanContext: () => ({
          traceId: "11111111111111111111111111111111",
          spanId: "1111111111111111",
          traceFlags: 1,
        }),
      };
      const span2 = {
        spanContext: () => ({
          traceId: "22222222222222222222222222222222",
          spanId: "2222222222222222",
          traceFlags: 1,
        }),
      };

      const { testLogger, entries } = createCapturingLogger(
        format.combine(format.timestamp(), traceFormat, format.json()),
      );

      mockGetSpan.mockReturnValue(span1);
      testLogger.info("first message");

      mockGetSpan.mockReturnValue(span2);
      testLogger.info("second message");

      expect(entries).toHaveLength(2);
      expect(entries[0].trace_id).toBe("11111111111111111111111111111111");
      expect(entries[0].span_id).toBe("1111111111111111");
      expect(entries[1].trace_id).toBe("22222222222222222222222222222222");
      expect(entries[1].span_id).toBe("2222222222222222");
    });

    it("handles transition from active span to no span", () => {
      mockGetSpan.mockReturnValue({
        spanContext: () => ({
          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          spanId: "00f067aa0ba902b7",
          traceFlags: 1,
        }),
      });

      const { testLogger, entries } = createCapturingLogger(
        format.combine(format.timestamp(), traceFormat, format.json()),
      );

      testLogger.info("with span");

      mockGetSpan.mockReturnValue(undefined);
      testLogger.info("without span");

      expect(entries).toHaveLength(2);
      expect(entries[0].trace_id).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
      expect(entries[0].span_id).toBe("00f067aa0ba902b7");
      expect(entries[1].trace_id).toBe("00000000000000000000000000000000");
      expect(entries[1].span_id).toBe("0000000000000000");
    });

    it("handles debug level log entries", () => {
      mockGetSpan.mockReturnValue(undefined);
      mockContextActive.mockReturnValue({});

      const { testLogger, entries } = createCapturingLogger(
        format.combine(format.timestamp(), traceFormat, format.json()),
      );
      testLogger.debug("debug message");

      expect(entries).toHaveLength(1);
      expect(entries[0].trace_id).toBe("00000000000000000000000000000000");
      expect(entries[0].span_id).toBe("0000000000000000");
      expect(entries[0].level).toBe("debug");
    });
  });

  describe("consistent log schema (AC #4, #8)", () => {
    it("log entry contains all required schema fields", () => {
      const fakeTraceId = "4bf92f3577b34da6a3ce929d0e0e4736";
      const fakeSpanId = "00f067aa0ba902b7";
      mockGetSpan.mockReturnValue({
        spanContext: () => ({
          traceId: fakeTraceId,
          spanId: fakeSpanId,
          traceFlags: 1,
        }),
      });

      const { testLogger, entries } = createCapturingLogger(
        format.combine(format.timestamp(), traceFormat, format.json()),
      );
      testLogger.info("schema test");

      const entry = entries[0];
      expect(entry).toHaveProperty("timestamp");
      expect(entry).toHaveProperty("level");
      expect(entry).toHaveProperty("service");
      expect(entry).toHaveProperty("trace_id");
      expect(entry).toHaveProperty("span_id");
      expect(entry).toHaveProperty("message");
      expect(entry.trace_id).toMatch(/^[0-9a-f]{32}$/);
      expect(entry.span_id).toMatch(/^[0-9a-f]{16}$/);
    });

    it("trace_id is a top-level field suitable for Grafana correlation", () => {
      const fakeTraceId = "4bf92f3577b34da6a3ce929d0e0e4736";
      mockGetSpan.mockReturnValue({
        spanContext: () => ({
          traceId: fakeTraceId,
          spanId: "00f067aa0ba902b7",
          traceFlags: 1,
        }),
      });

      const { testLogger, entries } = createCapturingLogger(
        format.combine(format.timestamp(), traceFormat, format.json()),
      );
      testLogger.info("grafana test");

      const entry = entries[0];
      const keys = Object.keys(entry);
      expect(keys).toContain("trace_id");
      expect(entry.trace_id).toBe(fakeTraceId);
    });
  });

  describe("PII protection — no user data in trace log entries", () => {
    it("log entry does not contain user query content", () => {
      mockGetSpan.mockReturnValue({
        spanContext: () => ({
          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          spanId: "00f067aa0ba902b7",
          traceFlags: 1,
        }),
      });

      const { testLogger, entries } = createCapturingLogger(
        format.combine(format.timestamp(), traceFormat, format.json()),
      );
      testLogger.info("processing request");

      const entry = entries[0];
      const entryStr = JSON.stringify(entry);
      const sensitivePatterns = [
        /password/i,
        /api[_-]?key/i,
        /secret/i,
        /credential/i,
        /token.*bearer/i,
      ];
      for (const pattern of sensitivePatterns) {
        expect(entryStr).not.toMatch(pattern);
      }
    });

    it("trace fields contain only safe identifiers", () => {
      mockGetSpan.mockReturnValue({
        spanContext: () => ({
          traceId: "abcdef1234567890abcdef1234567890",
          spanId: "1234567890abcdef",
          traceFlags: 1,
        }),
      });

      const { testLogger, entries } = createCapturingLogger(
        format.combine(format.timestamp(), traceFormat, format.json()),
      );
      testLogger.info("test message", {
        userId: "user123",
        query: "sensitive data",
      });

      const entry = entries[0];
      // trace_id, span_id, and service are safe random identifiers
      expect(entry.trace_id).toMatch(/^[0-9a-f]{32}$/);
      expect(entry.span_id).toMatch(/^[0-9a-f]{16}$/);
      expect(entry.service).toBeDefined();
      // trace context fields must not contain user-provided data
      expect(entry.trace_id).not.toContain("user123");
      expect(entry.trace_id).not.toContain("sensitive");
      expect(entry.span_id).not.toContain("user123");
    });
  });
});
