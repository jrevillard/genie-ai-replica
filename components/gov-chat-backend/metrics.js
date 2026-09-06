// metrics.js — Custom application metrics wrapper
// Uses the MeterProvider already configured in tracing.js via NodeSDK.
// Import @opentelemetry/api (stable API), not the SDK.

const { metrics } = require('@opentelemetry/api');

const SERVICE_NAME = 'genie-backend';
const SERVICE_VERSION = process.env.npm_package_version || '1.0.0';

/**
 * Bounded reason enum for `log_record_dropped_total{reason=...}`.
 *
 * Cardinality is fixed at three values — the cardinality-bounded set guards
 * Prometheus against label explosion from arbitrary caller-supplied strings.
 * Per Epic 2 review, raw string literals at the call site MUST be rejected in
 * review: every `.add()` call passes one of the values below, never a free-form
 * label. The corresponding `LOG_RECORD_DROPPED_TOTAL` counter is named after
 * the Prometheus metric itself; paired via metric + reason attribute.
 *
 * AD-18 forbids a shared `recordLogDropped(reason)` helper that crosses the
 * `shared/lib → backend` require boundary, so this enum is the canonical
 * source of truth and each call-site module-loads its own mirror.
 */
const LOG_DROPPED_REASON = Object.freeze({
  QUEUE_FULL: 'queue_full',
  OTLP_UNREACHABLE: 'otlp_unreachable',
  OBSERVABILITY_DISABLED: 'observability_disabled'
});

/**
 * Canonical Prometheus counter name for OTel log records that were produced
 * but dropped before export (rejected by the BatchLogRecordProcessor queue,
 * failed to reach the collector, or skipped because observability is off).
 */
const LOG_RECORD_DROPPED_TOTAL = 'log_record_dropped_total';

/**
 * Returns a meter instance for creating custom instruments.
 * The MeterProvider is configured by NodeSDK in tracing.js.
 * @returns {import('@opentelemetry/api').Meter}
 */
function getMeter() {
  return metrics.getMeter(SERVICE_NAME, SERVICE_VERSION);
}

module.exports = {
  getMeter,
  LOG_DROPPED_REASON,
  LOG_RECORD_DROPPED_TOTAL
};
