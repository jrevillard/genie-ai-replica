const express = require('express');
const router = express.Router();
const ServiceCategoryService = require('../services/service-category-service');

const serviceService = new ServiceCategoryService();

// Get all categories with services
router.get('/categories', async (req, res) => {
  try {
    const locale = req.query.locale || 'en';
    const categories = await serviceService.getAllCategoriesWithServices(locale);
    res.json(categories);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get a single category with services
router.get('/categories/:categoryId', async (req, res) => {
  try {
    const locale = req.query.locale || 'en';
    const category = await serviceService.getCategoryWithServices(req.params.categoryId, locale);
    res.json(category);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Search categories and services
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
