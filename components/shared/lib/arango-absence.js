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
 * It lives in its own module because every component that has to tell an
 * absence from a fault must use the SAME rules: ArangoDB 3.12 moved the
 * simple-query miss from 1204 to errorNum 404 with the message 'no match',
 * and every copy of this predicate had to be found and fixed in lockstep.
 * The canonical copy lives here; `dbService._isExpectedAbsence` (in
 * db-connection-service.js) is the same function.
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

module.exports = { isExpectedAbsence };
