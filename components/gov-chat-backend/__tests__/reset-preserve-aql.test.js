'use strict';

// NO arangojs mock in this suite: the unit suite for resetUserData asserts
// the query through the inlining aql test-mock, which proves the mock's
// world, not the shipped one (the repo's erasure-tombstone-aql.test.js
// precedent). This suite renders the SAME QUERY STRUCTURE with the REAL
// aql tag and asserts the bind semantics of that structure (the preserve
// list travels as a bind parameter, never inlined into the query text).
// Known limit, identical to the tombstone suite's: the template is a copy —
// a production refactor of the query shape cannot redden this file; the
// unit suite gates the bound values. Full KEEP/MERGE/REPLACE database
// semantics are covered only by the manual E2E phases (docs/e2e-tests/).
const { aql } = require('arangojs');

const PRESERVE_FIELDS = [
  'email',
  'firstName',
  'lastName',
  'username',
  'name',
  'roles',
  'enabled',
  'disabled',
  'active',
  'deleted',
  'iss',
  'iss_sub',
  'sub',
  'createdAt',
  'emailVerified',
  'pendingEmailChange',
  'deletedAt',
  'erasedAt',
  'erased_key',
  // Client preference fields (#1454) — part of the production preserve set.
  'theme',
  'fontSize',
  'language',
  'emailUpdates',
  'soundNotifications'
];

describe('reset preserve AQL (real arangojs bind semantics)', () => {
  it('renders the atomic REPLACE with the preserve set as a bind parameter', () => {
    const q = aql`
      FOR u IN users
        FILTER u._key == ${'user-1'}
        REPLACE u WITH MERGE(KEEP(u, ${PRESERVE_FIELDS}), { updatedAt: DATE_ISO8601(DATE_NOW()) }) IN users
        RETURN LENGTH(ATTRIBUTES(KEEP(u, ${PRESERVE_FIELDS})))
    `;
    // The preserve list never appears inlined in the query text
    for (const field of PRESERVE_FIELDS) {
      expect(q.query).not.toContain(`"${field}"`);
    }
    // The atomic structure is present: read+compute+write in one statement
    expect(q.query).toContain('REPLACE u WITH MERGE(KEEP(u, @');
    expect(q.query).toContain('FILTER u._key == @');
    // Both KEEP occurrences reference ONE shared array bind (the aql tag
    // dedupes identical values — the two placeholders name the same variable)
    const arrayBinds = Object.values(q.bindVars).filter((v) => Array.isArray(v));
    expect(arrayBinds).toHaveLength(1);
    expect(arrayBinds[0]).toEqual(PRESERVE_FIELDS);
    expect(q.query.split('KEEP(u, @').length - 1).toBe(2);
  });
});
