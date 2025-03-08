// src/services/analyticsService.js - Analytics Frontend Service
import api from './api';

export default {
  /**
   * Get dashboard analytics
   * @param {String} period - Time period ('daily', 'weekly', 'monthly', 'all-time')
   * @param {String} date - Reference date (YYYY-MM-DD)
   * @returns {Promise} Analytics data
   */
  async getDashboardAnalytics(period = 'daily', date = new Date().toISOString().split('T')[0]) {
    try {
      const response = await api.get('/analytics/dashboard', {
        params: { period, date }
      });
      
      return response.data;
    } catch (error) {
      console.error('Error fetching dashboard analytics:', error);
      throw error;
    }
  },

  /**
   * Get category analytics
   * @param {String} period - Time period
   * @param {String} date - Reference date
   * @returns {Promise} Category distribution data
   */
  async getCategoryAnalytics(period = 'daily', date = new Date().toISOString().split('T')[0]) {
    try {
      const response = await api.get('/analytics/categories', {
        params: { period, date }
      });
      
      return response.data;
    } catch (error) {
      console.error('Error fetching category analytics:', error);
      throw error;
    }
  },

  /**
   * Get top queries
   * @param {String} period - Time period
   * @param {String} date - Reference date
   * @param {Number} limit - Number of top queries to return
   * @returns {Promise} Top queries data
   */
  async getTopQueries(period = 'daily', date = new Date().toISOString().split('T')[0], limit = 5) {
    try {
      const response = await api.get('/analytics/top-queries', {
        params: { period, date, limit }
      });
      
      return response.data;
    } catch (error) {
      console.error('Error fetching top queries:', error);
      throw error;
    }
  },

  /**
   * Get user satisfaction metrics
   * @param {String} period - Time period
   * @param {String} date - Reference date
   * @returns {Promise} User satisfaction data
   */
  async getUserSatisfaction(period = 'daily', date = new Date().toISOString().split('T')[0]) {
    try {
      const response = await api.get('/analytics/satisfaction', {
        params: { period, date }
      });
      
      return response.data;
    } catch (error) {
      console.error('Error fetching user satisfaction metrics:', error);
      throw error;
    }
  },

  /**
   * Get response time metrics
   * @param {String} period - Time period
   * @param {String} date - Reference date
   * @returns {Promise} Response time data
   */
  async getResponseTimes(period = 'daily', date = new Date().toISOString().split('T')[0]) {
    try {
      const response = await api.get('/analytics/response-times', {
        params: { period, date }
      });
      
      return response.data;
    } catch (error) {
      console.error('Error fetching response time metrics:', error);
      throw error;
    }
  },

  /**
   * Get unique users stats
   * @param {String} period - Time period
   * @param {String} date - Reference date
   * @returns {Promise} Unique users data
   */
  async getUniqueUsers(period = 'daily', date = new Date().toISOString().split('T')[0]) {
    try {
      const response = await api.get('/analytics/unique-users', {
        params: { period, date }
      });
      
      return response.data;
    } catch (error) {
      console.error('Error fetching unique users stats:', error);
      throw error;
    }
  },

  /**
   * Get time-series data for a specific metric
   * @param {String} metric - Metric name ('queries', 'users', 'satisfaction', 'responsetime')
   * @param {String} interval - Time interval ('hourly', 'daily', 'weekly', 'monthly')
   * @param {String} startDate - Start date (YYYY-MM-DD)
   * @param {String} endDate - End date (YYYY-MM-DD)
   * @returns {Promise} Time-series data
   */
  async getTimeSeriesData(metric, interval = 'daily', startDate, endDate) {
    try {
      const response = await api.get('/analytics/timeseries', {
        params: { 
          metric, 
          interval, 
          startDate, 
          endDate 
        }
      });
      
      return response.data;
    } catch (error) {
      console.error(`Error fetching time-series data for ${metric}:`, error);
      throw error;
    }
  },

  /**
   * Get comparison data between two periods
   * @param {String} metric - Metric to compare
   * @param {String} currentPeriod - Current period ('daily', 'weekly', 'monthly')
   * @param {String} currentDate - Current period reference date
   * @param {String} previousPeriod - Previous period ('daily', 'weekly', 'monthly')
   * @param {String} previousDate - Previous period reference date
   * @returns {Promise} Comparison data
   */
  async getComparisonData(metric, currentPeriod, currentDate, previousPeriod, previousDate) {
    try {
      const response = await api.get('/analytics/comparison', {
        params: {
          metric,
          currentPeriod,
          currentDate,
          previousPeriod,
          previousDate
        }
      });
      
      return response.data;
    } catch (error) {
      console.error(`Error fetching comparison data for ${metric}:`, error);
      throw error;
    }
  },

  /**
   * Track event for analytics
   * @param {String} eventType - Event type
   * @param {Object} eventData - Event data
   * @returns {Promise} Tracking result
   */
  async trackEvent(eventType, eventData = {}) {
    try {
      const response = await api.post('/analytics/events', {
        eventType,
        eventData,
        timestamp: new Date().toISOString()
      });
      
      return response.data;
    } catch (error) {
      console.error(`Error tracking event ${eventType}:`, error);
      // Non-critical error, can be ignored in production
      return null;
    }
  },

  /**
   * Format numeric data for display
   * @param {Number} value - Numeric value
   * @param {String} format - Format type ('number', 'percent', 'time', 'decimal')
   * @returns {String} Formatted value
   */
  formatValue(value, format = 'number') {
    if (value === undefined || value === null) return '-';
    
    switch (format) {
      case 'percent':
        return `${(value).toFixed(1)}%`;
      
      case 'time':
        // Format milliseconds as "X.X s"
        return `${(value / 1000).toFixed(1)} s`;
      
      case 'decimal':
        return value.toFixed(2);
      
      case 'number':
      default:
        return value.toLocaleString();
    }
  },

  /**
   * Calculate percentage change between two values
   * @param {Number} current - Current value
   * @param {Number} previous - Previous value
   * @returns {Number} Percentage change
   */
  calculatePercentChange(current, previous) {
    if (!previous) return 100; // If previous is 0, return 100% increase
    
    return ((current - previous) / previous) * 100;
  },

  /**
   * Get color for trend indicator
   * @param {Number} change - Percentage change
   * @param {Boolean} isInverse - Whether higher values are worse (e.g., response time)
   * @returns {String} CSS color class
   */
  getTrendColor(change, isInverse = false) {
    if (Math.abs(change) < 1) return 'neutral'; // Less than 1% change is neutral
    
    if ((change > 0 && !isInverse) || (change < 0 && isInverse)) {
      return 'positive';
    } else {
      return 'negative';
    }
  }
};
