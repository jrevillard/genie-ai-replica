// PII verification test — ensures no PII attributes leak into metric exports
// Triggers the middleware with a mock request/response cycle

const { metrics } = require('@opentelemetry/api');

jest.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: jest.fn(),
  },
}));

/**
 * Helper: create a mock res that captures the 'finish' callback
 * without auto-invoking it. Call triggerFinish() to fire it.
 */
function createMockRes(statusCode = 200) {
  const res = { statusCode, on: jest.fn() };
  res.triggerFinish = () => {
    const call = res.on.mock.calls.find((c) => c[0] === 'finish');
    if (call) call[1]();
  };
  return res;
}

describe('PII Verification', () => {
  let capturedAttrs;
  let middleware;

  beforeEach(() => {
    jest.clearAllMocks();
    capturedAttrs = [];

    const mockCounter = {
      add: jest.fn((val, attrs) => {
        capturedAttrs.push(attrs);
      }),
    };
    const mockHistogram = {
      record: jest.fn(),
    };
    metrics.getMeter.mockReturnValue({
      createCounter: jest.fn().mockReturnValue(mockCounter),
      createHistogram: jest.fn().mockReturnValue(mockHistogram),
    });

    jest.isolateModules(() => {
      const factory = require('../middleware/metrics-middleware');
      middleware = factory();
    });
  });

  // Required PII keys that must never appear in metric attributes
  const REQUIRED_PII_KEYS = [
    'user_id', 'email', 'query_text', 'document_text', 'password', 'token',
  ];

  REQUIRED_PII_KEYS.forEach((piiKey) => {
    it(`strips '${piiKey}' from attributes`, () => {
      const req = {
        method: 'GET',
        route: { path: '/api/test' },
        [piiKey]: 'sensitive-value',
      };
      const res = createMockRes(200);
      middleware(req, res, jest.fn());
      res.triggerFinish();

      const leaked = capturedAttrs.some((a) => piiKey in a);
      expect(leaked).toBe(false);
    });
  });

  it('allows safe HTTP attributes through', () => {
    const req = { method: 'POST', route: { path: '/api/chat/:conversationId' } };
    const res = createMockRes(200);
    middleware(req, res, jest.fn());
    res.triggerFinish();

    expect(capturedAttrs.length).toBe(1);
    const attrs = capturedAttrs[0];
    expect(attrs['http.method']).toBe('POST');
    expect(attrs['http.status_code']).toBe(200);
    expect(attrs['http.route']).toBe('/api/chat/:conversationId');
  });

  it('records metrics for each request/response cycle', () => {
    const req = { method: 'GET', route: { path: '/api/health' } };
    const res = createMockRes(200);
    middleware(req, res, jest.fn());
    res.triggerFinish();

    expect(capturedAttrs.length).toBe(1);
  });
});
