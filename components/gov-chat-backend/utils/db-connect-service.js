// db-connect-service.js
const { Database } = require('arangojs');

/**
 * Import the logger from the same shared logger module used by other services
 */
const { logger } = require('shared-lib');

/**
 * Singleton class to manage database connections across the application
 */
class DatabaseService {
    constructor() {
        logger.info('Initializing DatabaseService with URL:' + process.env.ARANGO_URL);
        this._connections = new Map();
        this._defaultConfig = {
          url: process.env.ARANGO_URL || 'http://arango-vector-db:8529',
          databaseName: process.env.ARANGO_DB || 'node-services',
          auth: {
            username: process.env.ARANGO_USERNAME || 'root',
            password: process.env.ARANGO_PASSWORD || 'test'
          }
        };
        
        // Log the default configuration (masking the password)
        const url = this._defaultConfig.url;
        const dbName = this._defaultConfig.databaseName;
        const username = this._defaultConfig.auth.username;
        logger.info(`DatabaseService initialized with config: url=${url}, database=${dbName}, username=${username}`);
      }
      

  /**
   * Get a database connection - creates one if it doesn't exist
   * 
   * @param {string} name - Optional connection name (default: 'default')
   * @param {Object} config - Optional configuration to override defaults
   * @returns {Database} The database connection
   */
  getConnection(name = 'default', config = {}) {
    logger.info(`Getting database connection: ${name}`);
    
    // Return existing connection if it exists
    if (this._connections.has(name)) {
      logger.info(`Returning existing connection: ${name}`);
      return this._connections.get(name);
    }

    // Merge default config with provided config
    const connectionConfig = {
      ...this._defaultConfig,
      ...config
    };

    logger.info(`Creating new database connection: ${name} to ${connectionConfig.url}/${connectionConfig.databaseName}`);

    // Create new connection
    const db = new Database({
      url: connectionConfig.url,
      databaseName: connectionConfig.databaseName,
      auth: {
        username: connectionConfig.auth.username,
        password: connectionConfig.auth.password
      }
    });

    // Test the connection
    try {
      logger.info(`Testing database connection: ${name}`);
      // Note: We're not awaiting this as we want to perform the test but not block
      // the connection setup. Any issues will be logged asynchronously.
      this._testConnection(db, name);
    } catch (error) {
      logger.error(`Failed to test connection ${name}: ${error.message}`);
      // Continue anyway - the connection may work later
    }

    // Store and return the connection
    this._connections.set(name, db);
    logger.info(`New connection created and stored: ${name}`);
    return db;
  }

  /**
   * Test a database connection
   * @private
   * @param {Database} db - Database connection to test
   * @param {string} name - Connection name for logging
   */
  async _testConnection(db, name) {
    try {
      // Simple query to test the connection
      const result = await db.query('RETURN 1');
      const value = await result.next();
      logger.info(`Database connection test successful: ${name}`);
    } catch (error) {
      logger.error(`Database connection test failed: ${name}: ${error.message}`);
      logger.debug(`Connection error stack: ${error.stack}`);
    }
  }

  /**
   * Close a specific database connection
   * 
   * @param {string} name - Connection name to close (default: 'default')
   * @returns {boolean} True if connection was closed, false if it didn't exist
   */
  closeConnection(name = 'default') {
    logger.debug(`Closing database connection: ${name}`);
    if (this._connections.has(name)) {
      // ArangoDB doesn't have an explicit close method, but we can remove the reference
      this._connections.delete(name);
      logger.info(`Database connection closed: ${name}`);
      return true;
    }
    logger.warn(`Attempted to close non-existent connection: ${name}`);
    return false;
  }

  /**
   * Close all database connections
   */
  closeAllConnections() {
    const count = this._connections.size;
    logger.info(`Closing all database connections. Total connections: ${count}`);
    const connectionNames = Array.from(this._connections.keys());
    this._connections.clear();
    logger.debug(`All connections closed: ${connectionNames.join(', ')}`);
  }

  /**
   * Update the default configuration
   * 
   * @param {Object} config - New default configuration
   */
  setDefaultConfig(config) {
    logger.info('Updating default database configuration');
    
    // Store old values for logging
    const oldUrl = this._defaultConfig.url;
    const oldDbName = this._defaultConfig.databaseName;
    const oldUsername = this._defaultConfig.auth.username;
    
    // Update configuration
    this._defaultConfig = {
      ...this._defaultConfig,
      ...config
    };
    
    // Log the new configuration
    const newUrl = this._defaultConfig.url;
    const newDbName = this._defaultConfig.databaseName;
    const newUsername = this._defaultConfig.auth.username;
    
    logger.debug(`Configuration updated: 
      url: ${oldUrl} → ${newUrl},
      database: ${oldDbName} → ${newDbName},
      username: ${oldUsername} → ${newUsername}`);
  }

  /**
   * Get the current connection status
   * @returns {Object} Connection status information
   */
  getConnectionStatus() {
    const connectionNames = Array.from(this._connections.keys());
    logger.debug(`Getting connection status. Active connections: ${connectionNames.join(', ') || 'none'}`);
    
    return {
      totalConnections: this._connections.size,
      connectionNames,
      defaultConfig: {
        url: this._defaultConfig.url,
        databaseName: this._defaultConfig.databaseName,
        username: this._defaultConfig.auth.username
      }
    };
  }
  
  /**
   * Ping all connections to check if they're still valid
   * @returns {Promise<Object>} Connection health status for each connection
   */
  async pingConnections() {
    const connectionCount = this._connections.size;
    logger.info(`Pinging all database connections (${connectionCount} total)`);
    const results = {};
    
    for (const [name, db] of this._connections.entries()) {
      try {
        logger.debug(`Pinging connection: ${name}`);
        const startTime = Date.now();
        const cursor = await db.query('RETURN 1');
        await cursor.next();
        const endTime = Date.now();
        const responseTime = endTime - startTime;
        
        results[name] = {
          status: 'connected',
          responseTime,
          url: db.url,
          databaseName: db.databaseName
        };
        logger.debug(`Connection ${name} is healthy - response time: ${responseTime}ms`);
      } catch (error) {
        logger.error(`Connection ${name} ping failed: ${error.message}`);
        results[name] = {
          status: 'error',
          error: error.message,
          url: db.url,
          databaseName: db.databaseName
        };
      }
    }
    
    return results;
  }
}

// Create and export a singleton instance
logger.info('Creating singleton DatabaseService instance');
const dbService = new DatabaseService();
Object.freeze(dbService);

logger.debug('DatabaseService singleton instance created and frozen');
module.exports = dbService;