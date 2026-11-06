'use strict';

require('../setup-env');

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('arangojs', () => ({
  aql: (strings, ...values) => ({ _aql: true, strings, values })
}));

jest.mock('../../shared-lib', () => require('../mocks/shared-lib'), { virtual: true });

const { dbService, logger } = require('../../shared-lib');

function createMockCollection() {
  return {
    save: jest.fn().mockResolvedValue({ _key: 'cat-1' }),
    update: jest.fn().mockResolvedValue({ _key: 'cat-1' }),
    document: jest.fn().mockResolvedValue({ _key: 'cat-1', nameEN: 'Test' }),
    remove: jest.fn().mockResolvedValue({ _key: 'cat-1' })
  };
}

function createMockCursor(results) {
  return {
    next: jest.fn().mockResolvedValue(results.length > 0 ? results[0] : null),
    all: jest.fn().mockResolvedValue(results)
  };
}

// The GC query's payload-key list is its second-to-last bind (the template
// ends on the collection handle): `... NOT IN ${keys} REMOVE ... IN ${coll}`.
function gcKeys(callIndex) {
  return mockDb.query.mock.calls[callIndex][0].values.at(-2);
}

let service;
let mockDb;
let mockServiceCategories;
let mockServices;
let mockCategoryServices;
let mockServiceCategoryTranslations;
let mockServiceTranslations;
let mockErrors;

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
    // The service is loaded in an isolated registry, so the error classes it
    // sees are NOT the ones the outer registry holds: `instanceof` across
    // the two boundaries is false. Capture them from inside the isolation.
    mockErrors = require('../../middleware/errors');
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
      // A lookup that re-created the collection on every access would leave
      // the service writing to a handle no test can reach.
      expect(mockDb.collection).toHaveBeenCalledTimes(5);
      expect(service.initialized).toBe(true);
    });

    it('should skip re-initialization', async () => {
      service.initialized = true;
      await service.init();
      expect(dbService.getConnection).toHaveBeenCalledTimes(1);
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

    it('rejects malformed translations without creating the service or its edge', async () => {
      await expect(
        service.createServiceWithTranslations('cat-1', {
          nameEN: 'New Service',
          translations: [{ lang: 'fr', text: 'Nouveau' }]
        })
      ).rejects.toThrow('unexpected shape');
      expect(mockServices.save).not.toHaveBeenCalled();
      expect(mockCategoryServices.save).not.toHaveBeenCalled();
    });

    it('rejects a nonexistent parent category with a typed 404 before saving anything', async () => {
      mockServiceCategories.document.mockRejectedValue(
        Object.assign(new Error('document not found'), { code: 404, errorNum: 1202 })
      );

      try {
        await service.createServiceWithTranslations('ghost-cat', { nameEN: 'New Service' });
        throw new Error('should have thrown');
      } catch (e) {
        expect(e.name).toBe('NotFoundError');
        expect(e.statusCode).toBe(404);
      }
      expect(mockServices.save).not.toHaveBeenCalled();
      expect(mockCategoryServices.save).not.toHaveBeenCalled();
    });

    it('rethrows non-404 parent-check errors instead of misreporting a 404', async () => {
      mockServiceCategories.document.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 503 }));

      await expect(service.createServiceWithTranslations('cat-1', { nameEN: 'New Service' })).rejects.toThrow(
        'ECONNREFUSED'
      );
      expect(mockServices.save).not.toHaveBeenCalled();
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
      // The parent update runs BEFORE the translation write: the GC pass
      // removes rows, so a failure after it must not have rows already
      // gone (a failed save must leave the old rows intact).
      expect(mockServices.update.mock.invocationCallOrder[0]).toBeLessThan(mockDb.query.mock.invocationCallOrder[0]);
      // One upsert round trip carries the EN row and the payload rows.
      const docs = mockDb.query.mock.calls[0][0].values[0];
      expect(docs).toHaveLength(2);
      expect(docs[0]).toEqual(
        expect.objectContaining({ _key: 'svc-1_EN', languageCode: 'EN', translation: 'Updated' })
      );
      expect(docs[1]).toEqual(
        expect.objectContaining({ _key: 'svc-1_FR', languageCode: 'FR', translation: 'Mis a jour' })
      );
    });

    it('sets createdAt on INSERT only — the UPDATE half never touches it', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));

      await service.updateServiceWithTranslations('svc-1', {
        nameEN: 'Updated',
        translations: [{ languageCode: 'fr', translation: 'Mis a jour' }]
      });

      const text = mockDb.query.mock.calls[0][0].strings.join('|');
      // The INSERT half assigns both timestamps; the UPDATE half is pinned
      // to exactly translation/isActive/updatedAt — the creation timestamp
      // of an existing row must survive every edit of its owner.
      expect(text).toMatch(/INSERT\s+MERGE\(doc,\s*\{\s*createdAt:/);
      expect(text).toMatch(/UPDATE\s*\{\s*translation:\s*doc\.translation,\s*isActive:\s*true,\s*updatedAt:/);
    });

    it('removes rows the payload no longer carries, keeping the payload keys', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));

      await service.updateServiceWithTranslations('svc-1', {
        nameEN: 'Updated',
        translations: [{ languageCode: 'fr', translation: 'Mis a jour' }]
      });

      // Upsert round trip + GC round trip.
      expect(mockDb.query).toHaveBeenCalledTimes(2);
      const gc = mockDb.query.mock.calls[1][0];
      expect(gc.strings.join('|')).toMatch(/REMOVE/);
      expect(gcKeys(1)).toEqual(['svc-1_EN', 'svc-1_FR']);
    });

    it('stores a trimmed nameEN on the parent document and the EN translation', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));

      await service.updateServiceWithTranslations('svc-1', {
        nameEN: '  Padded Name  ',
        translations: [{ languageCode: 'fr', translation: 'Mis a jour' }]
      });

      expect(mockServices.update).toHaveBeenCalledWith('svc-1', { nameEN: 'Padded Name' });
      const docs = mockDb.query.mock.calls[0][0].values[0];
      expect(docs[0]).toEqual(expect.objectContaining({ languageCode: 'EN', translation: 'Padded Name' }));
    });

    it('should throw ValidationError when nameEN is missing', async () => {
      await expect(service.updateServiceWithTranslations('svc-1', {})).rejects.toThrow('nameEN is required');
      expect(mockServices.update).not.toHaveBeenCalled();
    });

    it('rejects entries that use the read shape {lang, text} before mutating', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));

      await expect(
        service.updateServiceWithTranslations('svc-1', {
          nameEN: 'Updated',
          translations: [{ lang: 'fr', text: 'Mis a jour' }]
        })
      ).rejects.toThrow('unexpected shape');

      // no mutation at all: the EN upsert and the REMOVE must not run
      expect(mockDb.query).not.toHaveBeenCalled();
      // ... and the parent document must not be renamed either
      expect(mockServices.update).not.toHaveBeenCalled();
    });

    it('should reject a null translation entry before mutating anything', async () => {
      await expect(
        service.updateServiceWithTranslations('svc-1', {
          nameEN: 'Updated',
          translations: [{ languageCode: 'fr', translation: 'a' }, null]
        })
      ).rejects.toThrow('unexpected shape');
      expect(mockDb.query).not.toHaveBeenCalled();
      expect(mockServices.update).not.toHaveBeenCalled();
    });

    it('should accept valid entries and trim the language code', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));

      const result = await service.updateServiceWithTranslations('svc-1', {
        nameEN: 'Updated',
        translations: [{ languageCode: ' fr ', translation: 'Mis a jour' }]
      });

      expect(result.status).toBe('updated');
      const docs = mockDb.query.mock.calls[0][0].values[0];
      expect(docs[1]).toEqual(expect.objectContaining({ _key: 'svc-1_FR', languageCode: 'FR' }));
    });

    it('should throw when service does not exist', async () => {
      mockServices.document.mockRejectedValue(new Error('Not found'));

      await expect(service.updateServiceWithTranslations('missing', { nameEN: 'Test' })).rejects.toThrow('Not found');
    });

    it('answers 404-class existence before payload validation', async () => {
      mockServices.document.mockRejectedValue(new Error('Not found'));

      await expect(
        service.updateServiceWithTranslations('missing', {
          nameEN: 'Test',
          translations: [{ lang: 'fr', text: 'bad shape' }]
        })
      ).rejects.toThrow('Not found');
    });

    it('answers typed 404 when the service disappears between the check and the parent update', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));
      mockServices.update.mockRejectedValue(
        Object.assign(new Error('document not found'), { code: 404, errorNum: 1202 })
      );

      try {
        await service.updateServiceWithTranslations('svc-1', { nameEN: 'Test' });
        throw new Error('should have thrown');
      } catch (e) {
        // A raw driver 404 would render a 500; the race must answer the
        // same typed 404 deleteService answers.
        expect(e.name).toBe('NotFoundError');
        expect(e.statusCode).toBe(404);
      }
    });

    it.each([
      ['a typed 404', 'NotFoundError'],
      ['a typed 400', 'ValidationError']
    ])('re-throws %s untouched — the driver predicate must not claim it', async (_, kind) => {
      // A typed error whose message the canonical predicate would also read
      // as an absence: re-classifying it would rebuild the error (a 400
      // would even become a 404) and replace its message. It must reach
      // the caller as it is.
      const typed = new mockErrors[kind]('no match');
      mockServices.update.mockRejectedValue(typed);

      await expect(service.updateServiceWithTranslations('svc-1', { nameEN: 'Test' })).rejects.toBe(typed);
    });

    // One contract, three shapes of the driver error: a missing row and the
    // 3.12 simple-query miss are absences (typed 404), a missing collection
    // is a real fault that must not be reported as "no such document".
    [
      {
        label: 'a missing row (errorNum 1202)',
        error: Object.assign(new Error('document not found'), { code: 404, errorNum: 1202 }),
        absent: true
      },
      {
        label: "the ArangoDB 3.12 'no match' miss (errorNum 404)",
        error: Object.assign(new Error('no match'), { code: 404, errorNum: 404 }),
        absent: true
      },
      {
        label: 'a missing collection (errorNum 1203)',
        error: Object.assign(new Error('collection not found'), { code: 404, errorNum: 1203 }),
        absent: false
      }
    ].forEach(({ label, error, absent }) => {
      it(`classifies ${label} as ${absent ? 'an absence' : 'a real fault'}`, async () => {
        mockServices.document.mockRejectedValue(error);

        try {
          await service.updateServiceWithTranslations('svc-1', { nameEN: 'Test' });
          throw new Error('should have thrown');
        } catch (e) {
          if (absent) {
            expect(e.name).toBe('NotFoundError');
            expect(e.statusCode).toBe(404);
          } else {
            expect(e.name).not.toBe('NotFoundError');
            expect(e.message).toBe(error.message);
          }
        }
      });
    });

    it('rejects non-string translation values before mutating', async () => {
      await expect(
        service.updateServiceWithTranslations('svc-1', {
          nameEN: 'Updated',
          translations: [{ languageCode: 'fr', translation: 123 }]
        })
      ).rejects.toThrow('unexpected shape');
      expect(mockDb.query).not.toHaveBeenCalled();
      expect(mockServices.update).not.toHaveBeenCalled();
    });

    it('rejects duplicate language codes that differ only in case or whitespace', async () => {
      await expect(
        service.updateServiceWithTranslations('svc-1', {
          nameEN: 'Updated',
          translations: [
            { languageCode: 'fr', translation: 'A' },
            { languageCode: ' FR ', translation: 'B' }
          ]
        })
      ).rejects.toThrow('Duplicate languageCode');
      expect(mockDb.query).not.toHaveBeenCalled();
      expect(mockServices.update).not.toHaveBeenCalled();
    });

    it('preserves existing translations when the payload omits the translations field', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));

      await service.updateServiceWithTranslations('svc-1', { nameEN: 'Renamed' });

      // The EN upsert only — no GC pass runs.
      expect(mockDb.query).toHaveBeenCalledTimes(1);
      expect(mockDb.query.mock.calls[0][0].values[0]).toHaveLength(1);
    });

    it('treats an explicit empty translations array as clear-all', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));

      await service.updateServiceWithTranslations('svc-1', { nameEN: 'Renamed', translations: [] });

      // Upsert (EN row only) + GC removing every non-EN row of the owner.
      expect(mockDb.query).toHaveBeenCalledTimes(2);
      expect(gcKeys(1)).toEqual(['svc-1_EN']);
    });

    it('rejects an EN entry — the English name is owned by nameEN', async () => {
      await expect(
        service.updateServiceWithTranslations('svc-1', {
          nameEN: 'Tax Filing',
          translations: [{ languageCode: 'en', translation: 'Impots' }]
        })
      ).rejects.toThrow("must not include 'EN'");
      // no mutation at all: validation must reject before the upsert runs
      expect(mockDb.query).not.toHaveBeenCalled();
      expect(mockServices.update).not.toHaveBeenCalled();
    });
  });

  describe('categoryExists', () => {
    it('should return true when category exists', async () => {
      const result = await service.categoryExists('cat-1');
      expect(result).toBe(true);
    });

    it('should return false for a canonical absence (driver document-not-found)', async () => {
      // The classifier's own shapes (1204, the 3.12 no-match) are covered
      // at their owner: shared/lib/__tests__/db-connection-service.test.js.
      mockServiceCategories.document.mockRejectedValue(
        Object.assign(new Error('document not found'), { code: 404, errorNum: 1202 })
      );

      const result = await service.categoryExists('missing');
      expect(result).toBe(false);
    });

    it('rethrows a missing-collection error (1203) instead of answering "does not exist"', async () => {
      // A missing/misnamed collection also carries HTTP 404 (errorNum 1203).
      // Classifying it as "the category does not exist" renders a broken
      // deployment as an ordinary missing resource.
      mockServiceCategories.document.mockRejectedValue(
        Object.assign(new Error('collection or index not found'), { code: 404, errorNum: 1203 })
      );

      await expect(service.categoryExists('cat-1')).rejects.toThrow('collection or index not found');
    });

    it('rethrows a DB outage instead of answering "does not exist" (a 404 would lie)', async () => {
      mockServiceCategories.document.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 503 }));

      await expect(service.categoryExists('cat-1')).rejects.toThrow('ECONNREFUSED');
    });

    it('should return false when the adapter resolves a missing row as undefined', async () => {
      // The ArcadeDB adapter resolves absence instead of raising — the same
      // shape _documentOr404 defends against in this file.
      mockServiceCategories.document.mockResolvedValue(undefined);

      const result = await service.categoryExists('phantom');
      expect(result).toBe(false);
    });

    it('should return false when categoryKey is missing', async () => {
      const result = await service.categoryExists(null);
      expect(result).toBe(false);
    });

    it('initializes the service before the check (a fresh instance holds no collection yet)', async () => {
      // Every other method of the service initializes first; without it the
      // check dereferences a null collection — a TypeError the caller would
      // report as a server fault.
      service.initialized = false;
      service.serviceCategories = null;

      const result = await service.categoryExists('cat-1');

      expect(result).toBe(true);
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
    it('answers typed 404 when the category disappears between the check and the remove', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));
      mockServiceCategories.remove.mockRejectedValue(
        Object.assign(new Error('document not found'), { code: 404, errorNum: 1202 })
      );

      try {
        await service.deleteCategory('cat-1');
        throw new Error('should have thrown');
      } catch (e) {
        // The same race deleteService classifies: without the canonical
        // predicate the raw driver 404 would reach the client as a 500.
        expect(e.name).toBe('NotFoundError');
        expect(e.statusCode).toBe(404);
        expect(e.cause).toMatchObject({ errorNum: 1202 });
      }
    });

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
      await expect(service.deleteService(null)).rejects.toThrow('Invalid service key provided');
    });

    it('should handle delete errors', async () => {
      mockDb.query.mockRejectedValue(new Error('Delete failed'));
      await expect(service.deleteService('svc-1')).rejects.toThrow('Delete failed');
    });

    it('answers typed 404 when the service disappears between the check and the remove', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));
      mockServices.remove.mockRejectedValue(
        Object.assign(new Error('document not found'), { code: 404, errorNum: 1202 })
      );

      try {
        await service.deleteService('svc-1');
        throw new Error('should have thrown');
      } catch (e) {
        expect(e.name).toBe('NotFoundError');
        expect(e.statusCode).toBe(404);
        // The race verdict rides on the typed error: "vanished between the
        // check and the remove" must stay distinguishable from a probe of
        // an id that never existed.
        expect(e.cause).toMatchObject({ errorNum: 1202 });
      }
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
          { lang: 'en', text: 'Taxes' },
          { lang: 'fr', text: 'Impots' }
        ])
      );

      const result = await service.getCategoryTranslations('cat-1');
      expect(result).toEqual([
        { lang: 'en', text: 'Taxes' },
        { lang: 'fr', text: 'Impots' }
      ]);
    });

    it('answers a typed 404 for an unknown category id — same contract as the write paths', async () => {
      mockServiceCategories.document.mockRejectedValue(
        Object.assign(new Error('document not found'), { code: 404, errorNum: 1202 })
      );

      try {
        await service.getCategoryTranslations('ghost-cat');
        throw new Error('should have thrown');
      } catch (e) {
        expect(e.name).toBe('NotFoundError');
        expect(e.statusCode).toBe(404);
      }
      // The translations query must not run for a category that does not exist.
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    it('rethrows non-absence existence-check errors instead of misreporting a 404', async () => {
      // A DB outage (or a missing collection) must surface as the fault it
      // is, not as "Category x not found" — the exact looseness the
      // canonical absence classifier documents as the historical bug.
      mockServiceCategories.document.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 503 }));

      await expect(service.getCategoryTranslations('cat-1')).rejects.toThrow('ECONNREFUSED');
    });

    it('stays silent for a typed 404 — the route layer owns that one log line', async () => {
      mockServiceCategories.document.mockRejectedValue(
        Object.assign(new Error('document not found'), { code: 404, errorNum: 1202 })
      );

      await expect(service.getCategoryTranslations('ghost-cat')).rejects.toMatchObject({ statusCode: 404 });

      // An expected absence is not a fault: logging it here would double
      // the line the route already writes. The assertion is scoped to this
      // subject — another part of the path may legitimately log an error.
      const errorCalls = logger.error.mock.calls.filter((call) => String(call[0]).includes('ghost-cat'));
      expect(errorCalls).toHaveLength(0);
    });

    it('logs a genuine fault at error grade, with its stack', async () => {
      mockServiceCategories.document.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 503 }));

      await expect(service.getCategoryTranslations('cat-1')).rejects.toThrow('ECONNREFUSED');

      const errorCalls = logger.error.mock.calls.filter((call) => String(call[0]).includes('cat-1'));
      expect(errorCalls).toHaveLength(1);
      expect(errorCalls[0][1]).toHaveProperty('stack');
    });

    it('throws a ValidationError when categoryKey is missing', async () => {
      await expect(service.getCategoryTranslations(null)).rejects.toMatchObject({
        name: 'ValidationError',
        statusCode: 400,
        message: 'Invalid category key provided'
      });
    });
  });

  describe('getServiceTranslations', () => {
    it('should return translations for a service', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([{ lang: 'en', text: 'Tax Filing' }]));

      const result = await service.getServiceTranslations('svc-1');
      expect(result).toHaveLength(1);
    });

    it('answers a typed 404 for an unknown service id — same contract as the write paths', async () => {
      mockServices.document.mockRejectedValue(
        Object.assign(new Error('document not found'), { code: 404, errorNum: 1202 })
      );

      try {
        await service.getServiceTranslations('ghost-svc');
        throw new Error('should have thrown');
      } catch (e) {
        expect(e.name).toBe('NotFoundError');
        expect(e.statusCode).toBe(404);
      }
      expect(mockDb.query).not.toHaveBeenCalled();
    });

    it('rethrows non-absence existence-check errors instead of misreporting a 404', async () => {
      mockServices.document.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 503 }));

      await expect(service.getServiceTranslations('svc-1')).rejects.toThrow('ECONNREFUSED');
    });

    it('throws a ValidationError when serviceKey is missing', async () => {
      await expect(service.getServiceTranslations(null)).rejects.toMatchObject({
        name: 'ValidationError',
        statusCode: 400,
        message: 'Invalid service key provided'
      });
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

    it('rejects malformed translations without creating the category', async () => {
      await expect(
        service.createCategory({
          nameEN: 'New Category',
          translations: [{ lang: 'fr', text: 'Nouvelle' }]
        })
      ).rejects.toThrow('unexpected shape');
      expect(mockServiceCategories.save).not.toHaveBeenCalled();
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
      const docs = mockDb.query.mock.calls[0][0].values[0];
      expect(docs).toHaveLength(2);
      expect(docs[0]).toEqual(
        expect.objectContaining({ _key: 'cat-1_EN', languageCode: 'EN', translation: 'Updated' })
      );
      expect(docs[1]).toEqual(expect.objectContaining({ _key: 'cat-1_FR', languageCode: 'FR' }));
      expect(mockServiceCategories.update).toHaveBeenCalledWith('cat-1', { nameEN: 'Updated' });
    });

    it('should throw ValidationError when nameEN is missing', async () => {
      await expect(service.updateCategoryWithTranslations('cat-1', { nameEN: '' })).rejects.toThrow(
        'nameEN is required'
      );
      expect(mockServiceCategories.update).not.toHaveBeenCalled();
    });

    it('should reject entries that use the read shape {lang, text} before mutating', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));

      await expect(
        service.updateCategoryWithTranslations('cat-1', {
          nameEN: 'Updated',
          translations: [{ lang: 'fr', text: 'Mis a jour' }]
        })
      ).rejects.toThrow('unexpected shape');

      expect(mockDb.query).not.toHaveBeenCalled();
      expect(mockServiceCategories.update).not.toHaveBeenCalled();
    });

    it('rejects non-string translation values before mutating', async () => {
      await expect(
        service.updateCategoryWithTranslations('cat-1', {
          nameEN: 'Updated',
          translations: [{ languageCode: 'fr', translation: 123 }]
        })
      ).rejects.toThrow('unexpected shape');
      expect(mockDb.query).not.toHaveBeenCalled();
      expect(mockServiceCategories.update).not.toHaveBeenCalled();
    });

    it('rejects duplicate language codes that differ only in case or whitespace', async () => {
      await expect(
        service.updateCategoryWithTranslations('cat-1', {
          nameEN: 'Updated',
          translations: [
            { languageCode: 'fr', translation: 'A' },
            { languageCode: ' FR ', translation: 'B' }
          ]
        })
      ).rejects.toThrow('Duplicate languageCode');
      expect(mockDb.query).not.toHaveBeenCalled();
      expect(mockServiceCategories.update).not.toHaveBeenCalled();
    });

    it('preserves existing translations when the payload omits the translations field', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));

      await service.updateCategoryWithTranslations('cat-1', { nameEN: 'Renamed' });

      // The EN upsert only — no GC pass runs.
      expect(mockDb.query).toHaveBeenCalledTimes(1);
      expect(mockDb.query.mock.calls[0][0].values[0]).toHaveLength(1);
    });

    it('treats an explicit empty translations array as clear-all', async () => {
      mockDb.query.mockResolvedValue(createMockCursor([]));

      await service.updateCategoryWithTranslations('cat-1', { nameEN: 'Renamed', translations: [] });

      // Upsert (EN row only) + GC removing every non-EN row of the owner.
      expect(mockDb.query).toHaveBeenCalledTimes(2);
      expect(gcKeys(1)).toEqual(['cat-1_EN']);
    });
  });
});
