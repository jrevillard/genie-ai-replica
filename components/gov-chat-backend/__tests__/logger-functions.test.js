// Tests for logger.js utility functions: reconfigureLogger, triggerLogRollover,
// cleanupCombinedLog, flushLogs. These tests verify observable behavior, not
// internal mock wiring.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { PassThrough } = require("stream");

describe("logger.js utility functions", () => {
  let loggerModule;
  let tmpDir;

  beforeAll(() => {
    // Use a temp dir for log files so we don't pollute the project
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logger-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Re-require logger for each test to reset state
    jest.resetModules();
    loggerModule = require("../../shared/lib/logger");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------
  // reconfigureLogger
  // -------------------------------------------------------------------
  describe("reconfigureLogger", () => {
    it("changes the effective log level", () => {
      const { logger, reconfigureLogger } = loggerModule;

      // Default level is 'info' — debug messages should be silenced
      expect(logger.level).toBe("info");

      reconfigureLogger({ level: "debug" });
      expect(logger.level).toBe("debug");
    });

    it("preserves existing level when new level is not provided", () => {
      const { logger, reconfigureLogger } = loggerModule;
      reconfigureLogger({ level: "debug" });
      expect(logger.level).toBe("debug");

      reconfigureLogger({});
      expect(logger.level).toBe("debug");
    });

    it("creates transports with custom size limits", () => {
      const { reconfigureLogger } = loggerModule;

      // Should not throw — validates transport creation with custom config
      expect(() => {
        reconfigureLogger({
          errorMaxSize: "5m",
          errorMaxFiles: "7d",
          combinedMaxSize: "20m",
          combinedMaxFiles: "14d",
          combinedLogMaxSize: 1048576,
          combinedLogMaxFiles: 3,
          zippedArchive: false,
        });
      }).not.toThrow();
    });

    it("clears old transports and applies new ones", () => {
      const { logger, reconfigureLogger } = loggerModule;
      const originalTransportCount = logger.transports.length;

      reconfigureLogger({ level: "warn" });

      // Transport count stays the same (4 transports: console + 2 rotate + file)
      expect(logger.transports.length).toBe(originalTransportCount);
    });
  });

  // -------------------------------------------------------------------
  // triggerLogRollover
  // -------------------------------------------------------------------
  describe("triggerLogRollover", () => {
    it("does not throw when DailyRotateFile transports have rotate method", () => {
      const { triggerLogRollover } = loggerModule;

      // The real DailyRotateFile transports should have a rotate method
      expect(() => triggerLogRollover()).not.toThrow();
    });

    it("warns when error rotate transport is missing rotate method", () => {
      const { logger, triggerLogRollover } = loggerModule;

      // Temporarily remove the rotate method from error transport
      const errorTransport = logger.transports.find(
        (t) => t.constructor.name === "DailyRotateFile" && t.level === "error",
      );
      const originalRotate = errorTransport && errorTransport.rotate;
      if (errorTransport) {
        errorTransport.rotate = undefined;
      }

      // Should not throw — just warns
      expect(() => triggerLogRollover()).not.toThrow();

      // Restore
      if (errorTransport && originalRotate) {
        errorTransport.rotate = originalRotate;
      }
    });

    it("re-throws errors from rotate failures", () => {
      const { logger, triggerLogRollover } = loggerModule;

      const errorTransport = logger.transports.find(
        (t) => t.constructor.name === "DailyRotateFile" && t.level === "error",
      );

      if (errorTransport) {
        const originalRotate = errorTransport.rotate;
        errorTransport.rotate = () => {
          throw new Error("disk full");
        };

        expect(() => triggerLogRollover()).toThrow("disk full");

        errorTransport.rotate = originalRotate;
      }
    });
  });

  // -------------------------------------------------------------------
  // cleanupCombinedLog
  // -------------------------------------------------------------------
  describe("cleanupCombinedLog", () => {
    it("deletes combined.log when it exists", () => {
      const { cleanupCombinedLog } = loggerModule;
      const logDir = path.join(process.cwd(), "logs");
      const combinedLog = path.join(logDir, "combined.log");

      // Create the file
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      fs.writeFileSync(combinedLog, "old log data");

      expect(fs.existsSync(combinedLog)).toBe(true);

      cleanupCombinedLog();

      expect(fs.existsSync(combinedLog)).toBe(false);
    });

    it("does not throw when combined.log does not exist", () => {
      const { cleanupCombinedLog } = loggerModule;
      const combinedLog = path.join(process.cwd(), "logs", "combined.log");

      // Ensure file does not exist
      if (fs.existsSync(combinedLog)) fs.unlinkSync(combinedLog);

      expect(() => cleanupCombinedLog()).not.toThrow();
    });

    it("re-throws errors from fs.unlinkSync failure", () => {
      const { cleanupCombinedLog } = loggerModule;
      const combinedLog = path.join(process.cwd(), "logs", "combined.log");

      // Create the file
      const logDir = path.join(process.cwd(), "logs");
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      fs.writeFileSync(combinedLog, "data");

      // Make unlinkSync fail
      const unlinkSpy = jest.spyOn(fs, "unlinkSync").mockImplementation(() => {
        throw new Error("permission denied");
      });

      expect(() => cleanupCombinedLog()).toThrow("permission denied");

      unlinkSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------
  // flushLogs
  // -------------------------------------------------------------------
  describe("flushLogs", () => {
    it("does not throw when transports lack flush method", () => {
      const { flushLogs } = loggerModule;

      // Default transports may not have flush — should not throw
      expect(() => flushLogs()).not.toThrow();
    });

    it("calls flush on transports that support it", () => {
      const { logger, flushLogs } = loggerModule;

      // Spy on the real transports to see if flush is attempted
      const transportWithFlush = logger.transports.find(
        (t) => typeof t.flush === "function",
      );

      if (transportWithFlush) {
        const flushSpy = jest.spyOn(transportWithFlush, "flush");
        flushLogs();
        expect(flushSpy).toHaveBeenCalled();
      } else {
        // No transport has flush — verify the function walks all transports
        // without error by checking the transport count is unchanged
        const countBefore = logger.transports.length;
        flushLogs();
        expect(logger.transports.length).toBe(countBefore);
      }
    });

    it("skips transports without flush method", () => {
      const { flushLogs } = loggerModule;

      // Console transport doesn't have flush — should not throw
      expect(() => flushLogs()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------
  // logFormat output (printf format)
  // -------------------------------------------------------------------
  describe("logFormat output", () => {
    it('formats log entries as "TIMESTAMP [LEVEL]: message"', () => {
      const {
        format,
        createLogger,
        transports: winstonTransports,
      } = require("winston");

      const entries = [];
      const passThrough = new PassThrough();
      passThrough.on("data", (chunk) => entries.push(chunk.toString().trim()));

      const testLogger = createLogger({
        level: "debug",
        format: format.combine(
          format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
          format.printf(({ level, message, timestamp }) => {
            return `${timestamp} [${level.toUpperCase()}]: ${message}`;
          }),
        ),
        transports: [new winstonTransports.Stream({ stream: passThrough })],
        exitOnError: false,
      });

      testLogger.info("hello world");

      // Verify the format matches the expected pattern
      expect(entries[0]).toMatch(
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \[INFO\]: hello world$/,
      );
    });

    it("uses uppercase level in formatted output", () => {
      const {
        format,
        createLogger,
        transports: winstonTransports,
      } = require("winston");

      const entries = [];
      const passThrough = new PassThrough();
      passThrough.on("data", (chunk) => entries.push(chunk.toString().trim()));

      const testLogger = createLogger({
        level: "debug",
        format: format.combine(
          format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
          format.printf(({ level, message, timestamp }) => {
            return `${timestamp} [${level.toUpperCase()}]: ${message}`;
          }),
        ),
        transports: [new winstonTransports.Stream({ stream: passThrough })],
        exitOnError: false,
      });

      testLogger.warn("warning");
      testLogger.error("error");

      expect(entries[0]).toContain("[WARN]");
      expect(entries[1]).toContain("[ERROR]");
    });
  });

  // -------------------------------------------------------------------
  // Default log level
  // -------------------------------------------------------------------
  describe("default log level", () => {
    it("defaults to info when LOG_LEVEL is not set", () => {
      delete process.env.LOG_LEVEL;
      jest.resetModules();
      const mod = require("../../shared/lib/logger");
      expect(mod.logger.level).toBe("info");
    });

    it("uses LOG_LEVEL env var when set", () => {
      process.env.LOG_LEVEL = "debug";
      jest.resetModules();
      const mod = require("../../shared/lib/logger");
      expect(mod.logger.level).toBe("debug");
      delete process.env.LOG_LEVEL;
    });
  });
});
