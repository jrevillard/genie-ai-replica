'use strict';

require('../setup-env');

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('arangojs', () => ({
  aql: (strings, ...values) => ({ _aql: true, strings, values })
}));

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
  NotFoundError: class NotFoundError extends Error {
    constructor(msg) {
      super(msg);
      this.name = 'NotFoundError';
    }
  },
  ValidationError: class ValidationError extends Error {
    constructor(msg) {
      super(msg);
      this.name = 'ValidationError';
    }
  }
}));

const { dbService } = require('../../shared-lib');

function createMockCollection() {
  return {
    save: jest.fn().mockResolvedValue({ _key: 'cat-1' }),
    update: jest.fn().mockResolvedValue({ _key: 'cat-1' }),
    document: jest.fn().mockResolvedValue({ _key: 'cat-1', nameEN: 'Test' }),
    remove: jest.fn().mockResolvedValue({ _key: 'cat-1' }),
    ensureIndex: jest.fn()
  };
}

function createMockCursor(results) {
  return {
    next: jest.fn().mockResolvedValue(results.length > 0 ? results[0] : null),
    all: jest.fn().mockResolvedValue(results)
  };
}

let service;
let mockDb;
let mockServiceCategories;
let mockServices;
let mockCategoryServices;
let mockServiceCategoryTranslations;
let mockServiceTranslations;

beforeEach(() => {
  jest.clearAllMocks();

  mockServiceCategories = createMockCollection();
  mockServices = createMockCollection();
  mockCategoryServices = createMockCollection();
  mockServiceCategoryTranslations = createMockCollection();
  mockServiceTranslations = createMockCollection();

  mockDb = {
    collection: jest.fn().mockImplementation((name) => {
      const map = {
        serviceCategories: mockServiceCategories,
        services: mockServices,
        categoryServices: mockCategoryServices,
        serviceCategoryTranslations: mockServiceCategoryTranslations,
        serviceTranslations: mockServiceTranslations
      };
      return map[name] || createMockCollection();
    }),
    query: jest.fn()
  };

  dbService.getConnection.mockResolvedValue(mockDb);

  jest.isolateModules(() => {
    service = require('../../services/service-category-service');
  });
  service.initialized = false;
});

describe('ServiceCategoryService', () => {
  beforeEach(async () => {
    await service.init();
  });

  describe('init', () => {
    it('should initialize all 5 collections', async () => {
      expect(mockDb.collection).toHaveBeenCalledWith('serviceCategories');
      expect(mockDb.collection).toHaveBeenCalledWith('services');
      expect(mockDb.collection).toHaveBeenCalledWith('categoryServices');
      expect(mockDb.collection).toHaveBeenCalledWith('serviceCategoryTranslations');
      expect(mockDb.collection).toHaveBeenCalledWith('serviceTranslations');
      expect(service.initialized).toBe(true);
    });

    it('should skip re-initialization', async () => {
      service.initialized = true;
      await service.init();
      expect(dbService.getConnection).toHaveBeenCalledTimes(1);
    });
  });

  describe('upsertCategories', () => {
    it('should create categories with translations', async () => {
      const categories = [
        { name: 'Taxes', catKey: 'taxes', translations: [{ languageCode: 'fr', translation: 'Impots' }] }
      ];

      const result = await service.upsertCategories(categories, 'en');

      expect(result).toHaveLength(1);
      expect(mockServiceCategories.save).toHaveBeenCalledWith(
        expect.objectContaining({ nameEN: 'Taxes', catCode: 'taxes' })
      );
      expect(mockServiceCategoryTranslations.save).toHaveBeenCalledTimes(2);
    });

    it('should create category with default name when missing', async () => {
      const categories = [{}];

      await service.upsertCategories(categories);
      expect(mockServiceCategories.save).toHaveBeenCalledWith(expect.objectContaining({ nameEN: 'Category 1' }));
    });

    it('should throw on database error', async () => {
      mockServiceCategories.save.mockRejectedValue(new Error('DB error'));

      await expect(service.upsertCategories([{ name: 'Test' }])).rejects.toThrow('DB error');
    });
  });

  describe('upsertServices', () => {
    it('should create services with translations and edges', async () => {
      mockServices.save.mockResolvedValueOnce({ _key: 'svc-1' }).mockResolvedValueOnce({ _key: 'svc-2' });

      const result = await service.upsertServices('cat-1', ['Service A', 'Service B'], 'en');

      expect(result).toHaveLength(2);
      expect(mockServices.save).toHaveBeenCalledTimes(2);
      expect(mockServiceTranslations.save).toHaveBeenCalledTimes(2);
      expect(mockCategoryServices.save).toHaveBeenCalledTimes(2);
    });

    it('should return empty array when categoryKey is missing', async () => {
      const result = await service.upsertServices(null, ['Test']);
      expect(result).toEqual([]);
    });

    it('should return empty array when services is not an array', async () => {
      const result = await service.upsertServices('cat-1', 'not-array');
      expect(result).toEqual([]);
    });

    it('should skip empty service names', async () => {
      mockServices.save.mockResolvedValue({ _key: 'svc-1' });

      const result = await service.upsertServices('cat-1', ['Valid', '', '  ']);
      expect(result).toHaveLength(1);
    });
  });

  describe('createServiceWithTranslations', () => {
    it('should create service with correct order', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([2]));
      mockServices.save.mockResolvedValue({ _key: 'svc-new' });

      const result = await service.createServiceWithTranslations('cat-1', {
        nameEN: 'New Service',
        translations: [{ languageCode: 'fr', translation: 'Nouveau' }]
      });

      expect(result._key).toBe('svc-new');
      expect(mockCategoryServices.save).toHaveBeenCalledWith(expect.objectContaining({ order: 3 }));
    });

    it('should throw ValidationError when nameEN is missing', async () => {
      await expect(service.createServiceWithTranslations('cat-1', { nameEN: '' })).rejects.toThrow(
        'nameEN is required'
      );
    });

    it('should throw ValidationError when nameEN is not a string', async () => {
      await expect(service.createServiceWithTranslations('cat-1', { nameEN: 123 })).rejects.toThrow(
        'nameEN is required'
      );
    });
  });

  describe('updateServiceWithTranslations', () => {
    it('should update service with translations', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));

      const result = await service.updateServiceWithTranslations('svc-1', {
        nameEN: 'Updated',
        translations: [{ languageCode: 'fr', translation: 'Mis a jour' }]
      });

      expect(result._key).toBe('svc-1');
      expect(result.status).toBe('updated');
      expect(mockServices.update).toHaveBeenCalledWith('svc-1', { nameEN: 'Updated' });
    });

    it('should throw ValidationError when nameEN is missing', async () => {
      await expect(service.updateServiceWithTranslations('svc-1', {})).rejects.toThrow('nameEN is required');
    });

    it('should throw when service does not exist', async () => {
      mockServices.document.mockRejectedValue(new Error('Not found'));

      await expect(service.updateServiceWithTranslations('missing', { nameEN: 'Test' })).rejects.toThrow('Not found');
    });
  });

  describe('categoryExists', () => {
    it('should return true when category exists', async () => {
      const result = await service.categoryExists('cat-1');
      expect(result).toBe(true);
    });

    it('should return false when category not found (404)', async () => {
      const err = new Error('Not found');
      err.code = 404;
      mockServiceCategories.document.mockRejectedValue(err);

      const result = await service.categoryExists('missing');
      expect(result).toBe(false);
    });

    it('should return false when categoryKey is missing', async () => {
      const result = await service.categoryExists(null);
      expect(result).toBe(false);
    });

    it('should return false on other errors', async () => {
      mockServiceCategories.document.mockRejectedValue(new Error('DB error'));

      const result = await service.categoryExists('cat-1');
      expect(result).toBe(false);
    });
  });

  describe('getAllCategoriesWithServices', () => {
    it('should return categories with services', async () => {
      mockDb.query.mockResolvedValue(
        createMockCursor([
          {
            catKey: 'cat-1',
            catCode: 'taxes',
            name: 'Impuestos',
            nameEN: 'Taxes',
            children: [{ name: 'Declaración de impuestos', nameEN: 'Tax Filing' }]
          }
        ])
      );

      const result = await service.getAllCategoriesWithServices('en');
      expect(result).toHaveLength(1);
      // Both spellings survive the round trip: the localized name the UI
      // displays, and the ENGLISH one the query wire speaks. They are
      // different strings on purpose — a projection that carried one for
      // the other would look right with equal names.
      expect(result[0].name).toBe('Impuestos');
      expect(result[0].nameEN).toBe('Taxes');
      expect(result[0].children).toEqual([{ name: 'Declaración de impuestos', nameEN: 'Tax Filing' }]);
    });

    it('publishes both spellings — the EN translation beside the localized name', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('done'));
      await service.getAllCategoriesWithServices('fr').catch(() => {});

      const queryArg = mockDb.query.mock.calls[0][0];
      // arangojs 8 builds a LAZY aql object ({_aql, strings, values}) — the
      // query string only exists when a driver serializes it. The static
      // template parts carry everything structural this test asserts on.
      const text = queryArg.strings.join('|');
      // The EN translation is selected for the category AND for every
      // service: the corpus's chunk_labels carry the EN translation, so the
      // tree must publish it — that is the value the query wire speaks.
      const enSelections = (text.match(/'en'/g) || []).length;
      expect(enSelections).toBeGreaterThanOrEqual(2);
      // Both levels project the pair: `name` (display) and `nameEN` (wire).
      const dualSpellings = (text.match(/RETURN\s*\{[^}]*name:\s*\w+[^}]*nameEN/g) || []).length;
      expect(dualSpellings).toBeGreaterThanOrEqual(2);
      // The projection names the EN TRANSLATION on both sides — the
      // variable that carries it, not a literal and not the localized
      // one. `nameEN: null` and `nameEN: serviceTranslation` both leave
      // the corpus vocabulary empty while every pattern above still
      // matches, so the shape alone does not prove the value.
      expect(text).toMatch(/name:\s*categoryName,\s*nameEN:\s*categoryNameEN/);
      expect(text).toMatch(/name:\s*serviceName,\s*nameEN:\s*serviceNameEN/);
    });

    it('falls back to the EN translation for the display name when the locale has none', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('done'));
      await service.getAllCategoriesWithServices('fr').catch(() => {});

      const queryArg = mockDb.query.mock.calls[0][0];
      const text = queryArg.strings.join('|');
      // An entity nobody translated in the active locale used to publish
      // a NULL name, and the clients hid it: a blank category row, and
      // services dropped from the tree altogether — the tree showed less
      // than exists. The DISPLAY name falls back to the ENGLISH one, the
      // name the corpus filters on, so the label the user reads is the
      // label that scopes the query. The locale's own translation still
      // wins wherever there is one.
      expect(text).toMatch(
        /LET categoryName = LENGTH\(TRIM\(categoryTranslation\)\) > 0 \? categoryTranslation : categoryNameEN/
      );
      expect(text).toMatch(
        /LET serviceName = LENGTH\(TRIM\(serviceTranslation\)\) > 0 \? serviceTranslation : serviceNameEN/
      );
    });

    it('falls back to the entity document nameEN when no EN translation row exists', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('done'));
      await service.getAllCategoriesWithServices('en').catch(() => {});

      const queryArg = mockDb.query.mock.calls[0][0];
      const text = queryArg.strings.join('|');
      // An entity seeded outside the write path (the taxonomy seed script
      // writes the document field and no translation row at all) would
      // publish an EMPTY English name — the very symptom the tree must not
      // show: a blank row, and services the clients drop. The document's
      // cached nameEN is the fallback the corpus's own EN resolution
      // applies, so the tree must use it too. The write path keeps the
      // document and the row in sync, so this can only fill a missing row
      // with the text the row would have carried.
      expect(text).toMatch(
        /categoryTranslationEN\)\)\s*>\s*0\s*\?\s*categoryTranslationEN\s*:\s*\(LENGTH\(TRIM\(category\.nameEN\)\)\s*>\s*0\s*\?\s*category\.nameEN\s*:\s*null\)/
      );
      expect(text).toMatch(
        /serviceTranslationEN\)\)\s*>\s*0\s*\?\s*serviceTranslationEN\s*:\s*\(LENGTH\(TRIM\(service\.nameEN\)\)\s*>\s*0\s*\?\s*service\.nameEN\s*:\s*null\)/
      );
    });

    it('should throw on database error', async () => {
      mockDb.query.mockRejectedValue(new Error('Query failed'));

      await expect(service.getAllCategoriesWithServices('en')).rejects.toThrow('Query failed');
    });
  });

  describe('getAdminAllCategoriesWithServices', () => {
    it('should return categories with detailed service objects', async () => {
      mockDb.query.mockResolvedValue(
        createMockCursor([
          {
            catKey: 'cat-1',
            catCode: 'taxes',
            name: 'Impuestos',
            nameEN: 'Taxes',
            children: [{ _key: 'svc-1', name: 'Declaración de impuestos', nameEN: 'Tax Filing' }]
          }
        ])
      );

      const result = await service.getAdminAllCategoriesWithServices('en');
      // The admin tree carries the same spellings the public tree publishes:
      // the hierarchy editor renames entities, and nameEN is the one the
      // corpus filters on — the one that must not drift. Localized and EN
      // values differ on purpose; a projection that carried one for the
      // other would look right with equal names.
      expect(result[0].name).toBe('Impuestos');
      expect(result[0].nameEN).toBe('Taxes');
      expect(result[0].children[0]).toEqual({
        _key: 'svc-1',
        name: 'Declaración de impuestos',
        nameEN: 'Tax Filing'
      });
    });

    it('publishes both spellings — the EN translation beside the localized name', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('done'));
      await service.getAdminAllCategoriesWithServices('fr').catch(() => {});

      const queryArg = mockDb.query.mock.calls[0][0];
      // arangojs 8 builds a LAZY aql object ({_aql, strings, values}) — see
      // the note in the getAllCategoriesWithServices shape test above.
      const text = queryArg.strings.join('|');
      // The EN translation is selected for the category AND for every
      // service, through the same single-translation-pass shape as the
      // public tree.
      const enSelections = (text.match(/'en'/g) || []).length;
      expect(enSelections).toBeGreaterThanOrEqual(2);
      // Both levels project the pair — `name` (display) and `nameEN` (wire)
      // — beside the entity KEY the hierarchy editor acts on. Asserting the
      // variable that carries the EN TRANSLATION (not a literal, not the
      // localized one) is what makes this fail on `nameEN: serviceTranslation`.
      expect(text).toMatch(/name:\s*categoryTranslation,\s*nameEN:\s*categoryNameEN/);
      expect(text).toMatch(/_key:\s*service\._key,\s*name:\s*serviceTranslation,\s*nameEN:\s*serviceNameEN/);
    });

    it('keeps the LOCALIZED name as its display name — no English fallback', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('done'));
      await service.getAdminAllCategoriesWithServices('fr').catch(() => {});

      const queryArg = mockDb.query.mock.calls[0][0];
      const text = queryArg.strings.join('|');
      // The public tree falls back to the English name for an entity the
      // locale has no translation for; the admin tree does NOT. The admin
      // panel keys its label map by this display name — the file's labels
      // ARE locale names — so an English fallback here would let two
      // entities share one key and file a label under the wrong entity.
      // The sibling shape test above already pins what the RETURN does
      // carry; this one fails the moment the public tree's display-name
      // fallback is copy-pasted in.
      expect(text).not.toMatch(/LET categoryName =/);
      expect(text).not.toMatch(/LET serviceName =/);
    });

    it('falls back to the entity document nameEN when no EN translation row exists', async () => {
      mockDb.query.mockRejectedValueOnce(new Error('done'));
      await service.getAdminAllCategoriesWithServices('en').catch(() => {});

      const queryArg = mockDb.query.mock.calls[0][0];
      const text = queryArg.strings.join('|');
      // The EN translation row is the SSOT, but an entity seeded outside
      // the write path (the taxonomy seed script writes the document
      // field and no translation row at all) would publish an EMPTY
      // English name — the very symptom the admin panel must not show.
      // The document's cached nameEN is the fallback the corpus's own EN
      // resolution uses, so the tree must use it too.
      expect(text).toMatch(
        /categoryTranslationEN\)\)\s*>\s*0\s*\?\s*categoryTranslationEN\s*:\s*\(LENGTH\(TRIM\(category\.nameEN\)\)\s*>\s*0\s*\?\s*category\.nameEN\s*:\s*null\)/
      );
      expect(text).toMatch(
        /serviceTranslationEN\)\)\s*>\s*0\s*\?\s*serviceTranslationEN\s*:\s*\(LENGTH\(TRIM\(service\.nameEN\)\)\s*>\s*0\s*\?\s*service\.nameEN\s*:\s*null\)/
      );
    });

    it('should throw on database error', async () => {
      mockDb.query.mockRejectedValue(new Error('Query failed'));

      await expect(service.getAdminAllCategoriesWithServices('en')).rejects.toThrow('Query failed');
    });
  });

  describe('getCategoryWithServices', () => {
    it('should return category with services', async () => {
      mockDb.query.mockResolvedValue(
        createMockCursor([{ catKey: 'cat-1', catCode: 'taxes', name: 'Taxes', children: ['Tax Filing'] }])
      );

      const result = await service.getCategoryWithServices('cat-1', 'en');
      expect(result.catKey).toBe('cat-1');
    });

    it('should throw NotFoundError when category not found', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([null]));

      await expect(service.getCategoryWithServices('missing')).rejects.toThrow('Category missing not found');
    });

    it('should throw Error when categoryKey is missing', async () => {
      await expect(service.getCategoryWithServices(null)).rejects.toThrow('Invalid category key');
    });
  });

  describe('deleteCategory', () => {
    it('should delete category and related data', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));
      mockServiceCategories.remove.mockResolvedValue({ _key: 'cat-1' });

      const result = await service.deleteCategory('cat-1');
      expect(result._key).toBe('cat-1');
      expect(mockDb.query).toHaveBeenCalledTimes(3);
      expect(mockServiceCategories.remove).toHaveBeenCalledWith('cat-1');
    });

    it('should throw Error when categoryKey is missing', async () => {
      await expect(service.deleteCategory(null)).rejects.toThrow('Invalid category key');
    });
  });

  describe('deleteService', () => {
    it('should delete service and related data', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));
      mockServices.remove.mockResolvedValue({ _key: 'svc-1' });

      const result = await service.deleteService('svc-1');
      expect(result).toEqual({ _key: 'svc-1', status: 'deleted' });
      expect(mockDb.query).toHaveBeenCalledTimes(2);
      expect(mockServices.remove).toHaveBeenCalledWith('svc-1');
    });

    it('should throw Error when serviceKey is missing', async () => {
      await expect(service.deleteService(null)).rejects.toThrow('Invalid service key');
    });
  });

  describe('searchCategoriesAndServices', () => {
    it('should return empty results when no query provided', async () => {
      const result = await service.searchCategoriesAndServices('');
      expect(result).toEqual({ categories: [], services: [] });
    });

    it('should return matching categories and services', async () => {
      mockDb.query.mockResolvedValue(
        createMockCursor([
          {
            categories: [{ type: 'category', key: 'cat-1', name: 'Taxes' }],
            services: [
              { type: 'service', key: 'svc-1', name: 'Tax Filing', categoryKey: 'cat-1', categoryName: 'Taxes' }
            ]
          }
        ])
      );

      const result = await service.searchCategoriesAndServices('tax', 'en');
      expect(result.categories).toHaveLength(1);
      expect(result.services).toHaveLength(1);
    });

    it('should return empty results on database error', async () => {
      mockDb.query.mockRejectedValue(new Error('DB error'));

      const result = await service.searchCategoriesAndServices('tax');
      expect(result).toEqual({ categories: [], services: [] });
    });
  });

  describe('getCategoryTranslations', () => {
    it('should return translations for a category', async () => {
      mockDb.query.mockResolvedValue(
        createMockCursor([
          { languageCode: 'en', translation: 'Taxes' },
          { languageCode: 'fr', translation: 'Impots' }
        ])
      );

      const result = await service.getCategoryTranslations('cat-1');
      expect(result).toHaveLength(2);
    });

    it('should throw Error when categoryKey is missing', async () => {
      await expect(service.getCategoryTranslations(null)).rejects.toThrow('Invalid category key');
    });
  });

  describe('getServiceTranslations', () => {
    it('should return translations for a service', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([{ lang: 'en', text: 'Tax Filing' }]));

      const result = await service.getServiceTranslations('svc-1');
      expect(result).toHaveLength(1);
    });

    it('should throw Error when serviceKey is missing', async () => {
      await expect(service.getServiceTranslations(null)).rejects.toThrow('Invalid service key');
    });
  });

  describe('createCategory', () => {
    it('should create category with correct order', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([3]));
      mockServiceCategories.save.mockResolvedValue({ _key: 'cat-new' });

      const result = await service.createCategory({
        nameEN: 'New Category',
        translations: [{ languageCode: 'fr', translation: 'Nouvelle' }]
      });

      expect(result._key).toBe('cat-new');
      expect(mockServiceCategories.save).toHaveBeenCalledWith(
        expect.objectContaining({ order: 4, nameEN: 'New Category' })
      );
    });

    it('should throw ValidationError when nameEN is missing', async () => {
      await expect(service.createCategory({ nameEN: '' })).rejects.toThrow('nameEN is required');
    });
  });

  describe('updateCategoryWithTranslations', () => {
    it('should update category and translations', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));

      const result = await service.updateCategoryWithTranslations('cat-1', {
        nameEN: 'Updated',
        translations: [{ languageCode: 'fr', translation: 'Mis a jour' }]
      });

      expect(result).toEqual({ _key: 'cat-1', status: 'updated' });
      expect(mockServiceCategoryTranslations.save).toHaveBeenCalledWith(
        expect.objectContaining({ languageCode: 'EN', translation: 'Updated' }),
        expect.objectContaining({ overwrite: true })
      );
      expect(mockServiceCategories.update).toHaveBeenCalledWith('cat-1', { nameEN: 'Updated' });
    });

    it('should throw ValidationError when nameEN is missing', async () => {
      await expect(service.updateCategoryWithTranslations('cat-1', { nameEN: '' })).rejects.toThrow(
        'nameEN is required'
      );
    });
  });

  describe('_getTranslatedName', () => {
    beforeEach(async () => {
      await service.init();
    });

    it('should return category translation', async () => {
      mockDb.query.mockResolvedValue({ next: jest.fn().mockResolvedValue('Catégorie') });
      const result = await service._getTranslatedName('category', 'cat-1', 'fr');
      expect(result).toBe('Catégorie');
    });

    it('should return service translation', async () => {
      mockDb.query.mockResolvedValue({ next: jest.fn().mockResolvedValue('Service FR') });
      const result = await service._getTranslatedName('service', 'svc-1', 'fr');
      expect(result).toBe('Service FR');
    });

    it('should return null for invalid collection type', async () => {
      const result = await service._getTranslatedName('invalid', 'cat-1', 'en');
      expect(result).toBeNull();
    });

    it('should return null when no translation found', async () => {
      mockDb.query.mockResolvedValue({ next: jest.fn().mockResolvedValue(null) });
      const result = await service._getTranslatedName('category', 'cat-99', 'de');
      expect(result).toBeNull();
    });

    it('should return null on query error', async () => {
      mockDb.query.mockRejectedValue(new Error('DB error'));
      const result = await service._getTranslatedName('category', 'cat-1', 'en');
      expect(result).toBeNull();
    });
  });

  describe('deleteService', () => {
    beforeEach(async () => {
      await service.init();
    });

    it('should throw when service key is empty', async () => {
      await expect(service.deleteService('')).rejects.toThrow('Invalid service key provided');
    });

    it('should delete service and translations', async () => {
      mockDb.query.mockResolvedValue({ next: jest.fn().mockResolvedValue(null) });
      mockServices.remove.mockResolvedValue({ _key: 'svc-1' });
      const result = await service.deleteService('svc-1');
      expect(result.status).toBe('deleted');
      expect(mockDb.query).toHaveBeenCalledTimes(2);
      expect(mockServices.remove).toHaveBeenCalledWith('svc-1');
    });

    it('should handle delete errors', async () => {
      mockDb.query.mockRejectedValue(new Error('Delete failed'));
      await expect(service.deleteService('svc-1')).rejects.toThrow('Delete failed');
    });
  });

  describe('searchCategoriesAndServices', () => {
    beforeEach(async () => {
      await service.init();
    });

    it('should return empty results when query is empty', async () => {
      const result = await service.searchCategoriesAndServices('', 'en');
      expect(result).toEqual({ categories: [], services: [] });
    });

    it('should return search results', async () => {
      mockDb.query.mockResolvedValue({
        next: jest.fn().mockResolvedValue({
          categories: [{ type: 'category', key: 'cat-1', name: 'Tax' }],
          services: [{ type: 'service', key: 'svc-1', name: 'Tax Rate' }]
        })
      });
      const result = await service.searchCategoriesAndServices('tax', 'en');
      expect(result.categories).toHaveLength(1);
      expect(result.services).toHaveLength(1);
    });

    it('should return empty results on search error', async () => {
      mockDb.query.mockRejectedValue(new Error('Search failed'));
      const result = await service.searchCategoriesAndServices('tax', 'en');
      expect(result).toEqual({ categories: [], services: [] });
    });
  });
});
