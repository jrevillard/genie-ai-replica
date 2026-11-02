// D4: healthcheck traffic (the backend's own 10s wget /api/health) must never
// accumulate IP reputation — +1/hit with 1/hour decay tripped "IP Blocked"
// spam and unbounded Map growth. Real security-middleware (the deployed file),
// mocked shared logger — same idiom as the other middleware tests. The three
// deps below are virtual-mocked: they resolve from components/shared/lib in
// Docker but no node_modules sits there in the repo checkout.
jest.mock('../../shared/lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
jest.mock('express-rate-limit', () => jest.fn(() => (req, res, next) => next()), { virtual: true });
jest.mock('validator', () => ({ escape: (s) => s }), { virtual: true });
jest.mock('geoip-lite', () => ({ lookup: () => null }), { virtual: true });

const SecurityMiddleware = require('../../shared/lib/security-middleware');
const { logger } = require('../../shared/lib/logger');

// wget healthcheck shape: no auth header, no user, bare path
const reqLike = (path, ip) => ({ path, ip, headers: {}, query: {}, body: {} });

describe('health endpoint reputation exemption (D4)', () => {
  beforeEach(() => {
    SecurityMiddleware.ipReputation.clear();
    jest.clearAllMocks();
  });

  it('never scores /api/health or /health, however often hit', () => {
    for (let i = 0; i < 250; i++) { // far past the 100-score blockIP threshold
      SecurityMiddleware.updateIPReputation(reqLike('/api/health', '10.0.0.1'));
      SecurityMiddleware.updateIPReputation(reqLike('/health', '10.0.0.2'));
    }
    expect(SecurityMiddleware.ipReputation.size).toBe(0);
    expect(logger.warn).not.toHaveBeenCalled(); // no "IP Blocked"
  });

  it('matches trailing-slash and case variants of the health paths', () => {
    for (const path of ['/api/health/', '/API/HEALTH', '/Health/']) {
      SecurityMiddleware.updateIPReputation(reqLike(path, '10.0.0.9'));
      const next = jest.fn();
      SecurityMiddleware.threatDetectionMiddleware(reqLike(path, '10.0.0.9'), {}, next);
      expect(next).toHaveBeenCalledTimes(1);
    }
    expect(SecurityMiddleware.ipReputation.size).toBe(0);
  });

  it('still scores other unauthenticated paths', () => {
    SecurityMiddleware.updateIPReputation(reqLike('/api/queries', '10.0.0.3'));
    expect(SecurityMiddleware.ipReputation.get('10.0.0.3').score).toBe(1);
  });

  it('threatDetectionMiddleware skips health paths entirely', () => {
    const next = jest.fn();
    SecurityMiddleware.threatDetectionMiddleware(reqLike('/api/health', '10.0.0.4'), {}, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(SecurityMiddleware.ipReputation.size).toBe(0);
  });
});
