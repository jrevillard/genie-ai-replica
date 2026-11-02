// services/databaseOperationsService.js
import httpService from './httpService';

/**
 * Database Operations Service (Frontend)
 * 
 * HTTP client for the Database Management tab in the System Administration dashboard.
 * Communicates with the backend admin API to perform maintenance operations on the
 * ArangoDB "node-services" database.
 * 
 * Backend endpoints are defined in: gov-chat-backend/routes/admin-routes.js
 * Backend logic lives in: gov-chat-backend/services/database-operations-service.js
 * 
 * All endpoints require admin authentication (JWT + admin role).
 * 
 * @see docs/Database-Management.md for full feature documentation
 */
export default {
  /**
   * Reindex the database.
   * 
   * Drops all non-primary indexes from every collection and recreates them
   * based on predefined index definitions. This can improve query performance
   * after bulk imports, migrations, or schema changes.
   * 
   * Note: This temporarily removes indexes — run during low-traffic periods.
   * 
   * @returns {Promise<Object>} Response with { success, message, results[] }
   *   where results contains per-collection status and indexesRecreated count
   */
  async reindexDatabase() {
    try {
      return await httpService.post('/admin/database/reindex');
    } catch (error) {
      console.error('Error reindexing database:', error);
      throw error;
    }
  },
  
  /**
   * Create a full database backup.
   * 
   * Exports all non-system collections to a JSON file on the server.
   * The backup is stored in the configured BACKUP_DIR and old backups
   * are automatically cleaned up based on MAX_BACKUPS retention setting.
   * 
   * @returns {Promise<Object>} Response with { success, message, backupFile, backupLocation, size, collections, timestamp, compressed }
   */
  async backupDatabase() {
    try {
      return await httpService.post('/admin/database/backup');
    } catch (error) {
      console.error('Error backing up database:', error);
      throw error;
    }
  },
  
  /**
   * Optimize the database.
   * 
   * Compacts all collections (reclaims disk space from deleted documents)
   * and analyzes indexes for performance issues. Returns suggestions for
   * indexes that may need attention (low selectivity, overly complex).
   * 
   * @returns {Promise<Object>} Response with { success, message, results[] }
   *   where results contains per-collection status and indexSuggestions array
   */
  async optimizeDatabase() {
    try {
      return await httpService.post('/admin/database/optimize');
    } catch (error) {
      console.error('Error optimizing database:', error);
      throw error;
    }
  },
  
  /**
   * Get database statistics for the admin dashboard display.
   * 
   * Returns current database metrics including total size, collection count,
   * last reindex timestamp, and per-collection breakdowns.
   * 
   * @returns {Promise<Object>} Response with { success, databaseSize, totalTables, lastReindex, collections[], systemStats, server }
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
