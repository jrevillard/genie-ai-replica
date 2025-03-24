// db.service.js
const { Database } = require('arangojs');

/**
 * Singleton class to manage database connections across the application
 */
class DatabaseService {
    constructor() {
        this._connections = new Map();
        this._defaultConfig = {
          url: process.env.ARANGO_URL || 'http://arango-vector-db:8529', // Use env variable
          databaseName: process.env.ARANGO_DB || 'node-services',
          auth: {
            username: process.env.ARANGO_USERNAME || 'root',
            password: process.env.ARANGO_PASSWORD || 'test'
          }
        };
      }
      

  /**
   * Get a database connection - creates one if it doesn't exist
   * 
   * @param {string} name - Optional connection name (default: 'default')
   * @param {Object} config - Optional configuration to override defaults
   * @returns {Database} The database connection
   */
  getConnection(name = 'default', config = {}) {
    // Return existing connection if it exists
    if (this._connections.has(name)) {
      return this._connections.get(name);
    }

    // Merge default config with provided config
    const connectionConfig = {
      ...this._defaultConfig,
      ...config
    };

    // Create new connection
    const db = new Database({
      url: connectionConfig.url,
      databaseName: connectionConfig.databaseName,
      auth: {
        username: connectionConfig.auth.username,
        password: connectionConfig.auth.password
      }
    });

    // Store and return the connection
    this._connections.set(name, db);
    return db;
  }

  /**
   * Close a specific database connection
   * 
   * @param {string} name - Connection name to close (default: 'default')
   * @returns {boolean} True if connection was closed, false if it didn't exist
   */
  closeConnection(name = 'default') {
    if (this._connections.has(name)) {
      // ArangoDB doesn't have an explicit close method, but we can remove the reference
      this._connections.delete(name);
      return true;
    }
    return false;
  }

  /**
   * Close all database connections
   */
  closeAllConnections() {
    this._connections.clear();
  }

  /**
   * Update the default configuration
   * 
   * @param {Object} config - New default configuration
   */
  setDefaultConfig(config) {
    this._defaultConfig = {
      ...this._defaultConfig,
      ...config
    };
  }
}

// Create and export a singleton instance
const dbService = new DatabaseService();
Object.freeze(dbService);

module.exports = dbService;