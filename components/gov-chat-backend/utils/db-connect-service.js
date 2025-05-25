const { Database } = require('arangojs');
const retry = require('async-retry');
const { logger } = require('../shared-lib');

/**
 * Singleton class to manage database connections across the application
 */
class DatabaseService {
  constructor() {
    const url = process.env.ARANGO_URL || 'http://arango-vector-db:8529';
    const databaseName = process.env.ARANGO_DB || 'node-services';
    //const username = process.env.ARANGO_USERNAME || 'root';
    //const password = process.env.ARANGO_PASSWORD || 'test'; // Replace with actual password if needed
    const username = 'root';
    const password = 'test';

    // Log the configuration (masking the password)
    logger.info(`Initializing DatabaseService with config:`);
    logger.info(`ARANGO_URL: ${url}`);
    logger.info(`ARANGO_DB: ${databaseName}`);
    logger.info(`ARANGO_USERNAME: ${username}`);
    logger.info(`ARANGO_PASSWORD: ${password ? '***' : 'not set'}`);

    this._connections = new Map();
    this._defaultConfig = {
      url,
      databaseName,
      auth: {
        username,
        password
      }
    };

    // Log the default configuration
    logger.debug('DatabaseService singleton instance created and frozen');
  }

  /**
   * Get a database connection - creates one if it doesn't exist
   * 
   * @param {string} name - Optional connection name (default: 'default')
   * @param {Object} config - Optional configuration to override defaults
   * @returns {Database} The database connection
   */
  async getConnection(name = 'default', config = {}) {
    logger.info(`Getting database connection: ${name}`);

    if (this._connections.has(name)) {
      const db = this._connections.get(name);
      try {
        await this._testConnection(db, name);
        logger.info(`Returning existing connection: ${name}`);
        return db;
      } catch (error) {
        logger.warn(`Stale or unauthorized connection detected for ${name}: ${error.message}`);
        this._connections.delete(name);
      }
    }

    const connectionConfig = {
      ...this._defaultConfig,
      ...config
    };

    logger.info(`Creating new database connection: ${name} to ${connectionConfig.url}/${connectionConfig.databaseName}`);

    const db = new Database({
      url: connectionConfig.url,
      databaseName: connectionConfig.databaseName,
      auth: {
        username: connectionConfig.auth.username,
        password: connectionConfig.auth.password
      }
    });

    // Create a proxy to intercept query methods
    const proxyDb = new Proxy(db, {
      get: (target, prop) => {
        if (['query', 'document'].includes(prop)) {
          return async (...args) => {
            for (let attempt = 1; attempt <= 3; attempt++) {
              try {
                return await target[prop](...args);
              } catch (error) {
                if (error.message.includes('not authorized') && attempt < 3) {
                  logger.warn(`Authorization error in ${prop} on attempt ${attempt}, refreshing connection ${name}`);
                  this._connections.delete(name);
                  const newDb = await this._createConnection(name, connectionConfig);
                  this._connections.set(name, newDb);
                  target._connection = newDb._connection;
                  continue;
                }
                throw error;
              }
            }
          };
        }
        return target[prop];
      }
    });

    try {
      logger.info(`Attempting pre-connection login: ${name}`);
      await proxyDb.login(connectionConfig.auth.username, connectionConfig.auth.password);
      logger.info(`Pre-connection login successful: ${name}`);
      const connection = await retry(async () => {
        await this._testConnection(proxyDb, name);
        return proxyDb;
      }, {
        retries: 5,
        minTimeout: 1000,
        onRetry: (err, attempt) => {
          logger.warn(`Connection attempt ${attempt} failed: ${err.message}`);
        }
      });
      this._connections.set(name, connection);
      logger.info(`New connection created and stored: ${name}`);
      return connection;
    } catch (error) {
      logger.error(`Failed to create connection ${name}`);
      logger.error(`Error: ${error.message}`);
      if (error.response) {
        logger.error(`Status: ${error.response.status}`);
        logger.error(`Body: ${JSON.stringify(error.response.body, null, 2)}`);
      }
      throw error;
    }
  }

  /**
   * Create a new database connection
   * @private
   * @param {string} name - Connection name
   * @param {Object} connectionConfig - Connection configuration
   * @returns {Database} The new database connection
   */
  // db-connect-service.js
  async _createConnection(name, connectionConfig) {
    const db = new Database({
      url: connectionConfig.url,
      databaseName: connectionConfig.databaseName,
      auth: {
        username: connectionConfig.auth.username,
        password: connectionConfig.auth.password
      }
    });
    logger.info(`Attempting to authenticate for connection: ${name}`);
    await db.login(connectionConfig.auth.username, connectionConfig.auth.password);
    logger.info(`Authentication successful for connection: ${name}`);
    return new Proxy(db, {
      get: (target, prop) => {
        if (['query', 'document'].includes(prop)) {
          return async (...args) => {
            for (let attempt = 1; attempt <= 3; attempt++) {
              try {
                return await target[prop](...args);
              } catch (error) {
                if (error.message.includes('not authorized') && attempt < 3) {
                  logger.warn(`Authorization error in ${prop} on attempt ${attempt}, refreshing connection ${name}`);
                  this._connections.delete(name);
                  const newDb = await this._createConnection(name, connectionConfig);
                  this._connections.set(name, newDb);
                  target._connection = newDb._connection;
                  await target.login(connectionConfig.auth.username, connectionConfig.auth.password);
                  logger.info(`Re-authentication successful for connection: ${name}`);
                  continue;
                }
                logger.error(`Failed ${prop} after ${attempt} attempts: ${error.message}`);
                throw error;
              }
            }
          };
        }
        return target[prop];
      }
    });
  }

  /**
   * Test a database connection by executing a simple query
   * @private
   * @param {Database} db - Database connection to test
   * @param {string} name - Connection name for logging
   */
  async _testConnection(db, name) {
    try {
      logger.info(`Testing database connection: ${name}`);
      const cursor = await db.query('RETURN 1');
      const result = await cursor.next();
      if (result !== 1) {
        throw new Error('Unexpected query result');
      }
      // Test users collection access
      const users = db.collection('users');
      await users.documentExists('2133');
      await users.document('2133');
      logger.info(`Database connection test successful: ${name}`);
    } catch (error) {
      logger.error(`Database connection test failed: ${name}`);
      logger.error(`Error message: ${error.message}`);
      if (error.response) {
        logger.error(`Response status: ${error.response.status}`);
        logger.error(`Response body: ${JSON.stringify(error.response.body, null, 2)}`);
      }
      logger.error(`Stack trace: ${error.stack}`);
      if (error.message.includes('not authorized')) {
        logger.warn(`Authorization error detected, forcing reconnect for ${name}`);
        throw new Error('Authorization failure, requires reconnect');
      }
      throw error;
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
    logger.debug(`All connections closed: ${connectionNames.join(', ') || 'none'}`);
  }

  /**
   * Update the default configuration
   * 
   * @param {Object} config - New default configuration
   */
  setDefaultConfig(config) {
    logger.info('Updating default database configuration');
    const oldUrl = this._defaultConfig.url;
    const oldDbName = this._defaultConfig.databaseName;
    const oldUsername = this._defaultConfig.auth.username;
    this._defaultConfig = {
      ...this._defaultConfig,
      ...config
    };
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

module.exports = dbService;