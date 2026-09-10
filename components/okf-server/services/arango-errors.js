// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Shared ArangoDB error classifiers (Story 2.9.2 review fix — was duplicated
// verbatim in concept-meta-service and pii-service). STRICT matching by
// errorNum/code only: message-regex matching (/no match|not found/i) classified
// transient infrastructure failures (collection-not-found, gateway
// route-not-found) as document-absent, masking outages as creates.

/** arangojs "document not found" (errorNum 1204) or an HTTP 404 — treat as absent. */
function isArangoNotFound(err) {
  return !!(err && (err.errorNum === 1204 || err.code === 404 || err.statusCode === 404));
}

/** Unique-constraint violation (errorNum 1210/1185 or HTTP 409) — the unique-index race guard. */
function isArangoUniqueViolation(err) {
  return !!(err && (err.errorNum === 1210 || err.errorNum === 1185 || err.code === 409));
}

module.exports = { isArangoNotFound, isArangoUniqueViolation };
