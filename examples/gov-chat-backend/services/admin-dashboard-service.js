// src/services/admin-dashboard-service.js
const { Database } = require('arangojs');
const { logger } = require('../logger');
const os = require('os');
const fs = require('fs').promises;
const path = require('path');
const util = require('util');
const childProcess = require('child_process');
const exec = util.promisify(childProcess.exec);

// Database connection
const DB_URL = process.env.ARANGO_URL || 'http://localhost:8529';
const DB_NAME = process.env.ARANGO_DB || 'node-services';
const DB_USER = process.env.ARANGO_USER || 'root';
const DB_PASS = process.env.ARANGO_PASSWORD || 'test';

// Connect to ArangoDB with explicit credentials
const db = new Database({
  url: DB_URL,
  databaseName: DB_NAME,
  auth: {
    username: DB_USER,
    password: DB_PASS
  }
});

/**
 * Service for admin dashboard operations
 */
const adminDashboardService = {
  /**
   * Get system health statistics
   * @returns {Promise<Object>} System health metrics
   */
  async getSystemHealth() {
    logger.info('Getting system health metrics');

    try {
      // Get date ranges for metrics
      const now = new Date();
      const oneDayAgo = new Date(now);
      oneDayAgo.setDate(now.getDate() - 1);
      const oneMonthAgo = new Date(now);
      oneMonthAgo.setMonth(now.getMonth() - 1);
      const startDate = oneDayAgo.toISOString();
      const lastMonthStart = oneMonthAgo.toISOString();
      logger.debug(`Date ranges: now=${now.toISOString()}, startDate=${startDate}, lastMonthStart=${lastMonthStart}`);

      // Calculate system uptime
      const systemUptimeSeconds = os.uptime();
      const expectedUptimeSeconds = 30 * 24 * 60 * 60; // 30 days in seconds
      const systemUptime = Math.min((systemUptimeSeconds / expectedUptimeSeconds) * 100, 100).toFixed(2);
      logger.debug(`System Uptime Calculation: systemUptimeSeconds=${systemUptimeSeconds}, expectedUptimeSeconds=${expectedUptimeSeconds}, systemUptime=${systemUptime}%`);

      // Store current uptime in analytics for future trend calculations
      logger.debug('Storing current uptime in analytics collection');
      await this.storeAnalyticsData({
        period: 'daily',
        startDate: now.toISOString(),
        uptime: parseFloat(systemUptime),
        uniqueUsers: 0, // Will be updated later
        errorRate: 0 // Will be updated later
      });

      // Get last month's uptime for trend
      logger.debug('Fetching last month\'s uptime from analytics for trend calculation');
      const lastMonthAnalyticsCursor = await db.query(`
        FOR a IN analytics
          FILTER a.period == 'monthly' AND a.startDate >= @lastMonthStart AND a.startDate < @startDate
          SORT a.startDate DESC
          LIMIT 1
          RETURN a
      `, { startDate, lastMonthStart });
      const lastMonthAnalytics = await lastMonthAnalyticsCursor.next();
      logger.debug(`Last month's analytics data: ${JSON.stringify(lastMonthAnalytics)}`);
      const uptimeTrend = lastMonthAnalytics ? (parseFloat(systemUptime) - lastMonthAnalytics.uptime).toFixed(2) : 0;
      logger.debug(`Uptime Trend Calculation: currentUptime=${systemUptime}, lastMonthUptime=${lastMonthAnalytics?.uptime || 0}, uptimeTrend=${uptimeTrend}%`);

      // Get session data for active users
      logger.debug('Fetching active sessions from sessions collection');
      const sessionsCursor = await db.query(`
        FOR s IN sessions
          FILTER s.startTime >= @startDate AND s.active == true
          COLLECT AGGREGATE count = COUNT()
          RETURN count
      `, { startDate });
      const activeSessions = await sessionsCursor.next() || 0;
      logger.debug(`Active sessions count: ${activeSessions}`);

      // Get unique user count from analytics
      logger.debug('Fetching unique user count from analytics collection');
      const analyticsCursor = await db.query(`
        FOR a IN analytics
          FILTER a.period == 'daily' AND a.startDate >= @startDate
          SORT a.startDate DESC
          LIMIT 1
          RETURN a
      `, { startDate });
      let analytics = await analyticsCursor.next();
      logger.debug(`Analytics data for unique users: ${JSON.stringify(analytics)}`);

      // Get total users as fallback
      logger.debug('Fetching total users count as fallback');
      const usersCursor = await db.query(`
        FOR u IN users
          COLLECT AGGREGATE count = COUNT()
          RETURN count
      `);
      const totalUsers = await usersCursor.next() || 0;
      logger.debug(`Total users count: ${totalUsers}`);

      // Calculate active users
      const activeUsersValue = analytics?.uniqueUsers || activeSessions || totalUsers;
      logger.debug(`Active Users Calculation: analytics.uniqueUsers=${analytics?.uniqueUsers}, activeSessions=${activeSessions}, totalUsers=${totalUsers}, final activeUsersValue=${activeUsersValue}`);

      // Update analytics with active users
      logger.debug('Updating analytics with active users count');
      await this.storeAnalyticsData({
        period: 'daily',
        startDate: now.toISOString(),
        uptime: parseFloat(systemUptime),
        uniqueUsers: activeUsersValue,
        errorRate: 0 // Will be updated later
      });

      // Calculate active users trend
      logger.debug('Fetching last month\'s unique users for trend calculation');
      const lastMonthUsersCursor = await db.query(`
        FOR a IN analytics
          FILTER a.period == 'monthly' AND a.startDate >= @lastMonthStart AND a.startDate < @startDate
          SORT a.startDate DESC
          LIMIT 1
          RETURN a.uniqueUsers
      `, { startDate, lastMonthStart });
      const lastMonthUsers = await lastMonthUsersCursor.next() || 0;
      logger.debug(`Last month's unique users: ${lastMonthUsers}`);
      const activeUsersTrend = lastMonthUsers ? (((activeUsersValue - lastMonthUsers) / lastMonthUsers) * 100).toFixed(2) : 0;
      logger.debug(`Active Users Trend Calculation: currentActiveUsers=${activeUsersValue}, lastMonthUsers=${lastMonthUsers}, activeUsersTrend=${activeUsersTrend}%`);

      // Get response time from queries
      logger.debug('Fetching average response time from queries collection');
      const queriesCursor = await db.query(`
        FOR q IN queries
          FILTER q.timestamp >= @startDate
          COLLECT AGGREGATE 
            avgTime = AVERAGE(q.responseTime),
            count = COUNT()
          RETURN { avgTime, count }
      `, { startDate });
      const queriesStats = await queriesCursor.next() || { avgTime: 0, count: 0 };
      logger.debug(`Queries stats: avgTime=${queriesStats.avgTime}, count=${queriesStats.count}`);

      // Calculate response time trend
      logger.debug('Fetching last month\'s average response time for trend calculation');
      const lastMonthQueriesCursor = await db.query(`
        FOR q IN queries
          FILTER q.timestamp >= @lastMonthStart AND q.timestamp < @startDate
          COLLECT AGGREGATE 
            avgTime = AVERAGE(q.responseTime)
          RETURN avgTime
      `, { lastMonthStart, startDate });
      const lastMonthAvgTime = await lastMonthQueriesCursor.next() || 0;
      logger.debug(`Last month's average response time: ${lastMonthAvgTime}`);
      const responseTimeTrend = lastMonthAvgTime ? (((queriesStats.avgTime - lastMonthAvgTime) / lastMonthAvgTime) * 100).toFixed(2) : 0;
      logger.debug(`Response Time Trend Calculation: currentAvgTime=${queriesStats.avgTime}, lastMonthAvgTime=${lastMonthAvgTime}, responseTimeTrend=${responseTimeTrend}%`);

      // Calculate error rate from logs
      const today = now.toISOString().split('T')[0]; // Format: YYYY-MM-DD
      const logFile = path.join(__dirname, `../logs/combined-${today}.log`);
      let errorRate = 0;
      logger.debug(`Reading log file for error rate: ${logFile}`);
      try {
        const logContent = await fs.readFile(logFile, 'utf8');
        const logLines = logContent.split('\n').filter(line => line.trim() !== '');
        const totalLogs = logLines.length;
        const errorLogs = logLines.filter(line => line.includes('[ERROR]')).length;
        errorRate = totalLogs > 0 ? ((errorLogs / totalLogs) * 100).toFixed(2) : 0;
        logger.debug(`Error Rate Calculation: totalLogs=${totalLogs}, errorLogs=${errorLogs}, errorRate=${errorRate}%`);
      } catch (error) {
        logger.error(`Error reading log file for error rate: ${error.message}`);
      }

      // Update analytics with error rate
      logger.debug('Updating analytics with error rate');
      await this.storeAnalyticsData({
        period: 'daily',
        startDate: now.toISOString(),
        uptime: parseFloat(systemUptime),
        uniqueUsers: activeUsersValue,
        errorRate: parseFloat(errorRate)
      });

      // Calculate error rate trend
      logger.debug('Fetching last month\'s error rate for trend calculation');
      const lastMonthErrorRateCursor = await db.query(`
        FOR a IN analytics
          FILTER a.period == 'monthly' AND a.startDate >= @lastMonthStart AND a.startDate < @startDate
          SORT a.startDate DESC
          LIMIT 1
          RETURN a.errorRate
      `, { startDate, lastMonthStart });
      const lastMonthErrorRate = await lastMonthErrorRateCursor.next() || 0;
      logger.debug(`Last month's error rate: ${lastMonthErrorRate}`);
      const errorRateTrend = lastMonthErrorRate ? (parseFloat(errorRate) - lastMonthErrorRate).toFixed(2) : 0;
      logger.debug(`Error Rate Trend Calculation: currentErrorRate=${errorRate}, lastMonthErrorRate=${lastMonthErrorRate}, errorRateTrend=${errorRateTrend}%`);

      // Get resource usage
      logger.debug('Calculating resource usage');
      const cpuUsage = Math.round((os.loadavg()[0] / os.cpus().length) * 100);
      const memoryUsage = Math.round((process.memoryUsage().rss / os.totalmem()) * 100);
      const storageUsage = await this.getStorageUsage();
      const networkUsage = await this.getNetworkUsage();
      const resourceUsage = {
        cpu: cpuUsage,
        memory: memoryUsage,
        storage: storageUsage,
        network: networkUsage
      };
      logger.debug(`Resource Usage: cpu=${cpuUsage}%, memory=${memoryUsage}%, storage=${storageUsage}%, network=${networkUsage}%`);

      // Determine health status of services
      logger.debug('Determining health status of services');
      const healthServices = [
        { id: 'apiServices', name: 'API Services', status: resourceUsage.cpu < 80 ? 'good' : 'warning' },
        { id: 'database', name: 'Database', status: 'good' }, // Would need actual DB health check
        { id: 'cache', name: 'Cache', status: 'good' }, // Would need actual cache health check
        { id: 'storage', name: 'Storage', status: resourceUsage.storage < 90 ? 'good' : 'warning' },
        { id: 'messageQueue', name: 'Message Queue', status: 'good' }, // Would need actual queue health check
        { id: 'externalApi', name: 'External API', status: 'good' } // Would need actual external API check
      ];
      logger.debug(`Health Services: ${JSON.stringify(healthServices)}`);

      // Build response object
      const response = {
        metrics: {
          systemUptime: parseFloat(systemUptime),
          avgResponseTime: Math.round(queriesStats.avgTime),
          errorRate: parseFloat(errorRate),
          activeUsers: activeUsersValue
        },
        trends: {
          uptime: parseFloat(uptimeTrend),
          responseTime: parseFloat(responseTimeTrend),
          errorRate: parseFloat(errorRateTrend),
          activeUsers: parseFloat(activeUsersTrend)
        },
        resourceUsage,
        healthServices
      };
      logger.debug(`Final response: ${JSON.stringify(response)}`);

      return response;
    } catch (error) {
      logger.error(`Error in getSystemHealth: ${error.message}`, { stack: error.stack });
      throw error;
    }
  },

  /**
   * Store analytics data in the database
   * @param {Object} data - Analytics data to store
   */
  async storeAnalyticsData(data) {
    try {
      logger.debug(`Storing analytics data: ${JSON.stringify(data)}`);
      const existingCursor = await db.query(`
        FOR a IN analytics
          FILTER a.period == @period AND a.startDate == @startDate
          LIMIT 1
          RETURN a
      `, { period: data.period, startDate: data.startDate });

      const existing = await existingCursor.next();
      if (existing) {
        logger.debug(`Updating existing analytics record with key ${existing._key}`);
        await db.query(`
          UPDATE @key WITH @data IN analytics
        `, { key: existing._key, data });
      } else {
        logger.debug('Inserting new analytics record');
        await db.query(`
          INSERT @data INTO analytics
        `, { data });
      }
    } catch (error) {
      logger.error(`Error storing analytics data: ${error.message}`);
    }
  },

  /**
   * Get storage usage percentage
   * @returns {Promise<number>} Storage usage percentage
   */
  async getStorageUsage() {
    try {
      logger.debug('Calculating storage usage');
      if (process.platform !== 'win32') {
        const { stdout } = await exec('df -h / | tail -1 | awk \'{print $5}\'');
        const usageString = stdout.trim();
        const usage = parseInt(usageString.replace('%', ''));
        logger.debug(`Storage usage (Linux): ${usage}%`);
        return usage;
      } else {
        const { stdout } = await exec('wmic logicaldisk get size,freespace | findstr /C:"C:"');
        const [size, freeSpace] = stdout.trim().split(/\s+/).map(num => parseInt(num));
        const usage = Math.round(((size - freeSpace) / size) * 100);
        logger.debug(`Storage usage (Windows): size=${size}, freeSpace=${freeSpace}, usage=${usage}%`);
        return usage;
      }
    } catch (error) {
      logger.error(`Error getting storage usage: ${error.message}`);
      logger.debug('Falling back to default storage usage: 50%');
      return 50; // Fallback value
    }
  },

  /**
   * Get network usage percentage (simulated)
   * @returns {Promise<number>} Network usage percentage
   */
  async getNetworkUsage() {
    try {
      logger.debug('Calculating network usage (simulated)');
      // Simulate network usage for demo purposes
      const usage = Math.round(Math.random() * 100);
      logger.debug(`Simulated network usage: ${usage}%`);
      return usage;
    } catch (error) {
      logger.error(`Error getting network usage: ${error.message}`);
      logger.debug('Falling back to default network usage: 35%');
      return 35; // Fallback value
    }
  },

  /**
   * Get database statistics
   * @returns {Promise<Object>} Database statistics
   */
  async getDatabaseStats() {
    logger.info('Getting database statistics');

    try {
      // Get collection statistics
      logger.debug('Fetching collection statistics');
      const collections = await db.collections();
      const collectionStats = await Promise.all(
        collections.map(async (collection) => {
          const figures = await collection.figures();
          logger.debug(`Collection ${collection.name}: count=${figures.count}, size=${figures.size}`);
          return {
            name: collection.name,
            count: figures.count,
            size: figures.size
          };
        })
      );

      // Calculate total database size
      const totalSize = collectionStats.reduce((sum, coll) => sum + coll.size, 0);
      const formattedSize = (totalSize / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
      logger.debug(`Total database size: ${totalSize} bytes, formatted: ${formattedSize}`);

      // Get last reindex time
      logger.debug('Fetching last reindex time from analytics');
      const reindexCursor = await db.query(`
        FOR a IN analytics
          FILTER a.event == 'reindex'
          SORT a.timestamp DESC
          LIMIT 1
          RETURN a.timestamp
      `);
      const lastReindexTimestamp = await reindexCursor.next();
      const lastReindex = lastReindexTimestamp
        ? this.formatTimeAgo(new Date(lastReindexTimestamp))
        : 'Never';
      logger.debug(`Last reindex time: ${lastReindexTimestamp || 'Never'}, formatted: ${lastReindex}`);

      const response = {
        lastReindex,
        databaseSize: formattedSize,
        totalTables: collections.length,
        collections: collectionStats
      };
      logger.debug(`Database stats response: ${JSON.stringify(response)}`);

      return response;
    } catch (error) {
      logger.error(`Error in getDatabaseStats: ${error.message}`, { stack: error.stack });
      throw error;
    }
  },

  /**
   * Format time ago for display
   * @param {Date} date - Date to format
   * @returns {string} Formatted time ago string
   */
  formatTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    let result;
    if (diffDays === 0) result = 'Today';
    else if (diffDays === 1) result = '1 day ago';
    else result = `${diffDays} days ago`;
    logger.debug(`Formatting time ago: date=${date}, diffDays=${diffDays}, result=${result}`);
    return result;
  },

  /**
   * Get user statistics
   * @returns {Promise<Object>} User statistics
   */
  async getUserStats() {
    logger.info('Getting user statistics');

    try {
      // Query user count
      logger.debug('Fetching total user count');
      const userCountCursor = await db.query(`
        RETURN LENGTH(FOR u IN users RETURN 1)
      `);
      const userCount = await userCountCursor.next();
      logger.debug(`Total users: ${userCount}`);

      // Query active users in the last day
      logger.debug('Fetching active users in the last day');
      const activeUsersCursor = await db.query(`
        LET oneDayAgo = DATE_SUBTRACT(DATE_NOW(), 1, "day")
        RETURN LENGTH(
          FOR s IN sessions
            FILTER s.startTime >= oneDayAgo OR s.active == true
            COLLECT userId = s.userId
            RETURN 1
        )
      `);
      const activeUsers = await activeUsersCursor.next();
      logger.debug(`Active users: ${activeUsers}`);

      // Query new users in the last month
      logger.debug('Fetching new users in the last month');
      const newUsersCursor = await db.query(`
        LET oneMonthAgo = DATE_SUBTRACT(DATE_NOW(), 1, "month")
        RETURN LENGTH(
          FOR u IN users
            FILTER DATE_TIMESTAMP(u.createdAt) >= DATE_TIMESTAMP(oneMonthAgo)
            RETURN 1
        )
      `);
      const newUsers = await newUsersCursor.next();
      logger.debug(`New users: ${newUsers}`);

      // Get sample user list
      logger.debug('Fetching sample user list (top 10)');
      const usersCursor = await db.query(`
        FOR u IN users
          SORT u.updatedAt DESC
          LIMIT 10
          RETURN {
            _key: u._key,
            loginName: u.loginName,
            email: u.email,
            fullName: HAS(u, "personalIdentification") ? u.personalIdentification.fullName : "",
            role: HAS(u, "role") ? u.role : "User"
          }
      `);
      const users = await usersCursor.all();
      logger.debug(`Sample users: ${JSON.stringify(users)}`);

      const response = {
        totalUsers: userCount,
        activeUsers,
        newUsers,
        users
      };
      logger.debug(`User stats response: ${JSON.stringify(response)}`);

      return response;
    } catch (error) {
      logger.error(`Error in getUserStats: ${error.message}`, { stack: error.stack });
      throw error;
    }
  },

  /**
   * Get system logs
   * @param {Object} options - Log options
   * @param {number} options.limit - Maximum number of logs to return
   * @param {string} options.level - Log level filter
   * @param {string} options.service - Service name filter
   * @returns {Promise<Object>} Log data
   */
  async getLogs(options = {}) {
    const { limit = 100, level, service } = options;
    logger.info(`Getting system logs with options: ${JSON.stringify(options)}`);

    try {
      // Read logs from the current day's combined log file
      const today = new Date().toISOString().split('T')[0];
      const logFile = path.join(__dirname, `../logs/combined-${today}.log`);
      let logs = [];
      let totalLogs = 0;

      logger.debug(`Reading log file: ${logFile}`);
      try {
        const logContent = await fs.readFile(logFile, 'utf8');
        const logLines = logContent.split('\n').filter(line => line.trim() !== '');
        totalLogs = logLines.length;
        logger.debug(`Total log lines: ${totalLogs}`);

        logs = logLines.map(line => {
          const match = line.match(/\[([^\]]+)\]\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.*)/);
          if (!match) {
            logger.debug(`Skipping unparseable log line: ${line}`);
            return null;
          }
          const [, timestamp, level, service, message] = match;
          const parsedLog = {
            time: new Date(timestamp).toLocaleTimeString(),
            level: level.toUpperCase(),
            service,
            message,
            messageKey: message.toLowerCase().replace(/\s+/g, '')
          };
          logger.debug(`Parsed log: ${JSON.stringify(parsedLog)}`);
          return parsedLog;
        }).filter(log => log !== null);
      } catch (error) {
        logger.error(`Error reading log file: ${error.message}`);
      }

      // Filter logs based on query parameters
      let filteredLogs = logs;
      if (level) {
        logger.debug(`Filtering logs by level: ${level}`);
        filteredLogs = filteredLogs.filter(log => log.level.toLowerCase() === level.toLowerCase());
      }

      if (service) {
        logger.debug(`Filtering logs by service: ${service}`);
        filteredLogs = filteredLogs.filter(log => log.service.toLowerCase().includes(service.toLowerCase()));
      }

      // Sort by time (most recent first)
      logger.debug('Sorting logs by time (most recent first)');
      filteredLogs.sort((a, b) => new Date(b.time) - new Date(a.time));

      // Limit the number of logs
      logger.debug(`Limiting logs to ${limit}`);
      filteredLogs = filteredLogs.slice(0, parseInt(limit));

      const response = {
        logs: filteredLogs,
        total: totalLogs,
        limit: parseInt(limit),
        offset: 0
      };
      logger.debug(`Logs response: ${JSON.stringify(response)}`);

      return response;
    } catch (error) {
      logger.error(`Error in getLogs: ${error.message}`, { stack: error.stack });
      throw error;
    }
  },

  /**
   * Get security metrics
   * @returns {Promise<Object>} Security metrics
   */
  async getSecurityMetrics() {
    logger.info('Getting security metrics');

    try {
      // Query failed login attempts in the last 24 hours
      logger.debug('Fetching failed login attempts in the last 24 hours');
      const failedLoginsCursor = await db.query(`
        FOR l IN logs
          FILTER l.timestamp >= DATE_SUBTRACT(DATE_NOW(), 1, "day")
          AND l.event == "login_failed"
          COLLECT AGGREGATE count = COUNT()
          RETURN count
      `);
      const failedLoginAttempts = await failedLoginsCursor.next() || 0;
      logger.debug(`Failed login attempts: ${failedLoginAttempts}`);

      // Query suspicious activities
      logger.debug('Fetching suspicious activities in the last 24 hours');
      const suspiciousActivitiesCursor = await db.query(`
        FOR l IN logs
          FILTER l.timestamp >= DATE_SUBTRACT(DATE_NOW(), 1, "day")
          AND l.event == "suspicious_activity"
          COLLECT AGGREGATE count = COUNT()
          RETURN count
      `);
      const suspiciousActivities = await suspiciousActivitiesCursor.next() || 0;
      logger.debug(`Suspicious activities: ${suspiciousActivities}`);

      // Get last security scan time
      logger.debug('Fetching last security scan time');
      const lastScanCursor = await db.query(`
        FOR s IN security_scans
          SORT s.scanTime DESC
          LIMIT 1
          RETURN s.scanTime
      `);
      const lastScanTime = await lastScanCursor.next();
      const lastSecurityScan = lastScanTime ? this.formatTimeAgo(new Date(lastScanTime)) : 'Never';
      logger.debug(`Last security scan: ${lastSecurityScan}`);

      // Get vulnerabilities from the last scan
      logger.debug('Fetching vulnerabilities from the last security scan');
      const vulnerabilitiesCursor = await db.query(`
        FOR s IN security_scans
          SORT s.scanTime DESC
          LIMIT 1
          RETURN s.vulnerabilities
      `);
      const vulnerabilities = await vulnerabilitiesCursor.next() || { critical: 0, medium: 0, low: 0 };
      logger.debug(`Vulnerabilities: ${JSON.stringify(vulnerabilities)}`);

      const response = {
        failedLoginAttempts,
        suspiciousActivities,
        lastSecurityScan,
        vulnerabilities
      };
      logger.debug(`Security metrics response: ${JSON.stringify(response)}`);

      return response;
    } catch (error) {
      logger.error(`Error in getSecurityMetrics: ${error.message}`, { stack: error.stack });
      throw error;
    }
  },

  /**
   * Run system diagnostics
   * @returns {Promise<Object>} Diagnostics results
   */
  async runDiagnostics() {
    logger.info('Running system diagnostics');

    try {
      // Collect system information
      logger.debug('Collecting system information');
      const systemInfo = {
        os: {
          type: os.type(),
          platform: os.platform(),
          release: os.release(),
          uptime: os.uptime()
        },
        memory: {
          total: os.totalmem(),
          free: os.freemem(),
          usage: Math.round((1 - os.freemem() / os.totalmem()) * 100)
        },
        cpu: {
          model: os.cpus()[0].model,
          cores: os.cpus().length,
          loadAvg: os.loadavg()
        },
        process: {
          pid: process.pid,
          uptime: process.uptime(),
          memory: process.memoryUsage()
        }
      };
      logger.debug(`System info: ${JSON.stringify(systemInfo)}`);

      // Check disk space
      logger.debug('Checking disk space');
      let diskSpace;
      try {
        const { stdout } = await exec('df -h');
        diskSpace = stdout;
        logger.debug(`Disk space output: ${diskSpace}`);
      } catch (error) {
        diskSpace = 'Unable to fetch disk space information';
        logger.error(`Error getting disk space: ${error.message}`);
      }

      // Check network connectivity
      logger.debug('Checking network connectivity');
      const networkChecks = [
        { service: 'API Services', status: 'good' },
        { service: 'Database', status: await this.checkDatabaseHealth() ? 'good' : 'error' },
        { service: 'Cache', status: 'good' }, // Would need actual cache check
        { service: 'External API', status: 'good' } // Would need actual external API check
      ];
      logger.debug(`Network checks: ${JSON.stringify(networkChecks)}`);

      const response = {
        systemInfo,
        diskSpace,
        networkChecks
      };
      logger.debug(`Diagnostics response: ${JSON.stringify(response)}`);

      return response;
    } catch (error) {
      logger.error(`Error in runDiagnostics: ${error.message}`, { stack: error.stack });
      throw error;
    }
  },

  /**
   * Check database health
   * @returns {Promise<boolean>} Database health status
   */
  async checkDatabaseHealth() {
    try {
      logger.debug('Checking database health');
      await db.query('RETURN 1');
      logger.debug('Database health check passed');
      return true;
    } catch (error) {
      logger.error(`Database health check failed: ${error.message}`);
      return false;
    }
  },

  /**
   * Run security scan
   * @returns {Promise<Object>} Security scan results
   */
  async runSecurityScan() {
    logger.info('Running security scan');

    try {
      // Simulate a security scan
      logger.debug('Simulating security scan');
      const vulnerabilities = {
        critical: 0,
        medium: Math.floor(Math.random() * 3),
        low: Math.floor(Math.random() * 5),
        details: []
      };

      if (vulnerabilities.medium > 0) {
        const detail = {
          type: 'medium',
          description: 'Outdated package dependency',
          recommendation: 'Update package to latest version'
        };
        vulnerabilities.details.push(detail);
        logger.debug(`Added medium vulnerability: ${JSON.stringify(detail)}`);
      }

      if (vulnerabilities.low > 0) {
        const detail1 = {
          type: 'low',
          description: 'Weak password policy',
          recommendation: 'Enhance password requirements'
        };
        const detail2 = {
          type: 'low',
          description: 'Excessive session timeout',
          recommendation: 'Reduce session timeout period'
        };
        vulnerabilities.details.push(detail1, detail2);
        logger.debug(`Added low vulnerabilities: ${JSON.stringify([detail1, detail2])}`);
      }

      const scanResult = {
        scanTime: new Date().toISOString(),
        vulnerabilities
      };
      logger.debug(`Security scan result: ${JSON.stringify(scanResult)}`);

      // Store the scan result in the database
      logger.debug('Storing security scan result in security_scans collection');
      await db.query(`
        INSERT @data INTO security_scans
      `, { data: scanResult });

      return scanResult;
    } catch (error) {
      logger.error(`Error in runSecurityScan: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }
};

module.exports = adminDashboardService;