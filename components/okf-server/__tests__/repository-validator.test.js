// Story 1-8c regression — the forbidden-tag ceiling. The 1-8c teaching
// loop ADDS forbidden tags on top of the curator's initial set; the old
// cap (6) made any add-all on a repo that already had 5 tags a guaranteed
// 400. 24 is the new hard ceiling; the soft guidance lives in
// frontmatter-service FIELD_RANGES.
const { updateSchema, TAG_LIMITS } = require('../validators/repository-validator');

const base = {
  topic: ['cancer-screening'],
  entity: ['breast-cancer'],
  scope: 'healthcare',
  summary: 'x',
  keyword: []
};

function fmWith(forbidden) {
  return { frontmatter: { ...base, forbidden } };
}

describe('updateSchema forbidden-tag ceiling (1-8c)', () => {
  test('accepts the curator set plus a batch of suggested tags (8 total)', () => {
    const forbidden = ['mental-health', 'nutrition', 'exercise', 'genetics', 'epidemiology', 'communicable-disease', 'hiv', 'infectious-disease'];
    const { error } = updateSchema.validate(fmWith(forbidden));
    expect(error).toBeUndefined();
  });

  test('accepts up to 24 forbidden tags', () => {
    const forbidden = Array.from({ length: 24 }, (_, i) => `tag-${i + 1}`);
    const { error } = updateSchema.validate(fmWith(forbidden));
    expect(error).toBeUndefined();
  });

  test('rejects more than 24', () => {
    const forbidden = Array.from({ length: 25 }, (_, i) => `tag-${i + 1}`);
    const { error } = updateSchema.validate(fmWith(forbidden));
    expect(error).toBeDefined();
  });

  test('still rejects non-string forbidden entries', () => {
    const { error } = updateSchema.validate(fmWith([{ value: 'obj' }]));
    expect(error).toBeDefined();
  });
});

// !1082 — the suggester returned 22 entities against a ceiling of 20, and Joi
// rejects the WHOLE request body, so a curator accepting that suggestion lost
// the topics and every accepted entity too. The schema was always right; the
// producer ignored it. These assert the producer's cap produces output the
// schema accepts, across every field and a wide range of input sizes.
describe('tag ceilings — producer output is always writable', () => {
  // Mirrors the cap()/clean() applied in frontmatter-service.suggestTags.
  const clean = (list) => list.filter((t) => t.length <= TAG_LIMITS.tagLength);
  const cap = (list, field) => list.slice(0, TAG_LIMITS[field]);

  const fields = ['topic', 'entity', 'forbidden', 'keyword'];

  for (const field of fields) {
    test(`${field} capped to ${TAG_LIMITS[field]} validates, at any input size`, () => {
      for (const raw of [0, 1, 5, 8, 9, 20, 21, 22, 25, 40, 100]) {
        const out = cap(clean(Array.from({ length: raw }, (_, i) => `tag-${i}`)), field);
        const { error } = updateSchema.validate({ frontmatter: { [field]: out } });
        expect({ field, raw, error: error && error.details[0].message }).toEqual({
          field,
          raw,
          error: undefined
        });
      }
    });
  }

  test('over-length tag strings are filtered, not passed through', () => {
    const out = cap(clean(['x'.repeat(200), 'ok']), 'topic');
    expect(out).toEqual(['ok']);
    const { error } = updateSchema.validate({ frontmatter: { topic: out } });
    expect(error).toBeUndefined();
  });

  test('the Bali failure case: 22 entities now becomes a writable 20', () => {
    // The exact shape that 400'd on Bali 2026-10-15.
    const suggested = {
      topic: ['culture', 'history', 'politics', 'economics', 'religion', 'prehistory'],
      entity: Array.from({ length: 22 }, (_, i) => `entity-${i}`)
    };
    const writable = {
      topic: cap(clean(suggested.topic), 'topic'),
      entity: cap(clean(suggested.entity), 'entity')
    };
    const { error } = updateSchema.validate({ frontmatter: writable });
    expect(error).toBeUndefined();
    expect(writable.topic).toHaveLength(6);   // under the ceiling — untouched
    expect(writable.entity).toHaveLength(20); // truncated, and the topics survive
  });

  test('TAG_LIMITS is exported so the producer cannot re-declare the numbers', () => {
    expect(TAG_LIMITS).toEqual({
      topic: 8,
      entity: 20,
      forbidden: 24,
      keyword: 20,
      tagLength: 64,
      summaryLength: 1024
    });
  });
});
