const express = require('express');
const router = express.Router();
const AnalyticsService = require('../services/analytics-service');

const analyticsService = new AnalyticsService();

// Get dashboard analytics
router.get('/dashboard', async (req, res) => {
  try {
    const startDate = req.query.startDate || new Date().toISOString().split('T')[0];
    const endDate = req.query.endDate || new Date().toISOString();
    
    console.log(`Getting dashboard analytics from ${startDate} to ${endDate}`);
    const analytics = await analyticsService.getDashboardAnalytics(startDate, endDate);
    
    res.json(analytics);
  } catch (error) {
    console.error('Error getting dashboard analytics:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get analytics for all periods
router.get('/', async (req, res) => {
  try {
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    const filters = req.query.filters ? JSON.parse(req.query.filters) : {};
    
    console.log(`Getting analytics from ${startDate} to ${endDate} with filters:`, filters);
    const analytics = await analyticsService.getAnalytics(filters, startDate, endDate);
    
    res.json(analytics);
  } catch (error) {
    console.error('Error getting analytics:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get time series data
router.get('/timeseries', async (req, res) => {
  try {
    const { metric, interval = 'daily', startDate, endDate } = req.query;
    const data = await analyticsService.getTimeSeriesData(metric, interval, startDate, endDate);
    res.json(data);
  } catch (error) {
    console.error('Error getting time series data:', error);
    res.status(500).json({ message: error.message });
  }
});

// Record an event
router.post('/events', async (req, res) => {
  try {
    const { userId, eventType, eventData } = req.body;
    
    if (!userId || !eventType) {
      return res.status(400).json({ message: 'userId and eventType are required' });
    }
    
    console.log(`Recording event of type ${eventType} for user ${userId}`);
    const result = await analyticsService.trackEvent(userId, eventType, eventData || {});
    res.status(201).json(result);
  } catch (error) {
    console.error('Error recording event:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get analytics records - new endpoint for testing
router.get('/records', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    
    console.log(`Getting analytics records with limit ${limit} and offset ${offset}`);
    
    // Query analytics collection directly
    const cursor = await analyticsService.db.query(`
      FOR a IN analytics
        SORT a.timestamp DESC
        LIMIT ${offset}, ${limit}
        RETURN a
    `);
    
    const records = await cursor.all();
    res.json(records);
  } catch (error) {
    console.error('Error retrieving analytics records:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get events records - new endpoint for testing
router.get('/events', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    
    console.log(`Getting event records with limit ${limit} and offset ${offset}`);
    
    // Query events collection directly
    const cursor = await analyticsService.db.query(`
      FOR e IN events
        SORT e.timestamp DESC
        LIMIT ${offset}, ${limit}
        RETURN e
    `);
    
    const events = await cursor.all();
    res.json(events);
  } catch (error) {
    console.error('Error retrieving events records:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;