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
  }
};

export default adminDashboardService;