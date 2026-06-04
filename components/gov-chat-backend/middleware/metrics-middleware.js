// metrics-middleware.js — Express middleware that records custom HTTP metrics
// Instruments: http_requests_total (counter), http_request_duration_seconds (histogram)
// Uses route template patterns to prevent cardinality explosion.

const { getMeter } = require('../metrics');

// PII keys that must never appear in metric attributes
const PII_KEYS = new Set([
  'user_id',
  'email',
  'query_text',
  'document_text',
  'password',
  'token'
]);

/**
 * Removes PII keys from attributes object.
 * @param {Object} attrs
 * @returns {Object} sanitized copy
 */
function sanitizeAttributes(attrs) {
  const sanitized = { ...attrs };
  for (const key of Object.keys(sanitized)) {
    if (PII_KEYS.has(key)) {
      delete sanitized[key];
    }
  }
  return sanitized;
}

// Toggle: set ENABLE_METRICS=false to disable metrics overhead (for benchmarking)
if (process.env.ENABLE_METRICS === 'false') {
  module.exports = function metricsMiddleware() {
    return (req, res, next) => next();
  };
} else {
  const meter = getMeter();

  const requestCounter = meter.createCounter('http_requests_total', {
    description: 'Total HTTP requests'
  });

  const requestDuration = meter.createHistogram('http_request_duration_seconds', {
    description: 'HTTP request duration',
    unit: 's'
  });

  /**
   * Express middleware that records HTTP request count and duration.
   * Uses req.route.path for template patterns (e.g., /api/users/:id).
   * Falls back to 'unknown_route' for 404s where req.route is undefined.
   */
  function metricsMiddleware() {
    return (req, res, next) => {
      const start = process.hrtime.bigint();

      res.on('finish', () => {
        const durationNs = Number(process.hrtime.bigint() - start);
        const durationSeconds = durationNs / 1e9;

        const route = req.route && req.route.path ? req.route.path : 'unknown_route';

        const attrs = sanitizeAttributes({
          'http.method': req.method,
          'http.status_code': res.statusCode,
          'http.route': route
        });

        requestCounter.add(1, attrs);
        requestDuration.record(durationSeconds, attrs);
      });

      next();
    };
  }

  module.exports = metricsMiddleware;
}