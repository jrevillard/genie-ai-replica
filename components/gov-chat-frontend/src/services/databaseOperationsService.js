// services/databasOperationsService.js
import httpService from './httpService';

/**
 * Service for database management operations
 * Provides methods to interact with database-related endpoints
 */
export default {
  /**
   * Create a database backup
   *
   * @returns {Promise} API response with backup details
   */
  async backupDatabase() {
    try {
      return await httpService.post('/database/backup');
    } catch (error) {
      console.error('Error backing up database:', error);
      throw error;
    }
  },

  /**
   * Optimize the database
   * Performs operations like compacting collections
   *
   * @returns {Promise} API response with optimization results
   */
  async optimizeDatabase() {
    try {
      return await httpService.post('/database/optimize');
    } catch (error) {
      console.error('Error optimizing database:', error);
      throw error;
    }
  },

  /**
   * Get database statistics
   *
   * @returns {Promise} API response with database statistics
   */
  async getDatabaseStats() {
    try {
      return await httpService.get('/admin/database/stats');
    } catch (error) {
      console.error('Error getting database stats:', error);
      throw error;
    }
  }
};
