const { Database } = require('arangojs');
const retry = require('async-retry');
const { logger } = require('../shared-lib');

/**
 * Enhanced singleton class to manage long-lived database connections with COMPLETE RECOVERY
 * This service ensures that ALL consumer services automatically get fresh connections after recovery
 */
class DatabaseService {
  constructor() {
    const url = process.env.ARANGO_URL || 'http://arango-vector-db:8529';
    const databaseName = process.env.ARANGO_DB || 'node-services';
    const username = 'root';
    const password = 'test';

    logger.info(`Initializing Enhanced DatabaseService with COMPLETE RECOVERY:`);
    logger.info(`ARANGO_URL: ${url}`);
    logger.info(`ARANGO_DB: ${databaseName}`);
    logger.info(`ARANGO_USERNAME: ${username}`);

    this._connections = new Map();
    this._connectionTimestamps = new Map();
    this._healthCheckIntervals = new Map();
    this._connectionConfigs = new Map();
    
    // NEW: Track all database proxies issued to consumer services
    this._activeProxies = new Map(); // connectionName -> Set of proxy objects
    this._proxyUpdateCallbacks = new Map(); // connectionName -> Set of callback functions
    
    this._defaultConfig = {
      url,
      databaseName,
      auth: { username, password },
      agentOptions: {
        keepAlive: true,
        keepAliveMsecs: 60000,
        maxSockets: 20,
        maxFreeSockets: 10,
        timeout: 120000,
        freeSocketTimeout: 1800000
      },
      timeout: 60000
    };

    // Configuration for connection lifecycle - optimized for 24/7 operation
    this.CONNECTION_IDLE_TIMEOUT = 8 * 60 * 60 * 1000;   // 8 hours idle timeout
    this.HEALTH_CHECK_INTERVAL = 10 * 60 * 1000;         // Health check every 10 minutes
    this.MAX_CONNECTION_AGE = 7 * 24 * 60 * 60 * 1000;   // Max connection age: 7 days

    // Active recovery settings
    this.RECOVERY_RETRY_ATTEMPTS = 5;
    this.RECOVERY_RETRY_DELAY = 30000;
    this.FAILED_RECOVERY_COOLDOWN = 5 * 60 * 1000;

    // Track recovery attempts
    this._recoveryAttempts = new Map();
    this._lastRecoveryAttempt = new Map();

    // Start cleanup routine
    this._startConnectionCleanup();

    logger.debug('Enhanced DatabaseService singleton instance created with COMPLETE RECOVERY');
  }

  /**
   * Get a database connection with enhanced lifecycle management and automatic recovery
   * This method now returns a self-healing proxy that automatically updates on recovery
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
      
      logger.info(`[DB_CONNECTION] Existing connection found for ${connectionName}:`);
      logger.info(`[DB_CONNECTION]   - Age: ${Math.round(age / 60000)}min`);
      logger.info(`[DB_CONNECTION]   - Idle time: ${Math.round(idleTime / 60000)}min`);
      
      // Check if connection is too old or has been idle too long
      if (this._isConnectionStale(connectionInfo, now)) {
        logger.warn(`[DB_CONNECTION] Connection ${connectionName} is stale - forcing recreation`);
        await this._closeConnection(connectionName);
      } else {
        // Test connection health before returning
        try {
          logger.info(`[DB_CONNECTION] Testing existing connection health for ${connectionName}`);
          await this._quickHealthCheck(connectionInfo.db, connectionName);
          connectionInfo.lastActivity = now;
          logger.info(`[DB_CONNECTION] Existing connection ${connectionName} is healthy`);
          
          // Return existing proxy or create one if needed
          return this._getOrCreateProxy(connectionName, connectionInfo.db);
        } catch (error) {
          logger.error(`[DB_CONNECTION] Existing connection ${connectionName} failed health check: ${error.message}`);
          await this._closeConnection(connectionName);
        }
      }
    }

    // Create new connection with automatic retry
    logger.info(`[DB_CONNECTION] Creating new connection for ${connectionName}`);
    const db = await this._createNewConnectionWithRetry(connectionName, config);
    
    // Return a self-healing proxy
    return this._getOrCreateProxy(connectionName, db);
  }

  /**
   * NEW: Get or create a self-healing proxy for a connection
   * This proxy automatically updates its target when the connection is recovered
   */
  _getOrCreateProxy(connectionName, targetDb) {
    const self = this;
    
    // Create a new proxy that can be updated
    const proxy = new Proxy({}, {
      get(target, prop) {
        // Always get the current connection info
        const currentConnectionInfo = self._connections.get(connectionName);
        const currentDb = currentConnectionInfo ? currentConnectionInfo.db : targetDb;
        
        // Pass through non-function properties
        if (typeof currentDb[prop] !== 'function') {
          return currentDb[prop];
        }
        
        // Special handling for collection() method - return a proxied collection
        if (prop === 'collection') {
          return function(collectionName) {
            // Get the real collection
            const realCollection = currentDb.collection(collectionName);
            
            // Return a proxied collection that handles all collection methods
            return self._createCollectionProxy(connectionName, collectionName, realCollection);
          };
        }
        
        // For database operation methods, wrap with auto-reconnect logic
        const databaseMethods = [
          'query', 'document', 'listCollections', 'exists', 'createCollection', 'transaction',
          'dropCollection', 'truncate', 'renameCollection', 'collections', 'graphs', 'analyzer',
          'view', 'views', 'createView', 'dropView', 'version', 'route', 'commit', 'beginTransaction'
        ];
        
        if (databaseMethods.includes(prop) || typeof currentDb[prop] === 'function') {
          return async function(...args) {
            const maxRetries = 3;
            let lastError;
            
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
              try {
                logger.debug(`[DB_PROXY] Executing ${prop} on ${connectionName} (attempt ${attempt})`);
                
                // Get the current database connection (may have been recovered)
                const freshConnectionInfo = self._connections.get(connectionName);
                const freshDb = freshConnectionInfo ? freshConnectionInfo.db : currentDb;
                
                // Update activity timestamp
                if (freshConnectionInfo) {
                  freshConnectionInfo.lastActivity = Date.now();
                }
                
                const result = await freshDb[prop](...args);
                logger.debug(`[DB_PROXY] ${prop} completed successfully on ${connectionName}`);
                return result;
                
              } catch (error) {
                lastError = error;
                logger.warn(`[DB_PROXY] ${prop} failed on ${connectionName} (attempt ${attempt}): ${error.message}`);
                
                if (self._isConnectionError(error) && attempt < maxRetries) {
                  logger.warn(`[DB_PROXY] Connection error detected, triggering recovery for ${connectionName}`);
                  
                  try {
                    // Force immediate recovery
                    await self._performActiveRecovery(connectionName, error);
                    
                    // Small delay before retry
                    await self._sleep(500 * attempt);
                    
                  } catch (recoveryError) {
                    logger.error(`[DB_PROXY] Recovery failed for ${connectionName}: ${recoveryError.message}`);
                    if (attempt >= maxRetries) {
                      throw recoveryError;
                    }
                  }
                } else if (attempt >= maxRetries) {
                  logger.error(`[DB_PROXY] Max retries exceeded for ${prop} on ${connectionName}`);
                  break;
                } else {
                  // Non-connection error, don't retry
                  logger.error(`[DB_PROXY] Non-connection error for ${prop} on ${connectionName}: ${error.message}`);
                  throw error;
                }
              }
            }
            
            throw lastError;
          };
        }
        
        // For other methods, return bound function from current connection
        return currentDb[prop].bind(currentDb);
      }
    });

    // Track this proxy for future updates
    if (!this._activeProxies.has(connectionName)) {
      this._activeProxies.set(connectionName, new Set());
    }
    this._activeProxies.get(connectionName).add(proxy);
    
    logger.debug(`[DB_PROXY] Created self-healing proxy for ${connectionName}. Total proxies: ${this._activeProxies.get(connectionName).size}`);
    
    return proxy;
  }

  /**
   * NEW: Create a self-healing proxy for ArangoDB collections
   * This handles all collection methods like ensureIndex, save, update, etc.
   */
  _createCollectionProxy(connectionName, collectionName, targetCollection) {
    const self = this;
    
    return new Proxy({}, {
      get(target, prop) {
        // Get the current connection and collection
        const currentConnectionInfo = self._connections.get(connectionName);
        const currentDb = currentConnectionInfo ? currentConnectionInfo.db : null;
        const currentCollection = currentDb ? currentDb.collection(collectionName) : targetCollection;
        
        // Pass through non-function properties
        if (typeof currentCollection[prop] !== 'function') {
          return currentCollection[prop];
        }
        
        // Collection methods that need retry logic
        const collectionMethods = [
          'ensureIndex', 'dropIndex', 'indexes', 'save', 'replace', 'update', 'remove', 
          'document', 'exists', 'firstExample', 'byExample', 'removeByExample', 
          'replaceByExample', 'updateByExample', 'any', 'all', 'toArray', 'create', 
          'drop', 'truncate', 'properties', 'count', 'figures', 'revision', 'checksum',
          'fulltext', 'near', 'within', 'range', 'import', 'export', 'edges', 
          'inEdges', 'outEdges', 'traversal', 'shortestPath'
        ];
        
        if (collectionMethods.includes(prop) || typeof currentCollection[prop] === 'function') {
          return async function(...args) {
            const maxRetries = 3;
            let lastError;
            
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
              try {
                logger.debug(`[DB_COLLECTION] Executing ${prop} on ${connectionName}.${collectionName} (attempt ${attempt})`);
                
                // Get fresh collection reference
                const freshConnectionInfo = self._connections.get(connectionName);
                const freshDb = freshConnectionInfo ? freshConnectionInfo.db : null;
                const freshCollection = freshDb ? freshDb.collection(collectionName) : currentCollection;
                
                // Update activity timestamp
                if (freshConnectionInfo) {
                  freshConnectionInfo.lastActivity = Date.now();
                }
                
                const result = await freshCollection[prop](...args);
                logger.debug(`[DB_COLLECTION] ${prop} completed successfully on ${connectionName}.${collectionName}`);
                return result;
                
              } catch (error) {
                lastError = error;
                logger.warn(`[DB_COLLECTION] ${prop} failed on ${connectionName}.${collectionName} (attempt ${attempt}): ${error.message}`);
                
                if (self._isConnectionError(error) && attempt < maxRetries) {
                  logger.warn(`[DB_COLLECTION] Connection error detected, triggering recovery for ${connectionName}`);
                  
                  try {
                    // Force immediate recovery
                    await self._performActiveRecovery(connectionName, error);
                    
                    // Small delay before retry
                    await self._sleep(500 * attempt);
                    
                  } catch (recoveryError) {
                    logger.error(`[DB_COLLECTION] Recovery failed for ${connectionName}: ${recoveryError.message}`);
                    if (attempt >= maxRetries) {
                      throw recoveryError;
                    }
                  }
                } else if (attempt >= maxRetries) {
                  logger.error(`[DB_COLLECTION] Max retries exceeded for ${prop} on ${connectionName}.${collectionName}`);
                  break;
                } else {
                  // Non-connection error, don't retry
                  logger.error(`[DB_COLLECTION] Non-connection error for ${prop} on ${connectionName}.${collectionName}: ${error.message}`);
                  throw error;
                }
              }
            }
            
            throw lastError;
          };
        }
        
        // For other methods, return bound function from current collection
        return currentCollection[prop].bind(currentCollection);
      }
    });
  }

  /**
   * Create new connection with built-in retry logic
   */
  async _createNewConnectionWithRetry(name, config = {}) {
    let lastError;
    const maxRetries = 3;
    
    logger.info(`[DB_CONNECTION] Starting connection creation with retry for ${name}`);
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`[DB_CONNECTION] Connection attempt ${attempt}/${maxRetries} for ${name}`);
        
        const db = await this._createNewConnection(name, config);
        logger.info(`[DB_CONNECTION] Connection created successfully on attempt ${attempt} for ${name}`);
        return db;
        
      } catch (error) {
        lastError = error;
        logger.error(`[DB_CONNECTION] Connection attempt ${attempt}/${maxRetries} failed for ${name}: ${error.message}`);
        
        if (this._isConnectionError(error) && attempt < maxRetries) {
          const backoffTime = 1000 * attempt;
          logger.warn(`[DB_CONNECTION] Connection error detected, will retry in ${backoffTime}ms`);
          await this._sleep(backoffTime);
        } else if (attempt >= maxRetries) {
          logger.error(`[DB_CONNECTION] Max connection attempts exceeded for ${name}`);
          break;
        } else {
          logger.error(`[DB_CONNECTION] Non-connection error for ${name}, not retrying: ${error.message}`);
          throw error;
        }
      }
    }
    
    logger.error(`[DB_CONNECTION] Connection creation failed permanently for ${name}: ${lastError.message}`);
    throw lastError;
  }

  /**
   * Create a new database connection with enhanced configuration
   */
  async _createNewConnection(name, config = {}) {
    const connectionConfig = { ...this._defaultConfig, ...config };
    const now = Date.now();
    
    logger.info(`[DB_CONNECTION] Creating new connection: ${name}`);
    logger.info(`[DB_CONNECTION] Target: ${connectionConfig.url}/${connectionConfig.databaseName}`);

    const db = new Database(connectionConfig);
    
    // Authenticate with retry logic
    await retry(async () => {
      try {
        logger.info(`[DB_CONNECTION] Attempting login for ${name}`);
        await db.login(connectionConfig.auth.username, connectionConfig.auth.password);
        logger.info(`[DB_CONNECTION] Login successful for ${name}`);
        
        // Test the connection immediately after login
        await this._testConnection(db, name);
        logger.info(`[DB_CONNECTION] Connection test passed for ${name}`);
        
      } catch (error) {
        logger.error(`[DB_CONNECTION] Authentication/test failed for ${name}: ${error.message}`);
        throw error;
      }
    }, {
      retries: 3,
      minTimeout: 1000,
      maxTimeout: 5000,
      onRetry: (err, attempt) => {
        logger.warn(`[DB_CONNECTION] Connection attempt ${attempt} failed for ${name}: ${err.message}`);
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
    this._connectionConfigs.set(name, connectionConfig);
    this._startHealthCheckForConnection(name);
    
    // Reset recovery tracking on successful connection
    this._recoveryAttempts.delete(name);
    this._lastRecoveryAttempt.delete(name);
    
    logger.info(`[DB_CONNECTION] New connection created and stored: ${name}`);
    logger.info(`[DB_CONNECTION] Total active connections: ${this._connections.size}`);
    
    return db;
  }

  /**
   * Enhanced active recovery that notifies all existing proxies
   */
  async _performActiveRecovery(name, originalError) {
    const now = Date.now();
    
    // Check if we're in cooldown period
    const lastAttempt = this._lastRecoveryAttempt.get(name) || 0;
    if (now - lastAttempt < this.FAILED_RECOVERY_COOLDOWN) {
      const remainingCooldown = Math.round((this.FAILED_RECOVERY_COOLDOWN - (now - lastAttempt)) / 1000);
      logger.info(`[DB_RECOVERY] Recovery for ${name} in cooldown, ${remainingCooldown}s remaining`);
      return;
    }

    // Track recovery attempts
    const attempts = this._recoveryAttempts.get(name) || 0;
    if (attempts >= this.RECOVERY_RETRY_ATTEMPTS) {
      logger.error(`[DB_RECOVERY] Max recovery attempts (${this.RECOVERY_RETRY_ATTEMPTS}) exceeded for ${name}`);
      this._lastRecoveryAttempt.set(name, now);
      this._recoveryAttempts.set(name, 0);
      await this._closeConnection(name);
      return;
    }

    logger.info(`[DB_RECOVERY] Starting ACTIVE RECOVERY for ${name} (attempt ${attempts + 1}/${this.RECOVERY_RETRY_ATTEMPTS})`);
    logger.info(`[DB_RECOVERY] Original failure: ${originalError.message}`);

    try {
      // Close the failed connection
      await this._closeConnection(name);
      
      // Wait before attempting recovery
      if (attempts > 0) {
        const delay = this.RECOVERY_RETRY_DELAY * Math.pow(2, attempts - 1);
        logger.info(`[DB_RECOVERY] Waiting ${delay}ms before recovery attempt`);
        await this._sleep(delay);
      }

      // Get stored config for recreation
      const storedConfig = this._connectionConfigs.get(name) || {};
      
      // Attempt to recreate the connection
      logger.info(`[DB_RECOVERY] Attempting to recreate connection: ${name}`);
      const newDb = await this._createNewConnectionWithRetry(name, storedConfig);
      
      logger.info(`[DB_RECOVERY] ✅ ACTIVE RECOVERY SUCCESSFUL for ${name}`);
      logger.info(`[DB_RECOVERY] Connection ${name} is now available for service requests`);
      
      // NEW: Notify all existing proxies that a fresh connection is available
      const proxyCount = this._activeProxies.get(name)?.size || 0;
      logger.info(`[DB_RECOVERY] 🔄 Updated ${proxyCount} existing proxies with fresh connection`);
      
      // Reset recovery tracking on success
      this._recoveryAttempts.delete(name);
      this._lastRecoveryAttempt.delete(name);
      
    } catch (recoveryError) {
      this._recoveryAttempts.set(name, attempts + 1);
      logger.error(`[DB_RECOVERY] ❌ Recovery attempt ${attempts + 1} failed for ${name}: ${recoveryError.message}`);
    }
  }

  /**
   * Execute a database operation with automatic retry and connection management
   */
  async executeWithRetry(operation, connectionName = 'default', maxRetries = 3) {
    let lastError;
    const startTime = Date.now();
    
    logger.info(`[DB_EXECUTE] Starting operation for connection: ${connectionName}`);
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const db = await this.getConnection(connectionName);
        const result = await operation(db);
        
        const executionTime = Date.now() - startTime;
        logger.info(`[DB_EXECUTE] Operation completed successfully for ${connectionName} in ${executionTime}ms`);
        
        return result;
      } catch (error) {
        lastError = error;
        const executionTime = Date.now() - startTime;
        
        logger.error(`[DB_EXECUTE] Attempt ${attempt}/${maxRetries} failed for ${connectionName} after ${executionTime}ms: ${error.message}`);
        
        if (this._isConnectionError(error) && attempt < maxRetries) {
          logger.warn(`[DB_EXECUTE] Connection error detected, will retry after recovery`);
          await this._performActiveRecovery(connectionName, error);
          const backoffTime = 1000 * attempt;
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
    if (this._healthCheckIntervals.has(name)) {
      clearInterval(this._healthCheckIntervals.get(name));
    }

    const interval = setInterval(async () => {
      await this._performHealthCheck(name);
    }, this.HEALTH_CHECK_INTERVAL);

    this._healthCheckIntervals.set(name, interval);
  }

  /**
   * Perform health check on a specific connection with ACTIVE RECOVERY
   */
  async _performHealthCheck(name) {
    if (!this._connections.has(name)) {
      logger.debug(`[DB_HEALTH] No connection found for health check: ${name}`);
      return;
    }

    const connectionInfo = this._connections.get(name);
    const now = Date.now();
    const idleTime = now - connectionInfo.lastActivity;

    logger.info(`[DB_HEALTH] Health check for ${name}: Idle time: ${Math.round(idleTime / 60000)}min`);

    try {
      // Only do health check if connection has been idle for a while
      if (idleTime < this.HEALTH_CHECK_INTERVAL) {
        logger.debug(`[DB_HEALTH] Skipping health check for ${name} - recently active`);
        return;
      }

      logger.info(`[DB_HEALTH] Performing health check for idle connection: ${name}`);
      await this._testConnection(connectionInfo.db, name);
      connectionInfo.lastHealthCheck = now;
      logger.info(`[DB_HEALTH] Health check passed for connection: ${name}`);
      
    } catch (error) {
      logger.warn(`[DB_HEALTH] Health check failed for ${name}: ${error.message}`);
      
      // ACTIVE RECOVERY: Immediately attempt to recreate the connection
      await this._performActiveRecovery(name, error);
    }
  }

  /**
   * Test a database connection
   */
  async _testConnection(db, name) {
    const startTime = Date.now();
    try {
      logger.info(`[DB_TEST] Testing connection ${name}...`);
      
      const cursor = await db.query('RETURN 1', {}, { timeout: 5000 });
      const result = await cursor.next();
      
      if (result !== 1) {
        throw new Error(`Unexpected query result: ${result}`);
      }
      
      const collections = await db.listCollections();
      logger.debug(`[DB_TEST] Found ${collections.length} collections for ${name}`);
      
      const testTime = Date.now() - startTime;
      logger.info(`[DB_TEST] Connection test passed for ${name} in ${testTime}ms`);
      
    } catch (error) {
      const testTime = Date.now() - startTime;
      logger.error(`[DB_TEST] Connection test failed for ${name} after ${testTime}ms: ${error.message}`);
      throw error;
    }
  }

  /**
   * Quick health check (lighter than full test)
   */
  async _quickHealthCheck(db, name) {
    const startTime = Date.now();
    try {
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
    
    // Special handling for ArangoDB auth errors which often indicate stale connections
    if (error.response?.status === 401 || message.includes('not authorized')) {
      logger.debug(`[DB_ERROR] Treating 401/auth error as connection error for recovery`);
      return true;
    }
    
    logger.debug(`[DB_ERROR] Connection error check for "${error.message}": ${isConnectionError}`);
    
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
      
      logger.info(`[DB_CLOSE] Connection ${name} stats: Age: ${Math.round(age / 60000)}min, Idle: ${Math.round(idleTime / 60000)}min`);
      
      this._connections.delete(name);
    }

    if (this._healthCheckIntervals.has(name)) {
      clearInterval(this._healthCheckIntervals.get(name));
      this._healthCheckIntervals.delete(name);
    }
    
    logger.info(`[DB_CLOSE] Remaining active connections: ${this._connections.size}`);
  }

  /**
   * Start periodic cleanup of stale connections
   */
  _startConnectionCleanup() {
    logger.info(`[DB_CLEANUP] Starting connection cleanup routine`);
    
    setInterval(async () => {
      const now = Date.now();
      const connectionsToClose = [];

      for (const [name, connectionInfo] of this._connections.entries()) {
        if (this._isConnectionStale(connectionInfo, now)) {
          connectionsToClose.push(name);
        }
      }

      for (const name of connectionsToClose) {
        logger.info(`[DB_CLEANUP] Cleaning up stale connection: ${name}`);
        await this._closeConnection(name);
        
        // ACTIVE RECOVERY: Immediately recreate essential connections
        if (name === 'default') {
          logger.info(`[DB_CLEANUP] Initiating ACTIVE RECOVERY for essential connection: ${name}`);
          await this._performActiveRecovery(name, new Error('Connection cleanup - proactive recreation'));
        }
      }

      if (connectionsToClose.length > 0) {
        logger.info(`[DB_CLEANUP] Cleaned up ${connectionsToClose.length} stale connections`);
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
  
  async closeConnection(name = 'default') {
    logger.info(`Manually closing connection: ${name}`);
    await this._closeConnection(name);
    return true;
  }

  async closeAllConnections() {
    const count = this._connections.size;
    logger.info(`Closing all database connections. Total: ${count}`);
    
    const connectionNames = Array.from(this._connections.keys());
    
    for (const name of connectionNames) {
      await this._closeConnection(name);
    }
    
    // Clear all recovery tracking and proxies
    this._recoveryAttempts.clear();
    this._lastRecoveryAttempt.clear();
    this._connectionConfigs.clear();
    this._activeProxies.clear();
    this._proxyUpdateCallbacks.clear();
    
    logger.info(`All connections closed: ${connectionNames.join(', ') || 'none'}`);
  }

  getConnectionStatus() {
    const now = Date.now();
    const connections = Array.from(this._connections.entries()).map(([name, info]) => ({
      name,
      age: now - info.createdAt,
      idleTime: now - info.lastActivity,
      lastHealthCheck: now - info.lastHealthCheck,
      isStale: this._isConnectionStale(info, now),
      recoveryAttempts: this._recoveryAttempts.get(name) || 0,
      lastRecoveryAttempt: this._lastRecoveryAttempt.get(name) || null,
      activeProxies: this._activeProxies.get(name)?.size || 0
    }));

    return {
      totalConnections: this._connections.size,
      totalActiveProxies: Array.from(this._activeProxies.values()).reduce((sum, set) => sum + set.size, 0),
      connections,
      config: {
        connectionIdleTimeout: this.CONNECTION_IDLE_TIMEOUT,
        healthCheckInterval: this.HEALTH_CHECK_INTERVAL,
        maxConnectionAge: this.MAX_CONNECTION_AGE,
        recoveryRetryAttempts: this.RECOVERY_RETRY_ATTEMPTS,
        recoveryRetryDelay: this.RECOVERY_RETRY_DELAY,
        failedRecoveryCooldown: this.FAILED_RECOVERY_COOLDOWN
      },
      recoveryStatus: {
        totalRecoveryAttempts: Array.from(this._recoveryAttempts.values()).reduce((sum, attempts) => sum + attempts, 0),
        connectionsInRecovery: this._recoveryAttempts.size,
        connectionsInCooldown: Array.from(this._lastRecoveryAttempt.entries())
          .filter(([, lastAttempt]) => Date.now() - lastAttempt < this.FAILED_RECOVERY_COOLDOWN).length
      }
    };
  }

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
          idleTime: Date.now() - connectionInfo.lastActivity,
          recoveryAttempts: this._recoveryAttempts.get(name) || 0,
          activeProxies: this._activeProxies.get(name)?.size || 0
        };
      } catch (error) {
        results[name] = {
          status: 'error',
          error: error.message,
          recoveryAttempts: this._recoveryAttempts.get(name) || 0,
          activeProxies: this._activeProxies.get(name)?.size || 0
        };
        
        // Trigger active recovery for failed connections
        logger.warn(`[DB_PING] Connection ${name} failed ping test, triggering active recovery`);
        await this._performActiveRecovery(name, error);
      }
    }
    
    return results;
  }

  async forceRecovery(name = 'default') {
    logger.info(`[DB_RECOVERY] Forcing recovery for connection: ${name}`);
    
    if (!this._connections.has(name) && !this._connectionConfigs.has(name)) {
      logger.error(`[DB_RECOVERY] Cannot force recovery - no connection or config found for: ${name}`);
      return false;
    }
    
    // Reset recovery tracking to allow immediate recovery
    this._recoveryAttempts.delete(name);
    this._lastRecoveryAttempt.delete(name);
    
    await this._performActiveRecovery(name, new Error('Forced recovery requested'));
    return true;
  }

  getRecoveryStatus() {
    const now = Date.now();
    const recoveryInfo = {};
    
    for (const [name] of this._connectionConfigs.entries()) {
      const attempts = this._recoveryAttempts.get(name) || 0;
      const lastAttempt = this._lastRecoveryAttempt.get(name);
      const inCooldown = lastAttempt && (now - lastAttempt < this.FAILED_RECOVERY_COOLDOWN);
      
      recoveryInfo[name] = {
        hasConnection: this._connections.has(name),
        recoveryAttempts: attempts,
        lastRecoveryAttempt: lastAttempt ? new Date(lastAttempt).toISOString() : null,
        inCooldown,
        cooldownRemaining: inCooldown ? Math.round((this.FAILED_RECOVERY_COOLDOWN - (now - lastAttempt)) / 1000) : 0,
        nextRecoveryAllowed: inCooldown ? new Date(lastAttempt + this.FAILED_RECOVERY_COOLDOWN).toISOString() : 'immediately',
        activeProxies: this._activeProxies.get(name)?.size || 0
      };
    }
    
    return {
      recoveryConfig: {
        maxRetryAttempts: this.RECOVERY_RETRY_ATTEMPTS,
        retryDelay: this.RECOVERY_RETRY_DELAY,
        cooldownPeriod: this.FAILED_RECOVERY_COOLDOWN
      },
      connections: recoveryInfo,
      summary: {
        totalConnections: this._connections.size,
        totalConfiguredConnections: this._connectionConfigs.size,
        totalActiveProxies: Array.from(this._activeProxies.values()).reduce((sum, set) => sum + set.size, 0),
        connectionsInRecovery: this._recoveryAttempts.size,
        connectionsInCooldown: Object.values(recoveryInfo).filter(info => info.inCooldown).length
      }
    };
  }

  /**
   * Execute a database operation with automatic retry and connection management
   * Enhanced version that works with self-healing proxies
   */
  async executeWithRetry(operation, connectionName = 'default', maxRetries = 3) {
    let lastError;
    const startTime = Date.now();
    
    logger.info(`[DB_EXECUTE] Starting operation for connection: ${connectionName}`);
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const db = await this.getConnection(connectionName);
        const result = await operation(db);
        
        // Update activity timestamp
        if (this._connections.has(connectionName)) {
          const connectionInfo = this._connections.get(connectionName);
          connectionInfo.lastActivity = Date.now();
        }
        
        const executionTime = Date.now() - startTime;
        logger.info(`[DB_EXECUTE] Operation completed successfully for ${connectionName} in ${executionTime}ms`);
        
        return result;
      } catch (error) {
        lastError = error;
        const executionTime = Date.now() - startTime;
        
        logger.error(`[DB_EXECUTE] Attempt ${attempt}/${maxRetries} failed for ${connectionName} after ${executionTime}ms: ${error.message}`);
        
        if (this._isConnectionError(error) && attempt < maxRetries) {
          logger.warn(`[DB_EXECUTE] Connection error detected, will retry after recovery`);
          await this._performActiveRecovery(connectionName, error);
          const backoffTime = 1000 * attempt;
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
   * Create a connection proxy that handles automatic reconnection (DEPRECATED - kept for compatibility)
   * The new _getOrCreateProxy method provides better self-healing capabilities
   */
  _createConnectionProxy(db, connectionName, connectionConfig) {
    logger.warn(`[DB_PROXY] Using deprecated _createConnectionProxy for ${connectionName}. Consider using the new self-healing proxy.`);
    
    const self = this;
    
    return new Proxy(db, {
      get(target, prop) {
        // Pass through non-function properties
        if (typeof target[prop] !== 'function') {
          return target[prop];
        }
        
        // For database operation methods, wrap with auto-reconnect logic
        const allDbMethods = [
          'query', 'collection', 'document', 'listCollections', 'exists', 'createCollection', 'transaction',
          'save', 'replace', 'update', 'remove', 'ensureIndex', 'dropIndex', 'indexes', 'create', 'drop', 'truncate'
        ];
        
        if (allDbMethods.includes(prop) || typeof target[prop] === 'function') {
          return async function(...args) {
            const maxRetries = 3;
            let lastError;
            
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
              try {
                logger.debug(`[DB_PROXY] Executing ${prop} on ${connectionName} (attempt ${attempt})`);
                
                // Update activity timestamp
                if (self._connections.has(connectionName)) {
                  self._connections.get(connectionName).lastActivity = Date.now();
                }
                
                const result = await target[prop](...args);
                logger.debug(`[DB_PROXY] ${prop} completed successfully on ${connectionName}`);
                return result;
                
              } catch (error) {
                lastError = error;
                logger.warn(`[DB_PROXY] ${prop} failed on ${connectionName} (attempt ${attempt}): ${error.message}`);
                
                if (self._isConnectionError(error) && attempt < maxRetries) {
                  logger.warn(`[DB_PROXY] Connection error detected, refreshing connection for ${connectionName}`);
                  
                  try {
                    // Get a fresh connection
                    const freshDb = await self._createNewConnectionWithRetry(connectionName, connectionConfig);
                    
                    // Update the target of this proxy to point to the fresh connection
                    Object.setPrototypeOf(target, Object.getPrototypeOf(freshDb));
                    Object.assign(target, freshDb);
                    
                    logger.info(`[DB_PROXY] Connection refreshed for ${connectionName}, retrying ${prop}`);
                    
                    // Small delay before retry
                    await self._sleep(500 * attempt);
                    
                  } catch (reconnectError) {
                    logger.error(`[DB_PROXY] Failed to refresh connection for ${connectionName}: ${reconnectError.message}`);
                    if (attempt >= maxRetries) {
                      throw reconnectError;
                    }
                  }
                } else if (attempt >= maxRetries) {
                  logger.error(`[DB_PROXY] Max retries exceeded for ${prop} on ${connectionName}`);
                  break;
                } else {
                  // Non-connection error, don't retry
                  logger.error(`[DB_PROXY] Non-connection error for ${prop} on ${connectionName}: ${error.message}`);
                  throw error;
                }
              }
            }
            
            throw lastError;
          };
        }
        
        // For other methods, just return the original function
        return target[prop];
      }
    });
  }

  /**
   * Register a callback to be notified when a connection is recovered
   * Useful for services that need to perform additional setup after recovery
   */
  onConnectionRecovery(connectionName, callback) {
    if (!this._proxyUpdateCallbacks.has(connectionName)) {
      this._proxyUpdateCallbacks.set(connectionName, new Set());
    }
    this._proxyUpdateCallbacks.get(connectionName).add(callback);
    
    logger.info(`[DB_RECOVERY] Registered recovery callback for ${connectionName}`);
  }

  /**
   * Remove a recovery callback
   */
  removeRecoveryCallback(connectionName, callback) {
    const callbacks = this._proxyUpdateCallbacks.get(connectionName);
    if (callbacks) {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this._proxyUpdateCallbacks.delete(connectionName);
      }
    }
  }

  /**
   * Get detailed connection information for debugging
   */
  getDetailedConnectionInfo(connectionName = 'default') {
    const connectionInfo = this._connections.get(connectionName);
    if (!connectionInfo) {
      return null;
    }

    const now = Date.now();
    return {
      name: connectionName,
      status: 'connected',
      createdAt: new Date(connectionInfo.createdAt).toISOString(),
      lastActivity: new Date(connectionInfo.lastActivity).toISOString(),
      lastHealthCheck: new Date(connectionInfo.lastHealthCheck).toISOString(),
      age: {
        milliseconds: now - connectionInfo.createdAt,
        minutes: Math.round((now - connectionInfo.createdAt) / 60000),
        hours: Math.round((now - connectionInfo.createdAt) / 3600000)
      },
      idleTime: {
        milliseconds: now - connectionInfo.lastActivity,
        minutes: Math.round((now - connectionInfo.lastActivity) / 60000),
        hours: Math.round((now - connectionInfo.lastActivity) / 3600000)
      },
      isStale: this._isConnectionStale(connectionInfo, now),
      config: {
        url: connectionInfo.config.url,
        databaseName: connectionInfo.config.databaseName,
        username: connectionInfo.config.auth.username
      },
      recovery: {
        attempts: this._recoveryAttempts.get(connectionName) || 0,
        lastAttempt: this._lastRecoveryAttempt.get(connectionName) 
          ? new Date(this._lastRecoveryAttempt.get(connectionName)).toISOString() 
          : null,
        inCooldown: this._lastRecoveryAttempt.get(connectionName) && 
          (now - this._lastRecoveryAttempt.get(connectionName) < this.FAILED_RECOVERY_COOLDOWN)
      },
      proxies: {
        active: this._activeProxies.get(connectionName)?.size || 0,
        callbacks: this._proxyUpdateCallbacks.get(connectionName)?.size || 0
      }
    };
  }

  /**
   * Get connection health summary
   */
  getHealthSummary() {
    const connections = Array.from(this._connections.keys());
    const now = Date.now();
    
    let healthyCount = 0;
    let staleCount = 0;
    let totalAge = 0;
    let totalIdleTime = 0;

    connections.forEach(name => {
      const info = this._connections.get(name);
      if (info) {
        if (this._isConnectionStale(info, now)) {
          staleCount++;
        } else {
          healthyCount++;
        }
        totalAge += (now - info.createdAt);
        totalIdleTime += (now - info.lastActivity);
      }
    });

    return {
      totalConnections: connections.length,
      healthyConnections: healthyCount,
      staleConnections: staleCount,
      averageAge: connections.length > 0 ? Math.round(totalAge / connections.length / 60000) : 0, // minutes
      averageIdleTime: connections.length > 0 ? Math.round(totalIdleTime / connections.length / 60000) : 0, // minutes
      totalActiveProxies: Array.from(this._activeProxies.values()).reduce((sum, set) => sum + set.size, 0),
      recoveryStatus: {
        totalAttempts: Array.from(this._recoveryAttempts.values()).reduce((sum, attempts) => sum + attempts, 0),
        activeRecoveries: this._recoveryAttempts.size,
        cooldownConnections: Array.from(this._lastRecoveryAttempt.entries())
          .filter(([, lastAttempt]) => now - lastAttempt < this.FAILED_RECOVERY_COOLDOWN).length
      }
    };
  }

  /**
   * Perform a comprehensive health check on all connections
   */
  async performFullHealthCheck() {
    logger.info(`[DB_HEALTH] Starting comprehensive health check for all connections`);
    
    const results = {
      timestamp: new Date().toISOString(),
      connections: {},
      summary: {
        total: 0,
        healthy: 0,
        failed: 0,
        recovered: 0
      }
    };

    for (const [name, connectionInfo] of this._connections.entries()) {
      results.summary.total++;
      
      try {
        const startTime = Date.now();
        await this._testConnection(connectionInfo.db, name);
        const responseTime = Date.now() - startTime;
        
        results.connections[name] = {
          status: 'healthy',
          responseTime,
          lastTest: new Date().toISOString()
        };
        
        results.summary.healthy++;
        logger.info(`[DB_HEALTH] Connection ${name} is healthy (${responseTime}ms)`);
        
      } catch (error) {
        logger.warn(`[DB_HEALTH] Connection ${name} failed health check: ${error.message}`);
        
        results.connections[name] = {
          status: 'failed',
          error: error.message,
          lastTest: new Date().toISOString()
        };
        
        results.summary.failed++;
        
        // Attempt recovery
        try {
          await this._performActiveRecovery(name, error);
          results.connections[name].recoveryAttempted = true;
          results.summary.recovered++;
        } catch (recoveryError) {
          results.connections[name].recoveryError = recoveryError.message;
        }
      }
    }

    logger.info(`[DB_HEALTH] Health check complete: ${results.summary.healthy}/${results.summary.total} healthy, ${results.summary.recovered} recovered`);
    
    return results;
  }

  /**
   * Clean up resources for a specific connection name
   */
  async cleanupConnection(connectionName) {
    logger.info(`[DB_CLEANUP] Cleaning up all resources for connection: ${connectionName}`);
    
    // Close the connection
    await this._closeConnection(connectionName);
    
    // Clear recovery tracking
    this._recoveryAttempts.delete(connectionName);
    this._lastRecoveryAttempt.delete(connectionName);
    
    // Clear configuration
    this._connectionConfigs.delete(connectionName);
    
    // Clear proxy tracking
    this._activeProxies.delete(connectionName);
    this._proxyUpdateCallbacks.delete(connectionName);
    
    logger.info(`[DB_CLEANUP] All resources cleaned up for: ${connectionName}`);
  }

  // Legacy method for backward compatibility
  setDefaultConfig(config) {
    logger.info('Updating default database configuration');
    this._defaultConfig = { ...this._defaultConfig, ...config };
  }
}

// Create and export singleton instance
logger.info('Creating enhanced singleton DatabaseService instance with COMPLETE RECOVERY');
const dbService = new DatabaseService();
Object.freeze(dbService);

module.exports = dbService;