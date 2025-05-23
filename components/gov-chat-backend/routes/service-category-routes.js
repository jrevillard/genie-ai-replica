const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth-middleware');
const { logger } = require('../shared-lib');

module.exports = (serviceCategoryService) => {
  if (!serviceCategoryService || typeof serviceCategoryService.getAllCategoriesWithServices !== 'function') {
    logger.error('Invalid serviceCategoryService provided to service-category-routes');
    throw new Error('serviceCategoryService is required with getAllCategoriesWithServices');
  }
  logger.debug('serviceCategory-routes initialized with serviceCategoryService', {
    methods: Object.getOwnPropertyNames(Object.getPrototypeOf(serviceCategoryService)).filter(m => m !== 'constructor')
  });

  router.use(authMiddleware.authenticate);

  /**
   * @swagger
   * /service-categories/categories:
   *   get:
   *     summary: Get all categories with services
   *     description: Retrieves all service categories with their associated services
   *     tags: [Service Categories]
   *     parameters:
   *       - in: query
   *         name: locale
   *         schema:
   *           type: string
   *           default: en
   *         description: Language locale for category and service names
   *     responses:
   *       200:
   *         description: List of categories with services
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   catKey:
   *                     type: string
   *                   name:
   *                     type: string
   *                   children:
   *                     type: array
   *                     items:
   *                       type: string
   *       500:
   *         description: Server error
   */
  router.get('/categories', async (req, res) => {
    const start = Date.now();
    try {
      const locale = req.query.locale || 'en';
      logger.info(`Fetching all service categories with locale: ${locale}`);
      const categories = await serviceCategoryService.getAllCategoriesWithServices(locale);
      logger.info(`Fetched ${categories.length} categories in ${Date.now() - start}ms`);
      res.json(categories);
    } catch (error) {
      logger.error(`Error getting all categories with services: ${error.message}`, { stack: error.stack, durationMs: Date.now() - start });
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * /service-categories/categories/{categoryId}:
   *   get:
   *     summary: Get category with services
   *     description: Retrieves a specific service category with its associated services
   *     tags: [Service Categories]
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
   *       200:
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
   *       404:
   *         description: Category not found
   *       500:
   *         description: Server error
   */
  router.get('/categories/:categoryId', async (req, res) => {
    const start = Date.now();
    try {
      const locale = req.query.locale || 'en';
      logger.info(`Fetching category ${req.params.categoryId} with locale: ${locale}`);
      const category = await serviceCategoryService.getCategoryWithServices(req.params.categoryId, locale);
      logger.info(`Fetched category ${req.params.categoryId} in ${Date.now() - start}ms`);
      res.json(category);
    } catch (error) {
      if (error.message.includes('not found')) {
        logger.warn(`Category ${req.params.categoryId} not found`);
        res.status(404).json({ message: error.message });
      } else {
        logger.error(`Error getting category ${req.params.categoryId}: ${error.message}`, { stack: error.stack, durationMs: Date.now() - start });
        res.status(500).json({ message: error.message });
      }
    }
  });

  /**
   * @swagger
   * /service-categories/search:
   *   get:
   *     summary: Search categories and services
   *     description: Searches for categories and services based on a query string
   *     tags: [Service Categories]
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
   *       200:
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
   *       400:
   *         description: Missing search query
   *       500:
   *         description: Server error
   */
  router.get('/search', async (req, res) => {
    const start = Date.now();
    try {
      const { query, locale = 'en' } = req.query;
      if (!query) {
        logger.warn('Search query missing in /service-categories/search');
        return res.status(400).json({ message: 'Search query is required' });
      }
      logger.info(`Searching categories and services with query: "${query}" and locale: ${locale}`);
      const results = await serviceCategoryService.searchCategoriesAndServices(query, locale);
      logger.info(`Search completed in ${Date.now() - start}ms: ${results.categories.length} categories, ${results.services.length} services`);
      res.json(results);
    } catch (error) {
      logger.error(`Error searching categories and services: ${error.message}`, { stack: error.stack, durationMs: Date.now() - start });
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * /service-categories:
   *   post:
   *     summary: Create or update categories
   *     description: Creates or updates service categories and their services
   *     tags: [Service Categories]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - categories
   *             properties:
   *               categories:
   *                 type: array
   *                 items:
   *                   type: object
   *                   properties:
   *                     catKey:
   *                       type: string
   *                     name:
   *                       type: string
   *                     children:
   *                       type: array
   *                       items:
   *                         type: string
   *               locale:
   *                 type: string
   *                 default: en
   *     responses:
   *       200:
   *         description: Categories created or updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *       400:
   *         description: Invalid request
   *       500:
   *         description: Server error
   */
  router.post('/', async (req, res) => {
    const start = Date.now();
    try {
      const { categories, locale = 'en' } = req.body;
      if (!categories || !Array.isArray(categories)) {
        logger.warn('Categories array missing or invalid in /service-categories POST');
        return res.status(400).json({ message: 'Categories array is required' });
      }
      logger.info(`Creating/updating ${categories.length} categories with locale: ${locale}`);
      const result = await serviceCategoryService.upsertCategories(categories, locale);
      logger.info(`Upserted ${result.length} categories in ${Date.now() - start}ms`);
      res.json(result);
    } catch (error) {
      logger.error(`Error creating/updating categories: ${error.message}`, { stack: error.stack, durationMs: Date.now() - start });
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * /service-categories/{categoryId}:
   *   delete:
   *     summary: Delete a category
   *     description: Deletes a service category and its associated services
   *     tags: [Service Categories]
   *     parameters:
   *       - in: path
   *         name: categoryId
   *         required: true
   *         schema:
   *           type: string
   *         description: Category key
   *     responses:
   *       200:
   *         description: Category deleted successfully
   *       404:
   *         description: Category not found
   *       500:
   *         description: Server error
   */
  router.delete('/:categoryId', async (req, res) => {
    const start = Date.now();
    try {
      logger.info(`Attempting to delete category: ${req.params.categoryId}`);
      const exists = await serviceCategoryService.categoryExists(req.params.categoryId);
      if (!exists) {
        logger.warn(`Category ${req.params.categoryId} not found for deletion`);
        return res.status(404).json({ message: `Category ${req.params.categoryId} not found` });
      }
      await serviceCategoryService.deleteCategory(req.params.categoryId);
      logger.info(`Category ${req.params.categoryId} deleted successfully in ${Date.now() - start}ms`);
      res.json({ message: `Category ${req.params.categoryId} deleted successfully` });
    } catch (error) {
      logger.error(`Error deleting category ${req.params.categoryId}: ${error.message}`, { stack: error.stack, durationMs: Date.now() - start });
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * /service-categories/init:
   *   post:
   *     summary: Initialize default categories
   *     description: Initializes the system with default categories and services
   *     tags: [Service Categories]
   *     responses:
   *       200:
   *         description: Default categories initialized successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *                 categoriesCreated:
   *                   type: integer
   *       500:
   *         description: Server error
   */
  router.post('/init', async (req, res) => {
    const start = Date.now();
    try {
      logger.info('Initializing default categories and services');
      const result = await serviceCategoryService.initializeDefaultCategoriesAndServices();
      logger.info(`Default categories initialized successfully in ${Date.now() - start}ms`);
      res.json(result);
    } catch (error) {
      logger.error(`Error initializing default categories: ${error.message}`, { stack: error.stack, durationMs: Date.now() - start });
      res.status(500).json({ message: error.message });
    }
  });

  return router;
};