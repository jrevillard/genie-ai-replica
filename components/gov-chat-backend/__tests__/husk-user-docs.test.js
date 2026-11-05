/**
 * Tests for the husk-user-document signature (scripts/report-husk-user-docs.js,
 * issue #1430). The AQL matcher is generated from the same constants the JS
 * predicate reads, so these tests pin the predicate semantics (the signature's
 * meaning) and guard the AQL template against corruption (each FILTER clause,
 * the deleted carve-out, the allowed-field subset, a final RETURN). The
 * template pins cannot see the AQL's RUNTIME semantics — a template edit that
 * keeps its substrings, or a constant edit both sides share, passes them
 * green. Those are covered against a real ArangoDB by
 * __tests__/integration/husk-report.db.test.js (the test:backend-arango CI
 * job, issue #1501).
 */

const { JIT_PROTECTED_FIELDS } = require('../constants/jit-fields');
const {
  isHuskDoc,
  compareSignatureSets,
  HUSK_IDENTITY_FIELDS,
  HUSK_SYSTEM_FIELDS,
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

  // Only _key/_id/_rev are system fields — any other underscore-prefixed
  // key is an application field and disqualifies the document (matching the
  // AQL, which subtracts the exact allowlist from ATTRIBUTES(u)).
  it('rejects underscore-prefixed application fields that are not system fields', () => {
    expect(isHuskDoc({ ...huskDoc, _migration_state: 'pending' })).toBe(false);
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

  it('restricts the remaining attributes to the exact system+allowed allowlist', () => {
    // ATTRIBUTES(u) keeps the internal fields, and the MINUS subtracts the
    // exact allowlist — so an underscore-prefixed non-system field counts as
    // an extra, the same as in the JS predicate.
    const allowlistAql = `['${[...HUSK_SYSTEM_FIELDS, ...HUSK_ALLOWED_FIELDS].join("', '")}']`;
    expect(HUSK_MATCHER_AQL).toContain('MINUS(ATTRIBUTES(u), ');
    expect(HUSK_MATCHER_AQL).toContain(allowlistAql);
    expect(HUSK_MATCHER_AQL).toContain(')) == 0');
  });

  it('is a complete query (final RETURN)', () => {
    expect(HUSK_MATCHER_AQL.trimEnd().endsWith('RETURN u')).toBe(true);
  });
});

describe('compareSignatureSets', () => {
  // The abort guard the script runs before any destructive step: the AQL
  // match set and the JS-computed set must agree in BOTH directions.
  const healthyDoc = { ...huskDoc, _key: 'healthy', iss_sub: 'kc:1', sub: '1', email: 'a@b.c' };

  it('finds no mismatch when both sides agree', () => {
    const docs = [huskDoc, healthyDoc];
    expect(compareSignatureSets([huskDoc], docs)).toEqual({ extra: [], missed: [] });
  });

  it('flags AQL hits the predicate rejects (AQL too permissive)', () => {
    const stray = { ...huskDoc, _key: 'stray', customSettings: { theme: 'dark' } };
    const result = compareSignatureSets([huskDoc, stray], [huskDoc, stray]);
    expect(result.extra).toEqual([stray]);
    expect(result.missed).toEqual([]);
  });

  it('flags documents the predicate accepts but the AQL missed (the silent direction)', () => {
    const result = compareSignatureSets([], [huskDoc]);
    expect(result.extra).toEqual([]);
    expect(result.missed).toEqual([huskDoc]);
  });
});

describe('HUSK_REMOVAL_AQL', () => {
  // The destructive query must re-assert the full signature — a template edit
  // that drops the interpolation would degrade --delete to destroy-by-_key.
  it('selects by the passed key list', () => {
    expect(HUSK_REMOVAL_AQL).toContain('FILTER u._key IN @keys');
  });

  it('re-asserts the husk signature before removing', () => {
    // The signature fragment is interpolated at export time; the lines below
    // are its visible expansion in the built query — the identity absences,
    // the soft-delete carve-out and the allowed-field subset, so a partial
    // template edit that drops any single clause reddens the suite.
    for (const field of HUSK_IDENTITY_FIELDS) {
      expect(HUSK_REMOVAL_AQL).toContain(`FILTER u.${field} == null`);
    }
    expect(HUSK_REMOVAL_AQL).toContain('FILTER u.deleted == null || u.deleted == false');
    expect(HUSK_REMOVAL_AQL).toContain('MINUS(ATTRIBUTES(u), ');
  });

  it('reads the keys first and removes by key (does not iterate the collection it modifies)', () => {
    expect(HUSK_REMOVAL_AQL).toContain('FOR u IN @@collection');
    expect(HUSK_REMOVAL_AQL).toContain('RETURN u._key');
    expect(HUSK_REMOVAL_AQL.trimEnd().endsWith('REMOVE { _key: k } IN @@collection')).toBe(true);
  });
});

describe('signature vocabulary vs the app field vocabulary', () => {
  // The script keeps its own field lists (it is a standalone ops tool and
  // describes the OLD reset's husk shape), but the identity fields it tests
  // for absence must stay a subset of the app's own protected-field list —
  // a new issuer adding an identity field there would otherwise silently
  // make the script's signature stale.
  it('tests only fields the app also treats as identity/protected fields', () => {
    for (const field of HUSK_IDENTITY_FIELDS) {
      expect(JIT_PROTECTED_FIELDS).toContain(field);
    }
  });

  it('allows exactly the old-reset-preserved fields from the app vocabulary', () => {
    // The husk keeps only what the OLD reset preserved (the timestamps and
    // the soft-delete marker). Any other app-protected field that becomes
    // husk-allowed would widen the signature silently.
    const shared = JIT_PROTECTED_FIELDS.filter((field) => HUSK_ALLOWED_FIELDS.includes(field));
    expect(shared.sort()).toEqual(['createdAt', 'deleted', 'updatedAt']);
  });

  it('allows EXACTLY the three preserved fields — not one more', () => {
    // The intersection check above only sees the fields the app lists as
    // PROTECTED; a field added to the allowlist from another vocabulary (a
    // client preference, a profile section, any new field) would widen the
    // selection on BOTH sides of the contract — the predicate and the AQL
    // move together, the divergence guard sees agreement, and the deletion
    // wave starts removing accounts that carry that field. No corpus can
    // pin a field it does not contain: the list itself is pinned here.
    expect([...HUSK_ALLOWED_FIELDS].sort()).toEqual(['createdAt', 'deleted', 'updatedAt']);
  });

  it('treats EXACTLY the three ArangoDB system fields as internal', () => {
    // Same reasoning for the internal-field list: a field added to it
    // (or a system field removed from it) moves both sides together, and
    // only the exact list pins it.
    expect([...HUSK_SYSTEM_FIELDS].sort()).toEqual(['_id', '_key', '_rev']);
  });
});

describe('the script stays out of the auto-executed migrations directory', () => {
  // scripts/migrations/run-migrations.js is executed by the db-migrations
  // init container on every deploy (docs/database-migrations.md). It picks
  // up the files matching /^\d{3}-.*\.js$/ and runs their exported up(db).
  // The husk report is an operator tool a human runs on purpose: promoted
  // into that directory under a matching name it would abort the migration
  // init (it exports no up(db)), and a renamed copy would run its removal
  // query on every deployment (issue #1501).
  it('is not under scripts/migrations/', () => {
    expect(require.resolve('../scripts/report-husk-user-docs')).not.toMatch(/scripts[\\/]migrations[\\/]/);
  });
});
