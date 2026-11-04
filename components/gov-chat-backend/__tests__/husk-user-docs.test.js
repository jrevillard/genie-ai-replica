/**
 * Tests for the husk-user-document signature (scripts/report-husk-user-docs.js,
 * issue #1430). The AQL matcher is generated from the same constants the JS
 * predicate reads, so these tests pin the predicate semantics (the signature's
 * meaning) and guard the AQL template against corruption (each FILTER clause,
 * the deleted carve-out, the allowed-field subset, a final RETURN). The AQL's
 * runtime semantics against a real ArangoDB cannot run in CI — it is
 * re-validated against a throwaway ArangoDB with a synthetic corpus whenever
 * the matcher template changes (see MR !752 for the latest validation).
 */

const {
  isHuskDoc,
  findDivergences,
  HUSK_IDENTITY_FIELDS,
  HUSK_ALLOWED_FIELDS,
  HUSK_MATCHER_AQL,
  HUSK_REMOVAL_AQL
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
  // Pin the AQL template to the constants it is generated from: each absence
  // test, the soft-delete carve-out, the allowed-field subset check and a
  // final RETURN. The matcher itself is built from HUSK_IDENTITY_FIELDS and
  // HUSK_ALLOWED_FIELDS, so these pins guard template corruption only.
  it('tests all identity fields for absence', () => {
    for (const field of HUSK_IDENTITY_FIELDS) {
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

describe('HUSK_REMOVAL_AQL', () => {
  // The destructive query must re-assert the full signature — a template edit
  // that drops the interpolation would degrade --delete to destroy-by-_key.
  it('selects by the passed key list', () => {
    expect(HUSK_REMOVAL_AQL).toContain('FILTER u._key IN @keys');
  });

  it('re-asserts the husk signature before removing', () => {
    // The signature fragment is interpolated at export time; the identity
    // FILTER lines below are its visible expansion in the built query.
    for (const field of HUSK_IDENTITY_FIELDS) {
      expect(HUSK_REMOVAL_AQL).toContain(`FILTER u.${field} == null`);
    }
  });

  it('targets the collection and removes the matched documents', () => {
    expect(HUSK_REMOVAL_AQL).toContain('FOR u IN @@collection');
    expect(HUSK_REMOVAL_AQL.trimEnd().endsWith('REMOVE u IN @@collection')).toBe(true);
  });
});
