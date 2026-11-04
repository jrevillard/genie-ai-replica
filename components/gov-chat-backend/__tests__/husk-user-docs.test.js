/**
 * Tests for the husk-user-document signature (scripts/report-husk-user-docs.js,
 * issue #1430). The JS predicate and the AQL matcher must agree — the script
 * aborts on divergence, and these tests pin both sides of that contract.
 */

const {
  isHuskDoc,
  findDivergences,
  HUSK_ALLOWED_FIELDS,
  HUSK_MATCHER_AQL
} = require('../scripts/report-husk-user-docs');

// The exact shape the old resetUserData (pre-#1428) left behind.
const huskDoc = {
  _key: '12345',
  _id: 'users/12345',
  _rev: '_abc',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-02T00:00:00.000Z'
};

describe('isHuskDoc', () => {
  it('matches a pure husk ({_key, createdAt, updatedAt} only)', () => {
    expect(isHuskDoc(huskDoc)).toBe(true);
  });

  it('matches a husk with deleted: false', () => {
    expect(isHuskDoc({ ...huskDoc, deleted: false })).toBe(true);
  });

  it('rejects a document with iss_sub', () => {
    expect(isHuskDoc({ ...huskDoc, iss_sub: 'kc:123' })).toBe(false);
  });

  it('rejects a document with sub', () => {
    expect(isHuskDoc({ ...huskDoc, sub: '123' })).toBe(false);
  });

  it('rejects a document with email (legacy pre-Keycloak account)', () => {
    expect(isHuskDoc({ ...huskDoc, email: 'legacy@example.gov' })).toBe(false);
  });

  it('rejects a soft-deleted document (deleted: true)', () => {
    expect(isHuskDoc({ ...huskDoc, deleted: true })).toBe(false);
  });

  // Mirrors the AQL exactly (u.deleted == null || u.deleted == false): any
  // non-boolean or truthy value disqualifies the document on both sides.
  it('rejects non-boolean deleted values (0, "false") on both sides of the contract', () => {
    expect(isHuskDoc({ ...huskDoc, deleted: 0 })).toBe(false);
    expect(isHuskDoc({ ...huskDoc, deleted: 'false' })).toBe(false);
  });

  it('rejects a husk carrying an extra application field', () => {
    expect(isHuskDoc({ ...huskDoc, customSettings: { theme: 'dark' } })).toBe(false);
    expect(isHuskDoc({ ...huskDoc, name: 'Someone' })).toBe(false);
  });

  it('rejects a healthy provisioned document', () => {
    expect(
      isHuskDoc({
        ...huskDoc,
        iss: 'kc',
        iss_sub: 'kc:123',
        sub: '123',
        email: 'a@b.c',
        name: 'A',
        roles: ['User'],
        deleted: false
      })
    ).toBe(false);
  });

  it('allows every listed field on a husk', () => {
    const doc = { ...huskDoc };
    for (const field of HUSK_ALLOWED_FIELDS) {
      doc[field] = field === 'deleted' ? false : '2025-01-01T00:00:00.000Z';
    }
    expect(isHuskDoc(doc)).toBe(true);
  });
});

describe('HUSK_MATCHER_AQL', () => {
  // Pin the AQL to the same tests the predicate runs: each absence test, the
  // soft-delete carve-out, the allowed-field subset check and a final RETURN.
  it('tests all three identity fields for absence', () => {
    for (const field of ['iss_sub', 'sub', 'email']) {
      expect(HUSK_MATCHER_AQL).toContain(`FILTER u.${field} == null`);
    }
  });

  it('keeps soft-deleted documents out of the signature', () => {
    expect(HUSK_MATCHER_AQL).toContain('FILTER u.deleted == null || u.deleted == false');
  });

  it('restricts the remaining attributes to the allowed set', () => {
    const allowedAql = `['${HUSK_ALLOWED_FIELDS.join("', '")}']`;
    expect(HUSK_MATCHER_AQL).toContain('MINUS(ATTRIBUTES(u, true), ');
    expect(HUSK_MATCHER_AQL).toContain(allowedAql);
    expect(HUSK_MATCHER_AQL).toContain(')) == 0');
  });

  it('is a complete query (final RETURN)', () => {
    expect(HUSK_MATCHER_AQL.trimEnd().endsWith('RETURN u')).toBe(true);
  });
});

describe('findDivergences', () => {
  // The abort guard the script runs before any destructive step: every AQL
  // hit must pass the JS predicate, or the run aborts without deleting.
  it('returns nothing when every AQL hit passes the predicate', () => {
    expect(findDivergences([huskDoc, { ...huskDoc, _key: '6789' }])).toEqual([]);
  });

  it('flags AQL hits that fail the predicate', () => {
    const stray = { ...huskDoc, customSettings: { theme: 'dark' } };
    expect(findDivergences([huskDoc, stray])).toEqual([stray]);
  });
});
