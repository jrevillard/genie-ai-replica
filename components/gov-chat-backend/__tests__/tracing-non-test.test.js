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
    expect(mockGetTracer).toHaveBeenCalledWith('genie-backend', '1.0.0');
    expect(tracer).toEqual({ startSpan: expect.any(Function) });
  });

  it('registers SIGTERM handler', () => {
    const listeners = process.listeners('SIGTERM');
    expect(listeners.length).toBeGreaterThan(0);
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
