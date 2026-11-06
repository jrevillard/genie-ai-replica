'use strict';

/**
 * The translation rows written by the seed/migration scripts must use the
 * SAME locale form as the application write path
 * (`services/service-category-service.js`).
 *
 * The service stores the locale UPPERCASED and keys the row
 * `${ownerKey}_${LOCALE}`; the scripts used to store the raw/lowercased
 * locale and key the row with it. The two forms are different documents:
 * the application's UPSERT (keyed on `_key`) then MISSES the seeded row and
 * INSERTs a second one with a fresh `createdAt`, while the GC pass removes
 * the seeded row — the seeded row's creation timestamp (and its synthetic
 * age) is lost, and both rows coexist for the length of the request.
 *
 * This suite drives the REAL write paths of both scripts against an
 * in-memory database, then drives the REAL application write path over the
 * rows the seed produced and asserts the application targets exactly those
 * rows (same `_key`) — which is what makes the UPSERT an UPDATE (createdAt
 * preserved) instead of an INSERT.
 *
 * The seed's existence probe is pinned too: a row already held for an owner
 * and locale must be recognized whatever case it was stored in, so a rerun
 * does not add a SECOND row for the same owner and locale.
 */

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('arangojs', () => ({
  aql: (strings, ...values) => ({ _aql: true, strings, values }),
  Database: jest.fn()
}));

jest.mock('../../shared-lib', () => require('../mocks/shared-lib'), { virtual: true });

jest.mock('../../middleware/errors', () => ({
  NotFoundError: class NotFoundError extends Error {
    constructor(msg) {
      super(msg);
      this.name = 'NotFoundError';
      this.statusCode = 404;
    }
  },
  ValidationError: class ValidationError extends Error {
    constructor(msg) {
      super(msg);
      this.name = 'ValidationError';
      this.statusCode = 400;
    }
  }
}));

const COLLECTIONS = [
  'serviceCategories',
  'services',
  'categoryServices',
  'serviceCategoryTranslations',
  'serviceCategoryTranslationsEdge',
  'serviceTranslations',
  'serviceTranslationsEdge'
];

/**
 * An in-memory stand-in for ArangoDB, just large enough for the queries
 * the two scripts and the application write path issue: `save` records the
 * document, `query` answers the existence checks. The AQL template is
 * inspected as text — the mocked `aql` returns the raw template parts.
 */
function createMemoryDb() {
  const saved = Object.fromEntries(COLLECTIONS.map((name) => [name, []]));
  const queries = [];

  function collection(name) {
    return {
      name,
      save: jest.fn(async (doc) => {
        saved[name].push(doc);
        return doc;
      }),
      update: jest.fn(async (key, patch) => {
        const doc = saved[name].find((d) => d._key === key);
        if (doc) {
          Object.assign(doc, patch);
        }
        return doc;
      }),
      exists: jest.fn(async () => true),
      indexes: jest.fn(async () => []),
      ensureIndex: jest.fn(async () => ({})),
      document: jest.fn(async (key) => {
        const doc = saved[name].find((d) => d._key === key);
        if (!doc) {
          const error = new Error(`not found: ${key}`);
          error.code = 404;
          error.errorNum = 1202;
          throw error;
        }
        return doc;
      })
    };
  }

  const handles = Object.fromEntries(COLLECTIONS.map((name) => [name, collection(name)]));

  function cursor(result) {
    return {
      next: jest.fn(async () => result ?? null),
      all: jest.fn(async () => (Array.isArray(result) ? result : result ? [result] : []))
    };
  }

  /**
   * The seed's existence probe: "does this owner already have a translation
   * for this locale?". Mirrors the AQL exactly — the key clause matches a row
   * by its `_key`, the other clause matches the FOLDED column against the
   * bound value LITERALLY, so a probe that binds the uppercase locale (or
   * drops the folding) genuinely does not match a lowercase row.
   */
  function findTranslation(rows, ownerField, values, text) {
    const byKey = text.includes('d._key ==');
    const folded = text.includes('LOWER(d.languageCode)');
    const [key, owner, locale] = byKey ? values : [null, values[0], values[1]];
    const row = rows.find((r) => {
      if (byKey && r._key === key) return true;
      if (r[ownerField] !== owner) return false;
      return (folded ? String(r.languageCode).toLowerCase() : r.languageCode) === locale;
    });
    return row ? row._key : null;
  }

  async function query(template) {
    const text = template.strings.join(' ');
    queries.push({ text, values: template.values });

    // --- the seed script's queries -------------------------------------
    if (text.includes('FOR d IN serviceCategories SORT')) {
      return cursor(saved.serviceCategories[saved.serviceCategories.length - 1]);
    }
    if (text.includes('FOR d IN services SORT')) {
      return cursor(saved.services[saved.services.length - 1]);
    }
    if (text.includes('FOR d IN serviceCategories FILTER d.nameEN')) {
      return cursor(null);
    }
    if (text.includes('FOR d IN serviceCategoryTranslations')) {
      return cursor(findTranslation(saved.serviceCategoryTranslations, 'serviceCategoryId', template.values, text));
    }
    if (text.includes('FOR d IN serviceTranslations')) {
      return cursor(findTranslation(saved.serviceTranslations, 'serviceId', template.values, text));
    }
    if (text.includes('FOR d IN services FILTER d.nameEN')) {
      return cursor(null);
    }
    if (text.includes('FOR d IN services RETURN d')) {
      return cursor(saved.services);
    }

    // --- create-translations.js: the English source rows ---------------
    if (text.includes('RETURN { _key: trans.serviceCategoryId')) {
      return cursor([{ _key: 'cat-1', nameEN: 'Taxes' }]);
    }
    if (text.includes('RETURN { _key: trans.serviceId')) {
      return cursor([{ _key: 'svc-1', nameEN: 'Tax Filing' }]);
    }
    // the "already translated for this language?" probe
    if (text.includes('RETURN trans.serviceCategoryId') || text.includes('RETURN trans.serviceId')) {
      return cursor([]);
    }

    return cursor([]);
  }

  return { saved, handles, queries, query, collection };
}

describe('seed scripts write the locale the application reads back', () => {
  let db;
  let service;
  let logSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    db = createMemoryDb();
    const { dbService } = require('../../shared-lib');
    dbService.getConnection.mockResolvedValue({
      query: db.query,
      collection: (name) => db.handles[name]
    });
    jest.isolateModules(() => {
      service = require('../../services/service-category-service');
    });
    service.initialized = false;
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('seed-synthetic-data.js writes translation rows the application write path targets', async () => {
    const { SeedRunner } = require('../../scripts/seed-synthetic-data');
    const runner = new SeedRunner(db, { knowledge: true });
    await runner.seedKnowledge();

    const categoryRows = db.saved.serviceCategoryTranslations;
    const serviceRows = db.saved.serviceTranslations;
    expect(categoryRows.length).toBeGreaterThan(0);
    expect(serviceRows.length).toBeGreaterThan(0);

    for (const row of [...categoryRows, ...serviceRows]) {
      const ownerKey = row.serviceCategoryId || row.serviceId;
      expect(row.languageCode).toBe(row.languageCode.toUpperCase());
      expect(row._key).toBe(`${ownerKey}_${row.languageCode}`);
    }

    // The seed gives its rows a SYNTHETIC AGE (daysAgo(55) for categories,
    // daysAgo(50) for services) — the age is the point of the seed, and it
    // must survive: it only does if the application's UPSERT updates the
    // seeded row instead of inserting a second one.
    const seventyDays = 70 * 24 * 60 * 60 * 1000;
    for (const row of categoryRows) {
      expect(Date.now() - Date.parse(row.createdAt)).toBeGreaterThan(seventyDays / 2);
    }
    for (const row of serviceRows) {
      expect(Date.now() - Date.parse(row.createdAt)).toBeGreaterThan(seventyDays / 2);
    }

    // The application write path must bind exactly those keys: that is what
    // turns its UPSERT into an UPDATE over the seeded row (createdAt and
    // the seeded age preserved) instead of an INSERT of a second row.
    const seededCategory = db.saved.serviceCategories[0];
    const seededFrenchRow = categoryRows.find(
      (row) => row.serviceCategoryId === seededCategory._key && row.languageCode === 'FR'
    );
    expect(seededFrenchRow).toBeDefined();

    await service.updateCategoryWithTranslations(seededCategory._key, {
      nameEN: seededCategory.nameEN,
      translations: [{ languageCode: 'fr', translation: 'Impôts' }]
    });

    const upsert = db.queries.find((q) => q.text.includes('UPSERT { _key: doc._key }'));
    expect(upsert).toBeDefined();
    const boundDocs = upsert.values[0];
    expect(boundDocs.map((doc) => doc._key)).toContain(seededFrenchRow._key);
    expect(boundDocs.map((doc) => doc.languageCode)).toContain('FR');

    // The application ALWAYS writes the EN row of the owner, keyed
    // `${ownerKey}_EN`. The seed writes one too, so it must land on the
    // same key — otherwise the edit inserts a second EN row.
    const seededEnglishRow = categoryRows.find(
      (row) => row.serviceCategoryId === seededCategory._key && row.languageCode === 'EN'
    );
    expect(seededEnglishRow).toBeDefined();
    expect(boundDocs.map((doc) => doc._key)).toContain(seededEnglishRow._key);
  });

  it('seed-synthetic-data.js does not add a second row for a locale it already holds', async () => {
    // The legacy shape: a lowercased key AND a lowercased languageCode (what
    // the old script wrote). Only the owner clause can reach it — the key
    // the script would write is the uppercase one.
    db.saved.serviceCategoryTranslations.push({
      _key: '1_fr',
      serviceCategoryId: '1',
      languageCode: 'fr',
      translation: 'legacy french row',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z'
    });
    // The owner-less shape: the canonical key, no foreign key. It is
    // invisible to every read and immortal to the GC pass, so only the key
    // clause can reach it — and the seed must not write that key again (a
    // real database rejects the second write).
    db.saved.serviceCategoryTranslations.push({
      _key: '2_FR',
      languageCode: 'FR',
      translation: 'row without an owner',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z'
    });

    const { SeedRunner } = require('../../scripts/seed-synthetic-data');
    const runner = new SeedRunner(db, { knowledge: true });
    await runner.seedKnowledge();

    // the legacy row is recognized: no second row for that owner and locale
    const frenchRows = db.saved.serviceCategoryTranslations.filter(
      (row) => row.serviceCategoryId === '1' && row.languageCode.toUpperCase() === 'FR'
    );
    expect(frenchRows.length).toBe(1);
    expect(frenchRows[0].translation).toBe('legacy french row');

    // the owner-less row is recognized by its key: the seed writes no
    // second document under that key
    expect(db.saved.serviceCategoryTranslations.filter((row) => row._key === '2_FR').length).toBe(1);
  });

  it('create-translations.js writes translation rows the application write path targets', async () => {
    const { TranslationCreator } = require('../../scripts/new-schema-scripts/create-translations');
    const creator = new TranslationCreator({ url: 'http://localhost:8529' }, 'internal');
    creator.db = db;
    await creator.ensureCollections();
    creator.generateTranslation = jest.fn(async (text) => `translated:${text}`);

    await creator.createCategoryTranslations('FR');
    await creator.createServiceTranslations('FR');

    const categoryRows = db.saved.serviceCategoryTranslations;
    const serviceRows = db.saved.serviceTranslations;
    expect(categoryRows.length).toBe(1);
    expect(serviceRows.length).toBe(1);

    for (const row of [...categoryRows, ...serviceRows]) {
      const ownerKey = row.serviceCategoryId || row.serviceId;
      expect(row.languageCode).toBe('FR');
      expect(row._key).toBe(`${ownerKey}_${row.languageCode}`);
    }
    expect(categoryRows[0]._key).toBe('cat-1_FR');
    expect(serviceRows[0]._key).toBe('svc-1_FR');
  });
});
