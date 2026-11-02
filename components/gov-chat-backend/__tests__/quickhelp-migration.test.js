// 006-quickhelp-buttons migration (J.4): pins the two properties the box
// depends on — (1) the collection is created only when missing (001
// exists-check pattern), (2) the seed is INSERT-ONLY: a re-run never
// duplicates and never clobbers admin edits to seeded buttons (005
// non-destructive precedent). Also pins the 8-button DEC-28 set shape:
// bilingual title/prompt, order 1-8, icon paths under /config/quickhelp/.
const migration = require('../scripts/migrations/006-quickhelp-buttons');

// Fake db: exists() with no arg = collection existence (tracked via
// `created`); with a key = document existence.
function makeFakeDb() {
  const docs = new Map(); // _key -> doc
  const created = [];
  const db = {
    collection: () => ({
      exists: async (key) => (key === undefined ? created.includes('quickhelpButtons') : docs.has(key)),
      save: async (doc) => {
        if (docs.has(doc._key)) throw new Error('conflict');
        docs.set(doc._key, doc);
      },
    }),
    createCollection: async (name) => created.push(name),
    query: async (_q, vars) => ({ next: async () => (docs.has(vars.key) ? vars.key : null) }),
  };
  return { db, docs, created };
}

describe('006-quickhelp-buttons migration (J.4)', () => {
  it('creates the collection and seeds the 8-button DEC-28 set', async () => {
    const { db, docs, created } = makeFakeDb();
    await migration.up(db);
    expect(created).toEqual(['quickhelpButtons']);
    expect(docs.size).toBe(8);
    const keys = [...docs.values()].sort((a, b) => a.order - b.order).map((d) => d._key);
    expect(keys).toEqual([
      'just-chat', 'crop-advice', 'soil-fertilizers', 'pest-control',
      'maize-in-lesotho', 'pre-planting', 'crop-management', 'harvest-storage',
    ]);
    for (const doc of docs.values()) {
      expect(doc.title.en).toBeTruthy();
      expect(doc.prompt.en).toBeTruthy();
      expect(doc.icon).toMatch(/^\/config\/quickhelp\/.+\.svg$/);
      expect(doc.title.st).toBeTruthy(); // seed ships ST for all 8 (drafts flagged in source)
    }
  });

  it('re-run is a no-op and never clobbers admin edits (insert-only seed)', async () => {
    const { db, docs } = makeFakeDb();
    await migration.up(db);
    docs.get('crop-advice').title = { en: 'Admin renamed me' };
    await migration.up(db); // second run
    expect(docs.size).toBe(8);
    expect(docs.get('crop-advice').title.en).toBe('Admin renamed me');
  });
});
