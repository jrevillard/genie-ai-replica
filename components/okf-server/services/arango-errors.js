// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Shared ArangoDB error classifiers (Story 2.9.2 review fix — was duplicated
// verbatim in concept-meta-service and pii-service). STRICT matching by
// errorNum/code only: message-regex matching (/no match|not found/i) classified
// transient infrastructure failures (collection-not-found, gateway
// route-not-found) as document-absent, masking outages as creates.

/**
 * arangojs "not found" — the row simply is not there. This is a NORMAL
 * application outcome, not a fault.
 *
 * MEASURED against the live driver (arangojs 10.1.2, ArangoDB):
 *
 *   collection.document('MISSING_KEY') -> errorNum 1202, code 404
 *   collection('nope').document('x')   -> errorNum 1203, code 404
 *
 * And encoded in the fixtures of concept-meta-service.test.js (which cannot be
 * reproduced locally — firstExample was REMOVED in arangojs 10, so its throw
 * cannot be provoked from this driver):
 *
 *   collection.firstExample(no match)  -> ArangoError 'no match', errorNum 1204
 *
 * So TWO codes mean "absent": 1202 (document not found) and 1204 (a query
 * matched nothing). Both are genuine, and 1204 must stay.
 *
 * WHY errorNum IS NOW AUTHORITATIVE, AND WHY THAT MATTERS (!1072):
 * 1202 (row absent), 1204 (no match) and 1203 (COLLECTION absent) all arrive
 * with `code === 404`, so keying on the HTTP status alone cannot tell them
 * apart — it classifies a missing COLLECTION as "document absent". That is
 * precisely the masking this file's header warns about, reintroduced through a
 * different key: 18 call sites do `if (!isArangoNotFound(err)) throw err` /
 * `if (isArangoNotFound(err)) return null`, so a collection-level fault would be
 * reported to every caller as "no row" — an outage silently rendered as an
 * empty result. 1203 is excluded below, and the status is used only as a
 * fallback for driver errors that carry no errorNum at all.
 */
const ABSENT_ERROR_NUMS = new Set([1202, 1204]);

function isArangoNotFound(err) {
  if (!err) return false;
  if (err.errorNum != null) return ABSENT_ERROR_NUMS.has(err.errorNum);
  // No errorNum (raw HTTP, or a driver-level error): fall back to the status.
  return err.code === 404 || err.statusCode === 404;
}

/** True when the COLLECTION (not the row) is missing — an infrastructure or
 * configuration fault that must NOT be reported to callers as "no row". */
function isArangoCollectionNotFound(err) {
  return !!(err && err.errorNum === 1203);
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

module.exports = {
  isArangoNotFound,
  isArangoCollectionNotFound,
  isArangoUniqueViolation,
  isArangoConflict
};
