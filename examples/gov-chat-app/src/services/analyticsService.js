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
    this.latestUniqueUsers = 0; // Store the latest unique users count
    this.$i18n = null; // Will be set after initialization
  }

  /**
   * Get unique users count directly
   * @param {string} startDate - Start date (ISO string)
   * @param {string} endDate - End date (ISO string)
   * @returns {Promise<number>} Count of unique users
   */
  async getUniqueUsersCount(startDate, endDate) {
    try {
      console.log(`Directly getting unique users count from ${startDate} to ${endDate}`);
      const response = await axios.get(`${this.baseUrl}/analytics/metric/uniqueUsers`, {
        params: { startDate, endDate }
      });

      console.log("Unique users direct response:", response.data);

      if (response.data && typeof response.data.value === 'number') {
        this.latestUniqueUsers = response.data.value;
        return response.data.value;
      }

      return 0;
    } catch (error) {
      console.error('Error getting unique users count:', error);
      return 0;
    }
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

      // Get current locale from i18n if available
      const locale = this.$i18n ? this.$i18n.locale : 'en';

      console.log(`Fetching dashboard analytics with locale: ${locale}`);

      // Change this URL to include /analytics/
      const response = await axios.get(`${this.baseUrl}/analytics/dashboard`, {
        params: {
          startDate,
          endDate,
          locale // Pass locale to the API
        }
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

      // Map frontend metric names to backend API metric names
      const metricMap = {
        'totalQueries': 'totalQueries',
        'uniqueUsers': 'uniqueUsers',
        'averageResponseTime': 'averageResponseTime',
        'satisfactionRate': 'satisfactionRate'
      };

      const apiMetric = metricMap[metric] || metric;

      // Get current period data
      const currentResponse = await axios.get(`${this.baseUrl}/analytics/metric/${apiMetric}`, {
        params: { startDate: current.startDate, endDate: current.endDate }
      });

      // Get previous period data
      const previousResponse = await axios.get(`${this.baseUrl}/analytics/metric/${apiMetric}`, {
        params: { startDate: previous.startDate, endDate: previous.endDate }
      });

      console.log(`Response for ${metric}:`, {
        current: currentResponse.data,
        previous: previousResponse.data
      });

      // For uniqueUsers specifically, update the analytics value in real-time
      if (metric === 'uniqueUsers' && currentResponse.data && typeof currentResponse.data.value === 'number') {
        // Force an update to the dashboard's uniqueUsers value
        this.latestUniqueUsers = currentResponse.data.value;
      }

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
      console.log(`Fetching time series data for ${metricType}, interval ${interval}`);

      const response = await axios.get(`${this.baseUrl}/analytics/timeseries/${metricType}`, {
        params: { interval, startDate, endDate }
      });

      if (!response.data || !Array.isArray(response.data)) {
        console.warn(`Invalid response format for ${metricType} time series:`, response.data);
        return this.getFallbackTimeSeriesData(interval);
      }

      // Process the data to ensure it's valid
      return response.data.map(item => ({
        timestamp: item.timestamp || '',
        dateLabel: this.formatDateLabel(item.timestamp, interval),
        value: typeof item.value === 'number' ? item.value : 0,
        userCount: typeof item.userCount === 'number' ? item.userCount : 0
      }));
    } catch (error) {
      console.error('Error fetching time series data:', error);
      return this.getFallbackTimeSeriesData(interval);
    }
  }

  /**
   * Get fallback time series data
   * @param {string} interval - Time interval
   * @returns {Array} Sample time series data
   */
  getFallbackTimeSeriesData(interval) {
    const result = [];
    const now = new Date();
    let count = 0;

    // Determine number of data points based on interval
    switch (interval) {
      case 'hourly':
        count = 24;
        break;
      case 'daily':
        count = 30;
        break;
      case 'weekly':
        count = 12;
        break;
      case 'monthly':
        count = 12;
        break;
      default:
        count = 30;
    }

    // Generate sample data
    for (let i = 0; i < count; i++) {
      const date = new Date(now);

      // Adjust date based on interval
      switch (interval) {
        case 'hourly':
          date.setHours(date.getHours() - (count - i - 1));
          break;
        case 'daily':
          date.setDate(date.getDate() - (count - i - 1));
          break;
        case 'weekly':
          date.setDate(date.getDate() - (count - i - 1) * 7);
          break;
        case 'monthly':
          date.setMonth(date.getMonth() - (count - i - 1));
          break;
        default:
          date.setDate(date.getDate() - (count - i - 1));
      }

      // Format date label
      const dateLabel = this.formatDateLabel(date, interval);

      // Generate random value
      const value = Math.floor(Math.random() * 500) + 500;

      // Add data point
      result.push({
        timestamp: date.toISOString(),
        dateLabel,
        value,
        userCount: Math.floor(value * 0.2) // 20% of value
      });
    }

    return result;
  }

  /**
   * Format date label based on interval
   * @param {string|Date} timestamp - Date to format
   * @param {string} interval - Time interval
   * @returns {string} Formatted date label
   */
  formatDateLabel(timestamp, interval) {
    if (!timestamp) return '';

    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    if (isNaN(date.getTime())) return String(timestamp);

    try {
      switch (interval) {
        case 'hourly':
          return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        case 'daily':
          return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        case 'weekly':
          return `Week ${Math.ceil((date.getDate() + 6 - date.getDay()) / 7)} ${date.toLocaleDateString([], { month: 'short' })}`;
        case 'monthly':
          return date.toLocaleDateString([], { month: 'short', year: 'numeric' });
        default:
          return date.toLocaleDateString();
      }
    } catch (error) {
      console.warn('Error formatting date label:', error);
      return String(timestamp);
    }
  }
  /**
   * Transform time series data for charts
   * @param {Array} data - Raw time series data
   * @param {string} interval - Data interval
   * @returns {Array} Transformed time series data
   */
  transformTimeSeriesData(data, interval) {
    // Safety check for input data
    if (!data || !Array.isArray(data)) return [];

    // Filter out invalid entries
    const validData = data.filter(item => item && item.timestamp);

    return validData.map(item => {
      // Format date label based on interval
      let dateLabel;
      try {
        const date = new Date(item.timestamp);

        if (!isNaN(date.getTime())) {
          switch (interval) {
            case 'hourly':
              dateLabel = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              break;

            case 'daily':
              dateLabel = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
              break;

            case 'weekly':
              const weekNum = this.getWeekNumber(date);
              dateLabel = `W${weekNum} ${date.toLocaleDateString([], { month: 'short' })}`;
              break;

            case 'monthly':
              dateLabel = date.toLocaleDateString([], { month: 'short', year: 'numeric' });
              break;

            default:
              dateLabel = date.toLocaleDateString();
          }
        } else {
          dateLabel = item.timestamp;
        }
      } catch (error) {
        console.warn(`Error formatting date label for ${item.timestamp}:`, error);
        dateLabel = item.timestamp;
      }

      return {
        timestamp: item.timestamp,
        dateLabel,
        value: typeof item.value === 'number' ? item.value : 0
      };
    });
  }

  /**
   * Get week number of the year
   * @param {Date} date - Date object
   * @returns {number} Week number
   */
  getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
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

    console.log("Dashboard data received:", data);

    // Extract the unique users count
    let uniqueUsers = 0;
    if (data.users && typeof data.users.activeCount === 'number') {
      uniqueUsers = data.users.activeCount;
      console.log("Unique users count from API:", uniqueUsers);
    } else {
      console.warn("No users.activeCount in dashboard data:", data.users);
    }

    // Use latestUniqueUsers if available and not zero (from getComparisonData)
    if (this.latestUniqueUsers && this.latestUniqueUsers > 0) {
      console.log("Using latest unique users count:", this.latestUniqueUsers);
      uniqueUsers = this.latestUniqueUsers;
    }

    // Transform the data from the API response structure
    return {
      totalQueries: data.queries?.total || 0,
      uniqueUsers: uniqueUsers || 0,
      averageResponseTime: data.queries?.avgResponseTime || 0,
      satisfactionRate: data.feedback?.positivePercentage || 0,

      // Transform category distribution
      queryDistribution: (data.categories || []).map(cat => ({
        categoryId: cat.categoryId,
        name: cat.name,
        count: cat.count
      })),

      // Top queries from the response
      topQueries: data.topQueries || []
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