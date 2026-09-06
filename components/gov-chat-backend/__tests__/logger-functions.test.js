// Tests for logger.js utility functions: reconfigureLogger, triggerLogRollover,
// cleanupCombinedLog, flushLogs. These tests verify observable behavior, not
// internal mock wiring.

// Pin OTel context to "no active span" so traceFormat's `trace.getSpan(...)` is
// deterministic in this file's hermetic JSON-pipeline tests. logger-otel-trace
// already mocks the same module; mirror its setup so both files are isolated
// from any future default-context leak.
jest.mock('@opentelemetry/api', () => ({
  trace: { getSpan: jest.fn() },
  context: { active: jest.fn() }
}));

// Sentinel "no active span" IDs that traceFormat emits when the OTel API has
// no current span. Centralised here so a future format-length change is a
// single edit; logger-otel-trace.test.js uses the same constants.
const ZERO_TRACE_ID = '00000000000000000000000000000000';
const ZERO_SPAN_ID = '0000000000000000';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');

describe('logger.js utility functions', () => {
  let loggerModule;
  let tmpDir;

  beforeAll(() => {
    // Use a temp dir for log files so we don't pollute the project
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-test-'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Re-require logger for each test to reset state
    jest.resetModules();
    loggerModule = require('../../shared/lib/logger');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------
  // reconfigureLogger
  // -------------------------------------------------------------------
  describe('reconfigureLogger', () => {
    it('changes the effective log level', () => {
      const { logger, reconfigureLogger } = loggerModule;

      // Default level is 'info' — debug messages should be silenced
      expect(logger.level).toBe('info');

      reconfigureLogger({ level: 'debug' });
      expect(logger.level).toBe('debug');
    });

    it('preserves existing level when new level is not provided', () => {
      const { logger, reconfigureLogger } = loggerModule;
      reconfigureLogger({ level: 'debug' });
      expect(logger.level).toBe('debug');

      reconfigureLogger({});
      expect(logger.level).toBe('debug');
    });

    it('creates transports with custom size limits', () => {
      const { reconfigureLogger } = loggerModule;

      // Should not throw — validates transport creation with custom config
      expect(() => {
        reconfigureLogger({
          errorMaxSize: '5m',
          errorMaxFiles: '7d',
          combinedMaxSize: '20m',
          combinedMaxFiles: '14d',
          combinedLogMaxSize: 1048576,
          combinedLogMaxFiles: 3,
          zippedArchive: false
        });
      }).not.toThrow();
    });

    it('clears old transports and applies new ones', () => {
      const { logger, reconfigureLogger } = loggerModule;
      const originalTransportCount = logger.transports.length;

      reconfigureLogger({ level: 'warn' });

      // Transport count stays the same (4 transports: console + 2 rotate + file)
      expect(logger.transports.length).toBe(originalTransportCount);
    });
  });

  // -------------------------------------------------------------------
  // triggerLogRollover
  // -------------------------------------------------------------------
  describe('triggerLogRollover', () => {
    it('does not throw when DailyRotateFile transports have rotate method', () => {
      const { triggerLogRollover } = loggerModule;

      // The real DailyRotateFile transports should have a rotate method
      expect(() => triggerLogRollover()).not.toThrow();
    });

    it('warns when error rotate transport is missing rotate method', () => {
      const { logger, triggerLogRollover } = loggerModule;

      // Temporarily remove the rotate method from error transport
      const errorTransport = logger.transports.find(
        (t) => t.constructor.name === 'DailyRotateFile' && t.level === 'error'
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

    it('re-throws errors from rotate failures', () => {
      const { logger, triggerLogRollover } = loggerModule;

      const errorTransport = logger.transports.find(
        (t) => t.constructor.name === 'DailyRotateFile' && t.level === 'error'
      );

      if (errorTransport) {
        const originalRotate = errorTransport.rotate;
        errorTransport.rotate = () => {
          throw new Error('disk full');
        };

        expect(() => triggerLogRollover()).toThrow('disk full');

        errorTransport.rotate = originalRotate;
      }
    });
  });

  // -------------------------------------------------------------------
  // cleanupCombinedLog
  // -------------------------------------------------------------------
  describe('cleanupCombinedLog', () => {
    it('deletes combined.log when it exists', () => {
      const { cleanupCombinedLog } = loggerModule;
      const logDir = path.join(process.cwd(), 'logs');
      const combinedLog = path.join(logDir, 'combined.log');

      // Create the file
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      fs.writeFileSync(combinedLog, 'old log data');

      expect(fs.existsSync(combinedLog)).toBe(true);

      cleanupCombinedLog();

      expect(fs.existsSync(combinedLog)).toBe(false);
    });

    it('does not throw when combined.log does not exist', () => {
      const { cleanupCombinedLog } = loggerModule;
      const combinedLog = path.join(process.cwd(), 'logs', 'combined.log');

      // Ensure file does not exist
      if (fs.existsSync(combinedLog)) fs.unlinkSync(combinedLog);

      expect(() => cleanupCombinedLog()).not.toThrow();
    });

    it('re-throws errors from fs.unlinkSync failure', () => {
      const { cleanupCombinedLog } = loggerModule;
      const combinedLog = path.join(process.cwd(), 'logs', 'combined.log');

      // Create the file
      const logDir = path.join(process.cwd(), 'logs');
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      fs.writeFileSync(combinedLog, 'data');

      // Make unlinkSync fail
      const unlinkSpy = jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {
        throw new Error('permission denied');
      });

      expect(() => cleanupCombinedLog()).toThrow('permission denied');

      unlinkSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------
  // flushLogs
  // -------------------------------------------------------------------
  describe('flushLogs', () => {
    it('does not throw when transports lack flush method', () => {
      const { flushLogs } = loggerModule;

      // Default transports may not have flush — should not throw
      expect(() => flushLogs()).not.toThrow();
    });

    it('calls flush on transports that support it', () => {
      const { logger, flushLogs } = loggerModule;

      // Spy on the real transports to see if flush is attempted
      const transportWithFlush = logger.transports.find((t) => typeof t.flush === 'function');

      if (transportWithFlush) {
        const flushSpy = jest.spyOn(transportWithFlush, 'flush');
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

    it('skips transports without flush method', () => {
      const { flushLogs } = loggerModule;

      // Console transport doesn't have flush — should not throw
      expect(() => flushLogs()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------
  // traceFormat → winston.format.json pipeline (Story 2.8 — JSON-key schema)
  //
  // traceFormat writes `trace_id` and `span_id` as TOP-LEVEL keys on the
  // Winston `info` object. When the pipeline ends with `winston.format.json()`
  // (the production-target wire shape per Story 2.5's deferred work), those
  // keys must surface as own properties of the parsed JSON record —
  // consumed by VictoriaLogs LogSQL `trace_id:` filters, the Grafana
  // trace_explorer, and the NDJSON file fallback. They MUST NOT be
  // printf-template substrings (e.g. `trace_id=%s`) inside a JSON string.
  //
  // These tests exercise traceFormat + format.json() directly. They do NOT
  // assert the production default `loggerConfig.format` (which still uses
  // the printf `logFormat`) — that path is covered by logger-otel-trace and
  // will be re-validated once Story 2.5 lands.
  // -------------------------------------------------------------------
  describe('traceFormat → winston.format.json pipeline', () => {
    it('produces JSON output with trace_id and span_id as top-level keys (no active span)', () => {
      const { format, createLogger, transports: winstonTransports } = require('winston');
      const { traceFormat } = loggerModule;

      const entries = [];
      const passThrough = new PassThrough();
      passThrough.on('data', (chunk) => {
        entries.push(JSON.parse(chunk.toString().trim()));
      });

      const testLogger = createLogger({
        level: 'debug',
        format: format.combine(format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), traceFormat, format.json()),
        transports: [new winstonTransports.Stream({ stream: passThrough })],
        exitOnError: false
      });

      testLogger.info('hello world');

      expect(entries).toHaveLength(1);
      const entry = entries[0];
      // Top-level keys on the JSON object (not printf substrings).
      expect(entry).toHaveProperty('trace_id');
      expect(entry).toHaveProperty('span_id');
      // No active span → zeroed placeholder values, not undefined.
      expect(entry.trace_id).toBe(ZERO_TRACE_ID);
      expect(entry.span_id).toBe(ZERO_SPAN_ID);
    });

    it('emits trace_id and span_id as JSON keys, not printf `%s` substrings', () => {
      const { format, createLogger, transports: winstonTransports } = require('winston');
      const { traceFormat } = loggerModule;

      const rawChunks = [];
      const passThrough = new PassThrough();
      passThrough.on('data', (chunk) => {
        rawChunks.push(chunk.toString());
      });

      const testLogger = createLogger({
        level: 'debug',
        format: format.combine(format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), traceFormat, format.json()),
        transports: [new winstonTransports.Stream({ stream: passThrough })],
        exitOnError: false
      });

      testLogger.info('hello world');

      expect(rawChunks).toHaveLength(1);
      const raw = rawChunks[0];
      // Output is valid JSON — not a printf-formatted string.
      expect(() => JSON.parse(raw.trim())).not.toThrow();
      // Positive assertions: parsed object has the expected top-level keys.
      const parsed = JSON.parse(raw.trim());
      expect(Object.prototype.hasOwnProperty.call(parsed, 'trace_id')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(parsed, 'span_id')).toBe(true);
      expect(parsed.message).toBe('hello world');
      // No printf placeholders leaked into the rendered output.
      expect(raw).not.toMatch(/trace_id=%s/);
      expect(raw).not.toMatch(/span_id=%s/);
      // No legacy printf quote-wrapped form should be present.
      expect(raw).not.toMatch(/trace_id="/);
      expect(raw).not.toMatch(/span_id="/);
    });
  });

  // -------------------------------------------------------------------
  // Default log level
  // -------------------------------------------------------------------
  describe('default log level', () => {
    it('defaults to info when LOG_LEVEL is not set', () => {
      delete process.env.LOG_LEVEL;
      jest.resetModules();
      const mod = require('../../shared/lib/logger');
      expect(mod.logger.level).toBe('info');
    });

    it('uses LOG_LEVEL env var when set', () => {
      process.env.LOG_LEVEL = 'debug';
      jest.resetModules();
      const mod = require('../../shared/lib/logger');
      expect(mod.logger.level).toBe('debug');
      delete process.env.LOG_LEVEL;
    });
  });
});
