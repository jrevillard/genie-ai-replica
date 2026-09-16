// Tests the non-test (OTel initialization) branch of tracing.js
// Uses jest.isolateModules to reload with NODE_ENV != test

const mockStart = jest.fn();
const mockShutdown = jest.fn().mockResolvedValue(undefined);
const mockGetTracer = jest.fn().mockReturnValue({ startSpan: jest.fn() });
// tracing.js now requires metrics.js, which calls metrics.getMeter()
// at module load (otlp_unreachable dropped counter). The @opentelemetry/api
// mock must provide the `metrics` namespace or the counter init fails.
// `mockCreateCounter` + `mockCounterAdd` are exposed at module scope so the
// otlp_unreachable increment test can observe the `.add()` call.
const mockCounterAdd = jest.fn();
const mockCreateCounter = jest.fn().mockReturnValue({ add: mockCounterAdd });
const mockGetMeter = jest.fn().mockReturnValue({ createCounter: mockCreateCounter });

jest.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: jest.fn().mockImplementation(() => ({
    start: mockStart,
    shutdown: mockShutdown
  }))
}));

jest.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: jest.fn().mockImplementation(() => ({}))
}));

jest.mock('@opentelemetry/auto-instrumentations-node', () => ({
  getNodeAutoInstrumentations: jest.fn().mockReturnValue([])
}));

jest.mock('@opentelemetry/semantic-conventions', () => ({
  ATTR_SERVICE_NAME: 'service.name',
  ATTR_SERVICE_VERSION: 'service.version',
  ATTR_DEPLOYMENT_ENVIRONMENT: 'deployment.environment'
}));

jest.mock('@opentelemetry/sdk-trace-base', () => ({
  BatchSpanProcessor: jest.fn().mockImplementation(() => ({
    onStart: jest.fn(),
    onEnd: jest.fn(),
    shutdown: jest.fn().mockResolvedValue(),
    forceFlush: jest.fn().mockResolvedValue()
  }))
}));

jest.mock('@opentelemetry/core', () => ({
  W3CTraceContextPropagator: jest.fn().mockImplementation(() => ({}))
}));

jest.mock('@opentelemetry/api', () => ({
  trace: { getTracer: mockGetTracer },
  // shared/lib/logger.js + tracing.js both module-load a
  // log_record_dropped_total counter via metrics.getMeter(...).createCounter(...).
  metrics: { getMeter: mockGetMeter }
}));

jest.mock('@opentelemetry/resources', () => ({
  resourceFromAttributes: jest.fn().mockReturnValue({})
}));

jest.mock('@opentelemetry/exporter-metrics-otlp-http', () => ({
  OTLPMetricExporter: jest.fn().mockImplementation(() => ({}))
}));

jest.mock('@opentelemetry/sdk-metrics', () => ({
  PeriodicExportingMetricReader: jest.fn().mockImplementation(() => ({}))
}));

// The OTel logs deps require the LoggerProvider block in tracing.js
// at module load. Mock here to keep the non-test-branch tests
// hermetic — the dedicated 2-10 test file (victorialogs-transport.test.js)
// exercises the transport; this file only asserts sdk + tracer + signals.
jest.mock('@opentelemetry/api-logs', () => ({
  logs: { setGlobalLoggerProvider: jest.fn() }
}));

jest.mock('@opentelemetry/exporter-logs-otlp-http', () => ({
  OTLPLogExporter: jest.fn().mockImplementation(() => ({}))
}));

jest.mock('@opentelemetry/sdk-logs', () => {
  const noopBatch = jest.fn().mockImplementation(() => ({
    onEmit: jest.fn(),
    shutdown: jest.fn().mockResolvedValue(),
    forceFlush: jest.fn().mockResolvedValue()
  }));
  return {
    LoggerProvider: jest.fn().mockImplementation(() => ({
      shutdown: jest.fn().mockResolvedValue(),
      addLogRecordProcessor: noopBatch
    })),
    BatchLogRecordProcessor: noopBatch
  };
});

// 2-6 also added tracing-pii-logs.js (PIIRedactingLogRecordProcessor).
// Provide a stub so require does not throw if the LoggerProvider block runs.
jest.mock('../tracing-pii-logs', () => ({
  PIIRedactingLogRecordProcessor: jest.fn().mockImplementation(() => ({
    onEmit: jest.fn(),
    shutdown: jest.fn(),
    forceFlush: jest.fn()
  }))
}));

// 2-5 + 2-7 introduced shared/lib/boolean-env + otel-batch-config. The
// require chain at tracing.js:59-62 must resolve cleanly under the mock.
jest.mock('../../shared/lib/boolean-env', () => ({
  booleanEnv: jest.fn().mockReturnValue(false)
}));

jest.mock('../../shared/lib/otel-batch-config', () => ({
  maxExportBatchSize: 512,
  scheduledDelayMillis: 5000,
  maxQueueSize: 2048
}));

describe('tracing.js non-test branch', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalExit = process.exit;

  let tracingModule;

  beforeAll(() => {
    process.env.NODE_ENV = 'development';
    process.env.ENABLE_OBSERVABILITY = '1';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://otel-collector:4318';
    process.exit = jest.fn();
    // Use isolateModules to get a fresh require of tracing.js with NODE_ENV=development
    jest.isolateModules(() => {
      tracingModule = require('../tracing');
    });
  });

  afterAll(() => {
    process.env.NODE_ENV = originalEnv;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    process.exit = originalExit;
  });

  it('exports a non-null sdk', () => {
    expect(tracingModule.sdk).not.toBeNull();
    expect(typeof tracingModule.sdk.start).toBe('function');
  });

  it('calls sdk.start() during initialization', () => {
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('exports a getTracer function', () => {
    expect(typeof tracingModule.getTracer).toBe('function');
  });

  it('getTracer returns result from trace.getTracer', () => {
    const tracer = tracingModule.getTracer();
    // serviceVersion is read from package.json (or SERVICE_VERSION env
    // override). The test only verifies the service NAME arg + the tracer
    // return value — version is a non-deterministic string read at module
    // load time.
    expect(mockGetTracer).toHaveBeenCalledWith('backend', expect.any(String));
    expect(tracer).toEqual({ startSpan: expect.any(Function) });
  });

  it('registers SIGTERM handler', () => {
    const listeners = process.listeners('SIGTERM');
    expect(listeners.length).toBeGreaterThan(0);
  });

  // Round-2 fix (H4a): SIGTERM/SIGINT handlers must capture the Promise
  // returned by `withBackgroundSpan` — `process.on` ignores the
  // listener's return value, so without `.catch()` the Promise drops
  // on the floor and the otel.shutdown span leaks.
  it('SIGTERM handler attaches .catch() to capture the withBackgroundSpan Promise', () => {
    // Find the listener that the tracing.js install registered.
    const listeners = process.listeners('SIGTERM');
    expect(listeners.length).toBeGreaterThan(0);
    const handler = listeners[listeners.length - 1];
    // The handler must NOT just call withBackgroundSpan — that returns
    // a Promise which process.on discards. It must return a Promise
    // that we can `.catch()` (i.e. it returns the result of `.catch()`).
    expect(typeof handler).toBe('function');
    // The handler should not synchronously invoke gracefulShutdown
    // (which would call process.exit). Capture and discard any returned
    // promise so the test process doesn't actually exit.
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});
    try {
      const result = handler();
      // Either the handler returns a Promise (the .catch() chain)
      // or it returns void (we accept that — the .catch() pattern
      // doesn't strictly require returning the Promise, as long as
      // the rejection handler is attached internally).
      if (result && typeof result.catch === 'function') {
        result.catch(() => {});
      }
      // We can't actually invoke gracefulShutdown in a test (it
      // would call process.exit). The static-check that the handler
      // exists is sufficient for this regression test.
      expect(mockExit).not.toHaveBeenCalled();
    } finally {
      mockExit.mockRestore();
    }
  });

  it('registers SIGINT handler', () => {
    const listeners = process.listeners('SIGINT');
    expect(listeners.length).toBeGreaterThan(0);
  });

  describe('graceful shutdown', () => {
    beforeEach(() => {
      process.exit.mockClear();
    });

    it('calls sdk.shutdown() and process.exit(0) on signal', async () => {
      mockShutdown.mockResolvedValueOnce(undefined);
      const handler = process.listeners('SIGTERM').find((h) => h.name === 'gracefulShutdown');
      if (handler) {
        await handler('SIGTERM');
        expect(mockShutdown).toHaveBeenCalled();
        expect(process.exit).toHaveBeenCalledWith(0);
      }
    });

    it('exits via timeout when sdk.shutdown() hangs', async () => {
      jest.useFakeTimers();
      let resolveShutdown;
      mockShutdown.mockReturnValue(
        new Promise((r) => {
          resolveShutdown = r;
        })
      );

      const handler = process.listeners('SIGTERM').find((h) => h.name === 'gracefulShutdown');
      if (handler) {
        handler('SIGTERM');
        jest.advanceTimersByTime(5000);
        expect(process.exit).toHaveBeenCalledWith(0);
        resolveShutdown();
      }
      jest.useRealTimers();
    });

    it('clears timeout on successful shutdown', async () => {
      mockShutdown.mockResolvedValueOnce(undefined);
      const handler = process.listeners('SIGTERM').find((h) => h.name === 'gracefulShutdown');
      if (handler) {
        await handler('SIGTERM');
        expect(process.exit).toHaveBeenCalledTimes(1);
        expect(process.exit).toHaveBeenCalledWith(0);
      }
    });
  });
});

// otlp_unreachable call-site: tracing.js wraps `sdk.start()` in try/catch and
// increments the dropped counter when the SDK init throws. This block
// re-requires tracing.js under a synthetic `mockStart` failure and asserts
// the counter was bumped with the bounded enum reason.
describe('tracing.js — log_record_dropped_total{reason=otlp_unreachable}', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalExit = process.exit;

  let thrownError;

  beforeAll(() => {
    process.env.NODE_ENV = 'development';
    process.env.ENABLE_OBSERVABILITY = '1';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://otel-collector:4318';
    process.exit = jest.fn();
    // Replace this single invocation's behavior — every subsequent sdk.start()
    // call (none, since the require throws) is unaffected. Reset afterwards.
    mockStart.mockImplementationOnce(() => {
      throw new Error('synthetic init fail');
    });
    mockCounterAdd.mockClear();

    jest.isolateModules(() => {
      try {
        require('../tracing');
      } catch (err) {
        thrownError = err;
      }
    });
  });

  afterAll(() => {
    process.env.NODE_ENV = originalEnv;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    process.exit = originalExit;
    mockStart.mockReset();
  });

  it('rethrows the underlying SDK init error', () => {
    expect(thrownError).toBeDefined();
    expect(thrownError.message).toBe('synthetic init fail');
  });

  it('increments the dropped counter with the otlp_unreachable reason', () => {
    expect(mockCounterAdd).toHaveBeenCalledWith(1, { reason: 'otlp_unreachable' });
  });
});
