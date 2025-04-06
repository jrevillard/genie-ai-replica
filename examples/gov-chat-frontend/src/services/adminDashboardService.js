// src/services/adminDashboardService.js
import httpService from './httpService';

/**
 * Service for managing admin dashboard data
 * Provides methods to interact with dashboard-related endpoints
 */
const adminDashboardService = {
  /**
   * Get system health overview data
   * @returns {Promise} System health metrics
   */
  async getSystemHealth() {
    try {
      return await httpService.get('/admin/system-health');
    } catch (error) {
      console.error('Error fetching system health:', error);
      throw error;
    }
  },

  /**
   * Get latest system logs
   * @param {Object} options - Log filtering options
   * @param {Number} options.limit - Maximum number of logs to return
   * @param {String} options.level - Log level filter
   * @param {String} options.service - Service name filter
   * @returns {Promise} Array of log entries
   */
  async getLogs(options = {}) {
    try {
      return await httpService.get('/admin/logs', { params: options });
    } catch (error) {
      console.error('Error fetching logs:', error);
      throw error;
    }
  },

  /**
   * Get user statistics and user list
   * @param {Object} options - User filtering options
   * @returns {Promise} User statistics and list
   */
  async getUserStats(options = {}) {
    try {
      return await httpService.get('/admin/user-stats', { params: options });
    } catch (error) {
      console.error('Error fetching user stats:', error);
      throw error;
    }
  },

  /**
   * Get security metrics
   * @returns {Promise} Security statistics and metrics
   */
  async getSecurityMetrics() {
    try {
      return await httpService.get('/admin/security-metrics');
    } catch (error) {
      console.error('Error fetching security metrics:', error);
      throw error;
    }
  },

  /**
   * Trigger log rotation
   * @returns {Promise} Operation result
   */
  async rolloverLogs() {
    try {
      return await httpService.post('/admin/logs/rollover');
    } catch (error) {
      console.error('Error rolling over logs:', error);
      throw error;
    }
  },

  /**
   * Run system diagnostics
   * @returns {Promise} Diagnostics results
   */
  async runDiagnostics() {
    try {
      return await httpService.post('/admin/diagnostics');
    } catch (error) {
      console.error('Error running diagnostics:', error);
      throw error;
    }
  },

  /**
   * Run a security scan
   * @returns {Promise} Security scan results
   */
  async runSecurityScan() {
    try {
      return await httpService.post('/admin/security-scan');
    } catch (error) {
      console.error('Error running security scan:', error);
      throw error;
    }
  },

  /**
   * Get logs summary grouped by type and service
   * @param {Object} options - Options for filtering logs
   * @param {string} options.date - Date for which to get logs (YYYY-MM-DD)
   * @returns {Promise} Logs summary data
   */
  async getLogsSummary(options = {}) {
    try {
      return await httpService.get('/admin/logs/summary', { params: options });
    } catch (error) {
      console.error('Error fetching logs summary:', error);
      throw error;
    }
  },

  /**
   * Search logs with filtering across multiple log files
   * @param {Object} options - Search options
   * @param {string} options.term - Search term
   * @param {string} options.level - Log level filter (ERROR, WARNING, INFO)
   * @param {string} options.service - Service name filter
   * @param {string} options.dateRange - Date range (today, yesterday, week, month, custom)
   * @param {string} options.startDate - Custom start date (YYYY-MM-DD)
   * @param {string} options.endDate - Custom end date (YYYY-MM-DD)
   * @returns {Promise} Search results
   */
  async searchLogs(options = {}) {
    try {
      // Convert date range to actual dates
      const dateParams = this.convertDateRangeToParams(options.dateRange, options.startDate, options.endDate);
      
      // Add the date parameters to the options
      const searchParams = {
        ...options,
        ...dateParams,
        includeArchived: true // Flag to tell backend to search archived log files
      };

      console.log('Search logs request params:', searchParams); // Debug: Log the request parameters
      const response = await httpService.get('/admin/logs/search', { params: searchParams });
      console.log('Search logs response status:', response.status); // Debug: Log the response status
      console.log('Search logs response headers:', response.headers); // Debug: Log the response headers
      console.log('Search logs raw response data:', response.data); // Debug: Log the raw response data
      return response;
    } catch (error) {
      console.error('Error searching logs:', error); // Already present, but keeping for consistency
      throw error;
    }
  },

  /**
   * Convert date range option to start and end date parameters
   * @param {string} dateRange - Date range selection
   * @param {string} startDate - Custom start date (for custom range)
   * @param {string} endDate - Custom end date (for custom range)
   * @returns {Object} Object with startDate and endDate
   */
  convertDateRangeToParams(dateRange, customStartDate, customEndDate) {
    const today = new Date();
    let startDate, endDate;

    switch (dateRange) {
      case 'today':
        startDate = this.formatDate(today);
        endDate = this.formatDate(today);
        break;
      case 'yesterday':
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        startDate = this.formatDate(yesterday);
        endDate = this.formatDate(yesterday);
        break;
      case 'week':
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        startDate = this.formatDate(weekAgo);
        endDate = this.formatDate(today);
        break;
      case 'month':
        const monthAgo = new Date(today);
        monthAgo.setDate(monthAgo.getDate() - 30);
        startDate = this.formatDate(monthAgo);
        endDate = this.formatDate(today);
        break;
      case 'custom':
        startDate = customStartDate;
        endDate = customEndDate;
        break;
      default:
        startDate = this.formatDate(today);
        endDate = this.formatDate(today);
    }

    return { startDate, endDate };
  },

  /**
   * Format date as YYYY-MM-DD
   * @param {Date} date - Date to format
   * @returns {string} Formatted date
   */
  formatDate(date) {
    return date.toISOString().split('T')[0];
  },

  /**
 * Search users with filtering
 * @param {Object} options - Search options
 * @param {string} options.term - Search term
 * @param {string} options.field - Field to search (name, email, role, or all)
 * @param {number} options.limit - Maximum number of users to return
 * @param {number} options.offset - Offset for pagination
 * @returns {Promise} Search results
 */
  async searchUsers(options = {}) {
    try {
      // Pass options directly as first parameter, not wrapped in { params: ... }
      return await httpService.get('/admin/users/search', options);
    } catch (error) {
      console.error('Error searching users:', error);
      throw error;
    }
  }
};



export default adminDashboardService;