// controllers/analyticsController.js
const AnalyticsService = require('../services/analytics-service');

// Initialize the analytics service
const analyticsService = new AnalyticsService();

/**
 * Controller for analytics-related API endpoints
 */
class AnalyticsController {
  /**
   * Get dashboard analytics
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getDashboardAnalytics(req, res) {
    try {
      const { startDate, endDate } = req.query;
      
      // Validate required parameters
      if (!startDate || !endDate) {
        return res.status(400).json({ 
          error: 'Missing required parameters: startDate and endDate are required' 
        });
      }
      
      // Get dashboard analytics from service
      const dashboardData = await analyticsService.getDashboardAnalytics(startDate, endDate);
      
      res.json(dashboardData);
    } catch (error) {
      console.error('Error in getDashboardAnalytics:', error);
      res.status(500).json({ error: 'Failed to retrieve dashboard analytics' });
    }
  }
  
  /**
   * Get analytics for a specific metric
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getMetric(req, res) {
    try {
      const { metric } = req.params;
      const { startDate, endDate } = req.query;
      
      // Validate required parameters
      if (!startDate || !endDate) {
        return res.status(400).json({ 
          error: 'Missing required parameters: startDate and endDate are required' 
        });
      }
      
      // Get analytics with specific filters to extract just the needed metric
      const filters = {};
      const analyticsData = await analyticsService.getAnalytics(filters, startDate, endDate);
      
      // Extract the requested metric
      let value = null;
      
      switch (metric) {
        case 'totalQueries':
          value = analyticsData.queryCount;
          break;
          
        case 'uniqueUsers':
          // Count unique users from the raw data
          const userIds = new Set();
          analyticsData.raw.forEach(item => {
            if (item.userId) userIds.add(item.userId);
          });
          value = userIds.size;
          break;
          
        case 'averageResponseTime':
          // Calculate from query data if available
          if (analyticsData.raw && analyticsData.raw.length > 0) {
            const queries = analyticsData.raw.filter(item => 
              item.type === 'query' && item.data && item.data.responseTime
            );
            
            if (queries.length > 0) {
              const totalTime = queries.reduce((sum, q) => sum + q.data.responseTime, 0);
              value = totalTime / queries.length;
            }
          }
          break;
          
        case 'satisfactionRate':
          // Calculate from feedback data
          if (analyticsData.feedbackCount > 0) {
            value = analyticsData.avgRating * 20; // Convert 1-5 scale to percentage
          }
          break;
          
        default:
          return res.status(400).json({ error: `Unsupported metric: ${metric}` });
      }
      
      res.json({ metric, value });
    } catch (error) {
      console.error(`Error in getMetric for ${req.params.metric}:`, error);
      res.status(500).json({ error: 'Failed to retrieve metric data' });
    }
  }
  
  /**
   * Get time series data for analytics
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getTimeSeriesData(req, res) {
    try {
      const { metricType } = req.params;
      const { interval, startDate, endDate } = req.query;
      
      // Validate required parameters
      if (!interval || !startDate || !endDate) {
        return res.status(400).json({ 
          error: 'Missing required parameters: interval, startDate, and endDate are required' 
        });
      }
      
      // Validate interval
      const validIntervals = ['hourly', 'daily', 'monthly'];
      if (!validIntervals.includes(interval)) {
        return res.status(400).json({ 
          error: `Invalid interval: ${interval}. Must be one of: ${validIntervals.join(', ')}` 
        });
      }
      
      // For this implementation, we'll simulate the time series data
      // In a real implementation, you would call a service method
      const timeSeriesData = this.generateTimeSeriesData(metricType, interval, startDate, endDate);
      
      res.json(timeSeriesData);
    } catch (error) {
      console.error(`Error in getTimeSeriesData for ${req.params.metricType}:`, error);
      res.status(500).json({ error: 'Failed to retrieve time series data' });
    }
  }
  
  /**
   * Generate mock time series data for testing
   * This would be replaced with real data from the analytics service
   * @param {string} metricType - Type of metric
   * @param {string} interval - Time interval
   * @param {string} startDate - Start date
   * @param {string} endDate - End date
   * @returns {Array} Time series data
   */
  generateTimeSeriesData(metricType, interval, startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const result = [];
    
    let current = new Date(start);
    let incrementValue;
    
    switch (interval) {
      case 'hourly':
        incrementValue = 60 * 60 * 1000; // 1 hour
        break;
      case 'daily':
        incrementValue = 24 * 60 * 60 * 1000; // 1 day
        break;
      case 'monthly':
        incrementValue = 30 * 24 * 60 * 60 * 1000; // ~30 days
        break;
    }
    
    // Generate data points
    while (current <= end) {
      // Base value different for each metric type
      let baseValue;
      switch (metricType) {
        case 'queries':
          baseValue = 150;
          break;
        case 'users':
          baseValue = 50;
          break;
        default:
          baseValue = 100;
      }
      
      // Random fluctuation
      const fluctuation = Math.random() * 0.5 + 0.75; // 0.75 to 1.25
      
      // Add time pattern - more activity during business hours for hourly data
      let timePattern = 1;
      if (interval === 'hourly') {
        const hour = current.getHours();
        // More activity between 9am and 5pm
        if (hour >= 9 && hour <= 17) {
          timePattern = 1.5;
        }
      }
      
      // Add day pattern - less activity on weekends for daily data
      let dayPattern = 1;
      if (interval === 'daily') {
        const day = current.getDay();
        // Less activity on weekends (0 = Sunday, 6 = Saturday)
        if (day === 0 || day === 6) {
          dayPattern = 0.6;
        }
      }
      
      const value = Math.round(baseValue * fluctuation * timePattern * dayPattern);
      
      result.push({
        timestamp: current.toISOString(),
        value
      });
      
      // Increment to next interval
      current = new Date(current.getTime() + incrementValue);
    }
    
    return result;
  }
}

module.exports = new AnalyticsController();