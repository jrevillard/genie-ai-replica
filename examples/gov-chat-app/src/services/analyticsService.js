// src/services/analyticsService.js
import axios from 'axios';

/**
 * Service for interacting with the Analytics API
 */
class AnalyticsService {
  /**
   * Base URL for the analytics API endpoints
   */
  constructor() {
    this.baseUrl = process.env.VUE_APP_API_URL || '/api';
  }

  /**
   * Get dashboard analytics data
   * @param {string} period - Time period (daily, weekly, monthly, all-time)
   * @param {string} date - Selected date (YYYY-MM-DD)
   * @returns {Promise<Object>} Dashboard analytics data
   */
  async getDashboardAnalytics(period, date) {
    try {
      // Calculate start and end dates based on period and date
      const { startDate, endDate } = this.calculateDateRange(period, date);
      
      const response = await axios.get(`${this.baseUrl}/analytics/dashboard`, {
        params: { startDate, endDate }
      });
      
      return this.transformDashboardData(response.data);
    } catch (error) {
      console.error('Error fetching dashboard analytics:', error);
      throw error;
    }
  }
  
  /**
   * Get comparison data for trends
   * @param {string} metric - Metric name
   * @param {string} currentPeriod - Current period type
   * @param {string} currentDate - Current date
   * @param {string} previousPeriod - Previous period type
   * @param {string} previousDate - Previous date
   * @returns {Promise<Object>} Comparison data
   */
  async getComparisonData(metric, currentPeriod, currentDate, previousPeriod, previousDate) {
    try {
      // Calculate date ranges for current and previous periods
      const current = this.calculateDateRange(currentPeriod, currentDate);
      const previous = this.calculateDateRange(previousPeriod, previousDate);
      
      // Get current period data
      const currentResponse = await axios.get(`${this.baseUrl}/analytics/metric/${metric}`, {
        params: { startDate: current.startDate, endDate: current.endDate }
      });
      
      // Get previous period data
      const previousResponse = await axios.get(`${this.baseUrl}/analytics/metric/${metric}`, {
        params: { startDate: previous.startDate, endDate: previous.endDate }
      });
      
      return {
        current: currentResponse.data.value,
        previous: previousResponse.data.value
      };
    } catch (error) {
      console.error(`Error fetching comparison data for ${metric}:`, error);
      return { current: null, previous: null };
    }
  }
  
  /**
   * Get time series data for charts
   * @param {string} metricType - Type of metric (queries, users, etc.)
   * @param {string} interval - Interval for data points (hourly, daily, monthly)
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @returns {Promise<Array>} Time series data
   */
  async getTimeSeriesData(metricType, interval, startDate, endDate) {
    try {
      const response = await axios.get(`${this.baseUrl}/analytics/timeseries/${metricType}`, {
        params: { interval, startDate, endDate }
      });
      
      return this.transformTimeSeriesData(response.data, interval);
    } catch (error) {
      console.error('Error fetching time series data:', error);
      return [];
    }
  }
  
  /**
   * Calculate start and end date for a given period
   * @param {string} period - Time period (daily, weekly, monthly, all-time)
   * @param {string} date - Selected date (YYYY-MM-DD)
   * @returns {Object} Start and end date
   */
  calculateDateRange(period, date) {
    const endDate = date ? new Date(date) : new Date();
    let startDate = new Date(endDate);
    
    switch (period) {
      case 'daily':
        // Just this day
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);
        break;
        
      case 'weekly':
        // Last 7 days
        startDate.setDate(endDate.getDate() - 6);
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);
        break;
        
      case 'monthly':
        // Last 30 days
        startDate.setDate(endDate.getDate() - 29);
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);
        break;
        
      case 'all-time':
        // All data (use a very old start date)
        startDate = new Date('2020-01-01');
        break;
    }
    
    return {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString()
    };
  }
  
  /**
   * Transform dashboard data for UI display
   * @param {Object} data - Raw API response data
   * @returns {Object} Transformed dashboard data
   */
  transformDashboardData(data) {
    // Default values if data is missing
    const defaultData = {
      totalQueries: 0,
      uniqueUsers: 0,
      averageResponseTime: 0,
      satisfactionRate: 0,
      queryDistribution: [],
      topQueries: []
    };
    
    if (!data) return defaultData;
    
    // Transform the data from the API response structure
    return {
      totalQueries: data.queries?.total || 0,
      uniqueUsers: data.users?.activeCount || 0,
      averageResponseTime: data.queries?.avgResponseTime || 0,
      satisfactionRate: data.feedback?.positivePercentage || 0,
      
      // Transform category distribution
      queryDistribution: (data.categories || []).map(cat => ({
        categoryId: cat.categoryId,
        name: cat.name,
        count: cat.count
      })),
      
      // We don't have top queries in the original response, but we could add them
      topQueries: []
    };
  }
  
  /**
   * Transform time series data for charts
   * @param {Array} data - Raw time series data
   * @param {string} interval - Data interval
   * @returns {Array} Transformed time series data
   */
  transformTimeSeriesData(data, interval) {
    if (!Array.isArray(data)) return [];
    
    return data.map(item => {
      // Format date label based on interval
      let dateLabel;
      const date = new Date(item.timestamp);
      
      switch (interval) {
        case 'hourly':
          dateLabel = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          break;
          
        case 'daily':
          dateLabel = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
          break;
          
        case 'monthly':
          dateLabel = date.toLocaleDateString([], { month: 'short', year: 'numeric' });
          break;
          
        default:
          dateLabel = date.toLocaleDateString();
      }
      
      return {
        timestamp: item.timestamp,
        dateLabel,
        value: item.value
      };
    });
  }
  
  /**
   * Format a value for display
   * @param {number} value - Value to format
   * @param {string} format - Format type (number, time, percent)
   * @returns {string} Formatted value
   */
  formatValue(value, format = 'number') {
    if (value === null || value === undefined) return '—';
    
    switch (format) {
      case 'number':
        return value.toLocaleString();
        
      case 'time':
        // Format as seconds with 1 decimal place
        return `${value.toFixed(1)}s`;
        
      case 'percent':
        return `${value.toFixed(1)}%`;
        
      default:
        return String(value);
    }
  }
  
  /**
   * Calculate percentage change between two values
   * @param {number} current - Current value
   * @param {number} previous - Previous value
   * @returns {number} Percentage change
   */
  calculatePercentChange(current, previous) {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / Math.abs(previous)) * 100;
  }
  
  /**
   * Get CSS class for trend indicator
   * @param {number} change - Percentage change
   * @param {boolean} isInverse - Whether less is better (e.g., response time)
   * @returns {string} CSS class
   */
  getTrendColor(change, isInverse = false) {
    if (!change) return 'neutral';
    
    const isPositive = change > 0;
    
    if (isInverse) {
      return isPositive ? 'negative' : 'positive';
    }
    
    return isPositive ? 'positive' : 'negative';
  }
}

export default new AnalyticsService();