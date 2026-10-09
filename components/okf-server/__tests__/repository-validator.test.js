// Story 1-8c regression — the forbidden-tag ceiling. The 1-8c teaching
// loop ADDS forbidden tags on top of the curator's initial set; the old
// cap (6) made any add-all on a repo that already had 5 tags a guaranteed
// 400. 24 is the new hard ceiling; the soft guidance lives in
// frontmatter-service FIELD_RANGES.
const { updateSchema } = require('../validators/repository-validator');

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
