// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// BUG-11 / !1077 — the type vocabulary was copied into five places and none of
// them knew the reserved root type existed. The product writes type 'index' on
// the bundle root (crawl-conversion-service) and may carry the authorial
// 'BundleRoot'; concept-meta-service identifies the index by IDENTITY (path
// 'index.md' or concept_id 'index') and deliberately does not let the authorial
// type block detection. But autocorrect raised INVALID_TYPE on the product's own
// reserved page, with no remedy offered — a dead end for the curator.
//
// The same drift produced two disagreeing STATUS vocabularies. These tests pin
// the shared vocabulary and assert every consumer reads it rather than
// restating it, so the next edit cannot silently fork a sixth copy.

const { CONTENT_TYPES, RESERVED_INDEX_TYPES, ALL_TYPES, STATUS_VALUES } = require('../services/okf-vocabulary');

const { planAutocorrectForConcept } = require('../services/concept-meta-service');

describe('okf-vocabulary', () => {
  test('content types are the five the inference services may choose', () => {
    expect(CONTENT_TYPES).toEqual(['topic', 'entity', 'process', 'event', 'source']);
  });

  test('the reserved root types are recognised but never offered for inference', () => {
    expect(RESERVED_INDEX_TYPES).toEqual(['index', 'BundleRoot']);
    expect(ALL_TYPES).toEqual([...CONTENT_TYPES, ...RESERVED_INDEX_TYPES]);
    for (const t of RESERVED_INDEX_TYPES) {
      expect(CONTENT_TYPES).not.toContain(t);
      expect(ALL_TYPES).toContain(t);
    }
  });

  test('an unknown type is in neither array', () => {
    expect(ALL_TYPES).not.toContain('nonsense');
    expect(RESERVED_INDEX_TYPES).not.toContain('nonsense');
  });

  describe('autocorrect on the reserved index (the !1077 case)', () => {
    const indexMeta = (fm) => ({ concept_id: 'index', path: 'index.md', body: '', frontmatter: fm });

    test('type "index" raises NO INVALID_TYPE warning', () => {
      const r = planAutocorrectForConcept(indexMeta({ type: 'index', title: 'Home' }));
      expect(r.warnings.filter((w) => w.rule === 'INVALID_TYPE')).toEqual([]);
    });

    test('the authorial type "BundleRoot" raises NO INVALID_TYPE warning', () => {
      const r = planAutocorrectForConcept(indexMeta({ type: 'BundleRoot', title: 'Home' }));
      expect(r.warnings.filter((w) => w.rule === 'INVALID_TYPE')).toEqual([]);
    });

    test('a genuinely unknown type STILL warns, and names only the content types', () => {
      const r = planAutocorrectForConcept({
        concept_id: 'c1',
        path: 'c1.md',
        body: '',
        frontmatter: { type: 'nonsense' }
      });
      const w = r.warnings.filter((x) => x.rule === 'INVALID_TYPE');
      expect(w).toHaveLength(1);
      // The remedy text must not read "use one of index|BundleRoot|..." — the
      // reserved types are recognised, so offering them is misleading.
      expect(w[0].message).toContain('topic|entity|process|event|source');
      expect(w[0].message).not.toContain('BundleRoot');
    });

    test('a non-index concept may legitimately carry a content type', () => {
      for (const t of CONTENT_TYPES) {
        const r = planAutocorrectForConcept({ concept_id: 'c1', path: 'c1.md', body: '', frontmatter: { type: t } });
        expect(r.warnings.filter((w) => w.rule === 'INVALID_TYPE')).toEqual([]);
      }
    });
  });

  describe('no consumer restates the vocabulary', () => {
    const consumers = {
      'concept-meta-service': '../services/concept-meta-service',
      'llm-curation-service': '../services/llm-curation-service',
      'type-inference-service': '../services/type-inference-service',
      'conformance-service': '../services/conformance-service'
    };

    for (const [name, rel] of Object.entries(consumers)) {
      test(`${name} imports the shared vocabulary`, () => {
        const raw = require('fs').readFileSync(require.resolve(rel), 'utf8');
        expect(raw).toMatch(/require\('\.\/okf-vocabulary'\)/);
        // Match CODE, not comments: the files explain the drift in prose and
        // quote the old literals verbatim, so stripping comments first is what
        // makes this a statement about the code rather than the prose.
        const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
        expect(code).not.toMatch(/\[\s*'topic'\s*,\s*'entity'\s*,\s*'process'/);
        expect(code).not.toMatch(/\[\s*'active'\s*,\s*'draft'\s*,\s*'retired'/);
        expect(code).not.toMatch(/\[\s*'draft'\s*,\s*'stable'\s*,\s*'deprecated'/);
      });
    }
  });

  test('status vocabulary is the one the corpus and tests actually carry', () => {
    // Measured live (2,979 concepts): frontmatter.status is 2,860 draft /
    // 5 stable / 114 absent — `active` and `retired` occur ZERO times.
    // conformance-service.test.js asserts these three are valid, and
    // concept-meta-service.test.js:304 asserts `retired` is INVALID.
    expect(STATUS_VALUES).toEqual(['draft', 'stable', 'deprecated']);
  });

  describe('autocorrect accepts the status the corpus actually has', () => {
    // The !1077 autocorrect defect: AUTOCORRECT_STATUS_ENUM read
    // ['active','draft','retired'], so every concept authored `status: stable`
    // — 5 of them live — drew an INVALID_STATUS warning, while `active` and
    // `retired` (which nothing produces, and `retired` is invalid per the
    // regression test) sailed through.
    const meta = (status) => ({
      concept_id: 'c1',
      path: 'c1.md',
      body: '',
      status,
      frontmatter: { status }
    });

    test.each(['draft', 'stable', 'deprecated'])('%s raises NO INVALID_STATUS', (s) => {
      const r = planAutocorrectForConcept(meta(s));
      expect(r.warnings.filter((w) => w.rule === 'INVALID_STATUS')).toEqual([]);
    });

    test('a value nothing produces is still rejected', () => {
      for (const bogus of ['active', 'retired', 'published']) {
        const r = planAutocorrectForConcept(meta(bogus));
        expect(r.warnings.filter((w) => w.rule === 'INVALID_STATUS')).toHaveLength(1);
      }
    });

    test('an absent status proposes MISSING_STATUS, not a warning', () => {
      const r = planAutocorrectForConcept({ concept_id: 'c1', path: 'c1.md', body: '', frontmatter: {} });
      expect(r.warnings.filter((w) => w.rule === 'INVALID_STATUS')).toEqual([]);
      expect(r.changes.filter((c) => c.reason === 'MISSING_STATUS')).toHaveLength(1);
    });
  });
});
