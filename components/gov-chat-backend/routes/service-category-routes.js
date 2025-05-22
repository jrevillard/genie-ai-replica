const express = require('express');
const router = express.Router();
const ServiceCategoryService = require('../services/service-category-service');
const authMiddleware = require('../middleware/auth-middleware');
//const { logger } = require('../logger'); // Import logger from logger.js
const { logger } = require('shared-lib');

const serviceCategoryService = new ServiceCategoryService();

// Apply authentication middleware to all routes
router.use(authMiddleware.authenticate);

/**
 * @swagger
 * /service-categories:
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
router.get('/', async (req, res) => {
  try {
    const locale = req.query.locale || 'en';
    logger.info(`Fetching all service categories with locale: ${locale}`);
    const categories = await serviceCategoryService.getAllCategoriesWithServices(locale);
    res.json(categories);
  } catch (error) {
    logger.error(`Error getting all categories with services: ${error.message}`, { stack: error.stack });
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /service-categories/{categoryKey}:
 *   get:
 *     summary: Get category with services
 *     description: Retrieves a specific service category with its associated services
 *     tags: [Service Categories]
 *     parameters:
 *       - in: path
 *         name: categoryKey
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
router.get('/:categoryKey', async (req, res) => {
  try {
    const locale = req.query.locale || 'en';
    logger.info(`Fetching category ${req.params.categoryKey} with locale: ${locale}`);
    const category = await serviceCategoryService.getCategoryWithServices(req.params.categoryKey, locale);
    res.json(category);
  } catch (error) {
    if (error.message.includes('not found')) {
      logger.warn(`Category ${req.params.categoryKey} not found`);
      res.status(404).json({ message: error.message });
    } else {
      logger.error(`Error getting category ${req.params.categoryKey}: ${error.message}`, { stack: error.stack });
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
 *         name: q
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
  try {
    const { q, locale = 'en' } = req.query;
    
    if (!q) {
      logger.warn('Search query missing in /service-categories/search');
      return res.status(400).json({ message: 'Search query is required' });
    }
    
    logger.info(`Searching categories and services with query: "${q}" and locale: ${locale}`);
    const results = await serviceCategoryService.searchCategoriesAndServices(q, locale);
    res.json(results);
  } catch (error) {
    logger.error(`Error searching categories and services: ${error.message}`, { stack: error.stack });
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
  try {
    const { categories, locale = 'en' } = req.body;
    
    if (!categories || !Array.isArray(categories)) {
      logger.warn('Categories array missing or invalid in /service-categories POST');
      return res.status(400).json({ message: 'Categories array is required' });
    }
    
    logger.info(`Creating/updating categories with locale: ${locale}, count: ${categories.length}`);
    const result = await serviceCategoryService.upsertCategories(categories, locale);
    res.json(result);
  } catch (error) {
    logger.error(`Error creating/updating categories: ${error.message}`, { stack: error.stack });
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /service-categories/{categoryKey}:
 *   delete:
 *     summary: Delete a category
 *     description: Deletes a service category and its associated services
 *     tags: [Service Categories]
 *     parameters:
 *       - in: path
 *         name: categoryKey
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
router.delete('/:categoryKey', async (req, res) => {
  try {
    logger.info(`Attempting to delete category: ${req.params.categoryKey}`);
    // Check if category exists first
    const exists = await serviceCategoryService.categoryExists(req.params.categoryKey);
    
    if (!exists) {
      logger.warn(`Category ${req.params.categoryKey} not found for deletion`);
      return res.status(404).json({ message: `Category ${req.params.categoryKey} not found` });
    }
    
    await serviceCategoryService.deleteCategory(req.params.categoryKey);
    logger.info(`Category ${req.params.categoryKey} deleted successfully`);
    res.json({ message: `Category ${req.params.categoryKey} deleted successfully` });
  } catch (error) {
    logger.error(`Error deleting category ${req.params.categoryKey}: ${error.message}`, { stack: error.stack });
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
  try {
    logger.info('Initializing default categories and services');
    const result = await serviceCategoryService.initializeDefaultCategoriesAndServices();
    logger.info('Default categories initialized successfully');
    res.json(result);
  } catch (error) {
    logger.error(`Error initializing default categories: ${error.message}`, { stack: error.stack });
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;