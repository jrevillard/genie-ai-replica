/**
 * Shared test fixture: the canonical ArangoDB absence classifier, mirrored
 * from shared/lib db-connection-service `_isExpectedAbsence` (review wave 8,
 * !597 — the replica previously lived verbatim in TWO mocks, which drifts the
 * moment the real classifier gains a case). Both the shared-lib mock and the
 * fileService.test inline mock require THIS definition, so the not-found
 * boundary stays single-sourced in tests.
 *
 * A bare `jest.fn()` is deliberately NOT used: returning undefined would
 * silently shift the boundary the wave-6 fix made canonical.
 *
 * @param {object} error - the thrown error (arangojs/ArangoError shape)
 * @returns {boolean} true when the error is an EXPECTED absence
 */
const isExpectedAbsence = (error) => {
  if (!error) return false;
  if (error.errorNum === 1202 || error.errorNum === 1204) return true;
  if (error.errorNum != null) return false; // 1203 and friends are real faults
  return (
    String(error.message || '')
      .trim()
      .toLowerCase() === 'no match'
  );
};

module.exports = { isExpectedAbsence };
