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
 * An in-memory stand-in for ArangoDB, just large enough for the seed
 * script's queries: `save` records the document, `query` answers the
 * existence checks the seed and the service issue. The AQL template is
 * inspected as text — the mocked `aql` returns the raw template parts.
 */
function createMemoryDb() {
  const saved = Object.fromEntries(COLLECTIONS.map((name) => [name, []]));
  const queries = [];

  function collection(name) {
    return {
      name,
      saved: saved[name],
      save: jest.fn(async (doc) => {
        saved[name].push(doc);
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
      }),
      update: jest.fn(async (key, patch) => {
        const doc = saved[name].find((d) => d._key === key);
        if (doc) {
          Object.assign(doc, patch);
        }
        return doc;
      }),
      remove: jest.fn(async () => ({}))
    };
  }

  const handles = Object.fromEntries(COLLECTIONS.map((name) => [name, collection(name)]));

  function cursor(result) {
    return {
      next: jest.fn(async () => result ?? null),
      all: jest.fn(async () => (Array.isArray(result) ? result : result ? [result] : []))
    };
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
      return cursor(null);
    }
    if (text.includes('FOR d IN serviceTranslations')) {
      return cursor(null);
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
