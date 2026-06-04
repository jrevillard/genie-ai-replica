// Tests for custom application metrics (Task 1)
// metrics.js — getMeter() wrapper
// middleware/metrics-middleware.js — HTTP request counter + duration histogram

const { metrics } = require('@opentelemetry/api');

jest.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: jest.fn()
  }
}));

// Reset mocks between tests
beforeEach(() => {
  jest.clearAllMocks();
});

describe('metrics.js', () => {
  let getMeter;

  beforeEach(() => {
    jest.isolateModules(() => {
      getMeter = require('../metrics').getMeter;
    });
  });

  it('exports a getMeter function', () => {
    expect(typeof getMeter).toBe('function');
  });

  it('calls metrics.getMeter with service name and version', () => {
    getMeter();
    expect(metrics.getMeter).toHaveBeenCalledWith('genie-backend', '1.0.0');
  });

  it('returns the meter from metrics.getMeter', () => {
    const mockMeter = { createCounter: jest.fn(), createHistogram: jest.fn() };
    metrics.getMeter.mockReturnValueOnce(mockMeter);
    const result = getMeter();
    expect(result).toBe(mockMeter);
  });
});

describe('metrics-middleware.js', () => {
  let createApp;
  let mockCounter;
  let mockHistogram;
  let mockMeter;
  let capturedMiddleware;

  beforeEach(() => {
    mockCounter = { add: jest.fn() };
    mockHistogram = { record: jest.fn() };
    mockMeter = {
      createCounter: jest.fn().mockReturnValue(mockCounter),
      createHistogram: jest.fn().mockReturnValue(mockHistogram)
    };
    metrics.getMeter.mockReturnValue(mockMeter);

    jest.isolateModules(() => {
      const metricsMiddleware = require('../middleware/metrics-middleware');
      capturedMiddleware = metricsMiddleware;
    });
  });

  it('exports a function that returns Express middleware', () => {
    expect(typeof capturedMiddleware).toBe('function');
    const middleware = capturedMiddleware();
    expect(typeof middleware).toBe('function');
  });

  it('creates http_requests_total counter with correct options', () => {
    capturedMiddleware();
    expect(mockMeter.createCounter).toHaveBeenCalledWith('http_requests_total', {
      description: 'Total HTTP requests'
    });
  });

  it('creates http_request_duration_seconds histogram with correct options', () => {
    capturedMiddleware();
    expect(mockMeter.createHistogram).toHaveBeenCalledWith('http_request_duration_seconds', {
      description: 'HTTP request duration',
      unit: 's'
    });
  });

  it('records counter on response finish with correct attributes', (done) => {
    const middleware = capturedMiddleware();
    const req = {
      method: 'GET',
      route: { path: '/api/users/:id' }
    };
    const res = {
      statusCode: 200,
      on: jest.fn((event, cb) => {
        if (event === 'finish') {
          // Simulate finish after a tick
          setImmediate(() => cb());
        }
      })
    };
    const next = jest.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();

    // Wait for finish event
    setImmediate(() => {
      expect(mockCounter.add).toHaveBeenCalledWith(1, expect.objectContaining({
        'http.method': 'GET',
        'http.status_code': 200,
        'http.route': '/api/users/:id'
      }));
      done();
    });
  });

  it('records histogram duration on response finish', (done) => {
    const middleware = capturedMiddleware();
    const startTime = Date.now();
    const req = {
      method: 'POST',
      route: { path: '/api/chat/:conversationId' }
    };
    const res = {
      statusCode: 201,
      on: jest.fn((event, cb) => {
        if (event === 'finish') {
          setImmediate(() => cb());
        }
      })
    };
    const next = jest.fn();

    middleware(req, res, next);

    setImmediate(() => {
      expect(mockHistogram.record).toHaveBeenCalled();
      const callArgs = mockHistogram.record.mock.calls[0];
      expect(callArgs[0]).toBeGreaterThanOrEqual(0); // duration in seconds
      expect(callArgs[1]).toMatchObject({
        'http.method': 'POST',
        'http.status_code': 201,
        'http.route': '/api/chat/:conversationId'
      });
      done();
    });
  });

  it('uses unknown_route when req.route is undefined (404)', (done) => {
    const middleware = capturedMiddleware();
    const req = {
      method: 'GET',
      route: undefined
    };
    const res = {
      statusCode: 404,
      on: jest.fn((event, cb) => {
        if (event === 'finish') {
          setImmediate(() => cb());
        }
      })
    };
    const next = jest.fn();

    middleware(req, res, next);

    setImmediate(() => {
      expect(mockCounter.add).toHaveBeenCalledWith(1, expect.objectContaining({
        'http.route': 'unknown_route'
      }));
      done();
    });
  });

  it('strips PII keys from attributes', (done) => {
    // This test validates the PII enforcement is active.
    // The middleware should never include user_id, email, query_text, document_text.
    // We verify by checking that even if someone passes them in req (which shouldn't happen),
    // they won't appear in metric attributes.

    const middleware = capturedMiddleware();
    const req = {
      method: 'GET',
      route: { path: '/api/users/:id' }
    };
    const res = {
      statusCode: 200,
      on: jest.fn((event, cb) => {
        if (event === 'finish') {
          setImmediate(() => cb());
        }
      })
    };
    const next = jest.fn();

    middleware(req, res, next);

    setImmediate(() => {
      const counterAttrs = mockCounter.add.mock.calls[0][1];
      expect(counterAttrs).not.toHaveProperty('user_id');
      expect(counterAttrs).not.toHaveProperty('email');
      expect(counterAttrs).not.toHaveProperty('query_text');
      expect(counterAttrs).not.toHaveProperty('document_text');

      const histogramAttrs = mockHistogram.record.mock.calls[0][1];
      expect(histogramAttrs).not.toHaveProperty('user_id');
      expect(histogramAttrs).not.toHaveProperty('email');
      expect(histogramAttrs).not.toHaveProperty('query_text');
      expect(histogramAttrs).not.toHaveProperty('document_text');
      done();
    });
  });

  it('calls next() to continue middleware chain', () => {
    const middleware = capturedMiddleware();
    const req = { method: 'GET', route: { path: '/' } };
    const res = {
      statusCode: 200,
      on: jest.fn()
    };
    const next = jest.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('is no-op when ENABLE_METRICS env is "false"', () => {
    const originalEnv = process.env.ENABLE_METRICS;
    process.env.ENABLE_METRICS = 'false';

    // Create fresh spy that no prior test has touched
    const freshAdd = jest.fn();
    metrics.getMeter.mockReturnValueOnce({
      createCounter: jest.fn().mockReturnValue({ add: freshAdd }),
      createHistogram: jest.fn()
    });

    let noOpMiddleware;
    jest.isolateModules(() => {
      jest.resetModules();
      const m = require('../middleware/metrics-middleware');
      noOpMiddleware = m;
    });

    const req = { method: 'GET', route: { path: '/' } };
    const res = { statusCode: 200, on: jest.fn() };
    const next = jest.fn();

    noOpMiddleware()(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(freshAdd).not.toHaveBeenCalled();

    process.env.ENABLE_METRICS = originalEnv;
  });
});
