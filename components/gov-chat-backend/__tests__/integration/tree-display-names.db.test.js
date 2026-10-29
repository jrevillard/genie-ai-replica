'use strict';

/**
 * The tree's name resolution lives INSIDE the AQL projection, so the unit
 * suite — which mocks the database — can only assert the projection's
 * SHAPE. This file runs the real projection against a real ArangoDB: the
 * only place a RESOLVED name can be observed.
 *
 * It is SKIPPED unless ARANGO_TEST_URL points at a database:
 *
 *   ARANGO_TEST_URL=http://127.0.0.1:8529 npx jest __tests__/integration
 *
 * An authenticated database takes ARANGO_TEST_USER and ARANGO_TEST_PASSWORD
 * (the deployment's own credentials):
 *
 *   ARANGO_TEST_URL=https://arango:8529 ARANGO_TEST_USER=root \
 *   ARANGO_TEST_PASSWORD=… npx jest __tests__/integration
 *
 * The suite has no database of its own (the CI runs it without one), and
 * this test creates its OWN database and drops it afterwards — it never
 * touches the one the application uses.
 */

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock(
  '../../shared-lib',
  () => ({
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    },
    dbService: { getConnection: jest.fn() }
  }),
  { virtual: true }
);

jest.mock('../../middleware/errors', () => ({
  NotFoundError: class NotFoundError extends Error {},
  ValidationError: class ValidationError extends Error {}
}));

const TEST_URL = process.env.ARANGO_TEST_URL;
const TEST_USER = process.env.ARANGO_TEST_USER || '';
const TEST_PASSWORD = process.env.ARANGO_TEST_PASSWORD || '';
const DB_NAME = 'genie_tree_display_names_test';

// The HTTP calls (creating a database, creating a collection) carry the
// same credentials the driver does.
function authHeader() {
  if (!TEST_USER) {
    return {};
  }
  return {
    Authorization: `Basic ${Buffer.from(`${TEST_USER}:${TEST_PASSWORD}`).toString('base64')}`
  };
}

const describeWithDatabase = TEST_URL ? describe : describe.skip;

// The taxonomy the assertions read. Three shapes, one per name class:
// translated in the active locale, translated only in ENGLISH, and seeded
// outside the write path (the document carries the English name and NO
// translation row — create-translations.js refuses to write an EN row).
const TAXONOMY = {
  categories: [
    { _key: 'taxes', catCode: 'taxes', order: 1, nameEN: 'Taxes' },
    { _key: 'civil', catCode: 'civil', order: 2, nameEN: 'Civil Registry' },
    { _key: 'agri', catCode: 'agri', order: 3, nameEN: 'Agriculture' }
  ],
  services: [
    { _key: 'filing', nameEN: 'Tax Filing' },
    { _key: 'audit', nameEN: 'Tax Audit' },
    { _key: 'births', nameEN: 'Births' },
    { _key: 'subsidy', nameEN: 'Farming Subsidies' }
  ],
  edges: [
    { _from: 'serviceCategories/taxes', _to: 'services/filing', order: 1 },
    { _from: 'serviceCategories/taxes', _to: 'services/audit', order: 2 },
    { _from: 'serviceCategories/civil', _to: 'services/births', order: 1 },
    { _from: 'serviceCategories/agri', _to: 'services/subsidy', order: 1 }
  ],
  categoryTranslations: [
    { serviceCategoryId: 'taxes', languageCode: 'en', translation: 'Taxes' },
    { serviceCategoryId: 'taxes', languageCode: 'fr', translation: 'Impôts' },
    { serviceCategoryId: 'civil', languageCode: 'en', translation: 'Civil Registry' }
  ],
  serviceTranslations: [
    { serviceId: 'filing', languageCode: 'en', translation: 'Tax Filing' },
    { serviceId: 'filing', languageCode: 'fr', translation: 'Déclaration de taxes' },
    { serviceId: 'audit', languageCode: 'en', translation: 'Tax Audit' },
    { serviceId: 'births', languageCode: 'en', translation: 'Births' }
  ]
};

async function seed(db) {
  // The schema the migration creates: categoryServices is an EDGE
  // collection (type 3), the rest are document collections (type 2).
  for (const [name, type] of [
    ['serviceCategories', 2],
    ['services', 2],
    ['categoryServices', 3],
    ['serviceCategoryTranslations', 2],
    ['serviceTranslations', 2]
  ]) {
    const response = await fetch(`${TEST_URL}/_db/${DB_NAME}/_api/collection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ name, type })
    });
    const body = await response.json();
    if (body.error) {
      throw new Error(`creating ${name}: ${JSON.stringify(body)}`);
    }
  }
  await db.collection('serviceCategories').saveAll(TAXONOMY.categories);
  await db.collection('services').saveAll(TAXONOMY.services);
  await db.collection('categoryServices').saveAll(TAXONOMY.edges);
  await db.collection('serviceCategoryTranslations').saveAll(TAXONOMY.categoryTranslations);
  await db.collection('serviceTranslations').saveAll(TAXONOMY.serviceTranslations);
}

describeWithDatabase('the category tree (against a real ArangoDB)', () => {
  let db;
  let serviceCategoryService;

  beforeAll(async () => {
    // Loaded HERE and not at the top of the file: a SKIPPED suite must
    // not open a connection, and the driver keeps one open until it is
    // closed.
    const { Database } = require('arangojs');
    serviceCategoryService = require('../../services/service-category-service');
    // The database is created over the HTTP API (arangojs 8's Database
    // binds to an existing one) and dropped in afterAll. A database left
    // behind by an interrupted run is dropped first: the test must be
    // repeatable.
    await fetch(`${TEST_URL}/_api/database/${DB_NAME}`, { method: 'DELETE', headers: authHeader() });
    const created = await fetch(`${TEST_URL}/_api/database`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ name: DB_NAME })
    });
    const createdBody = await created.json();
    if (createdBody.error && !String(createdBody.errorMessage).includes('duplicate')) {
      throw new Error(`creating ${DB_NAME}: ${JSON.stringify(createdBody)}`);
    }
    db = new Database({
      url: TEST_URL,
      databaseName: DB_NAME,
      username: TEST_USER || undefined,
      password: TEST_PASSWORD || undefined
    });
    await seed(db);
    // The service is a singleton whose init() would dial the configured
    // ArangoDB; the test hands it THIS database instead.
    serviceCategoryService.db = db;
    serviceCategoryService.initialized = true;
  });

  afterAll(async () => {
    // The database is dropped over the HTTP API (arangojs 8's Database
    // binds to an existing one).
    await fetch(`${TEST_URL}/_api/database/${DB_NAME}`, { method: 'DELETE', headers: authHeader() });
    // The driver's connection is closed: an open one keeps the test
    // process alive after the run.
    if (db) {
      db.close();
    }
  });

  it('names every entity — the locale, or the English one it falls back to', async () => {
    const tree = await serviceCategoryService.getAllCategoriesWithServices('fr');
    const taxes = tree.find((c) => c.catKey === 'taxes');
    const civil = tree.find((c) => c.catKey === 'civil');
    const agri = tree.find((c) => c.catKey === 'agri');
    const filing = taxes.children.find((c) => c.nameEN === 'Tax Filing');
    const audit = taxes.children.find((c) => c.nameEN === 'Tax Audit');

    // The locale's own translation wins wherever there is one.
    expect(taxes.name).toBe('Impôts');
    expect(filing.name).toBe('Déclaration de taxes');

    // No French translation: the ENGLISH one is the display name, and it
    // is the same name the corpus filters on.
    expect(civil.name).toBe('Civil Registry');
    expect(audit.name).toBe('Tax Audit');

    // Seeded outside the write path: the document carries the English
    // name and there is NO translation row at all. The tree still names
    // it — on the wire too, so the scope can be sent.
    expect(agri.name).toBe('Agriculture');
    expect(agri.nameEN).toBe('Agriculture');
    expect(agri.children[0].name).toBe('Farming Subsidies');
    expect(agri.children[0].nameEN).toBe('Farming Subsidies');

    // Nothing in the tree is left nameless.
    expect(tree.every((c) => c.name && c.nameEN)).toBe(true);
    expect(tree.every((c) => c.children.every((s) => s.name && s.nameEN))).toBe(true);
  });

  it('keeps the ADMIN tree on the localized display name — no English fallback', async () => {
    const tree = await serviceCategoryService.getAdminAllCategoriesWithServices('fr');
    const taxes = tree.find((c) => c.catKey === 'taxes');
    const civil = tree.find((c) => c.catKey === 'civil');
    const agri = tree.find((c) => c.catKey === 'agri');

    // The admin panel keys its label map by the display name, so the
    // English fallback the public tree applies would let two entities
    // share one key there.
    expect(taxes.name).toBe('Impôts');
    expect(civil.name).toBeNull();
    expect(agri.name).toBeNull();

    // The WIRE spelling is the same in both trees.
    expect(civil.nameEN).toBe('Civil Registry');
    expect(agri.nameEN).toBe('Agriculture');
    expect(taxes.children.find((c) => c.nameEN === 'Tax Audit')._key).toBe('audit');
  });
});
