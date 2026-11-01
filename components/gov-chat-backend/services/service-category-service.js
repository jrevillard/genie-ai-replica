require('dotenv').config();
const { aql } = require('arangojs');
const { logger, dbService } = require('../shared-lib');
const { NotFoundError, ValidationError } = require('../middleware/errors');

class ServiceCategoryService {
  constructor() {
    logger.info('ServiceCategoryService constructor called');
    this.db = null;
    this.serviceCategories = null;
    this.services = null;
    this.categoryServices = null;
    this.serviceCategoryTranslations = null;
    this.serviceTranslations = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) {
      logger.debug('ServiceCategoryService already initialized, skipping');
      return;
    }
    try {
      this.db = await dbService.getConnection('default');
      this.serviceCategories = this.db.collection('serviceCategories');
      this.services = this.db.collection('services');
      this.categoryServices = this.db.collection('categoryServices');
      this.serviceCategoryTranslations = this.db.collection('serviceCategoryTranslations');
      this.serviceTranslations = this.db.collection('serviceTranslations');
      this.initialized = true;
      logger.info('ServiceCategoryService initialized successfully with translation collections');
    } catch (error) {
      logger.error(`Error initializing ServiceCategoryService: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Helper method to get translated name for a document
   * @param {String} collectionType - 'category' or 'service'
   * @param {String} documentId - Document ID/key
   * @param {String} locale - Locale code (e.g., 'en', 'fr', 'sw')
   * @returns {Promise<String|null>} Translated name or null if not found
   */
  async _getTranslatedName(collectionType, documentId, locale) {
    try {
      const upperLocale = locale.toUpperCase();
      logger.debug(`Getting ${collectionType} translation for ${documentId} in ${upperLocale}`);

      let query;
      if (collectionType === 'category') {
        query = aql`
          FOR trans IN serviceCategoryTranslations
            FILTER trans.serviceCategoryId == ${documentId}
            FILTER LOWER(trans.languageCode) == LOWER(${upperLocale})
            RETURN trans.translation
        `;
      } else if (collectionType === 'service') {
        query = aql`
          FOR trans IN serviceTranslations
            FILTER trans.serviceId == ${documentId}
            FILTER LOWER(trans.languageCode) == LOWER(${upperLocale})
            RETURN trans.translation
        `;
      } else {
        logger.error(`Invalid collection type: ${collectionType}`);
        return null;
      }

      const cursor = await this.db.query(query);
      const result = await cursor.next();

      if (!result) {
        logger.warn(`No translation found for ${collectionType} ${documentId} in ${upperLocale}`);
        return null;
      }

      logger.debug(`Translation found for ${collectionType} ${documentId}: ${result}`);
      return result;
    } catch (error) {
      logger.error(`Error getting translated name for ${collectionType} ${documentId}: ${error.message}`, {
        stack: error.stack
      });
      return null;
    }
  }

  /**
   * Create or update service categories from the tree panel component
   * @param {Array} categories - Array of category objects
   * @param {String} locale - Locale code (e.g., 'en', 'fr', 'sw')
   * @returns {Promise<Array>} The created/updated categories
   */
  async upsertCategories(categories, locale = 'en') {
    try {
      // This part remains the same
      const upperLocale = locale.toUpperCase();
      logger.info(`Upserting ${categories.length} categories for locale ${upperLocale}`);
      const results = [];

      for (let i = 0; i < categories.length; i++) {
        const categoryData = categories[i];
        // ... (skipping invalid category checks) ...

        const categoryName = categoryData.name || `Category ${i + 1}`;
        const categoryDoc = {
          catCode: categoryData.catKey || `cat${i + 1}`,
          order: i + 1,
          nameEN: categoryName
        };

        const newCategory = await this.serviceCategories.save(categoryDoc);
        results.push(newCategory);
        logger.info(`Category created successfully with key: ${newCategory._key}`);

        // --- START OF MODIFICATIONS ---

        // 1. Save the primary English translation
        const englishTranslationDoc = {
          _key: `${newCategory._key}_${upperLocale}`,
          serviceCategoryId: newCategory._key,
          languageCode: upperLocale,
          translation: categoryName,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        await this.serviceCategoryTranslations.save(englishTranslationDoc, { overwrite: true });
        logger.info(`Saved English translation for category ${newCategory._key}`);

        // 2. Loop through and save the other translations if they exist
        if (categoryData.translations && Array.isArray(categoryData.translations)) {
          logger.info(`Processing ${categoryData.translations.length} additional translations.`);
          for (const trans of categoryData.translations) {
            if (trans.languageCode && trans.translation) {
              const transLocale = String(trans.languageCode).toUpperCase();
              const translationKey = `${newCategory._key}_${transLocale}`;
              const translationDoc = {
                _key: translationKey,
                serviceCategoryId: newCategory._key,
                languageCode: transLocale,
                translation: trans.translation,
                isActive: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              };
              await this.serviceCategoryTranslations.save(translationDoc, { overwrite: true });
              logger.info(`Saved ${transLocale} translation for category ${newCategory._key}`);
            }
          }
        }

        // --- END OF MODIFICATIONS ---

        // Handle children (services) - this part remains the same
        if (categoryData.children && Array.isArray(categoryData.children)) {
          // ... (existing children/services logic) ...
        }
      }

      logger.info(`Categories upserted successfully`);
      return results;
    } catch (error) {
      logger.error(`Error upserting categories: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Create or update services for a category
   * @param {String} categoryKey - Category key
   * @param {Array} services - Array of service names
   * @param {String} locale - Locale code (e.g., 'en', 'fr', 'sw')
   * @returns {Promise<Array>} The created/updated services
   */
  async upsertServices(categoryKey, services, locale = 'en') {
    try {
      const upperLocale = locale.toUpperCase();
      logger.info(
        `Starting upsertServices for category ${categoryKey} with ${services.length} services in locale ${upperLocale}`
      );
      const results = [];

      if (!categoryKey) {
        logger.error('Invalid category key provided');
        return [];
      }

      if (!Array.isArray(services)) {
        logger.error(`Invalid services array: ${JSON.stringify(services)}`);
        return [];
      }

      for (let i = 0; i < services.length; i++) {
        const serviceName = String(services[i] || '').trim();
        if (!serviceName) {
          logger.warn(`Skipping empty service at index ${i}`);
          continue;
        }

        logger.info(`Processing service ${i + 1}/${services.length}: "${serviceName}"`);

        try {
          // Create service document with nameEN for query-service compatibility
          const serviceDoc = {
            serviceCode: `service_${i + 1}`,
            categoryId: categoryKey,
            order: i + 1,
            nameEN: serviceName
          };

          logger.info(`Creating service with serviceCode: ${serviceDoc.serviceCode}`);
          const newService = await this.services.save(serviceDoc);
          results.push(newService);
          logger.info(`Service created successfully with key ${newService._key}`);

          // Create or update translation
          const translationKey = `${newService._key}_${upperLocale}`;
          const translationDoc = {
            _key: translationKey,
            serviceId: newService._key,
            languageCode: upperLocale,
            translation: serviceName,
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };

          logger.info(`Creating/updating translation for service ${newService._key} in ${upperLocale}`);
          try {
            await this.serviceTranslations.save(translationDoc, { overwrite: true });
            logger.info(`Translation created/updated successfully for service ${newService._key}`);
          } catch (transError) {
            logger.error(`Error creating translation for service ${newService._key}: ${transError.message}`, {
              stack: transError.stack
            });
          }

          // Create edge
          const edgeDoc = {
            _from: `serviceCategories/${categoryKey}`,
            _to: `services/${newService._key}`,
            order: i + 1
          };

          logger.info(`Creating edge for service "${serviceName}"`);
          await this.categoryServices.save(edgeDoc);
          logger.info(`Edge created successfully for service "${serviceName}"`);
        } catch (createError) {
          logger.error(`Error creating service "${serviceName}": ${createError.message}`, { stack: createError.stack });
        }
      }

      logger.info(
        `Services processed successfully for category ${categoryKey}: ${results.length}/${services.length} services`
      );
      return results;
    } catch (error) {
      logger.error(`Error upserting services for category ${categoryKey}: ${error.message}`, { stack: error.stack });
      return [];
    }
  }

  /**
   * Creates a single service under a category with its translations.
   * @param {String} categoryKey - The _key of the parent category.
   * @param {Object} payload - The service data { nameEN, translations }.
   * @returns {Promise<Object>} The newly created service document.
   */
  async createServiceWithTranslations(categoryKey, payload) {
    await this.init();
    try {
      if (!payload.nameEN || typeof payload.nameEN !== 'string' || payload.nameEN.trim() === '') {
        throw new ValidationError('nameEN is required and must be a non-empty string');
      }
      // Validate before any write: a rejected payload must not leave a
      // half-created service (or its category edge) behind. The parent
      // category must exist too — the edge save would otherwise fail after
      // the service document was already written. Direct document read (not
      // categoryExists) so a DB outage surfaces as 5xx, not a fake 404.
      await this._documentOr404(this.serviceCategories, categoryKey, 'Category');
      this._validateTranslationsPayload(payload.translations);
      logger.info(`Creating service "${payload.nameEN}" under category ${categoryKey}`);

      // 1. Get the current maximum order number for services IN THIS CATEGORY
      const cursor = await this.db.query(aql`
        FOR edge IN categoryServices
          FILTER edge._from == ${'serviceCategories/' + categoryKey}
          COLLECT AGGREGATE maxOrder = MAX(edge.order)
          RETURN maxOrder
      `);
      const maxOrder = (await cursor.next()) || 0;
      const newOrder = maxOrder + 1;
      logger.info(`Determined new service order: ${newOrder}`);

      // 2. Create the main service document
      const serviceDoc = {
        categoryId: categoryKey,
        nameEN: payload.nameEN.trim()
      };
      const newService = await this.services.save(serviceDoc);
      logger.info(`Service document created with key: ${newService._key}`);

      // 3. Create the edge with the correct order
      const edgeDoc = {
        _from: `serviceCategories/${categoryKey}`,
        _to: `services/${newService._key}`,
        order: newOrder // Set the correct order here
      };
      await this.categoryServices.save(edgeDoc);
      logger.info(`Edge created from category ${categoryKey} to service ${newService._key} with order ${newOrder}`);

      // 4. Save all translations
      await this.updateServiceWithTranslations(newService._key, payload);

      return newService;
    } catch (error) {
      logger.error(`Error creating service under category ${categoryKey}: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Validates the translations array of a write payload BEFORE any mutation.
   * The update paths are delete-then-rebuild: a malformed entry that only
   * surfaces mid-loop would leave the old translations deleted, so the whole
   * array is checked up front and bad entries reject the request.
   * @param {*} translations - The payload translations array (optional).
   */
  _validateTranslationsPayload(translations) {
    if (translations === undefined || translations === null) {
      return;
    }
    if (!Array.isArray(translations)) {
      throw new ValidationError('translations must be an array of {languageCode, translation}');
    }
    const seenLocales = new Set();
    for (let i = 0; i < translations.length; i++) {
      const trans = translations[i];
      if (
        !trans ||
        typeof trans !== 'object' ||
        typeof trans.languageCode !== 'string' ||
        !trans.languageCode.trim() ||
        typeof trans.translation !== 'string' ||
        !trans.translation.trim()
      ) {
        const keys = trans && typeof trans === 'object' ? Object.keys(trans).join(',') : typeof trans;
        throw new ValidationError(
          `Translation entry ${i} has an unexpected shape (expected {languageCode, translation}, got keys: ${keys})`
        );
      }
      const locale = this._normalizeLocale(trans.languageCode);
      // Same normalized code = same stored _key: the second entry would
      // silently overwrite the first via overwrite:true.
      if (seenLocales.has(locale)) {
        throw new ValidationError(`Duplicate languageCode '${locale}' in translations`);
      }
      // The English name is owned by the nameEN field of the same payload;
      // an EN entry here would silently overwrite it and desync the parent.
      if (locale === 'EN') {
        throw new ValidationError("translations must not include 'EN' — the English name is owned by nameEN");
      }
      seenLocales.add(locale);
    }
  }

  /**
   * Normalizes a language code to its stored form. The storage key of a
   * translation is `${ownerKey}_${LOCALE}`, so the validator's duplicate
   * detection and the document builder MUST normalize identically.
   * @param {String} code - The raw language code.
   * @returns {String} The uppercased, trimmed code.
   */
  _normalizeLocale(code) {
    return code.trim().toUpperCase();
  }

  /**
   * Builds a translation document for the given owner (category or service).
   * @param {String} ownerKey - The _key of the owning category or service.
   * @param {String} fkField - The foreign-key field name ('serviceCategoryId' or 'serviceId').
   * @param {Object} trans - A validated {languageCode, translation} entry.
   * @returns {Object} The translation document to save.
   */
  _buildTranslationDoc(ownerKey, fkField, trans) {
    const transLocale = this._normalizeLocale(trans.languageCode);
    const now = new Date().toISOString();
    return {
      _key: `${ownerKey}_${transLocale}`,
      [fkField]: ownerKey,
      languageCode: transLocale,
      translation: trans.translation.trim(),
      isActive: true,
      createdAt: now,
      updatedAt: now
    };
  }

  /**
   * Updates a single service and its translations.
   * @param {String} serviceKey - The _key of the service to update.
   * @param {Object} payload - The service data { nameEN, translations }.
   * @returns {Promise<Object>} The result of the update operation.
   */
  async updateServiceWithTranslations(serviceKey, payload) {
    await this.init();
    try {
      if (!payload.nameEN || typeof payload.nameEN !== 'string' || payload.nameEN.trim() === '') {
        throw new ValidationError('nameEN is required and must be a non-empty string');
      }
      // Existence first: an unknown id must answer 404 even when the
      // payload is also malformed. Validation still runs before any write.
      await this._documentOr404(this.services, serviceKey, 'Service');
      this._validateTranslationsPayload(payload.translations);
      const nameEN = payload.nameEN.trim();
      logger.info(`Updating service ${serviceKey} with name "${nameEN}"`);

      // 2. Update/create the English translation
      const englishTranslationDoc = {
        _key: `${serviceKey}_EN`,
        serviceId: serviceKey,
        languageCode: 'EN',
        translation: nameEN,
        isActive: true,
        updatedAt: new Date().toISOString()
      };
      await this.serviceTranslations.save(englishTranslationDoc, { overwrite: true });
      logger.info(`Upserted English translation for service ${serviceKey}`);

      // 2b. Keep nameEN in sync on the parent service document
      await this.services.update(serviceKey, { nameEN });

      // 3. Clear old non-English translations and save the new set. The
      // REMOVE only runs when the payload carries a translations array —
      // an omitted field means "leave the translations untouched" (an
      // explicit empty array is the clear-all), matching the category path.
      if (payload.translations) {
        await this.db.query(aql`
        FOR trans IN serviceTranslations
          FILTER trans.serviceId == ${serviceKey}
          FILTER trans.languageCode != 'EN'
          REMOVE trans IN serviceTranslations
      `);

        for (const trans of payload.translations) {
          await this.serviceTranslations.save(this._buildTranslationDoc(serviceKey, 'serviceId', trans), {
            overwrite: true
          });
        }
        logger.info(`Processed ${payload.translations.length} additional translations for service ${serviceKey}`);
      }

      return { _key: serviceKey, status: 'updated' };
    } catch (error) {
      logger.error(`Error updating service ${serviceKey}: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Loads a document, converting an arangojs not-found error (which carries
   * `code: 404` but no HTTP statusCode, so the global error middleware would
   * answer 500) into a typed NotFoundError. Non-404 errors propagate.
   * @param {Object} collection - The ArangoDB collection handle.
   * @param {String} key - The document _key.
   * @param {String} label - Resource label for the error message.
   * @returns {Promise<Object>} The document.
   */
  async _documentOr404(collection, key, label) {
    try {
      return await collection.document(key);
    } catch (error) {
      if (error.code === 404) {
        throw new NotFoundError(`${label} ${key} not found`);
      }
      throw error;
    }
  }

  /**
   * Check if a category exists
   * @param {String} categoryKey - Category key
   * @returns {Promise<Boolean>} True if the category exists
   */
  async categoryExists(categoryKey) {
    try {
      logger.info(`Checking if category ${categoryKey} exists`);
      if (!categoryKey) {
        logger.warn('Invalid category key provided');
        return false;
      }

      await this.serviceCategories.document(categoryKey);
      logger.info(`Category existence check successful: ${categoryKey} exists`);
      return true;
    } catch (error) {
      if (error.code === 404) {
        logger.info(`Category existence check: ${categoryKey} does not exist`);
        return false;
      }
      logger.error(`Error checking if category ${categoryKey} exists: ${error.message}`, { stack: error.stack });
      return false;
    }
  }

  /**
   * Get all categories with their services (for public-facing components)
   * @param {String} locale - Locale code (e.g., 'en', 'fr', 'sw')
   * @returns {Promise<Array>} Categories with service name strings.
   */
  async getAllCategoriesWithServices(locale = 'en') {
    await this.init();
    try {
      const upperLocale = locale.toUpperCase();
      logger.info(`Fetching all categories with services for locale ${upperLocale}`);

      const query = aql`
      FOR category IN serviceCategories
        SORT category.order ASC
        LET categoryTranslation = FIRST(
          FOR trans IN serviceCategoryTranslations
            FILTER trans.serviceCategoryId == category._key
            FILTER LOWER(trans.languageCode) == LOWER(${upperLocale})
            RETURN trans.translation
        )
        LET services = (
          FOR edge IN categoryServices
            FILTER edge._from == category._id
            FOR service IN services
              FILTER service._id == edge._to
              LET serviceTranslation = FIRST(
                FOR trans IN serviceTranslations
                  FILTER trans.serviceId == service._key
                  FILTER LOWER(trans.languageCode) == LOWER(${upperLocale})
                  RETURN trans.translation
              )
              SORT edge.order ASC
              RETURN serviceTranslation
        )
        RETURN {
          catKey: category._key,
          catCode: category.catCode,
          name: categoryTranslation,
          children: services
        }
    `;

      const cursor = await this.db.query(query);
      const categories = await cursor.all();
      logger.info(`Categories with services retrieved successfully: ${categories.length} categories`);

      return categories;
    } catch (error) {
      logger.error(`Error getting all categories with services: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  // Add this new method to your ServiceCategoryService class

  /**
   * Get all categories with DETAILED services for the admin panel
   * @param {String} locale - Locale code (e.g., 'en', 'fr', 'sw')
   * @returns {Promise<Array>} Categories with detailed service objects
   */
  async getAdminAllCategoriesWithServices(locale = 'en') {
    await this.init();
    try {
      const upperLocale = locale.toUpperCase();
      logger.info(`Fetching all categories with DETAILED services for admin panel, locale ${upperLocale}`);

      // This query is identical to getAllCategoriesWithServices, except for the final RETURN in the services subquery
      const query = aql`
          FOR category IN serviceCategories
              SORT category.order ASC
              LET categoryTranslation = FIRST(
                  FOR trans IN serviceCategoryTranslations
                      FILTER trans.serviceCategoryId == category._key
                      FILTER LOWER(trans.languageCode) == LOWER(${upperLocale})
                      RETURN trans.translation
              )
              LET services = (
                  FOR edge IN categoryServices
                      FILTER edge._from == category._id
                      FOR service IN services
                          FILTER service._id == edge._to
                          LET serviceTranslation = FIRST(
                              FOR trans IN serviceTranslations
                                  FILTER trans.serviceId == service._key
                                  FILTER LOWER(trans.languageCode) == LOWER(${upperLocale})
                                  RETURN trans.translation
                          )
                          SORT edge.order ASC
                          // This is the key change: return an object with the key and name
                          RETURN {
                              _key: service._key,
                              name: serviceTranslation
                          }
              )
              RETURN {
                  catKey: category._key,
                  catCode: category.catCode,
                  name: categoryTranslation,
                  children: services
              }
      `;

      const cursor = await this.db.query(query);
      const categories = await cursor.all();
      logger.info(`Admin categories with detailed services retrieved successfully: ${categories.length} categories`);
      return categories;
    } catch (error) {
      logger.error(`Error getting all admin categories with services: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Get category with services by key
   * @param {String} categoryKey - Category key
   * @param {String} locale - Locale code (e.g., 'en', 'fr', 'sw')
   * @returns {Promise<Object>} Category with services
   */
  async getCategoryWithServices(categoryKey, locale = 'en') {
    await this.init();
    try {
      const upperLocale = locale.toUpperCase();
      logger.info(`Fetching category ${categoryKey} with services for locale ${upperLocale}`);
      if (!categoryKey) {
        logger.warn('Invalid category key provided');
        throw new Error('Invalid category key');
      }

      const query = aql`
        LET category = DOCUMENT(${`serviceCategories/${categoryKey}`})
        LET categoryTranslation = FIRST(
          FOR trans IN serviceCategoryTranslations
            FILTER trans.serviceCategoryId == category._key
            FILTER LOWER(trans.languageCode) == LOWER(${upperLocale})
            RETURN trans.translation
        )
        LET services = (
          FOR edge IN categoryServices
            FILTER edge._from == ${`serviceCategories/${categoryKey}`}
            FOR service IN services
              FILTER service._id == edge._to
              LET serviceTranslation = FIRST(
                FOR trans IN serviceTranslations
                  FILTER trans.serviceId == service._key
                  FILTER LOWER(trans.languageCode) == LOWER(${upperLocale})
                  RETURN trans.translation
              )
              SORT edge.order ASC
              RETURN serviceTranslation
        )
        RETURN {
          catKey: category._key,
          catCode: category.catCode,
          name: categoryTranslation,
          children: services
        }
      `;

      const cursor = await this.db.query(query);
      const result = await cursor.next();

      if (!result) {
        logger.warn(`Category ${categoryKey} not found`);
        throw new NotFoundError(`Category ${categoryKey} not found`);
      }

      if (!result.name) {
        logger.warn(`Category ${categoryKey} has no translation in ${upperLocale}`);
      }

      logger.info(`Category with services retrieved successfully: ${categoryKey}`);
      return result;
    } catch (error) {
      logger.error(`Error getting category ${categoryKey} with services: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Delete a category and its services
   * @param {String} categoryKey - Category key
   * @returns {Promise<Object>} Deletion result
   */
  async deleteCategory(categoryKey) {
    try {
      logger.info(`Deleting category ${categoryKey} and all related data`);
      if (!categoryKey) {
        logger.warn('Invalid category key provided');
        throw new Error('Invalid category key');
      }

      // Delete all service translations for services in this category
      logger.info(`Deleting service translations for category ${categoryKey}`);
      await this.db.query(aql`
        FOR edge IN categoryServices
          FILTER edge._from == ${`serviceCategories/${categoryKey}`}
          LET service = DOCUMENT(edge._to)
          FOR trans IN serviceTranslations
            FILTER trans.serviceId == service._key
            REMOVE trans IN serviceTranslations
      `);

      // Delete all services and edges
      logger.info(`Deleting services and edges for category ${categoryKey}`);
      await this.db.query(aql`
        FOR edge IN categoryServices
          FILTER edge._from == ${`serviceCategories/${categoryKey}`}
          LET service = DOCUMENT(edge._to)
          REMOVE edge IN categoryServices
          REMOVE service IN services
      `);

      // Delete category translations
      logger.info(`Deleting category translations for category ${categoryKey}`);
      await this.db.query(aql`
        FOR trans IN serviceCategoryTranslations
          FILTER trans.serviceCategoryId == ${categoryKey}
          REMOVE trans IN serviceCategoryTranslations
      `);

      // Delete the category itself
      const result = await this.serviceCategories.remove(categoryKey);
      logger.info(`Category deleted successfully: ${categoryKey}`);
      return result;
    } catch (error) {
      logger.error(`Error deleting category ${categoryKey}: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Deletes a single service and its related data (translations, edges).
   * @param {String} serviceKey - The _key of the service to delete.
   * @returns {Promise<Object>} A confirmation object.
   */
  async deleteService(serviceKey) {
    await this.init();
    try {
      logger.info(`Deleting service ${serviceKey} and all related data`);
      if (!serviceKey) {
        throw new Error('Invalid service key provided');
      }

      // 1. Delete all translations for this service
      await this.db.query(aql`
      FOR trans IN serviceTranslations
        FILTER trans.serviceId == ${serviceKey}
        REMOVE trans IN serviceTranslations
    `);
      logger.info(`Deleted translations for service ${serviceKey}`);

      // 2. Delete the edge connecting the category to this service
      await this.db.query(aql`
      FOR edge IN categoryServices
        FILTER edge._to == ${'services/' + serviceKey}
        REMOVE edge IN categoryServices
    `);
      logger.info(`Deleted edge for service ${serviceKey}`);

      // 3. Delete the service document itself
      await this.services.remove(serviceKey);
      logger.info(`Service document ${serviceKey} deleted successfully`);

      return { _key: serviceKey, status: 'deleted' };
    } catch (error) {
      logger.error(`Error deleting service ${serviceKey}: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Search categories and services
   * @param {String} searchQuery - Search query string
   * @param {String} locale - Locale code (e.g., 'en', 'fr', 'sw')
   * @returns {Promise<Object>} Search results
   */
  async searchCategoriesAndServices(searchQuery, locale = 'en') {
    try {
      const upperLocale = locale.toUpperCase();
      logger.info(`Searching categories and services for query "${searchQuery}" in locale ${upperLocale}`);
      if (!searchQuery) {
        logger.info('No search query provided, returning empty results');
        return { categories: [], services: [] };
      }

      const lowerQuery = String(searchQuery).toLowerCase();

      const query = aql`
        LET matchingCategories = (
          FOR trans IN serviceCategoryTranslations
            FILTER LOWER(trans.languageCode) == LOWER(${upperLocale})
            FILTER LOWER(trans.translation) LIKE ${'%' + lowerQuery + '%'}
            LET category = DOCUMENT(CONCAT('serviceCategories/', trans.serviceCategoryId))
            FILTER category != null
            SORT category.order ASC
            RETURN {
              type: 'category',
              key: category._key,
              name: trans.translation
            }
        )

        LET matchingServices = (
          FOR trans IN serviceTranslations
            FILTER LOWER(trans.languageCode) == LOWER(${upperLocale})
            FILTER LOWER(trans.translation) LIKE ${'%' + lowerQuery + '%'}
            LET service = DOCUMENT(CONCAT('services/', trans.serviceId))
            FILTER service != null
            LET category = DOCUMENT(CONCAT('serviceCategories/', service.categoryId))
            LET categoryTrans = FIRST(
              FOR catTrans IN serviceCategoryTranslations
                FILTER catTrans.serviceCategoryId == service.categoryId
                FILTER LOWER(catTrans.languageCode) == LOWER(${upperLocale})
                RETURN catTrans.translation
            )
            SORT service.order ASC
            RETURN {
              type: 'service',
              key: service._key,
              name: trans.translation,
              categoryKey: service.categoryId,
              categoryName: categoryTrans
            }
        )

        RETURN {
          categories: matchingCategories,
          services: matchingServices
        }
      `;

      const cursor = await this.db.query(query);
      const result = await cursor.next();
      logger.info(
        `Search completed successfully: ${result.categories.length} categories, ${result.services.length} services matching query`
      );
      return result;
    } catch (error) {
      logger.error(`Error searching categories and services for "${searchQuery}": ${error.message}`, {
        stack: error.stack
      });
      return { categories: [], services: [] };
    }
  }

  /**
   * Get all translations for a specific category
   * @param {String} categoryKey - The _key of the category
   * @returns {Promise<Array>} A list of translation objects
   */
  async getCategoryTranslations(categoryKey) {
    await this.init(); // Ensure service is initialized
    try {
      logger.info(`Fetching all translations for category: ${categoryKey}`);
      if (!categoryKey) {
        throw new Error('Invalid category key provided');
      }

      // Query to find all translations for the given serviceCategoryId
      const query = aql`
          FOR trans IN serviceCategoryTranslations
            FILTER trans.serviceCategoryId == ${categoryKey}
            RETURN {
              lang: LOWER(trans.languageCode),
              text: trans.translation
            }
        `;

      const cursor = await this.db.query(query); //
      const translations = await cursor.all();
      logger.info(`Found ${translations.length} translations for category ${categoryKey}`);
      return translations;
    } catch (error) {
      logger.error(`Error fetching translations for category ${categoryKey}: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Get all translations for a specific service
   * @param {String} serviceKey - The _key of the service
   * @returns {Promise<Array>} A list of translation objects
   */
  async getServiceTranslations(serviceKey) {
    await this.init(); // Ensure service is initialized
    try {
      logger.info(`Fetching all translations for service: ${serviceKey}`);
      if (!serviceKey) {
        throw new Error('Invalid service key provided');
      }

      // Query to find all translations for the given serviceId
      const query = aql`
          FOR trans IN serviceTranslations
            FILTER trans.serviceId == ${serviceKey}
            RETURN {
              lang: LOWER(trans.languageCode),
              text: trans.translation
            }
        `;

      const cursor = await this.db.query(query); //
      const translations = await cursor.all();
      logger.info(`Found ${translations.length} translations for service ${serviceKey}`);
      return translations;
    } catch (error) {
      logger.error(`Error fetching translations for service ${serviceKey}: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Creates a single new category, calculating its order to be last.
   * @param {Object} payload - The category data { nameEN, translations }.
   * @returns {Promise<Object>} The newly created category document.
   */
  async createCategory(payload) {
    await this.init();
    try {
      if (!payload.nameEN || typeof payload.nameEN !== 'string' || payload.nameEN.trim() === '') {
        throw new ValidationError('nameEN is required and must be a non-empty string');
      }
      // Validate before any write: a rejected payload must not leave a
      // half-created category behind.
      this._validateTranslationsPayload(payload.translations);
      logger.info(`Creating new category "${payload.nameEN}"`);

      // 1. Get the current maximum order number for categories
      const cursor = await this.db.query(aql`
      FOR c IN serviceCategories
        COLLECT AGGREGATE maxOrder = MAX(c.order)
        RETURN maxOrder
    `);
      const maxOrder = (await cursor.next()) || 0;
      const newOrder = maxOrder + 1;
      logger.info(`Determined new category order: ${newOrder}`);

      // 2. Create the category document with the correct order and nameEN
      const categoryDoc = {
        order: newOrder,
        nameEN: payload.nameEN.trim()
      };
      const newCategory = await this.serviceCategories.save(categoryDoc);

      // 3. Create the English and other translations (same logic as before)
      await this.updateCategoryWithTranslations(newCategory._key, payload);

      return newCategory;
    } catch (error) {
      logger.error(`Error in createCategory: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Updates a single category and its translations.
   * @param {String} categoryKey - The _key of the category to update.
   * @param {Object} payload - The category data { nameEN, translations }.
   * @returns {Promise<Object>} The result of the update operation.
   */
  async updateCategoryWithTranslations(categoryKey, payload) {
    await this.init();
    try {
      if (!payload.nameEN || typeof payload.nameEN !== 'string' || payload.nameEN.trim() === '') {
        throw new ValidationError('nameEN is required and must be a non-empty string');
      }
      // Existence first: an unknown id must answer 404 even when the
      // payload is also malformed. Validation still runs before any write.
      await this._documentOr404(this.serviceCategories, categoryKey, 'Category');
      this._validateTranslationsPayload(payload.translations);
      const nameEN = payload.nameEN.trim();
      logger.info(`Updating category ${categoryKey} with name "${nameEN}"`);

      // 1. Update the main category document (if there are fields to update, otherwise this can be skipped)
      // For now, we'll assume the main document has no fields that change here.

      // 2. Update/create the English translation (upsert)
      const englishTranslationDoc = {
        _key: `${categoryKey}_EN`,
        serviceCategoryId: categoryKey,
        languageCode: 'EN',
        translation: nameEN,
        isActive: true,
        updatedAt: new Date().toISOString()
      };
      await this.serviceCategoryTranslations.save(englishTranslationDoc, { overwrite: true });
      logger.info(`Upserted English translation for category ${categoryKey}`);

      // 2b. Keep nameEN in sync on the parent category document
      await this.serviceCategories.update(categoryKey, { nameEN });

      // 3. Update/create the other translations
      if (payload.translations) {
        // For simplicity, we can remove old translations and add the new set.
        // A more complex implementation could merge changes.
        await this.db.query(aql`
        FOR trans IN serviceCategoryTranslations
          FILTER trans.serviceCategoryId == ${categoryKey}
          FILTER trans.languageCode != 'EN'
          REMOVE trans IN serviceCategoryTranslations
      `);

        for (const trans of payload.translations) {
          await this.serviceCategoryTranslations.save(
            this._buildTranslationDoc(categoryKey, 'serviceCategoryId', trans),
            {
              overwrite: true
            }
          );
        }
        logger.info(`Processed ${payload.translations.length} additional translations for category ${categoryKey}`);
      }

      return { _key: categoryKey, status: 'updated' };
    } catch (error) {
      logger.error(`Error updating category ${categoryKey}: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }
}

// Singleton instance
const instance = new ServiceCategoryService();
module.exports = instance;
