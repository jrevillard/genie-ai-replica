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
      
      // In a real implementation, this would make an API call
      // For now, return sample data
      return this.getSampleDashboardData();
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
    // Return sample comparison data
    return {
      current: 100,
      previous: 90
    };
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
    // Return sample time series data
    return this.getSampleTimeSeriesData(interval);
  }
  
  /**
   * Get sample dashboard data
   * @returns {Object} Sample dashboard data
   */
  getSampleDashboardData() {
    return {
      totalQueries: 12452,
      uniqueUsers: 3847,
      averageResponseTime: 2.3,
      satisfactionRate: 87.5,
      queryDistribution: [
        { categoryId: 'cat1', name: 'Business & Economy', count: 2347 },
        { categoryId: 'cat2', name: 'Transportation', count: 1782 },
        { categoryId: 'cat3', name: 'Taxes & Revenue', count: 1645 },
        { categoryId: 'cat4', name: 'Immigration & Citizenship', count: 1245 },
        { categoryId: 'cat5', name: 'Education & Learning', count: 980 },
        { categoryId: 'cat6', name: 'Housing & Properties', count: 850 },
        { categoryId: 'cat7', name: 'Health & Healthcare', count: 720 },
        { categoryId: 'cat8', name: 'Justice & Legal', count: 650 }
      ],
      topQueries: [
        { text: "How do I apply for a business license?", count: 2347, avgTime: 2.3 },
        { text: "Where can I find tax forms?", count: 1982, avgTime: 1.8 },
        { text: "How to renew my driver's license?", count: 1645, avgTime: 2.1 },
        { text: "What documents do I need for passport application?", count: 1423, avgTime: 3.4 },
        { text: "When are property taxes due?", count: 1289, avgTime: 1.5 }
      ]
    };
  }
  
  /**
   * Get sample time series data
   * @param {string} interval - Time interval (hourly, daily, monthly)
   * @returns {Array} Sample time series data
   */
  getSampleTimeSeriesData(interval) {
    const now = new Date();
    const result = [];
    
    switch (interval) {
      case 'hourly':
        // Hourly data for today
        for (let hour = 0; hour < 24; hour++) {
          const time = new Date(now);
          time.setHours(hour, 0, 0, 0);
          
          // More activity during business hours
          const baseValue = hour >= 9 && hour <= 17 ? 50 : 20;
          const value = Math.round(baseValue * (0.8 + Math.random() * 0.4));
          
          result.push({
            timestamp: time.toISOString(),
            dateLabel: time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            value: value
          });
        }
        break;
        
      case 'daily':
        // Daily data for the month
        for (let day = 29; day >= 0; day--) {
          const date = new Date(now);
          date.setDate(date.getDate() - day);
          date.setHours(0, 0, 0, 0);
          
          // Random fluctuation with weekend pattern
          const isWeekend = date.getDay() === 0 || date.getDay() === 6;
          const baseValue = isWeekend ? 200 : 350;
          const value = Math.round(baseValue * (0.8 + Math.random() * 0.4));
          
          result.push({
            timestamp: date.toISOString(),
            dateLabel: date.toLocaleDateString([], { month: 'short', day: 'numeric' }),
            value: value
          });
        }
        break;
        
      case 'monthly':
        // Monthly data for the year
        for (let month = 11; month >= 0; month--) {
          const date = new Date(now);
          date.setMonth(date.getMonth() - month);
          date.setDate(1);
          date.setHours(0, 0, 0, 0);
          
          // Random value with seasonal pattern
          const seasonalFactor = 1 + Math.sin(month / 6 * Math.PI) * 0.2;
          const value = Math.round(1000 * seasonalFactor * (0.8 + Math.random() * 0.4));
          
          result.push({
            timestamp: date.toISOString(),
            dateLabel: date.toLocaleDateString([], { month: 'short', year: 'numeric' }),
            value: value
          });
        }
        break;
        
      default:
        // Weekly data
        for (let week = 11; week >= 0; week--) {
          const date = new Date(now);
          date.setDate(date.getDate() - week * 7);
          
          result.push({
            timestamp: date.toISOString(),
            dateLabel: `Week ${12 - week}`,
            value: Math.round(500 + Math.random() * 500)
          });
        }
    }
    
    return result;
  }
  
  /**
   * Calculate date range based on period and date
   * @param {string} period - Time period (daily, weekly, monthly, all-time)
   * @param {string} date - Selected date
   * @returns {Object} Start and end dates
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