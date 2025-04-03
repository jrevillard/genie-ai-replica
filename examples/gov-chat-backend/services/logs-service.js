// src/services/logs-service.js
const fs = require('fs').promises;
const path = require('path');
const { logger } = require('../logger');

/**
 * Service for managing system logs
 */
const logsService = {
  /**
   * Get a summary of logs grouped by type and service
   * @param {Object} options - Options for filtering logs
   * @param {string} options.date - Date for which to get logs (YYYY-MM-DD format)
   * @param {string} options.level - Filter by log level
   * @returns {Promise<Object>} Log summary data
   */
  async getLogsSummary(options = {}) {
    try {
      logger.info('Getting logs summary with options:', options);
      
      // Extract params if they exist in JSON string format
      let params = options;
      if (options.params && typeof options.params === 'string') {
        try {
          params = JSON.parse(options.params);
          logger.info('Parsed params for logs summary:', params);
        } catch (e) {
          logger.error('Failed to parse params:', e);
        }
      }
      
      // Use today's date if not specified
      const date = params.date || new Date().toISOString().split('T')[0];
      
      let errorLogs = [];
      let warningLogs = [];
      
      try {
        // Try the dated log file first
        const logFile = path.join(__dirname, `../logs/combined-${date}.log`);
        let logContent;
        
        try {
          logContent = await fs.readFile(logFile, 'utf8');
          logger.debug(`Successfully read log file: ${logFile}`);
        } catch (err) {
          // If dated file doesn't exist, try the current combined.log
          if (date === new Date().toISOString().split('T')[0]) {
            const currentLogFile = path.join(__dirname, '../logs/combined.log');
            logContent = await fs.readFile(currentLogFile, 'utf8');
            logger.debug(`Reading current log file instead: ${currentLogFile}`);
          } else {
            throw err; // Re-throw if it's not today's date
          }
        }
        
        const logLines = logContent.split('\n').filter(line => line.trim() !== '');
        logger.debug(`Processing ${logLines.length} log lines for summary`);
        
        // Extract error and warning logs
        errorLogs = this.extractLogs(logLines, 'ERROR');
        warningLogs = this.extractLogs(logLines, 'WARNING');
        
        logger.debug(`Found ${errorLogs.length} ERROR logs and ${warningLogs.length} WARNING logs`);
        
        // Group logs by type and service
        const errorLogsSummary = this.groupLogs(errorLogs);
        const warningLogsSummary = this.groupLogs(warningLogs);
        
        return {
          errors: errorLogsSummary,
          warnings: warningLogsSummary,
          date
        };
      } catch (error) {
        logger.error(`Error reading log file: ${error.message}`);
        return {
          errors: [],
          warnings: [],
          date
        };
      }
    } catch (error) {
      logger.error(`Error in getLogsSummary: ${error.message}`, { stack: error.stack });
      throw error;
    }
  },

  /**
 * Search logs with filtering
 * @param {Object} options - Search options
 * @param {string} options.term - Search term
 * @param {string} options.level - Log level filter
 * @param {string} options.service - Service name filter
 * @param {string} options.dateRange - Date range (today, yesterday, week, month)
 * @param {string} options.startDate - Custom start date (YYYY-MM-DD)
 * @param {string} options.endDate - Custom end date (YYYY-MM-DD)
 * @param {boolean} options.includeArchived - Whether to include archived logs
 * @returns {Promise<Array>} Filtered log entries
 */
  async searchLogs(options = {}) {
    try {
      logger.info('Searching logs with options:', options);

      // Extract search parameters from options.params if it exists
      let searchParams = options;
      if (options.params && typeof options.params === 'string') {
        try {
          searchParams = JSON.parse(options.params);
          logger.info('Parsed search parameters:', searchParams);
        } catch (e) {
          logger.error('Failed to parse search parameters:', e);
        }
      }

      // Determine date range
      const { startDate, endDate } = this.getDateRange(searchParams);
      logger.debug(`Using date range: ${startDate} to ${endDate}`);

      // Get all log files in the range
      const logFiles = await this.getLogFilesInRange(startDate, endDate, searchParams.includeArchived);

      logger.info(`Found ${logFiles.length} log files to search:`, logFiles);

      // Read and parse all log files
      const allLogs = [];

      for (const file of logFiles) {
        try {
          logger.debug(`Reading log file: ${file}`);
          const logContent = await fs.readFile(file, 'utf8');
          const logLines = logContent.split('\n').filter(line => line.trim() !== '');
          logger.debug(`Found ${logLines.length} lines in ${file}`);

          // Special handling for error log files
          const isErrorLog = file.includes('error');
          let parsedLogs;

          if (isErrorLog) {
            // For error logs, set level to ERROR
            parsedLogs = this.parseLogs(logLines, 'ERROR');
            logger.debug(`Parsed ${parsedLogs.length} logs from error log file`);
          } else {
            // For combined logs, parse normally
            parsedLogs = this.parseLogs(logLines);
            logger.debug(`Parsed ${parsedLogs.length} logs from combined log file`);
          }

          // Log levels found in the parsed logs
          const logLevels = new Set(parsedLogs.map(log => log.level ? log.level.toUpperCase() : 'UNKNOWN'));
          logger.debug(`Log levels found in ${file}: ${Array.from(logLevels).join(', ')}`);

          allLogs.push(...parsedLogs);
        } catch (error) {
          logger.error(`Error reading log file ${file}: ${error.message}`);
        }
      }

      logger.info(`Parsed ${allLogs.length} log entries before filtering`);

      // Apply date filtering based on the date range
      let filteredLogs = allLogs.filter(log => {
        // Make sure log has a valid date
        if (!log.date) return false;

        // Compare with the date range
        return log.date >= startDate && log.date <= endDate;
      });

      logger.debug(`After date filtering: ${filteredLogs.length} logs remain`);

      // Apply filters - Modified to handle case insensitive filtering with detailed logging
      let levelFilteredLogs = filteredLogs;

      // Debug: show all unique levels in logs
      const uniqueLevels = new Set(filteredLogs.map(log => log.level ? log.level.toUpperCase() : 'UNKNOWN'));
      logger.debug(`Unique log levels in all logs: ${Array.from(uniqueLevels).join(', ')}`);

      // Apply level filter if specified
      if (searchParams.level && searchParams.level.trim() !== '') {
        const targetLevel = searchParams.level.toUpperCase();
        logger.debug(`Filtering for log level: "${targetLevel}"`);
        const beforeCount = levelFilteredLogs.length;

        levelFilteredLogs = levelFilteredLogs.filter(log => {
          const logLevel = log.level ? log.level.toUpperCase() : '';
          const matches = logLevel === targetLevel;
          return matches;
        });

        logger.debug(`After level filter (${targetLevel}): ${levelFilteredLogs.length} logs (from ${beforeCount})`);

        // If we have zero results, log some sample entries to diagnose the issue
        if (levelFilteredLogs.length === 0 && beforeCount > 0) {
          logger.debug('Level filter resulted in zero logs. Sample log entries:');
          const sampleLogs = filteredLogs.slice(0, 5);
          sampleLogs.forEach((log, index) => {
            logger.debug(`Sample log ${index + 1}: level=${log.level}, time=${log.time}, message=${log.message.substring(0, 50)}...`);
          });
        }
      }

      // Apply service filter if specified
      if (searchParams.service && searchParams.service.trim() !== '') {
        logger.debug(`Filtering for service: "${searchParams.service}"`);
        const beforeCount = levelFilteredLogs.length;

        levelFilteredLogs = levelFilteredLogs.filter(log => {
          return log.service && log.service.toLowerCase().includes(searchParams.service.toLowerCase());
        });

        logger.debug(`After service filter (${searchParams.service}): ${levelFilteredLogs.length} logs (from ${beforeCount})`);
      }

      // Apply search term filter if specified
      if (searchParams.term && searchParams.term.trim() !== '') {
        logger.debug(`Filtering for search term: "${searchParams.term}"`);
        const beforeCount = levelFilteredLogs.length;

        levelFilteredLogs = levelFilteredLogs.filter(log => {
          return log.message && log.message.toLowerCase().includes(searchParams.term.toLowerCase());
        });

        logger.debug(`After term filter (${searchParams.term}): ${levelFilteredLogs.length} logs (from ${beforeCount})`);
      }

      // Sort by date and time (most recent first)
      levelFilteredLogs.sort((a, b) => {
        // First compare by date
        if (a.date !== b.date) {
          return b.date.localeCompare(a.date);
        }
        // If dates are the same, compare by time
        const dateA = new Date(`${a.date} ${a.time}`);
        const dateB = new Date(`${b.date} ${b.time}`);
        return dateB - dateA;
      });

      logger.info(`Returning ${levelFilteredLogs.length} filtered log entries`);

      // Format logs for frontend
      const formattedLogs = levelFilteredLogs.map(log => ({
        date: log.date,  // Include date in response
        time: log.time,
        level: log.level,
        service: log.service,
        message: log.message
      }));

      return {
        logs: formattedLogs,
        total: formattedLogs.length
      };
    } catch (error) {
      logger.error(`Error in searchLogs: ${error.message}`, { stack: error.stack });
      throw error;
    }
  },
  
  /**
   * Extract logs of a specific level from log lines
   * @param {Array} logLines - Raw log lines
   * @param {string} level - Log level to extract
   * @returns {Array} Extracted logs
   */
  extractLogs(logLines, level) {
    logger.debug(`Extracting logs with level: ${level}`);
    
    const logs = logLines
      .filter(line => line.includes(`[${level}]`))
      .map(line => {
        // Parse log line
        const match = line.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+\[([^\]]+)\]:\s+(.*)/);
        if (!match) return null;
        
        const [, date, time, logLevel, message] = match;
        
        // Extract service information from the message
        let service = 'System';
        
        // Try to extract service from typical patterns
        const serviceMatch = message.match(/\[([^\]]+)\]/); // Look for service in brackets
        if (serviceMatch) {
          service = serviceMatch[1];
        } else if (message.includes('API Gateway')) {
          service = 'API Gateway';
        } else if (message.includes('Auth Service')) {
          service = 'Auth Service';
        } else if (message.includes('Database')) {
          service = 'Database';
        } else if (message.includes('Storage')) {
          service = 'Storage';
        } else if (message.includes('External API')) {
          service = 'External API';
        } else if (message.includes('Cache')) {
          service = 'Cache';
        }
        
        return {
          date,
          time,
          level: logLevel,
          message,
          service
        };
      })
      .filter(log => log !== null);
    
    logger.debug(`Extracted ${logs.length} logs with level ${level}`);
    return logs;
  },
  
  /**
   * Group logs by type and service for summary
   * @param {Array} logs - Parsed log entries
   * @returns {Array} Grouped logs summary
   */
  groupLogs(logs) {
    // Group logs by message pattern (type) and service
    const groups = {};
    
    logs.forEach(log => {
      // Create a simple "type" from the message by taking the first part
      let type = log.message.split(':')[0];
      
      // If no colon, use first few words
      if (type === log.message) {
        const words = log.message.split(' ').slice(0, 3).join(' ');
        type = words + (words.length < log.message.length ? '...' : '');
      }
      
      const key = `${type}|${log.service}`;
      
      if (!groups[key]) {
        groups[key] = {
          type,
          typeKey: type.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
          service: log.service,
          count: 0
        };
      }
      
      groups[key].count++;
    });
    
    return Object.values(groups);
  },
  
  /**
 * Parse raw log lines into structured log objects
 * @param {Array} logLines - Raw log lines
 * @param {string} defaultLevel - Default log level if not detected
 * @returns {Array} Parsed log entries
 */
  parseLogs(logLines, defaultLevel = null) {
    const logs = logLines
      .map(line => {
        // Try standard log format first: 2025-04-02 16:00:29 [INFO]: Message
        const standardMatch = line.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+\[([^\]]+)\]:\s+(.*)/);
        if (standardMatch) {
          const [, date, time, level, message] = standardMatch;
          return {
            date,  // This is YYYY-MM-DD format
            time,
            level: defaultLevel || level,
            message,
            service: this.detectService(message)
          };
        }

        // Try alternative format: 2025-04-02 16:00:29 [INFO] Message
        const altMatch1 = line.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+\[([^\]]+)\]\s+(.*)/);
        if (altMatch1) {
          const [, date, time, level, message] = altMatch1;
          return {
            date,  // This is YYYY-MM-DD format
            time,
            level: defaultLevel || level,
            message,
            service: this.detectService(message)
          };
        }

        // Try format without level: 2025-04-02 16:00:29 Message
        const dateTimeOnlyMatch = line.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(.*)/);
        if (dateTimeOnlyMatch) {
          const [, date, time, message] = dateTimeOnlyMatch;
          // Determine log level from message content or use default
          const detectedLevel = defaultLevel || this.detectLogLevel(message);
          return {
            date,  // This is YYYY-MM-DD format
            time,
            level: detectedLevel,
            message,
            service: this.detectService(message)
          };
        }

        // No recognized format, try to extract what we can
        if (line.trim()) {
          const dateMatch = line.match(/(\d{4}-\d{2}-\d{2})/);
          const timeMatch = line.match(/(\d{2}:\d{2}:\d{2})/);
          const levelMatch = line.match(/\[(ERROR|WARNING|INFO)\]/i);

          if (dateMatch || timeMatch) {
            return {
              date: dateMatch ? dateMatch[1] : new Date().toISOString().split('T')[0],
              time: timeMatch ? timeMatch[1] : '00:00:00',
              level: levelMatch ? levelMatch[1] : (defaultLevel || 'INFO'),
              message: line,
              service: this.detectService(line)
            };
          }
        }

        return null;
      })
      .filter(log => log !== null);

    // Log level distribution stats
    const levelCounts = {};
    logs.forEach(log => {
      const level = log.level ? log.level.toUpperCase() : 'UNKNOWN';
      levelCounts[level] = (levelCounts[level] || 0) + 1;
    });

    logger.debug(`Log level distribution: ${JSON.stringify(levelCounts)}`);

    return logs;
  },
  
  /**
   * Detect log level from message if not explicitly provided
   * @param {string} message - Log message
   * @returns {string} Detected log level
   */
  detectLogLevel(message) {
    if (!message) return 'INFO';
    
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('error') || lowerMessage.includes('exception') || lowerMessage.includes('fail')) {
      return 'ERROR';
    } else if (lowerMessage.includes('warn')) {
      return 'WARNING';
    } else {
      return 'INFO';
    }
  },
  
  /**
   * Detect service from message
   * @param {string} message - Log message
   * @returns {string} Detected service
   */
  detectService(message) {
    if (!message) return 'System';
    
    // Try to extract service from typical patterns in the message
    const serviceMatchers = [
      { pattern: 'API Gateway', service: 'API Gateway' },
      { pattern: 'Auth Service', service: 'Auth Service' },
      { pattern: 'Database', service: 'Database' },
      { pattern: 'Storage', service: 'Storage' },
      { pattern: 'External API', service: 'External API' },
      { pattern: 'Cache', service: 'Cache' },
      { pattern: 'Data Service', service: 'Data Service' }
    ];
    
    // Look for service names in message
    for (const matcher of serviceMatchers) {
      if (message.includes(matcher.pattern)) {
        return matcher.service;
      }
    }
    
    // Look for patterns like [AUTH DEBUG], [ADMIN DEBUG]
    const debugMatch = message.match(/\[(AUTH|ADMIN|API|DB|CACHE)\s+DEBUG\]/i);
    if (debugMatch) {
      const serviceType = debugMatch[1].toUpperCase();
      switch (serviceType) {
        case 'AUTH': return 'Auth Service';
        case 'ADMIN': return 'Admin Service';
        case 'API': return 'API Gateway';
        case 'DB': return 'Database';
        case 'CACHE': return 'Cache';
      }
    }
    
    // Try to extract service from brackets
    const bracketMatch = message.match(/\[([^\]]+)\]/);
    if (bracketMatch) {
      return bracketMatch[1];
    }
    
    return 'System';
  },
  
  /**
   * Get date range based on options
   * @param {Object} options - Date range options
   * @returns {Object} Start and end dates
   */
  getDateRange(options) {
    const now = new Date();
    let startDate, endDate;
    
    switch (options.dateRange) {
      case 'yesterday':
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 1);
        endDate = new Date(startDate);
        break;
        
      case 'week':
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 7);
        endDate = new Date(now);
        break;
        
      case 'month':
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 30);
        endDate = new Date(now);
        break;
        
      case 'custom':
        if (options.startDate && options.endDate) {
          startDate = new Date(options.startDate);
          endDate = new Date(options.endDate);
          break;
        }
        // Fall through to default if dates not provided
        
      default: // today
        startDate = new Date(now);
        endDate = new Date(now);
    }
    
    // Format dates as YYYY-MM-DD
    return {
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0]
    };
  },
  
  /**
   * Get all log files in the specified date range
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @param {boolean} includeArchived - Whether to include archived logs
   * @returns {Promise<Array>} List of log file paths
   */
  async getLogFilesInRange(startDate, endDate, includeArchived = true) {
    try {
      const logDir = path.join(__dirname, '../logs');
      const files = await fs.readdir(logDir);
      const logFiles = [];
      
      // Always include current log files if they might contain relevant logs
      const today = new Date().toISOString().split('T')[0];
      if (endDate >= today) {
        const currentCombinedLog = path.join(logDir, 'combined.log');
        const currentErrorLog = path.join(logDir, 'error.log');
        
        try {
          // Check if the files exist before adding
          await fs.access(currentCombinedLog);
          logFiles.push(currentCombinedLog);
          logger.debug(`Added current combined log: ${currentCombinedLog}`);
        } catch (e) {
          logger.debug('Current combined.log not found');
        }
        
        try {
          await fs.access(currentErrorLog);
          logFiles.push(currentErrorLog);
          logger.debug(`Added current error log: ${currentErrorLog}`);
        } catch (e) {
          logger.debug('Current error.log not found');
        }
      }
      
      if (includeArchived) {
        // Add archived log files that fall within the date range
        for (const file of files) {
          // Check for combined-YYYY-MM-DD.log pattern
          const combinedMatch = file.match(/^combined-(\d{4}-\d{2}-\d{2})\.log$/);
          if (combinedMatch) {
            const fileDate = combinedMatch[1];
            if (fileDate >= startDate && fileDate <= endDate) {
              logFiles.push(path.join(logDir, file));
              logger.debug(`Added archived combined log: ${file}`);
            }
            continue;
          }
          
          // Check for error-YYYY-MM-DD.log pattern
          const errorMatch = file.match(/^error-(\d{4}-\d{2}-\d{2})\.log$/);
          if (errorMatch) {
            const fileDate = errorMatch[1];
            if (fileDate >= startDate && fileDate <= endDate) {
              logFiles.push(path.join(logDir, file));
              logger.debug(`Added archived error log: ${file}`);
            }
          }
        }
      }
      
      logger.info(`Found ${logFiles.length} log files in range ${startDate} to ${endDate}`);
      return logFiles;
    } catch (error) {
      logger.error(`Error getting log files in range: ${error.message}`);
      return [];
    }
  }
};

module.exports = logsService;