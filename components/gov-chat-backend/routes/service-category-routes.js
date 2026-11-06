const express = require('express');
const { keycloakAuthMiddleware } = require('../middleware/keycloak-auth-middleware');
const { logger } = require('../shared-lib');
const { NotFoundError, isClientError } = require('../middleware/errors');

/**
 * Answers a failed service-category request.
 *
 * A typed client error (`isClientError` — the one predicate, in
 * middleware/errors.js) is an EXPECTED OUTCOME, not a fault: it is logged
 * ONCE, at warn grade and without a stack, and answered here — the
 * service layer stays silent for it, so a client probing ids produces one
 * line per probe instead of a pair of error-grade lines.
 *
 * The response is the typed status code and the typed error's message.
 * The one middleware behaviour this does not reproduce is the verbatim
 * forwarding of a typed error's own `body` — no error on these paths
 * carries one today.
 *
 * The warn line carries the request context the global middleware would
 * have logged (method, url, ip, user agent): an expected 404 is still an
 * event somebody has to triage — which client asked for which id — and the
 * middleware never sees this error, so it cannot supply that context. The
 * `context` argument names the operation without the word "Error": an
 * expected outcome is not an error by wording either, or a grep for it
 * mixes the 404s with the genuine faults.
 *
 * A genuine fault is NOT logged here: it is handed over to the global
 * error middleware, which logs it at error grade with the stack — with the
 * request duration attached, which the middleware would otherwise not
 * know. The service logs the fault too, so a fault currently costs two
 * error-grade lines (the service's own and the middleware's) — settling
 * the single owner is a repo-wide decision, not one this router makes
 * alone.
 *
 * @param {Object} req - The Express request.
 * @param {Object} res - The Express response.
 * @param {Function} next - The Express next callback.
 * @param {Error} error - The caught error.
 * @param {String} context - Log context naming the failed operation.
 * @param {Number} durationMs - Time spent on the request.
 */
function respondWithFailure(req, res, next, error, context, durationMs) {
  if (isClientError(error)) {
    logger.warn(`${context}: ${error.message}`, {
      statusCode: error.statusCode,
      durationMs,
      method: req.method,
      url: req.originalUrl || req.url,
      ip: req.ip,
      userAgent: req.get('User-Agent') || 'none',
      // A race-classified absence carries the driver error that produced
      // it (see _absenceOrRethrow): with it, the line says whether the row
      // was ever there or vanished mid-flight. A probe of an unknown id
      // has none.
      ...(error.cause && error.cause.errorNum != null ? { driverErrorNum: error.cause.errorNum } : {})
    });
    return res.status(error.statusCode).json({ message: error.message });
  }
  // The middleware logs the fault; the duration rides on the error, since
  // the middleware has no other way to know how long the request took.
  error.durationMs = durationMs;
  return next(error);
}

module.exports = (serviceCategoryService) => {
  // One router PER factory call. A module-level router would be mutated on
  // every factory call: the second mount would stack its routes onto the
  // first router, whose handlers close over the FIRST service instance.
  const router = express.Router();

  if (!serviceCategoryService || typeof serviceCategoryService.getAllCategoriesWithServices !== 'function') {
    logger.error('Invalid serviceCategoryService provided to service-category-routes');
    throw new Error('serviceCategoryService is required with getAllCategoriesWithServices');
  }
  logger.debug('serviceCategory-routes initialized with serviceCategoryService');

  router.use(keycloakAuthMiddleware.authenticate);

  /**
   * @swagger
   * "/api/service-categories/categories":
   *   get:
   *     summary: Get all categories with services
   *     description: Retrieves all service categories with their associated services
   *     tags: [Service Categories]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     parameters:
   *       - in: query
   *         name: locale
   *         schema:
   *           type: string
   *           default: en
   *         description: Language locale for category and service names
   *     responses:
   *       '200':
   *         description: List of categories with services
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/CategoryTree'
   *       '500':
   *         description: Server error
   */
  router.get('/categories', async (req, res, next) => {
    const start = Date.now();
    try {
      const locale = req.query.locale || 'en';
      logger.info(`Fetching all service categories with locale: ${locale}`);
      const categories = await serviceCategoryService.getAllCategoriesWithServices(locale);
      logger.info(`Fetched ${categories.length} categories in ${Date.now() - start}ms`);
      res.json(categories);
    } catch (error) {
      return respondWithFailure(req, res, next, error, 'Getting all categories with services', Date.now() - start);
    }
  });

  /**
   * @swagger
   * "/api/service-categories/categories/detailed":
   *   get:
   *     summary: Get all categories with detailed services for admin
   *     description: Retrieves all categories with their associated services as objects (including keys)
   *     tags: [Service Categories]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     parameters:
   *       - in: query
   *         name: locale
   *         schema:
   *           type: string
   *           default: en
   *         description: Language locale for category and service names
   *     responses:
   *       '200':
   *         description: List of categories with detailed service objects —
   *           the CategoryTree shape (both spellings), where each service
   *           additionally carries its entity `_key` (the hierarchy editor
   *           acts on entities).
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/CategoryTree'
   *       '500':
   *         description: Server error
   */
  router.get('/categories/detailed', async (req, res, next) => {
    const start = Date.now();
    try {
      const locale = req.query.locale || 'en';
      logger.info(`Fetching all DETAILED service categories with locale: ${locale}`);
      const categories = await serviceCategoryService.getAdminAllCategoriesWithServices(locale);
      logger.info(`Fetched ${categories.length} detailed categories in ${Date.now() - start}ms`);
      res.json(categories);
    } catch (error) {
      return respondWithFailure(req, res, next, error, 'Getting all detailed categories', Date.now() - start);
    }
  });

  /**
   * @swagger
   * "/api/service-categories/categories/{categoryId}":
   *   get:
   *     summary: Get category with services
   *     description: Retrieves a specific service category with its associated services
   *     tags: [Service Categories]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     parameters:
   *       - in: path
   *         name: categoryId
   *         required: true
   *         schema:
   *           type: string
   *         description: Category key
   *       - in: query
   *         name: locale
   *         schema:
   *           type: string
   *           default: en
   *         description: Language locale for category and service names
   *     responses:
   *       '200':
   *         description: Category with services
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 catKey:
   *                   type: string
   *                 name:
   *                   type: string
   *                 children:
   *                   type: array
   *                   items:
   *                     type: string
   *       '404':
   *         description: Category not found
   *       '500':
   *         description: Server error
   */
  router.get('/categories/:categoryId', async (req, res, next) => {
    const start = Date.now();
    try {
      const locale = req.query.locale || 'en';
      logger.info(`Fetching category ${req.params.categoryId} with locale: ${locale}`);
      const category = await serviceCategoryService.getCategoryWithServices(req.params.categoryId, locale);
      logger.info(`Fetched category ${req.params.categoryId} in ${Date.now() - start}ms`);
      res.json(category);
    } catch (error) {
      return respondWithFailure(req, res, next, error, `Getting category ${req.params.categoryId}`, Date.now() - start);
    }
  });

  /**
   * @swagger
   * "/api/service-categories/{categoryId}/translations":
   *   get:
   *     summary: Get all translations for a category
   *     description: Retrieves all available translations for a specific service category
   *     tags: [Service Categories]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     parameters:
   *       - in: path
   *         name: categoryId
   *         required: true
   *         schema:
   *           type: string
   *         description: The key of the category
   *     responses:
   *       '200':
   *         description: A list of translation objects
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   lang:
   *                     type: string
   *                     example: "FR"
   *                   text:
   *                     type: string
   *                     example: "Santé et services sociaux"
   *       '404':
   *         description: The category does not exist
   *       '500':
   *         description: Server error
   */
  router.get('/:categoryId/translations', async (req, res, next) => {
    const start = Date.now();
    try {
      const { categoryId } = req.params;
      logger.info(`Fetching all translations for category: ${categoryId}`);
      const translations = await serviceCategoryService.getCategoryTranslations(categoryId);
      logger.info(`Fetched ${translations.length} translations for category ${categoryId} in ${Date.now() - start}ms`);
      res.json(translations);
    } catch (error) {
      return respondWithFailure(
        req,
        res,
        next,
        error,
        `Getting translations for category ${req.params.categoryId}`,
        Date.now() - start
      );
    }
  });

  /**
   * @swagger
   * "/api/service-categories/services/{serviceId}/translations":
   *   get:
   *     summary: Get all translations for a service
   *     description: Retrieves all available translations for a specific service
   *     tags: [Service Categories]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     parameters:
   *       - in: path
   *         name: serviceId
   *         required: true
   *         schema:
   *           type: string
   *         description: The key of the service
   *     responses:
   *       '200':
   *         description: A list of translation objects
   *       '404':
   *         description: The service does not exist
   *       '500':
   *         description: Server error
   */
  router.get('/services/:serviceId/translations', async (req, res, next) => {
    const start = Date.now();
    try {
      const { serviceId } = req.params;
      logger.info(`Fetching all translations for service: ${serviceId}`);
      const translations = await serviceCategoryService.getServiceTranslations(serviceId);
      logger.info(`Fetched ${translations.length} translations for service ${serviceId} in ${Date.now() - start}ms`);
      res.json(translations);
    } catch (error) {
      return respondWithFailure(
        req,
        res,
        next,
        error,
        `Getting translations for service ${req.params.serviceId}`,
        Date.now() - start
      );
    }
  });

  /**
   * @swagger
   * "/api/service-categories/search":
   *   get:
   *     summary: Search categories and services
   *     description: Searches for categories and services based on a query string
   *     tags: [Service Categories]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     parameters:
   *       - in: query
   *         name: query
   *         required: true
   *         schema:
   *           type: string
   *         description: Search query
   *       - in: query
   *         name: locale
   *         schema:
   *           type: string
   *           default: en
   *         description: Language locale for search results
   *     responses:
   *       '200':
   *         description: Search results
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 categories:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       type:
   *                         type: string
   *                       key:
   *                         type: string
   *                       name:
   *                         type: string
   *                 services:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       type:
   *                         type: string
   *                       key:
   *                         type: string
   *                       name:
   *                         type: string
   *                       categoryKey:
   *                         type: string
   *                       categoryName:
   *                         type: string
   *       '400':
   *         description: Missing search query
   *       '500':
   *         description: Server error
   */
  router.get('/search', async (req, res, next) => {
    const start = Date.now();
    try {
      const { query, locale = 'en' } = req.query;
      if (!query) {
        logger.warn('Search query missing in /service-categories/search');
        return res.status(400).json({ message: 'Search query is required' });
      }
      logger.info(`Searching categories and services with query: "${query}" and locale: ${locale}`);
      const results = await serviceCategoryService.searchCategoriesAndServices(query, locale);
      logger.info(
        `Search completed in ${Date.now() - start}ms: ${results.categories.length} categories, ${results.services.length} services`
      );
      res.json(results);
    } catch (error) {
      return respondWithFailure(req, res, next, error, 'Searching categories and services', Date.now() - start);
    }
  });

  /**
   * @swagger
   * "/api/service-categories":
   *   post:
   *     summary: Create a new category
   *     description: Creates a new service category with translations
   *     tags: [Service Categories]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               nameEN:
   *                 type: string
   *               translations:
   *                 type: array
   *                 items:
   *                   type: object
   *                   properties:
   *                     languageCode:
   *                       type: string
   *                       description: ISO 639-1 code (e.g. "ES", "FR"). Stored uppercased.
   *                     translation:
   *                       type: string
   *                       description: Localized display name.
   *                   required: [languageCode, translation]
   *     responses:
   *       '400':
   *         description: Validation error (missing nameEN, bad translation shape, duplicate or EN languageCode)
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *       '201':
   *         description: Category created successfully
   */
  router.post('/', async (req, res, next) => {
    const start = Date.now();
    try {
      const payload = req.body;
      if (!payload || !payload.nameEN) {
        return res.status(400).json({ message: 'Payload with nameEN is required' });
      }
      logger.info(`Creating single category with name: ${payload.nameEN}`);
      const result = await serviceCategoryService.createCategory(payload);
      logger.info(`Category created successfully in ${Date.now() - start}ms`);
      res.status(201).json(result);
    } catch (error) {
      return respondWithFailure(req, res, next, error, 'Creating category', Date.now() - start);
    }
  });

  /**
   * @swagger
   * "/api/service-categories/{categoryId}":
   *   delete:
   *     summary: Delete a category
   *     description: Deletes a service category and its associated services
   *     tags: [Service Categories]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     parameters:
   *       - in: path
   *         name: categoryId
   *         required: true
   *         schema:
   *           type: string
   *         description: Category key
   *     responses:
   *       '200':
   *         description: Category deleted successfully
   *       '404':
   *         description: Category not found
   *       '500':
   *         description: Server error
   */
  router.delete('/:categoryId', async (req, res, next) => {
    const start = Date.now();
    try {
      logger.info(`Attempting to delete category: ${req.params.categoryId}`);
      const exists = await serviceCategoryService.categoryExists(req.params.categoryId);
      if (!exists) {
        // A typed 404, like every other 404 on these paths: the catch
        // block below logs it once and renders it.
        throw new NotFoundError(`Category ${req.params.categoryId} not found`);
      }
      await serviceCategoryService.deleteCategory(req.params.categoryId);
      logger.info(`Category ${req.params.categoryId} deleted successfully in ${Date.now() - start}ms`);
      res.json({ message: `Category ${req.params.categoryId} deleted successfully` });
    } catch (error) {
      return respondWithFailure(
        req,
        res,
        next,
        error,
        `Deleting category ${req.params.categoryId}`,
        Date.now() - start
      );
    }
  });

  /**
   * @swagger
   * "/api/service-categories/services/{serviceId}":
   *   delete:
   *     summary: Delete a service
   *     description: Deletes a service and its associated translations
   *     tags: [Service Categories]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     parameters:
   *       - in: path
   *         name: serviceId
   *         required: true
   *         schema:
   *           type: string
   *         description: The key of the service to delete
   *     responses:
   *       '200':
   *         description: Service deleted successfully
   *       '404':
   *         description: Service not found
   *       '500':
   *         description: Server error
   */
  router.delete('/services/:serviceId', async (req, res, next) => {
    const start = Date.now();
    try {
      const { serviceId } = req.params;
      logger.info(`Attempting to delete service: ${serviceId}`);
      await serviceCategoryService.deleteService(serviceId);
      logger.info(`Service ${serviceId} deleted successfully in ${Date.now() - start}ms`);
      res.status(200).json({ message: `Service ${serviceId} deleted successfully` });
    } catch (error) {
      return respondWithFailure(req, res, next, error, `Deleting service ${req.params.serviceId}`, Date.now() - start);
    }
  });

  /**
   * @swagger
   * "/api/service-categories/{categoryId}/services":
   *   post:
   *     summary: Create a new service for a category
   *     description: Creates a new service with translations under a specific category
   *     tags: [Service Categories]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     parameters:
   *       - in: path
   *         name: categoryId
   *         required: true
   *         schema:
   *           type: string
   *         description: The key of the parent category
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               nameEN:
   *                 type: string
   *               translations:
   *                 type: array
   *                 items:
   *                   type: object
   *                   properties:
   *                     languageCode:
   *                       type: string
   *                       description: ISO 639-1 code (e.g. "ES", "FR"). Stored uppercased.
   *                     translation:
   *                       type: string
   *                       description: Localized display name.
   *                   required: [languageCode, translation]
   *     responses:
   *       '400':
   *         description: Validation error (missing nameEN, bad translation shape, duplicate or EN languageCode)
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *       '201':
   *         description: Service created successfully
   *       '500':
   *         description: Server error
   */
  router.post('/:categoryId/services', async (req, res, next) => {
    const start = Date.now();
    try {
      const { categoryId } = req.params;
      const payload = req.body;
      logger.info(`Creating service for category ${categoryId}`);
      const newService = await serviceCategoryService.createServiceWithTranslations(categoryId, payload);
      logger.info(`Service created successfully for category ${categoryId} in ${Date.now() - start}ms`);
      res.status(201).json(newService);
    } catch (error) {
      return respondWithFailure(
        req,
        res,
        next,
        error,
        `Creating service for category ${req.params.categoryId}`,
        Date.now() - start
      );
    }
  });

  /**
   * @swagger
   * "/api/service-categories/{categoryId}":
   *   put:
   *     summary: Update an existing category
   *     description: Updates a category's name and translations
   *     tags: [Service Categories]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     parameters:
   *       - in: path
   *         name: categoryId
   *         required: true
   *         schema:
   *           type: string
   *         description: The key of the category to update
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               nameEN:
   *                 type: string
   *               translations:
   *                 type: array
   *                 items:
   *                   type: object
   *                   properties:
   *                     languageCode:
   *                       type: string
   *                       description: ISO 639-1 code (e.g. "ES", "FR"). Stored uppercased.
   *                     translation:
   *                       type: string
   *                       description: Localized display name.
   *                   required: [languageCode, translation]
   *     responses:
   *       '400':
   *         description: Validation error (missing nameEN, bad translation shape, duplicate or EN languageCode)
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *       '200':
   *         description: Category updated successfully
   *       '500':
   *         description: Server error
   */
  router.put('/:categoryId', async (req, res, next) => {
    const start = Date.now();
    try {
      const { categoryId } = req.params;
      const payload = req.body;
      logger.info(`Updating category ${categoryId}`);
      const result = await serviceCategoryService.updateCategoryWithTranslations(categoryId, payload);
      logger.info(`Category ${categoryId} updated successfully in ${Date.now() - start}ms`);
      res.status(200).json(result);
    } catch (error) {
      return respondWithFailure(
        req,
        res,
        next,
        error,
        `Updating category ${req.params.categoryId}`,
        Date.now() - start
      );
    }
  });

  /**
   * @swagger
   * "/api/service-categories/services/{serviceId}":
   *   put:
   *     summary: Update an existing service
   *     description: Updates a service's name and its associated translations
   *     tags: [Service Categories]
   *     security:
   *       - KeycloakOAuth2: ['openid']
   *     parameters:
   *       - in: path
   *         name: serviceId
   *         required: true
   *         schema:
   *           type: string
   *         description: The key of the service to update
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               nameEN:
   *                 type: string
   *               translations:
   *                 type: array
   *                 items:
   *                   type: object
   *                   properties:
   *                     languageCode:
   *                       type: string
   *                       description: ISO 639-1 code (e.g. "ES", "FR"). Stored uppercased.
   *                     translation:
   *                       type: string
   *                       description: Localized display name.
   *                   required: [languageCode, translation]
   *     responses:
   *       '400':
   *         description: Validation error (missing nameEN, bad translation shape, duplicate or EN languageCode)
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *       '200':
   *         description: Service updated successfully
   *       '500':
   *         description: Server error
   */
  router.put('/services/:serviceId', async (req, res, next) => {
    const start = Date.now();
    try {
      const { serviceId } = req.params;
      const payload = req.body;
      logger.info(`Updating service ${serviceId}`);
      const result = await serviceCategoryService.updateServiceWithTranslations(serviceId, payload);
      logger.info(`Service ${serviceId} updated successfully in ${Date.now() - start}ms`);
      res.status(200).json(result);
    } catch (error) {
      return respondWithFailure(req, res, next, error, `Updating service ${req.params.serviceId}`, Date.now() - start);
    }
  });

  return router;
};
