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
 *
 * ARANGODB 3.12 (Quran Core import, 2026-11-02, live-reproduced on the local
 * build): the 3.12 server reimplemented the simple-query API, and a
 * firstExample miss now answers errorNum **404** with errorMessage 'no match'
 * — the 3.11 server answered errorNum 1204 for the SAME call (the shape the
 * fixtures above pin). errorNum 404 alone is NOT trusted — a missing
 * collection or a wrong route can carry it too — so the verdict needs BOTH
 * the echoed 404 AND the server's own 'no match' errorMessage. 1203 keeps its
 * own errorNum and stays excluded.
 */
// ABSENCE-CLASSIFIER TWINS (review 84589): this file (strict predicates,
// errorNum enumerated) is encoding 1 of 3. Encoding 2:
// shared/lib/db-connection-service.js _isExpectedAbsence — same contract,
// owns the LOG-SEVERITY decision. Encoding 3: repository-service.js
// ARANGO_NOT_FOUND / notFoundAsNull — the OLDER, LAXER control-flow twin
// (bare 404 and /not found/i count); kept deliberately for the registry CRUD
// paths, but its laxity is exactly what the strict rule refuses. An ArangoDB
// message change needs ALL THREE lockstep edits — unification tracked on
// #1350.
const ABSENT_ERROR_NUMS = new Set([1202, 1204]);
const ABSENT_404_MESSAGE = 'no match';

function isArangoNotFound(err) {
  if (!err) return false;
  if (err.errorNum != null) {
    if (ABSENT_ERROR_NUMS.has(err.errorNum)) return true;
    // The 3.12 simple-API miss: errorNum 404 + the server's own 'no match'.
    // Both halves required — a bare 404 errorNum (route/collection faults)
    // stays a real fault.
    if (
      err.errorNum === 404 &&
      String(err.message || '')
        .trim()
        .toLowerCase() === ABSENT_404_MESSAGE
    ) {
      return true;
    }
    return false;
  }
  // No errorNum (raw HTTP, or a driver-level error): fall back to the status.
  return err.code === 404 || err.statusCode === 404;
}

/** COLLECTION-level absence (errorNum 1203 — arangojs COLLECTION_NOT_FOUND,
 * also VIEW_NOT_FOUND): the named collection or view does not exist.
 * Deliberately NOT part of isArangoNotFound: for the document-absent call
 * sites a missing collection is a FAULT (the masking this file's header
 * warns about), so 1203 stays excluded there. This twin exists for the call
 * sites where collection absence is an EXPECTED state — the graph endpoint
 * rewrite over a fresh / never-ingested repo's not-yet-created edge
 * collections is the live case. Verified live (2026-11-03, the settle wedge):
 * a query naming a missing collection raises ArangoError errorNum 1203,
 * message 'collection or view not found'. THE CALL SITE decides whether
 * collection absence is expected (continue) or a fault (throw) — this
 * predicate only classifies. */
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

/** Connection-class failure: the request (very likely) never reached the
 * server, the response never came back, or the server answered with a
 * transient gateway status — the operation's effect is UNKNOWN, and for
 * idempotent statements safe to retry. IN-COMPONENT union of the two
 * existing classifiers (db-connection-service._isConnectionError socket
 * codes + llm-transient-errors RETRIABLE_CODES and its 429/502/503/504
 * status set) plus the axios abort names — the cross-component
 * consolidation into shared/lib is tracked separately (#1550). */
const CONNECTION_CODES = [
  'ECONNRESET',
  'ENOTFOUND',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ECONNABORTED',
  'EPIPE',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  'ERR_STREAM_PREMATURE_CLOSE',
  'socket hang up',
  'fetch failed'
];
const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);
function isConnectionError(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  const message = String(err.message || '').toLowerCase();
  const code = String(err.code || '').toLowerCase();
  if (CONNECTION_CODES.some((c) => message.includes(c.toLowerCase()) || code.includes(c.toLowerCase()))) return true;
  const status = err.response ? err.response.status : err.status != null ? err.status : err.statusCode;
  return TRANSIENT_STATUSES.has(status);
}

module.exports = {
  isArangoNotFound,
  isArangoCollectionNotFound,
  isArangoUniqueViolation,
  isArangoConflict,
  isConnectionError
};
