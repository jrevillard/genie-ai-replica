// PII redaction utilities for OTel span processors
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
  // Recurse into nested object values so callers cannot smuggle
  // sensitive data through a non-matching top-level key. Pre-recursion,
  // `logger.info('msg', { headers: req.headers })` wrote the raw
  // `req.headers` object (including the `authorization` Bearer token)
  // verbatim into the OTel attributes because the top-level key
  // `headers` did not match the SENSITIVE_KEY_PATTERNS. The body walker
  // (`redactLogRecordBody`) already recurses; attributes now mirror it.
  //
  // Non-plain objects (Date, Buffer, Map, Set, Error, class instances)
  // pass through untouched — redacting their internals is lossy and
  // unsafe. Same contract as `redactLogRecordBody`.
  const redacted = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (isSensitiveKey(key)) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'string') {
      redacted[key] = redactValue(value);
    } else if (Array.isArray(value)) {
      redacted[key] = value.map((item) =>
        typeof item === 'object' && item !== null ? redactLogRecordBody(item) : item
      );
    } else if (value !== null && typeof value === 'object') {
      const proto = Object.getPrototypeOf(value);
      if (proto === null || proto === Object.prototype) {
        redacted[key] = redactLogRecordBody(value);
      } else {
        redacted[key] = value;
      }
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

// PII scrubbing for the OTel LogRecord body field.
// PII scrubbing applies to BOTH OTel span
// attributes (covered by `redactAttributes`) AND the log record body field,
// which may be a nested object holding the actual user input
// (`body.user.email`, `body.request.headers.authorization`, etc.).
// `redactAttributes` is shallow — it only walks the top-level keys. The body
// field is frequently a deeply-nested payload, so we need a separate walker
// that recurses into plain objects and arrays while preserving primitives,
// null, undefined, and special objects (Date, Buffer, Error, Map, Set, etc.)
// verbatim. This intentionally avoids any cloning of non-plain values.
function redactLogRecordBody(body, seen) {
  if (body === null || body === undefined) return body;
  if (typeof body !== 'object') {
    return redactValue(body);
  }
  // Circular-reference guard. Express middleware that logs `req` (or any
  // self-referential payload) would otherwise infinite-recurse into the
  // walker and crash with RangeError: Maximum call stack size exceeded.
  // WeakSet lets GC reclaim entries once the top-level walk finishes;
  // the marker `[CIRCULAR]` makes the cycle visible in VictoriaLogs so
  // operators can spot the offending caller.
  if (!seen) seen = new WeakSet();
  if (seen.has(body)) return '[CIRCULAR]';
  seen.add(body);
  // Non-plain objects (Date, Buffer, Error, Map, Set, RegExp, etc.) and class
  // instances are passed through untouched — redacting their internals would
  // be both unsafe and lossy. Callers serialize them before logging in
  // practice; the walker only owns plain data shapes.
  if (Array.isArray(body)) {
    return body.map((item) => redactLogRecordBody(item, seen));
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
      redacted[key] = redactLogRecordBody(value, seen);
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
