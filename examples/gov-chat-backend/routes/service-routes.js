const express = require('express');
const router = express.Router();
const ServiceCategoryService = require('../services/service-category-service');

const serviceService = new ServiceCategoryService();

/**
 * @swagger
 * /services/categories:
 *   get:
 *     summary: Get all categories with services
 *     description: Retrieves all service categories with their associated services
 *     tags: [Services]
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
 *                   _key:
 *                     type: string
 *                   nameEN:
 *                     type: string
 *                   descriptionEN:
 *                     type: string
 *                   icon:
 *                     type: string
 *                   services:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         _key:
 *                           type: string
 *                         nameEN:
 *                           type: string
 *                         descriptionEN:
 *                           type: string
 *                         requirements:
 *                           type: string
 *                         process:
 *                           type: string
 *       500:
 *         description: Server error
 */
router.get('/categories', async (req, res) => {
  try {
    const locale = req.query.locale || 'en';
    const categories = await serviceService.getAllCategoriesWithServices(locale);
    res.json(categories);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /services/categories/{categoryId}:
 *   get:
 *     summary: Get category with services
 *     description: Retrieves a specific service category with its associated services
 *     tags: [Services]
 *     parameters:
 *       - in: path
 *         name: categoryId
 *         required: true
 *         schema:
 *           type: string
 *         description: Category ID
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
 *                 _key:
 *                   type: string
 *                 nameEN:
 *                   type: string
 *                 descriptionEN:
 *                   type: string
 *                 icon:
 *                   type: string
 *                 services:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       _key:
 *                         type: string
 *                       nameEN:
 *                         type: string
 *                       descriptionEN:
 *                         type: string
 *                       requirements:
 *                         type: string
 *                       process:
 *                         type: string
 *       404:
 *         description: Category not found
 *       500:
 *         description: Server error
 */
router.get('/categories/:categoryId', async (req, res) => {
  try {
    const locale = req.query.locale || 'en';
    const category = await serviceService.getCategoryWithServices(req.params.categoryId, locale);
    res.json(category);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /services/search:
 *   get:
 *     summary: Search categories and services
 *     description: Searches for categories and services based on a query string
 *     tags: [Services]
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
 *                       _key:
 *                         type: string
 *                       nameEN:
 *                         type: string
 *                       descriptionEN:
 *                         type: string
 *                       relevance:
 *                         type: number
 *                 services:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       _key:
 *                         type: string
 *                       nameEN:
 *                         type: string
 *                       descriptionEN:
 *                         type: string
 *                       categoryId:
 *                         type: string
 *                       relevance:
 *                         type: number
 *       500:
 *         description: Server error
 */
router.get('/search', async (req, res) => {
  try {
    const { query, locale = 'en' } = req.query;
    const results = await serviceService.searchCategoriesAndServices(query, locale);
    res.json(results);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;