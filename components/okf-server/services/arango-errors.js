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
// ABSENCE CLASSIFIER (DW-433 / #1163): the errorNum semantics — measured
// above — have ONE owner, shared/lib/arango-absence.js (deep import below:
// this component never loads the shared barrel). This file keeps only its
// no-errorNum arm, the STATUS fallback, where it deliberately diverges from
// the canonical (there, a bare 404 without the server's 'no match' message
// stays a fault). repository-service.js ARANGO_NOT_FOUND / notFoundAsNull
// remains the OLDER, LAXER control-flow twin (bare 404 and /not found/i
// count), kept deliberately for the registry CRUD paths.
const { isRetriableUpstreamError, RETRIABLE_STATUS } = require('./llm-transient-errors');
const { isExpectedAbsence, hasNotFoundStatus } = require('../shared-lib/arango-absence');

function isArangoNotFound(err) {
  if (!err) return false;
  if (err.errorNum != null) return isExpectedAbsence(err);
  // No errorNum (raw HTTP, or a driver-level error): fall back to the status.
  return hasNotFoundStatus(err);
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
 * idempotent statements safe to retry. DELEGATES the shared transient
 * classes (socket codes, 429/502/503/504 response statuses, the abort
 * message regexes) to the in-component home llm-transient-errors.js — one
 * home per transient class — and adds only the DB-side extras. THIS file's
 * own additions match strictly on err.code / numeric status (a message that
 * merely contains a code word is not evidence of a transport failure); the
 * ONE message-regex exception is the shared classifier's own, learned from
 * the live stream-abort incident and owned by llm-transient-errors.js. The
 * cross-component consolidation into shared/lib is a separate step. */
const EXTRA_CONNECTION_CODES = new Set(['ENOTFOUND', 'EHOSTUNREACH', 'EAI_AGAIN']);
function isConnectionError(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  if (isRetriableUpstreamError(err)) return true;
  if (err.code && EXTRA_CONNECTION_CODES.has(String(err.code).toUpperCase())) return true;
  // The status travels in different fields depending on the layer: axios
  // puts it on err.response.status, the arangojs driver on err.code
  // (ArangoError{errorNum, code:503}) or err.response.statusCode
  // (HttpError{code:502, response:{statusCode:502}}). Scan every candidate —
  // a present-but-statusless response must not short-circuit the chain.
  const candidates = [err.response?.status, err.response?.statusCode, err.status, err.statusCode, err.code];
  return candidates.some((s) => typeof s === 'number' && RETRIABLE_STATUS.has(s));
}

module.exports = {
  isArangoNotFound,
  isArangoCollectionNotFound,
  isArangoUniqueViolation,
  isArangoConflict,
  isConnectionError
};
