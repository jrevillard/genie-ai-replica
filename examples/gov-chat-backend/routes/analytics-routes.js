const express = require('express');
const router = express.Router();
const AnalyticsService = require('../services/analytics-service');

const analyticsService = new AnalyticsService();

// Get dashboard analytics
router.get('/dashboard', async (req, res) => {
  try {
    const { period = 'daily', date = new Date().toISOString().split('T')[0] } = req.query;
    const analytics = await analyticsService.getDashboardAnalytics(period, date);
    res.json(analytics);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get analytics for all periods
router.get('/', async (req, res) => {
  try {
    const { period = 'daily', date = new Date().toISOString().split('T')[0] } = req.query;
    const analytics = await analyticsService.getAnalytics(period, date);
    res.json(analytics);
  } catch (error) {
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
    res.status(500).json({ message: error.message });
  }
});

// Record an event
router.post('/events', async (req, res) => {
  try {
    const result = await analyticsService.trackEvent(req.body.eventType, req.body.eventData);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
