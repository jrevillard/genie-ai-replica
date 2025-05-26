const { Database } = require('arangojs');
const retry = require('async-retry');
const { logger } = require('../shared-lib');

/**
 * Enhanced singleton class to manage long-lived database connections
 */
class DatabaseService {
  constructor() {
    const url = process.env.ARANGO_URL || 'http://arango-vector-db:8529';
    const databaseName = process.env.ARANGO_DB || 'node-services';
    const username = 'root';
    const password = 'test';

    logger.info(`Initializing Enhanced DatabaseService with config:`);
    logger.info(`ARANGO_URL: ${url}`);
    logger.info(`ARANGO_DB: ${databaseName}`);
    logger.info(`ARANGO_USERNAME: ${username}`);

    this._connections = new Map();
    this._connectionTimestamps = new Map(); // Track last activity
    this._healthCheckIntervals = new Map(); // Track health check intervals
    this._defaultConfig = {
      url,
      databaseName,
      auth: { username, password },
      // Enhanced connection configuration for long-lived connections
      agentOptions: {
        keepAlive: true,
        keepAliveMsecs: 30000,        // Send keepalive every 30 seconds
        maxSockets: 5,
        maxFreeSockets: 2,
        timeout: 60000,               // Socket timeout: 1 minute
        freeSocketTimeout: 900000     // Keep idle sockets for 15 minutes
      },
      timeout: 30000                  // Request timeout: 30 seconds
    };

    // Configuration for connection lifecycle
    this.CONNECTION_IDLE_TIMEOUT = 30 * 60 * 1000;  // 30 minutes idle timeout
    this.HEALTH_CHECK_INTERVAL = 5 * 60 * 1000;     // Health check every 5 minutes
    this.MAX_CONNECTION_AGE = 4 * 60 * 60 * 1000;   // Max connection age: 4 hours

    // Start cleanup routine
    this._startConnectionCleanup();

    logger.debug('Enhanced DatabaseService singleton instance created');
  }

  /**
   * Get a database connection with enhanced lifecycle management
   */
  async getConnection(name = 'default', config = {}) {
    const connectionName = name === 'test' ? 'default' : name;
    const now = Date.now();
    
    logger.info(`[DB_CONNECTION] Getting database connection: ${connectionName} at ${new Date().toISOString()}`);

    // Check if we have a valid existing connection
    if (this._connections.has(connectionName)) {
      const connectionInfo = this._connections.get(connectionName);
      const age = now - connectionInfo.createdAt;
      const idleTime = now - connectionInfo.lastActivity;
      const lastHealthCheck = now - connectionInfo.lastHealthCheck;
      
      logger.info(`[DB_CONNECTION] Existing connection found for ${connectionName}:`);
      logger.info(`[DB_CONNECTION]   - Age: ${Math.round(age / 1000)}s (${Math.round(age / 60000)}min)`);
      logger.info(`[DB_CONNECTION]   - Idle time: ${Math.round(idleTime / 1000)}s (${Math.round(idleTime / 60000)}min)`);
      logger.info(`[DB_CONNECTION]   - Last health check: ${Math.round(lastHealthCheck / 1000)}s ago`);
      logger.info(`[DB_CONNECTION]   - Created at: ${new Date(connectionInfo.createdAt).toISOString()}`);
      logger.info(`[DB_CONNECTION]   - Last activity: ${new Date(connectionInfo.lastActivity).toISOString()}`);
      
      // Check if connection is too old or has been idle too long
      if (this._isConnectionStale(connectionInfo, now)) {
        logger.warn(`[DB_CONNECTION] Connection ${connectionName} is stale - Age: ${Math.round(age / 60000)}min, Idle: ${Math.round(idleTime / 60000)}min`);
        logger.warn(`[DB_CONNECTION] Max age: ${Math.round(this.MAX_CONNECTION_AGE / 60000)}min, Max idle: ${Math.round(this.CONNECTION_IDLE_TIMEOUT / 60000)}min`);
        await this._closeConnection(connectionName);
      } else {
        // Test connection health before returning
        try {
          logger.info(`[DB_CONNECTION] Testing existing connection health for ${connectionName}`);
          await this._quickHealthCheck(connectionInfo.db, connectionName);
          connectionInfo.lastActivity = now;
          logger.info(`[DB_CONNECTION] Existing connection ${connectionName} is healthy, returning`);
          return connectionInfo.db;
        } catch (error) {
          logger.error(`[DB_CONNECTION] Existing connection ${connectionName} failed health check: ${error.message}`);
          logger.error(`[DB_CONNECTION] Error details: ${JSON.stringify({ code: error.code, name: error.name, stack: error.stack?.split('\n')[0] })}`);
          await this._closeConnection(connectionName);
        }
      }
    } else {
      logger.info(`[DB_CONNECTION] No existing connection found for ${connectionName}`);
    }

    // Create new connection
    logger.info(`[DB_CONNECTION] Creating new connection for ${connectionName}`);
    return await this._createNewConnection(connectionName, config);
  }

  /**
   * Create a new database connection with enhanced configuration
   */
  async _createNewConnection(name, config = {}) {
    const connectionConfig = { ...this._defaultConfig, ...config };
    const now = Date.now();
    
    logger.info(`[DB_CONNECTION] Creating new connection: ${name}`);
    logger.info(`[DB_CONNECTION] Target: ${connectionConfig.url}/${connectionConfig.databaseName}`);
    logger.info(`[DB_CONNECTION] Username: ${connectionConfig.auth.username}`);
    logger.info(`[DB_CONNECTION] Agent options: ${JSON.stringify(connectionConfig.agentOptions)}`);

    const db = new Database(connectionConfig);
    
    logger.info(`[DB_CONNECTION] Database instance created, attempting authentication...`);
    
    // Authenticate with retry logic
    await retry(async () => {
      try {
        logger.info(`[DB_CONNECTION] Attempting login for ${name} with user ${connectionConfig.auth.username}`);
        await db.login(connectionConfig.auth.username, connectionConfig.auth.password);
        logger.info(`[DB_CONNECTION] Login successful for ${name}`);
        
        // Test the connection immediately after login
        logger.info(`[DB_CONNECTION] Testing new connection for ${name}`);
        await this._testConnection(db, name);
        logger.info(`[DB_CONNECTION] Connection test passed for ${name}`);
        
      } catch (error) {
        logger.error(`[DB_CONNECTION] Authentication/test failed for ${name}: ${error.message}`);
        logger.error(`[DB_CONNECTION] Error details: ${JSON.stringify({ 
          code: error.code, 
          name: error.name, 
          status: error.response?.status,
          statusText: error.response?.statusText,
          responseBody: error.response?.body
        })}`);
        throw error;
      }
    }, {
      retries: 3,
      minTimeout: 1000,
      maxTimeout: 5000,
      onRetry: (err, attempt) => {
        logger.warn(`[DB_CONNECTION] Connection attempt ${attempt} failed for ${name}: ${err.message}`);
        logger.warn(`[DB_CONNECTION] Will retry in ${1000 * attempt}ms...`);
      }
    });

    const connectionInfo = {
      db,
      createdAt: now,
      lastActivity: now,
      lastHealthCheck: now,
      config: connectionConfig
    };

    this._connections.set(name, connectionInfo);
    this._startHealthCheckForConnection(name);
    
    logger.info(`[DB_CONNECTION] New connection created and stored: ${name}`);
    logger.info(`[DB_CONNECTION] Connection info: Created at ${new Date(now).toISOString()}`);
    logger.info(`[DB_CONNECTION] Total active connections: ${this._connections.size}`);
    
    return db;
  }

  /**
   * Execute a database operation with automatic retry and connection management
   */
  async executeWithRetry(operation, connectionName = 'default', maxRetries = 3) {
    let lastError;
    const startTime = Date.now();
    
    logger.info(`[DB_EXECUTE] Starting operation for connection: ${connectionName}, max retries: ${maxRetries}`);
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`[DB_EXECUTE] Attempt ${attempt}/${maxRetries} for ${connectionName}`);
        
        const db = await this.getConnection(connectionName);
        logger.info(`[DB_EXECUTE] Got database connection for attempt ${attempt}`);
        
        const result = await operation(db);
        
        // Update activity timestamp
        if (this._connections.has(connectionName)) {
          const connectionInfo = this._connections.get(connectionName);
          connectionInfo.lastActivity = Date.now();
          logger.info(`[DB_EXECUTE] Updated last activity for ${connectionName}`);
        }
        
        const executionTime = Date.now() - startTime;
        logger.info(`[DB_EXECUTE] Operation completed successfully for ${connectionName} in ${executionTime}ms`);
        
        return result;
      } catch (error) {
        lastError = error;
        const executionTime = Date.now() - startTime;
        
        logger.error(`[DB_EXECUTE] Attempt ${attempt}/${maxRetries} failed for ${connectionName} after ${executionTime}ms`);
        logger.error(`[DB_EXECUTE] Error: ${error.message}`);
        logger.error(`[DB_EXECUTE] Error details: ${JSON.stringify({ 
          code: error.code, 
          name: error.name, 
          status: error.response?.status,
          statusText: error.response?.statusText 
        })}`);
        
        if (this._isConnectionError(error) && attempt < maxRetries) {
          logger.warn(`[DB_EXECUTE] Connection error detected, forcing reconnection for ${connectionName}`);
          await this._closeConnection(connectionName);
          const backoffTime = 1000 * attempt;
          logger.info(`[DB_EXECUTE] Waiting ${backoffTime}ms before retry ${attempt + 1}`);
          await this._sleep(backoffTime);
        } else if (attempt >= maxRetries) {
          logger.error(`[DB_EXECUTE] Max retries exceeded for ${connectionName}`);
          break;
        } else {
          logger.error(`[DB_EXECUTE] Non-connection error, not retrying: ${error.message}`);
          throw error;
        }
      }
    }
    
    logger.error(`[DB_EXECUTE] Operation failed permanently for ${connectionName}: ${lastError.message}`);
    throw lastError;
  }

  /**
   * Check if a connection is stale based on age and activity
   */
  _isConnectionStale(connectionInfo, now) {
    const age = now - connectionInfo.createdAt;
    const idleTime = now - connectionInfo.lastActivity;
    
    return age > this.MAX_CONNECTION_AGE || idleTime > this.CONNECTION_IDLE_TIMEOUT;
  }

  /**
   * Start health check for a specific connection
   */
  _startHealthCheckForConnection(name) {
    // Clear existing health check if any
    if (this._healthCheckIntervals.has(name)) {
      clearInterval(this._healthCheckIntervals.get(name));
    }

    const interval = setInterval(async () => {
      await this._performHealthCheck(name);
    }, this.HEALTH_CHECK_INTERVAL);

    this._healthCheckIntervals.set(name, interval);
  }

  /**
   * Perform health check on a specific connection
   */
  async _performHealthCheck(name) {
    if (!this._connections.has(name)) {
      logger.debug(`[DB_HEALTH] No connection found for health check: ${name}`);
      return;
    }

    const connectionInfo = this._connections.get(name);
    const now = Date.now();
    const idleTime = now - connectionInfo.lastActivity;
    const timeSinceLastCheck = now - connectionInfo.lastHealthCheck;

    logger.info(`[DB_HEALTH] Health check for ${name}:`);
    logger.info(`[DB_HEALTH]   - Idle time: ${Math.round(idleTime / 1000)}s (${Math.round(idleTime / 60000)}min)`);
    logger.info(`[DB_HEALTH]   - Time since last check: ${Math.round(timeSinceLastCheck / 1000)}s`);
    logger.info(`[DB_HEALTH]   - Health check interval: ${Math.round(this.HEALTH_CHECK_INTERVAL / 1000)}s`);

    try {
      // Only do health check if connection has been idle for a while
      if (idleTime < this.HEALTH_CHECK_INTERVAL) {
        logger.debug(`[DB_HEALTH] Skipping health check for ${name} - recently active (${Math.round(idleTime / 1000)}s ago)`);
        return;
      }

      logger.info(`[DB_HEALTH] Performing health check for idle connection: ${name}`);
      await this._testConnection(connectionInfo.db, name);
      connectionInfo.lastHealthCheck = now;
      logger.info(`[DB_HEALTH] Health check passed for connection: ${name}`);
      
    } catch (error) {
      logger.warn(`[DB_HEALTH] Health check failed for ${name}: ${error.message}`);
      logger.warn(`[DB_HEALTH] Connection details: Age: ${Math.round((now - connectionInfo.createdAt) / 60000)}min, Idle: ${Math.round(idleTime / 60000)}min`);
      logger.warn(`[DB_HEALTH] Closing failed connection: ${name}`);
      await this._closeConnection(name);
    }
  }

  /**
   * Test a database connection
   */
  async _testConnection(db, name) {
    const startTime = Date.now();
    try {
      logger.info(`[DB_TEST] Testing connection ${name}...`);
      
      // Test 1: Simple query
      logger.debug(`[DB_TEST] Running simple query test for ${name}`);
      const cursor = await db.query('RETURN 1', {}, { timeout: 5000 });
      const result = await cursor.next();
      
      if (result !== 1) {
        throw new Error(`Unexpected query result: ${result}, expected: 1`);
      }
      
      // Test 2: Try to access a collection (this often reveals auth issues)
      logger.debug(`[DB_TEST] Testing collection access for ${name}`);
      const collections = await db.listCollections();
      logger.debug(`[DB_TEST] Found ${collections.length} collections for ${name}`);
      
      const testTime = Date.now() - startTime;
      logger.info(`[DB_TEST] Connection test passed for ${name} in ${testTime}ms`);
      
    } catch (error) {
      const testTime = Date.now() - startTime;
      logger.error(`[DB_TEST] Connection test failed for ${name} after ${testTime}ms`);
      logger.error(`[DB_TEST] Error: ${error.message}`);
      logger.error(`[DB_TEST] Error details: ${JSON.stringify({ 
        code: error.code, 
        name: error.name, 
        status: error.response?.status,
        statusText: error.response?.statusText,
        responseBody: error.response?.body 
      })}`);
      
      if (error.response) {
        logger.error(`[DB_TEST] Response status: ${error.response.status}`);
        logger.error(`[DB_TEST] Response headers: ${JSON.stringify(error.response.headers)}`);
      }
      
      throw error;
    }
  }

  /**
   * Quick health check (lighter than full test)
   */
  async _quickHealthCheck(db, name) {
    const startTime = Date.now();
    try {
      logger.debug(`[DB_HEALTH] Quick health check for ${name}`);
      const cursor = await db.query('RETURN 1', {}, { timeout: 3000 });
      await cursor.next();
      const checkTime = Date.now() - startTime;
      logger.debug(`[DB_HEALTH] Quick health check passed for ${name} in ${checkTime}ms`);
    } catch (error) {
      const checkTime = Date.now() - startTime;
      logger.error(`[DB_HEALTH] Quick health check failed for ${name} after ${checkTime}ms: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if an error is connection-related
   */
  _isConnectionError(error) {
    const connectionErrors = [
      'ECONNRESET', 'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT',
      'EPIPE', 'EHOSTUNREACH', 'socket hang up', 'not authorized'
    ];
    
    const message = error.message?.toLowerCase() || '';
    const code = error.code?.toLowerCase() || '';
    
    const isConnectionError = connectionErrors.some(errCode => 
      code.includes(errCode.toLowerCase()) || 
      message.includes(errCode.toLowerCase())
    );
    
    logger.debug(`[DB_ERROR] Connection error check for "${error.message}": ${isConnectionError}`);
    logger.debug(`[DB_ERROR] Error code: ${error.code}, Status: ${error.response?.status}`);
    
    return isConnectionError;
  }

  /**
   * Close a specific connection and clean up resources
   */
  async _closeConnection(name) {
    logger.info(`[DB_CLOSE] Closing connection: ${name}`);
    
    if (this._connections.has(name)) {
      const connectionInfo = this._connections.get(name);
      const age = Date.now() - connectionInfo.createdAt;
      const idleTime = Date.now() - connectionInfo.lastActivity;
      
      logger.info(`[DB_CLOSE] Connection ${name} stats before closing:`);
      logger.info(`[DB_CLOSE]   - Age: ${Math.round(age / 60000)}min`);
      logger.info(`[DB_CLOSE]   - Idle time: ${Math.round(idleTime / 60000)}min`);
      logger.info(`[DB_CLOSE]   - Created: ${new Date(connectionInfo.createdAt).toISOString()}`);
      logger.info(`[DB_CLOSE]   - Last activity: ${new Date(connectionInfo.lastActivity).toISOString()}`);
      
      this._connections.delete(name);
      logger.info(`[DB_CLOSE] Connection ${name} removed from pool`);
    } else {
      logger.warn(`[DB_CLOSE] Attempted to close non-existent connection: ${name}`);
    }

    if (this._healthCheckIntervals.has(name)) {
      clearInterval(this._healthCheckIntervals.get(name));
      this._healthCheckIntervals.delete(name);
      logger.info(`[DB_CLOSE] Health check interval cleared for ${name}`);
    }
    
    logger.info(`[DB_CLOSE] Remaining active connections: ${this._connections.size}`);
  }

  /**
   * Start periodic cleanup of stale connections
   */
  _startConnectionCleanup() {
    logger.info(`[DB_CLEANUP] Starting connection cleanup routine`);
    logger.info(`[DB_CLEANUP] Cleanup interval: ${Math.round(this.HEALTH_CHECK_INTERVAL / 60000)}min`);
    logger.info(`[DB_CLEANUP] Connection idle timeout: ${Math.round(this.CONNECTION_IDLE_TIMEOUT / 60000)}min`);
    logger.info(`[DB_CLEANUP] Max connection age: ${Math.round(this.MAX_CONNECTION_AGE / 60000)}min`);
    
    setInterval(async () => {
      const now = Date.now();
      const connectionsToClose = [];
      
      logger.debug(`[DB_CLEANUP] Running connection cleanup check - ${this._connections.size} active connections`);

      for (const [name, connectionInfo] of this._connections.entries()) {
        const age = now - connectionInfo.createdAt;
        const idleTime = now - connectionInfo.lastActivity;
        
        logger.debug(`[DB_CLEANUP] Checking ${name}: Age: ${Math.round(age / 60000)}min, Idle: ${Math.round(idleTime / 60000)}min`);
        
        if (this._isConnectionStale(connectionInfo, now)) {
          logger.info(`[DB_CLEANUP] Marking ${name} for cleanup - Age: ${Math.round(age / 60000)}min, Idle: ${Math.round(idleTime / 60000)}min`);
          connectionsToClose.push(name);
        }
      }

      for (const name of connectionsToClose) {
        logger.info(`[DB_CLEANUP] Cleaning up stale connection: ${name}`);
        await this._closeConnection(name);
      }

      if (connectionsToClose.length > 0) {
        logger.info(`[DB_CLEANUP] Cleaned up ${connectionsToClose.length} stale connections`);
      } else {
        logger.debug(`[DB_CLEANUP] No stale connections found`);
      }
    }, this.HEALTH_CHECK_INTERVAL);
  }

  /**
   * Utility function for sleep/delay
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Maintain backward compatibility with existing methods
  
  /**
   * Close a specific database connection
   */
  async closeConnection(name = 'default') {
    logger.info(`Manually closing connection: ${name}`);
    await this._closeConnection(name);
    return true;
  }

  /**
   * Close all database connections
   */
  async closeAllConnections() {
    const count = this._connections.size;
    logger.info(`Closing all database connections. Total: ${count}`);
    
    const connectionNames = Array.from(this._connections.keys());
    
    for (const name of connectionNames) {
      await this._closeConnection(name);
    }
    
    logger.info(`All connections closed: ${connectionNames.join(', ') || 'none'}`);
  }

  /**
   * Get connection status with enhanced information
   */
  getConnectionStatus() {
    const now = Date.now();
    const connections = Array.from(this._connections.entries()).map(([name, info]) => ({
      name,
      age: now - info.createdAt,
      idleTime: now - info.lastActivity,
      lastHealthCheck: now - info.lastHealthCheck,
      isStale: this._isConnectionStale(info, now)
    }));

    return {
      totalConnections: this._connections.size,
      connections,
      config: {
        connectionIdleTimeout: this.CONNECTION_IDLE_TIMEOUT,
        healthCheckInterval: this.HEALTH_CHECK_INTERVAL,
        maxConnectionAge: this.MAX_CONNECTION_AGE
      },
      defaultConfig: {
        url: this._defaultConfig.url,
        databaseName: this._defaultConfig.databaseName,
        username: this._defaultConfig.auth.username
      }
    };
  }

  /**
   * Ping all connections
   */
  async pingConnections() {
    logger.info(`Pinging all database connections (${this._connections.size} total)`);
    const results = {};
    
    for (const [name, connectionInfo] of this._connections.entries()) {
      try {
        const startTime = Date.now();
        await this._testConnection(connectionInfo.db, name);
        const responseTime = Date.now() - startTime;
        
        results[name] = {
          status: 'connected',
          responseTime,
          age: Date.now() - connectionInfo.createdAt,
          idleTime: Date.now() - connectionInfo.lastActivity
        };
      } catch (error) {
        results[name] = {
          status: 'error',
          error: error.message
        };
      }
    }
    
    return results;
  }

  // Legacy method for backward compatibility
  setDefaultConfig(config) {
    logger.info('Updating default database configuration');
    this._defaultConfig = { ...this._defaultConfig, ...config };
  }
}

// Create and export singleton instance
logger.info('Creating enhanced singleton DatabaseService instance');
const dbService = new DatabaseService();
Object.freeze(dbService);

module.exports = dbService;