// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// The ArangoDB absence/fault classifier twins — the verdict table each call
// site's guard depends on. Verified against the live driver (arangojs 10.1.2,
// ArangoDB 3.12): 1202 document-absent, 1204 no-match, 404+'no match' (the
// 3.12 simple-API miss), 1203 COLLECTION-absent. The third twin's shape is
// pinned by the settle wedge it caused (2026-11-03): a query naming a missing
// collection raised errorNum 1203 / 'collection or view not found', which the
// document-level classifier must keep EXCLUDING.

const { isArangoNotFound, isArangoCollectionNotFound } = require('../services/arango-errors');

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
});
