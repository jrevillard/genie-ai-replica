'use strict';

/**
 * Classifies an ArangoDB error as an EXPECTED ABSENCE (the document, the
 * match or the row is simply not there) or as a REAL FAULT.
 *
 * The predicate is deliberately narrow: a loose /not found/i would swallow
 * real faults — a missing collection (1203) and a missing route both carry
 * an HTTP 404, and reporting them as "no such document" renders a broken
 * deployment as an empty result.
 *
 * MEASURED against arangojs 10.1.2 + ArangoDB:
 *   collection.document('MISSING')      -> errorNum 1202, code 404 -> absence
 *   collection('nope').document()       -> errorNum 1203, code 404 -> FAULT
 *   collection.firstExample(no match)   -> errorNum 1204           -> absence
 * All three arrive with code 404 — only the errorNum (and, for the 3.12 miss
 * below, the server's own message) separates absence from fault. 1203 (a
 * MISSING COLLECTION, an infrastructure/configuration fault) deliberately
 * stays OUT of the predicate so it keeps reaching the error log. The 1204
 * shape cannot be provoked from arangojs 10 (firstExample was removed) — it
 * is pinned in the fixtures of okf-server/__tests__/concept-meta-service.test.js.
 *
 * It lives in its own module because every component that has to tell an
 * absence from a fault must use the SAME rules: ArangoDB 3.12 moved the
 * simple-query miss from 1204 to errorNum 404 with the message 'no match',
 * and every copy of this predicate had to be found and fixed in lockstep.
 * The canonical copy lives here; db-connection-service.js imports it under
 * the local name `_isExpectedAbsence` (private — consumers take it from the
 * shared-lib barrel), and okf-server's isArangoNotFound delegates the
 * errorNum'd classification to it while keeping its own no-errorNum status
 * fallback.
 *
 * @param {Error|Object} error - The error thrown by the driver.
 * @returns {Boolean} True when the error means "the row is not there".
 */
function isExpectedAbsence(error) {
  if (!error) return false;
  if (error.errorNum === 1202 || error.errorNum === 1204) return true;
  // ArangoDB 3.12 reimplemented the simple-query API: a firstExample miss
  // answers errorNum 404 with errorMessage 'no match' (the 3.11 server
  // answered 1204 — live-reproduced on the local build, Quran Core import
  // 2026-11-02). 404 alone is NOT absence (a missing collection or route can
  // carry it) — the verdict needs the server's own 'no match' message too.
  if (
    error.errorNum === 404 &&
    String(error.message || '')
      .trim()
      .toLowerCase() === 'no match'
  ) {
    return true;
  }
  if (error.errorNum != null) return false; // 1203 and friends are real faults
  return (
    String(error.message || '')
      .trim()
      .toLowerCase() === 'no match'
  );
}

/**
 * The arangojs HTTP-404 shapes on an error that carries NO errorNum at all:
 * the status rides on .statusCode (HTTP-layer errors) or .code (driver-thrown
 * errors). The one literal every consumer composite shares — okf-server's
 * isArangoNotFound answers a no-errorNum error with it, document-repository's
 * isDocumentNotFound ORs it under the canonical — so a future driver-shape
 * change is a single edit here. Whether that shape counts as absence is the
 * CALL SITE's decision (that is the deliberate divergence between the two
 * consumers), never this predicate's.
 *
 * @param {Error|Object} error - the thrown error (arangojs/ArangoError shape)
 * @returns {Boolean} True when the error carries a bare HTTP 404 status.
 */
function hasNotFoundStatus(error) {
  return !!error && (error.statusCode === 404 || error.code === 404);
}

module.exports = { isExpectedAbsence, hasNotFoundStatus };
