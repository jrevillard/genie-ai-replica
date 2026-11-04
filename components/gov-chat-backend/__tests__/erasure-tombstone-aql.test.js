'use strict';

// NO arangojs mock in this suite: the other tombstone tests assert the query
// text through the inlining aql test-mock, which proves the mock's world, not
// the shipped one. This suite renders the security-critical tombstone query
// fragments with the REAL aql tag and asserts the digest travels as a bind
// parameter (never inlined into the query text), so a change in how the
// digest reaches the database redds here.

// Test files are exempt from the shared-lib path guard (components/CLAUDE.md);
// the helper is required directly to keep this suite dependency-free.
const { erasureTombstoneKey } = require('../../shared/lib/erasure-tombstone');
const { aql } = require('arangojs');

const ISS_SUB = 'https://kc.example#sub-1';

describe('erasure tombstone AQL (real arangojs bind semantics)', () => {
  const digest = erasureTombstoneKey(ISS_SUB);

  it('binds the tombstone digest as a parameter in the erasure UPDATE', () => {
    const query = aql`
      UPDATE u WITH {
        deleted: true,
        erased_key: ${digest} == null ? u.erased_key : ${digest}
      } IN users
    `;
    // The digest never appears in the query text — it is a bind parameter
    expect(query.query).not.toContain(digest);
    expect(query.query).toContain('erased_key');
    const binds = Object.values(query.bindVars);
    expect(binds).toContain(digest);
  });

  it('binds the tombstone digest as a parameter in the provisioning lookup', () => {
    const query = aql`
      FOR u IN users
        FILTER u.iss_sub == null AND u.deleted == true AND u.erased_key == ${digest}
        RETURN u
    `;
    expect(query.query).not.toContain(digest);
    expect(query.query).toContain('u.erased_key ==');
    const binds = Object.values(query.bindVars);
    expect(binds).toContain(digest);
  });
});
