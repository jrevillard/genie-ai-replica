const express = require('express');
const router = express.Router();
const QueryService = require('../services/query-service');

const queryService = new QueryService();

// Submit a query
router.post('/', async (req, res) => {
  try {
    const query = await queryService.createQuery(req.body);
    res.status(201).json(query);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get query by ID
router.get('/:queryId', async (req, res) => {
  try {
    const query = await queryService.getQuery(req.params.queryId);
    res.json(query);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Add feedback to a query
router.post('/:queryId/feedback', async (req, res) => {
  try {
    const query = await queryService.addFeedback(req.params.queryId, req.body);
    res.json(query);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Mark a query as answered
router.patch('/:queryId/answered', async (req, res) => {
  try {
    const query = await queryService.markAsAnswered(req.params.queryId, req.body.responseTime);
    res.json(query);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Search queries
router.get('/', async (req, res) => {
  try {
    const { limit = 20, offset = 0, ...criteria } = req.query;
    const results = await queryService.searchQueries(criteria, parseInt(limit), parseInt(offset));
    res.json(results);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
