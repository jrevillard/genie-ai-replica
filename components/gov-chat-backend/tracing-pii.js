// PII redaction utilities for OTel span processors
// Extracted from tracing.js for testability

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /authorization/i,
  /credential/i,
  /api[_-]?key/i,
];
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const BEARER_PATTERN = /Bearer\s+\S+/gi;

function redactValue(value) {
  if (typeof value !== "string") return value;
  let redacted = value;
  redacted = redacted.replace(EMAIL_PATTERN, "[REDACTED]");
  redacted = redacted.replace(BEARER_PATTERN, "[REDACTED]");
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
      redacted[key] = "[REDACTED]";
    } else if (typeof value === "string") {
      redacted[key] = redactValue(value);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

module.exports = {
  redactValue,
  isSensitiveKey,
  redactAttributes,
  SENSITIVE_KEY_PATTERNS,
};
