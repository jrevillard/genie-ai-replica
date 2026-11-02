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
      console.log('[AdminDashboardService] Fetching system health');
      const response = await httpService.get('/admin/system-health');
      console.log('[AdminDashboardService] System health response:', JSON.stringify(response.data, null, 2));
      // The backend now provides all necessary metrics directly.
      // The faulty, redundant client-side logic has been removed to fix the error.
      return response.data;
    } catch (error) {
      console.error('[AdminDashboardService] Error fetching system health:', error.message, error.stack);
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
      return await httpService.get('admin/logs', { params: options });
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
      const response = await httpService.get('admin/user-stats', { params: options });
      console.log('User stats response:', {
        status: response.status,
        headers: response.headers,
        data: response.data
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching user stats:', error, {
        message: error.message,
        response: error.response ? {
          status: error.response.status,
          data: error.response.data
        } : null
      });
      throw error;
    }
  },

  /**
   * Get security metrics
   * @returns {Promise} Security statistics and metrics
   */
  async getSecurityMetrics() {
    try {
      const response = await httpService.get('admin/security-metrics');
      return response.data;
    } catch (error) {
      console.error('Error fetching security metrics:', error);
      throw error;
    }
  },

  /**
   * Get security scan details
   * @returns {Promise} Security scan details
   */
  async getSecurityDetails() {
    console.log('[AdminDashboardService] Fetching last security scan details');
    try {
      const response = await httpService.get('/admin/security/last-scan');
      console.log('[AdminDashboardService] Security scan details response:', JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error) {
      console.error('[AdminDashboardService] Error fetching security scan details:', error.message, error.stack);
      return {
        lastScan: 'Never',
        vulnerabilities: { critical: 0, medium: 0, low: 0, details: [] },
        vulnerabilityDetails: { critical: [], medium: [], low: [] },
        failedLoginDetails: [],
        suspiciousDetails: [],
      };
    }
  },

  /**
   * Trigger log rotation
   * @returns {Promise} Operation result
   */
  async rolloverLogs() {
    try {
      return await httpService.post('admin/logs/rollover');
    } catch (error) {
      console.error('Error rolling over logs:', error);
      throw error;
    }
  },

  /**
   * Configure logger settings (level, retention, etc.)
   * @param {Object} config - Logger configuration
   * @param {string} [config.level] - Log level (error, warn, info, debug)
   * @param {string} [config.errorMaxFiles] - Error log retention (e.g., '14d')
   * @param {string} [config.combinedMaxFiles] - Combined log retention (e.g., '14d')
   * @returns {Promise} Operation result
   */
  async configureLogger(config) {
    try {
      const response = await httpService.post('admin/logger/configure', config);
      return response.data;
    } catch (error) {
      console.error('Error configuring logger:', error);
      throw error;
    }
  },

  /**
   * Run system diagnostics
   * @returns {Promise} Diagnostics results
   */
  async runDiagnostics() {
    try {
      // Get the full response
      const response = await httpService.post('admin/diagnostics');
      // Return only the data payload, as expected by the component
      return response.data;
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
    console.log('[AdminDashboardService] Running security scan');
    try {
      const response = await httpService.post('/admin/security-scan');
      console.log('[AdminDashboardService] Security scan response:', JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error) {
      console.error('[AdminDashboardService] Error running security scan:', error.message, error.stack);
      return {
        success: false,
        data: {
          timestamp: new Date().toISOString(),
          status: 'failed',
          message: `Security scan failed: ${error.message}`,
        },
      };
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
      console.log('[AdminDashboardService] Getting logs summary with options:', JSON.stringify(options));
      const response = await httpService.get('/admin/logs/summary', { params: options });
      console.log('[AdminDashboardService] Logs summary response:', JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error) {
      console.error('[AdminDashboardService] Error fetching logs summary:', error.message, error.stack);
      return { data: { errors: [], warnings: [], date: options.date || new Date().toISOString().split('T')[0] } };
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
      const dateParams = this.convertDateRangeToParams(options.dateRange, options.startDate, options.endDate);
      const searchParams = {
        ...options,
        ...dateParams,
        includeArchived: true
      };
      console.log('Search logs request params:', searchParams);
      const response = await httpService.get('admin/logs/search', { params: searchParams });
      console.log('Search logs response status:', response.status);
      console.log('Search logs response headers:', response.headers);
      console.log('Search logs raw response data:', response.data);
      return response;
    } catch (error) {
      console.error('Error searching logs:', error);
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
      return await httpService.get('admin/users/search', { params: options });
    } catch (error) {
      console.error('Error searching users:', error);
      throw error;
    }
  },

  // ============================================================
  // QUERY INSPECTOR
  // ============================================================

  /**
   * Get count of pending user registrations (for badge notification)
   * @returns {Promise<number>} Count of pending users
   */
  async getPendingUsersCount() {
    try {
      const response = await httpService.get('/admin/users/pending/count');
      return response.data?.count || 0;
    } catch (error) {
      console.error('[AdminDashboardService] Error fetching pending users count:', error.message);
      return 0;
    }
  },

  /**
   * Get list of pending user registrations
   * @returns {Promise<Array>} List of pending users
   */
  async getPendingUsers() {
    try {
      const response = await httpService.get('/admin/users/pending');
      return response.data;
    } catch (error) {
      console.error('[AdminDashboardService] Error fetching pending users:', error.message);
      throw error;
    }
  },

  /**
   * Approve a pending user registration
   * @param {string} userId - User ID to approve
   * @param {string} role - Role to assign (defaults to 'User')
   * @returns {Promise} Approval result
   */
  async approveUser(userId, role = 'User') {
    try {
      const response = await httpService.post(`/admin/users/${userId}/approve`, { role });
      return response.data;
    } catch (error) {
      console.error('[AdminDashboardService] Error approving user:', error.message);
      throw error;
    }
  },

  /**
   * Reject a pending user registration
   * @param {string} userId - User ID to reject
   * @param {string} reason - Optional rejection reason
   * @returns {Promise} Rejection result
   */
  async rejectUser(userId, reason = '') {
    try {
      const response = await httpService.post(`/admin/users/${userId}/reject`, { reason });
      return response.data;
    } catch (error) {
      console.error('[AdminDashboardService] Error rejecting user:', error.message);
      throw error;
    }
  },

  /**
   * Get recent queries for admin inspection (Query Inspector)
   * @param {Object} options - Filter options
   * @param {number} options.limit - Max queries to return
   * @param {number} options.offset - Pagination offset
   * @param {string} options.userId - Filter by user ID
   * @param {string} options.searchText - Search in query text
   * @param {string} options.startDate - Filter from date
   * @param {string} options.endDate - Filter to date
   * @param {number} options.minConfidence - Min confidence score
   * @param {number} options.maxConfidence - Max confidence score
   * @returns {Promise} Queries with pagination
   */
  async getQueriesForInspector(options = {}) {
    try {
      console.log('[AdminDashboardService] Fetching queries for inspector', options);
      const response = await httpService.get('/admin/queries/inspect', { params: options });
      return response.data;
    } catch (error) {
      console.error('[AdminDashboardService] Error fetching queries for inspector:', error.message);
      throw error;
    }
  },

  /**
   * Get full query details for admin inspection
   * @param {string} queryId - The query ID to inspect
   * @returns {Promise} Full query details including metadata, context, response
   */
  async getQueryInspectorDetails(queryId) {
    try {
      console.log('[AdminDashboardService] Fetching query inspector details for:', queryId);
      const response = await httpService.get(`/admin/queries/inspect/${queryId}`);
      return response.data;
    } catch (error) {
      console.error('[AdminDashboardService] Error fetching query details:', error.message);
      throw error;
    }
  },

  /**
   * Get AI component configuration
   * @returns {Promise} AI configuration parameters (LLM, translation, embedding, etc.)
   */
  async getAIConfig() {
    try {
      const response = await httpService.get('/admin/ai-config');
      return response.data;
    } catch (error) {
      console.error('[AdminDashboardService] Error fetching AI config:', error.message);
      throw error;
    }
  },

  /**
   * K.2: get effective LLM settings (system prompt, abstention, generation
   * params, ingest prompts) + audit envelope (version/updatedAt/updatedBy).
   * @returns {Promise} { success, data }
   */
  async getLlmSettings() {
    try {
      const response = await httpService.get('/admin/pipeline-settings/llm-settings');
      return response.data;
    } catch (error) {
      console.error('[AdminDashboardService] Error fetching llm-settings:', error.message);
      throw error;
    }
  },

  /**
   * K.2: validate + save LLM settings (atomic write, version bump, audit stamp).
   * @param {Object} settings full settings content (systemPrompt, enforceAbstention,
   *   abstentionInstructions, generation, ingest)
   * @returns {Promise} { success, data } — 400s name the failing field
   */
  async updateLlmSettings(settings) {
    try {
      const response = await httpService.put('/admin/pipeline-settings/llm-settings', settings);
      return response.data;
    } catch (error) {
      console.error('[AdminDashboardService] Error saving llm-settings:', error.message);
      throw error;
    }
  },

  /**
   * K.3: get effective RAG tuning (retriever counts/thresholds/traversal/
   * hybrid + reranker strategy/adaptive params) + audit envelope.
   * @returns {Promise} { success, data }
   */
  async getRagTuning() {
    try {
      const response = await httpService.get('/admin/pipeline-settings/rag-tuning');
      return response.data;
    } catch (error) {
      console.error('[AdminDashboardService] Error fetching rag-tuning:', error.message);
      throw error;
    }
  },

  /**
   * K.3: validate + save RAG tuning (atomic write, version bump, audit
   * stamp; the next retrieval picks it up — no restart).
   * @param {Object} settings retriever/reranker blocks
   * @returns {Promise} { success, data } — 400s name the failing field
   */
  async updateRagTuning(settings) {
    try {
      const response = await httpService.put('/admin/pipeline-settings/rag-tuning', settings);
      return response.data;
    } catch (error) {
      console.error('[AdminDashboardService] Error saving rag-tuning:', error.message);
      throw error;
    }
  }
};

export default adminDashboardService;