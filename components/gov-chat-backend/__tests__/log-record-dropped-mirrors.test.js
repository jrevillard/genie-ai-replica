// Parity check: shared/lib call-site modules define a local mirror of the
// canonical `LOG_DROPPED_REASON` enum (AD-18 forbids a shared helper that
// crosses `shared/lib → backend`). This test loads both mirrors (under the
// same `@opentelemetry/api` mock used by tracing-non-test.test.js so the
// module-load counter creation does not blow up) and asserts the mirror
// values exactly equal the canonical backend enum from metrics.js.
//
// A drift between any mirror and the canonical enum would silently corrupt
// the Prometheus `log_record_dropped_total{reason=...}` label set — a
// cardinality bug. The test fails fast on any drift.

const mockGetMeter = jest.fn().mockReturnValue({ createCounter: jest.fn() });

jest.mock('@opentelemetry/api', () => ({
  metrics: { getMeter: mockGetMeter },
  trace: { getTracer: jest.fn().mockReturnValue({}) },
  context: { active: jest.fn().mockReturnValue({}) }
}));

const { LOG_DROPPED_REASON: canonical } = require('../metrics');
const { LOG_DROPPED_REASON: loggerMirror } = require('../../shared/lib/logger');
const { LOG_DROPPED_REASON: transportMirror } = require('../../shared/lib/victorialogs-transport');

describe('LOG_DROPPED_REASON — mirror parity across shared/lib call-sites', () => {
  it('logger.js mirror exactly equals the canonical backend enum', () => {
    expect(loggerMirror).toEqual(canonical);
  });

  it('victorialogs-transport.js mirror exactly equals the canonical backend enum', () => {
    expect(transportMirror).toEqual(canonical);
  });

  it('all three enums have identical key sets', () => {
    expect(Object.keys(loggerMirror).sort()).toEqual(Object.keys(canonical).sort());
    expect(Object.keys(transportMirror).sort()).toEqual(Object.keys(canonical).sort());
  });

  it('each reason value is a non-empty lowercase string (no cardinality drift)', () => {
    for (const value of Object.values(canonical)) {
      expect(typeof value).toBe('string');
      expect(value).toMatch(/^[a-z][a-z_]+$/);
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('no mirror drifts to an extra or missing reason (cardinality bounded)', () => {
    const canonicalKeys = Object.keys(canonical).sort();
    const loggerKeys = Object.keys(loggerMirror).sort();
    const transportKeys = Object.keys(transportMirror).sort();
    expect(loggerKeys).toEqual(canonicalKeys);
    expect(transportKeys).toEqual(canonicalKeys);
  });
});
