// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// metrics.js — Custom application metrics wrapper (shared by all Node services)
// Uses the MeterProvider already configured in tracing.js via NodeSDK.
// Import @opentelemetry/api (stable API), not the SDK.
// SERVICE_NAME is read from env so the meter is named per consumer (matches tracing.js).

const { metrics } = require('@opentelemetry/api');

const SERVICE_NAME = process.env.SERVICE_NAME || 'genie-backend';
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
