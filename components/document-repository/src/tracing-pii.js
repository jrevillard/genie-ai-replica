// PII redaction utilities for OTel span processors
// PARALLEL COPY of components/gov-chat-backend/tracing-pii.js.
//
// AD-18 forbids require()-ing into gov-chat-backend. This file must be kept in
// lockstep with the backend copy — drift risk is the price of avoiding the
// cross-component require. When backend's tracing-pii.js changes, mirror the
// diff here.
//
// Extracted from tracing.js for testability

const SENSITIVE_KEY_PATTERNS = [/password/i, /token/i, /secret/i, /authorization/i, /credential/i, /api[_-]?key/i];
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const BEARER_PATTERN = /Bearer\s+\S+/gi;

function redactValue(value) {
  if (typeof value !== 'string') return value;
  let redacted = value;
  redacted = redacted.replace(EMAIL_PATTERN, '[REDACTED]');
  redacted = redacted.replace(BEARER_PATTERN, '[REDACTED]');
  return redacted;
}

function isSensitiveKey(key) {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function redactAttributes(attributes) {
  if (!attributes) return attributes;
  const redacted = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (isSensitiveKey(key)) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'string') {
      redacted[key] = redactValue(value);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

// PII scrubbing for the OTel LogRecord body field.
// Required by Story 2-9 + AD-4: PII scrubbing applies to BOTH OTel span
// attributes (covered by `redactAttributes`) AND the log record body field,
// which may be a nested object holding the actual user input
// (`body.user.email`, `body.request.headers.authorization`, etc.).
// `redactAttributes` is shallow — it only walks the top-level keys. The body
// field is frequently a deeply-nested payload, so we need a separate walker
// that recurses into plain objects and arrays while preserving primitives,
// null, undefined, and special objects (Date, Buffer, Error, Map, Set, etc.)
// verbatim. This intentionally avoids any cloning of non-plain values.
function redactLogRecordBody(body) {
  if (body === null || body === undefined) return body;
  if (typeof body !== 'object') {
    return redactValue(body);
  }
  // Non-plain objects (Date, Buffer, Error, Map, Set, RegExp, etc.) and class
  // instances are passed through untouched — redacting their internals would
  // be both unsafe and lossy. Callers serialize them before logging in
  // practice; the walker only owns plain data shapes.
  if (Array.isArray(body)) {
    return body.map((item) => redactLogRecordBody(item));
  }
  const proto = Object.getPrototypeOf(body);
  if (proto !== null && proto !== Object.prototype) {
    return body;
  }
  const redacted = {};
  for (const [key, value] of Object.entries(body)) {
    if (isSensitiveKey(key)) {
      redacted[key] = '[REDACTED]';
    } else {
      redacted[key] = redactLogRecordBody(value);
    }
  }
  return redacted;
}

module.exports = {
  redactValue,
  isSensitiveKey,
  redactAttributes,
  redactLogRecordBody,
  SENSITIVE_KEY_PATTERNS
};
