// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// The ArangoDB absence/fault classifier twins — the verdict table each call
// site's guard depends on. Verified against the live driver (arangojs 10.1.2,
// ArangoDB 3.12): 1202 document-absent, 1204 no-match, 404+'no match' (the
// 3.12 simple-API miss), 1203 COLLECTION-absent. The third twin's shape is
// pinned by the settle wedge it caused (2026-11-03): a query naming a missing
// collection raised errorNum 1203 / 'collection or view not found', which the
// document-level classifier must keep EXCLUDING.

const { isArangoNotFound, isArangoCollectionNotFound, isConnectionError } = require('../services/arango-errors');

describe('arango-error classifiers (strict, errorNum-authoritative)', () => {
  test('isArangoNotFound: 1202 and 1204 are absence', () => {
    expect(isArangoNotFound({ errorNum: 1202 })).toBe(true);
    expect(isArangoNotFound({ errorNum: 1204 })).toBe(true);
  });

  test('isArangoNotFound: the 3.12 simple-API miss is 404 ONLY with the server no-match message', () => {
    expect(isArangoNotFound({ errorNum: 404, message: 'no match' })).toBe(true);
    expect(isArangoNotFound({ errorNum: 404, message: 'collection or view not found: name: x' })).toBe(false);
    expect(isArangoNotFound({ errorNum: 404, message: 'unknown error' })).toBe(false);
  });

  test('isArangoNotFound: 1203 (collection absence) is a FAULT, never document-absence', () => {
    // The masking this file exists to prevent: a missing COLLECTION answering
    // "no row" to every document-absent call site.
    expect(isArangoNotFound({ errorNum: 1203, message: 'collection or view not found' })).toBe(false);
  });

  test('isArangoCollectionNotFound: exactly 1203 — the call site decides expected-vs-fault', () => {
    expect(isArangoCollectionNotFound({ errorNum: 1203 })).toBe(true);
    // The live shape, verbatim from the settle wedge (2026-11-03).
    expect(
      isArangoCollectionNotFound(
        Object.assign(new Error('collection or view not found: name: OKF_x_v1_HAS_SOURCE'), { errorNum: 1203 })
      )
    ).toBe(true);
    expect(isArangoCollectionNotFound({ errorNum: 1202 })).toBe(false);
    expect(isArangoCollectionNotFound({ errorNum: 404, message: 'no match' })).toBe(false);
    expect(isArangoCollectionNotFound({ code: 404 })).toBe(false); // no bare-status fallback
    expect(isArangoCollectionNotFound(null)).toBe(false);
    expect(isArangoCollectionNotFound(undefined)).toBe(false);
  });

  // Issue #1391 round-3 review: the union of db-connection-service's socket
  // codes and llm-transient-errors' RETRIABLE_CODES — one home so a new
  // connection-code lesson lands once.
  test('isConnectionError: socket codes, axios aborts and stream disconnects', () => {
    expect(isConnectionError(Object.assign(new Error('connect ECONNREFUSED x'), { code: 'ECONNREFUSED' }))).toBe(true);
    expect(isConnectionError(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))).toBe(true);
    // axios abort (our own timeout) — in llm-transient-errors, not in the
    // socket-code list.
    expect(isConnectionError(Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' }))).toBe(
      true
    );
    expect(
      isConnectionError(Object.assign(new Error('stream has been aborted'), { code: 'ERR_STREAM_PREMATURE_CLOSE' }))
    ).toBe(true);
    expect(isConnectionError(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }))).toBe(
      true
    );
    expect(isConnectionError(new Error('socket hang up'))).toBe(true);
    expect(isConnectionError(new Error('fetch failed'))).toBe(true);
    // Transient gateway statuses (the llm-transient-errors status set) — the
    // shape an arangojs error carries through a proxy under load.
    expect(isConnectionError(Object.assign(new Error('Service Unavailable'), { response: { status: 503 } }))).toBe(
      true
    );
    expect(isConnectionError(Object.assign(new Error('Bad Gateway'), { response: { status: 502 } }))).toBe(true);
    expect(isConnectionError(Object.assign(new Error('Too Many Requests'), { statusCode: 429 }))).toBe(true);
    // A present-but-statusless response must not short-circuit the chain
    // (round-5 review): the outer layers' status fields are still consulted.
    expect(isConnectionError(Object.assign(new Error('x'), { response: {}, statusCode: 503 }))).toBe(true);
    // The ARANGOJS DRIVER shapes (final review — db.query never produces an
    // axios-shaped error): ArangoError{errorNum, code:503, response:<body>}
    // and HttpError{code:502, response:{statusCode:502}} carry the status on
    // err.code / err.response.statusCode, not on err.status.
    expect(isConnectionError(Object.assign(new Error('service unavailable'), { errorNum: 1495, code: 503 }))).toBe(
      true
    );
    expect(
      isConnectionError(Object.assign(new Error('bad gateway'), { code: 502, response: { statusCode: 502 } }))
    ).toBe(true);
    // A permanent 4xx/5xx status is NOT connection-class.
    expect(isConnectionError(Object.assign(new Error('Forbidden'), { response: { status: 403 } }))).toBe(false);
    expect(isConnectionError(Object.assign(new Error('Server Error'), { response: { status: 500 } }))).toBe(false);
    // Deterministic faults are NOT connection-class.
    expect(isConnectionError(Object.assign(new Error('auth failed'), { errorNum: 11 }))).toBe(false);
    expect(isConnectionError(new Error('AQL: parse error near FILTER'))).toBe(false);
    expect(isConnectionError(null)).toBe(false);
  });
});
