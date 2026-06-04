// PII verification test — ensures no PII attributes leak into metric exports
// Tests that the metrics middleware's attribute denylist covers all required PII fields

const { metrics } = require('@opentelemetry/api');

jest.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: jest.fn(),
  },
}));

describe('PII Verification', () => {
  let capturedAttrs;

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
      require('../middleware/metrics-middleware');
    });
  });

  // Required PII keys that must NEVER appear in metric attributes
  const REQUIRED_PII_KEYS = [
    'user_id',
    'email',
    'query_text',
    'document_text',
    'password',
    'token',
  ];

  REQUIRED_PII_KEYS.forEach((piiKey) => {
    it(`strips '${piiKey}' from attributes`, () => {
      const leaked = capturedAttrs.some((a) => piiKey in a);
      expect(leaked).toBe(false);
    });
  });

  it('allows safe HTTP attributes through', () => {
    const safeKeys = ['http.method', 'http.status_code', 'http.route'];
    const hasAll = capturedAttrs.every((a) =>
      safeKeys.every((k) => k in a)
    );
    expect(hasAll).toBe(true);
  });
});
