// metrics.js — Custom application metrics wrapper
// Uses the MeterProvider already configured in tracing.js via NodeSDK.
// Import @opentelemetry/api (stable API), not the SDK.

const { metrics } = require('@opentelemetry/api');

const SERVICE_NAME = 'genie-okf-server';
const SERVICE_VERSION = process.env.npm_package_version || '1.0.0';

/**
 * Returns a meter instance for creating custom instruments.
 * The MeterProvider is configured by NodeSDK in tracing.js.
 * @returns {import('@opentelemetry/api').Meter}
 */
function getMeter() {
  return metrics.getMeter(SERVICE_NAME, SERVICE_VERSION);
}

module.exports = { getMeter };
