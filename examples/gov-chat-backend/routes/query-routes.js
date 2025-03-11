const express = require('express');
const router = express.Router();
const QueryService = require('../services/query-service');
const AnalyticsService = require('../services/analytics-service');

// Initialize services
const queryService = new QueryService();
const analyticsService = new AnalyticsService();

// Inject analytics service into query service
queryService.setAnalyticsService(analyticsService);

// Middleware to ensure analytics service is set
router.use((req, res, next) => {
  if (!queryService.analyticsService) {
    console.log('Analytics service was not set, setting it now...');
    queryService.setAnalyticsService(analyticsService);
  }
  next();
});

// Submit a query
router.post('/', async (req, res) => {
  try {
    console.log("Request body:", JSON.stringify(req.body));
    const query = await queryService.createQuery(req.body);
    res.status(201).json(query);
  } catch (error) {
    console.error('Error creating query:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get query by ID
router.get('/:queryId', async (req, res) => {
  try {
    console.log("Request body:", JSON.stringify(req.body));
    const query = await queryService.getQuery(req.params.queryId);
    res.json(query);
  } catch (error) {
    console.error(`Error getting query ${req.params.queryId}:`, error);
    res.status(500).json({ message: error.message });
  }
});

// Add feedback to a query
router.post('/:queryId/feedback', async (req, res) => {
  try {
    console.log("Request body:", JSON.stringify(req.body));
    const query = await queryService.addFeedback(req.params.queryId, req.body);
    res.json(query);
  } catch (error) {
    console.error(`Error adding feedback to query ${req.params.queryId}:`, error);
    res.status(500).json({ message: error.message });
  }
});

// Mark a query as answered - support both PATCH and PUT
router.patch('/:queryId/answered', async (req, res) => {
  try {
    console.log("Request body:", JSON.stringify(req.body));
    const query = await queryService.markAsAnswered(req.params.queryId, req.body.responseTime);
    res.json(query);
  } catch (error) {
    console.error(`Error marking query ${req.params.queryId} as answered:`, error);
    res.status(500).json({ message: error.message });
  }
});

// Mark a query as answered (PUT method for test compatibility)
router.put('/:queryId/answered', async (req, res) => {
  try {
    console.log("Request body:", JSON.stringify(req.body));
    const responseTime = req.body.responseTime || 0;
    
    console.log(`Marking query ${req.params.queryId} as answered with response time: ${responseTime}ms`);
    
    const query = await queryService.markAsAnswered(req.params.queryId, responseTime);
    res.json(query);
  } catch (error) {
    console.error(`Error marking query ${req.params.queryId} as answered:`, error);
    res.status(500).json({ message: error.message });
  }
});

// Search queries
router.get('/', async (req, res) => {
  try {
    const { limit = 20, offset = 0, ...criteria } = req.query;
    console.log("Request body:", JSON.stringify(req.body));
    const results = await queryService.searchQueries(criteria, parseInt(limit), parseInt(offset));
    res.json(results);
  } catch (error) {
    console.error('Error searching queries:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;