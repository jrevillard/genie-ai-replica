// Structured log assertion helpers for Winston JSON log output.
//
// Usage:
//   const { expectLogContains } = require('./log-assertions');
//   expectLogContains(logEntry, { trace_id: '4bf92f3577b34da6a3ce929d0e0e4736', level: 'info' });

const LOG_SCHEMA_FIELDS = ['timestamp', 'level', 'service', 'trace_id', 'span_id', 'message'];

/**
 * Assert that a structured log entry contains expected fields.
 *
 * @param {object} logEntry - Parsed JSON log entry
 * @param {object} expected - Key-value pairs to match (supports regex via RegExp values)
 * @param {string} [expected.trace_id] - 32-char hex trace ID
 * @param {string} [expected.span_id] - 16-char hex span ID
 * @param {string} [expected.level] - Log level (info, warn, error, debug)
 * @param {string} [expected.message] - Log message (substring match)
 */
function expectLogContains(logEntry, expected) {
  if (!logEntry || typeof logEntry !== 'object') {
    throw new Error('logEntry must be a non-null object');
  }

  for (const [key, value] of Object.entries(expected)) {
    if (!(key in logEntry)) {
      throw new Error(`Missing field "${key}" in log entry. Available: ${Object.keys(logEntry).join(', ')}`);
    }

    if (value instanceof RegExp) {
      if (!value.test(logEntry[key])) {
        throw new Error(`Field "${key}" value "${logEntry[key]}" does not match pattern ${value}`);
      }
    } else if (typeof value === 'string') {
      if (!String(logEntry[key]).includes(value)) {
        throw new Error(`Field "${key}" value "${logEntry[key]}" does not contain "${value}"`);
      }
    } else {
      if (logEntry[key] !== value) {
        throw new Error(`Field "${key}" expected ${JSON.stringify(value)}, got ${JSON.stringify(logEntry[key])}`);
      }
    }
  }
}

/**
 * Assert that a structured log entry conforms to the consistent log schema.
 * Required fields: timestamp, level, trace_id, span_id, message
 *
 * @param {object} logEntry - Parsed JSON log entry
 */
function expectLogSchema(logEntry) {
  if (!logEntry || typeof logEntry !== 'object') {
    throw new Error('logEntry must be a non-null object');
  }

  for (const field of LOG_SCHEMA_FIELDS) {
    if (!(field in logEntry)) {
      throw new Error(`Missing required schema field "${field}" in log entry`);
    }
  }

  if (!/^[0-9a-f]{32}$/.test(logEntry.trace_id)) {
    throw new Error(`trace_id must be a 32-char hex string, got "${logEntry.trace_id}"`);
  }

  if (!/^[0-9a-f]{16}$/.test(logEntry.span_id)) {
    throw new Error(`span_id must be a 16-char hex string, got "${logEntry.span_id}"`);
  }

  const validLevels = ['debug', 'info', 'warn', 'error'];
  if (!validLevels.includes(logEntry.level)) {
    throw new Error(`level must be one of ${validLevels.join(', ')}, got "${logEntry.level}"`);
  }
}

/**
 * Assert that trace_id is a valid non-zeroed OTel trace ID.
 *
 * @param {string} traceId - The trace_id field value
 */
function expectNonZeroedTraceId(traceId) {
  if (!/^[0-9a-f]{32}$/.test(traceId)) {
    throw new Error(`trace_id must be a 32-char hex string, got "${traceId}"`);
  }
  if (traceId === '0'.repeat(32)) {
    throw new Error('trace_id must not be zeroed (no active span)');
  }
}

module.exports = {
  expectLogContains,
  expectLogSchema,
  expectNonZeroedTraceId,
  LOG_SCHEMA_FIELDS,
};
