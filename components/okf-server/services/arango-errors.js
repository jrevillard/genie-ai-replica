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

/** Concurrent-modification conflict (errorNum 1200, HTTP 409) — the
 * optimistic-concurrency (`ignoreRevs: false`) precondition guard. ONLY to be
 * tested against driver errors from collection writes, never app-level 409s. */
function isArangoConflict(err) {
  return !!(err && (err.errorNum === 1200 || err.code === 409 || err.statusCode === 409));
}

module.exports = { isArangoNotFound, isArangoUniqueViolation, isArangoConflict };
