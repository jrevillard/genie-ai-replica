// src/services/logs-service.js - with fixes for date handling and 7-day search
const fs = require('fs').promises;
const path = require('path');
const { logger } = require('../logger');
const zlib = require('zlib');
const util = require('util');

// Promisify zlib methods
const gunzip = util.promisify(zlib.gunzip);

// Set maximum log file size to prevent stack overflow
const MAX_LOG_FILE_SIZE = 10 * 1024 * 1024; // 10MB
// Set maximum number of lines to process at once
const MAX_LINES_TO_PROCESS = 50000;

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
          // Check if file exists before reading
          await this.fileExists(logFile);
          
          // First try reading uncompressed file
          const stats = await fs.stat(logFile);
          
          // Check file size to prevent stack overflow
          if (stats.size > MAX_LOG_FILE_SIZE) {
            logger.warn(`Log file is too large (${Math.round(stats.size / 1024 / 1024)}MB), reading first ${Math.round(MAX_LOG_FILE_SIZE / 1024 / 1024)}MB only`);
            const fileHandle = await fs.open(logFile, 'r');
            const buffer = Buffer.alloc(MAX_LOG_FILE_SIZE);
            await fileHandle.read(buffer, 0, MAX_LOG_FILE_SIZE, 0);
            await fileHandle.close();
            logContent = buffer.toString('utf8');
          } else {
            logContent = await fs.readFile(logFile, 'utf8');
          }
          
          logger.debug(`Successfully read log file: ${logFile}`);
        } catch (err) {
          // Try compressed file if uncompressed doesn't exist
          const compressedLogFile = `${logFile}.gz`;
          try {
            // Check if compressed file exists before reading
            await this.fileExists(compressedLogFile);
            
            logger.debug(`Trying compressed log file: ${compressedLogFile}`);
            const compressedData = await fs.readFile(compressedLogFile);
            logContent = (await gunzip(compressedData)).toString('utf8');
            logger.debug(`Successfully read compressed log file: ${compressedLogFile}`);
          } catch (compressedErr) {
            // If dated file doesn't exist, try the current combined.log
            if (date === new Date().toISOString().split('T')[0]) {
              const currentLogFile = path.join(__dirname, '../logs/combined.log');
              
              try {
                // Check if current log file exists before reading
                await this.fileExists(currentLogFile);
                
                const stats = await fs.stat(currentLogFile);
                
                // Check file size to prevent stack overflow
                if (stats.size > MAX_LOG_FILE_SIZE) {
                  logger.warn(`Current log file is too large (${Math.round(stats.size / 1024 / 1024)}MB), reading first ${Math.round(MAX_LOG_FILE_SIZE / 1024 / 1024)}MB only`);
                  const fileHandle = await fs.open(currentLogFile, 'r');
                  const buffer = Buffer.alloc(MAX_LOG_FILE_SIZE);
                  await fileHandle.read(buffer, 0, MAX_LOG_FILE_SIZE, 0);
                  await fileHandle.close();
                  logContent = buffer.toString('utf8');
                } else {
                  logContent = await fs.readFile(currentLogFile, 'utf8');
                }
                
                logger.debug(`Reading current log file instead: ${currentLogFile}`);
              } catch (currentFileErr) {
                logger.error(`Error reading current log file: ${currentFileErr.message}`);
                return {
                  errors: [],
                  warnings: [],
                  date
                };
              }
            } else {
              logger.error(`No log file found for date ${date}`);
              return {
                errors: [],
                warnings: [],
                date
              };
            }
          }
        }
        
        // Split logs into lines and limit the number to process
        let logLines = logContent.split('\n').filter(line => line.trim() !== '');
        
        if (logLines.length > MAX_LINES_TO_PROCESS) {
          logger.warn(`Too many log lines (${logLines.length}), limiting to ${MAX_LINES_TO_PROCESS}`);
          logLines = logLines.slice(0, MAX_LINES_TO_PROCESS);
        }
        
        logger.debug(`Processing ${logLines.length} log lines for summary`);
        
        // Extract error and warning logs
        errorLogs = this.extractLogs(logLines, 'ERROR');
        warningLogs = this.extractLogs(logLines, 'WARN');
        
        logger.debug(`Found ${errorLogs.length} ERROR logs and ${warningLogs.length} WARN logs`);
        
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
   * Check if a file exists
   * @param {string} filePath - Path to the file
   * @returns {Promise<boolean>} Whether the file exists
   */
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.debug(`File does not exist: ${filePath}`);
        throw new Error(`File not found: ${filePath}`);
      }
      throw error;
    }
  },

  /**
   * Read file content, handling both compressed and uncompressed files
   * @param {string} filePath - Path to the file
   * @returns {Promise<string>} File content as string
   */
  async readLogFile(filePath) {
    try {
      // Try reading as uncompressed first
      // Check if file exists
      await this.fileExists(filePath);
      
      // Check file size to prevent stack overflow
      const stats = await fs.stat(filePath);
      
      if (stats.size > MAX_LOG_FILE_SIZE) {
        logger.warn(`Log file is too large (${Math.round(stats.size / 1024 / 1024)}MB), reading first ${Math.round(MAX_LOG_FILE_SIZE / 1024 / 1024)}MB only`);
        const fileHandle = await fs.open(filePath, 'r');
        const buffer = Buffer.alloc(MAX_LOG_FILE_SIZE);
        await fileHandle.read(buffer, 0, MAX_LOG_FILE_SIZE, 0);
        await fileHandle.close();
        return buffer.toString('utf8');
      } else {
        return await fs.readFile(filePath, 'utf8');
      }
    } catch (err) {
      // If the file doesn't exist, check if a compressed version exists
      if (err.code === 'ENOENT' && !filePath.endsWith('.gz')) {
        const compressedFilePath = `${filePath}.gz`;
        logger.debug(`Trying compressed file: ${compressedFilePath}`);
        
        try {
          // Check if compressed file exists
          await this.fileExists(compressedFilePath);
          
          const compressedData = await fs.readFile(compressedFilePath);
          const decompressedData = await gunzip(compressedData);
          logger.debug(`Successfully read and decompressed: ${compressedFilePath}`);
          return decompressedData.toString('utf8');
        } catch (compressedErr) {
          logger.debug(`Compressed file not found either: ${compressedFilePath}`);
          throw err; // Re-throw the original error
        }
      } else {
        throw err;
      }
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

      // Special handling for yesterday's logs
      if (searchParams.dateRange === 'yesterday') {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        logger.info(`Special handling for yesterday's logs: ${yesterdayStr}`);

        const logDir = path.join(__dirname, '../logs');
        const compressedFilePath = path.join(logDir, `combined-${yesterdayStr}.log.gz`);

        // Check if the compressed file exists
        const compressedExists = await fs.access(compressedFilePath).then(() => true).catch(() => false);
        logger.info(`Yesterday's compressed log file exists: ${compressedExists}`);

        if (compressedExists) {
          try {
            // Read and decompress the file
            const compressedData = await fs.readFile(compressedFilePath);
            const decompressedData = await gunzip(compressedData);
            const content = decompressedData.toString('utf8');

            // Split into lines
            const logLines = content.split('\n').filter(line => line.trim() !== '');
            logger.info(`Successfully read ${logLines.length} lines from compressed file`);

            // Parse logs directly from this file
            const parsedLogs = logLines.map(line => {
              // Parse timestamp and message
              const match = line.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+\[([^\]]+)\](?::|)\s+(.*)/);
              if (!match) return null;

              const [, date, time, level, message] = match;
              let normalizedLevel = level;
              if (normalizedLevel === 'WARNING') normalizedLevel = 'WARN';

              return {
                date,
                time,
                level: normalizedLevel,
                message,
                service: this.detectService(message)
              };
            }).filter(log => log !== null);

            logger.info(`Successfully parsed ${parsedLogs.length} logs from yesterday's file`);

            // Apply filters
            let filteredLogs = parsedLogs;

            // Apply level filter if specified
            if (searchParams.level && searchParams.level.trim() !== '') {
              const targetLevel = searchParams.level.toUpperCase();
              filteredLogs = filteredLogs.filter(log => {
                const logLevel = log.level ? log.level.toUpperCase() : '';
                return logLevel === targetLevel ||
                  (targetLevel === 'WARN' && logLevel === 'WARNING');
              });
            }

            // Apply service filter if specified
            if (searchParams.service && searchParams.service.trim() !== '') {
              filteredLogs = filteredLogs.filter(log => {
                return log.service && log.service.toLowerCase().includes(searchParams.service.toLowerCase());
              });
            }

            // Apply search term filter if specified
            if (searchParams.term && searchParams.term.trim() !== '') {
              filteredLogs = filteredLogs.filter(log => {
                return log.message && log.message.toLowerCase().includes(searchParams.term.toLowerCase());
              });
            }

            // Sort by time (most recent first)
            filteredLogs.sort((a, b) => {
              const timeA = a.time;
              const timeB = b.time;
              return timeB.localeCompare(timeA);
            });

            // Format logs for frontend, ensuring date is set to yesterday
            const formattedLogs = filteredLogs.map(log => ({
              date: yesterdayStr,  // Explicitly set to yesterday
              time: log.time,
              level: log.level,
              service: log.service,
              message: log.message
            }));

            logger.info(`Returning ${formattedLogs.length} logs for yesterday`);

            return {
              logs: formattedLogs,
              total: formattedLogs.length
            };
          } catch (error) {
            logger.error(`Error processing yesterday's compressed log: ${error.message}`);
            // Continue with regular processing if special handling fails
          }
        }
      }

      // Get date range with normal processing for other date ranges
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
          let logContent;

          try {
            // Use the readLogFile method which handles both compressed and uncompressed
            logContent = await this.readLogFile(file);
          } catch (readError) {
            // Log the error but continue with other files
            logger.error(`Error reading log file ${file}: ${readError.message}`);
            continue; // Skip to the next file
          }

          // Limit the number of lines to process
          let logLines = logContent.split('\n').filter(line => line.trim() !== '');

          if (logLines.length > MAX_LINES_TO_PROCESS) {
            logger.warn(`Too many log lines in ${file} (${logLines.length}), limiting to ${MAX_LINES_TO_PROCESS}`);
            logLines = logLines.slice(0, MAX_LINES_TO_PROCESS);
          }

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
          logger.error(`Error processing log file ${file}: ${error.message}`);
          // Continue with the next file
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

          // Special handling for WARN/WARNING consistency
          if (targetLevel === 'WARN' && (logLevel === 'WARN' || logLevel === 'WARNING')) {
            return true;
          }

          // Special handling for DEBUG logs
          if (targetLevel === 'DEBUG' && logLevel === 'DEBUG') {
            return true;
          }

          return logLevel === targetLevel;
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
 * Extract date from a log filename
 * @param {string} filename - Log filename
 * @returns {string|null} Extracted date in YYYY-MM-DD format or null
 */
  extractDateFromFilename(filename) {
    if (!filename) return null;

    const match = filename.match(/(?:combined|error)-(\d{4}-\d{2}-\d{2})/);
    if (match) {
      return match[1];
    }

    return null;
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
      .filter(line => {
        // Check for different formats of log level
        return line.includes(`[${level}]`) || 
               line.includes(`[${level}]:`) || 
               (level === 'WARN' && (line.includes('[WARNING]') || line.includes('[WARNING]:'))) ||
               (level === 'DEBUG' && (line.includes('[DEBUG]') || line.includes('[DEBUG]:')));
      })
      .map(line => {
        // Parse log line
        const match = line.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+\[([^\]]+)\]:\s+(.*)/);
        if (!match) return null;
        
        const [, date, time, logLevel, message] = match;
        
        // Normalize level to match UI expectations (WARNING -> WARN)
        let normalizedLevel = logLevel;
        if (normalizedLevel === 'WARNING') {
          normalizedLevel = 'WARN';
        }
        
        // Extract service information from the message - use a safer approach
        let service = 'System';
        
        try {
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
        } catch (error) {
          logger.warn(`Error detecting service from message: ${error.message}`);
        }
        
        return {
          date,
          time,
          level: normalizedLevel,
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
      try {
        // Create a simple "type" from the message by taking the first part
        let type = '';
        
        if (log.message && log.message.split) {
          type = log.message.split(':')[0] || '';
          
          // If no colon, use first few words (safely)
          if (type === log.message) {
            const words = log.message.split(' ').slice(0, 3).join(' ');
            type = words + (words.length < log.message.length ? '...' : '');
          }
        } else {
          // Handle case where message is not a string
          type = 'Unknown';
          logger.warn(`Invalid log message format: ${typeof log.message}`);
        }
        
        const service = log.service || 'System';
        const key = `${type}|${service}`;
        
        if (!groups[key]) {
          groups[key] = {
            type,
            typeKey: type.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
            service,
            count: 0
          };
        }
        
        groups[key].count++;
      } catch (error) {
        logger.warn(`Error grouping log: ${error.message}`);
      }
    });
    
    return Object.values(groups);
  },
  
  /**
 * Parse raw log lines into structured log objects
 * @param {Array} logLines - Raw log lines
 * @param {string} defaultLevel - Default log level if not detected
 * @returns {Array} Parsed log entries
 */
  /**
 * Parse raw log lines into structured log objects
 * @param {Array} logLines - Raw log lines
 * @param {string} defaultLevel - Default log level if not detected
 * @returns {Array} Parsed log entries
 */
parseLogs(logLines, defaultLevel = null) {
  try {
    // Get the current date as a fallback
    const currentDate = new Date().toISOString().split('T')[0];
    
    const logs = logLines
      .map((line, index) => {
        try {
          // Skip empty lines or non-string values
          if (!line || typeof line !== 'string' || line.trim() === '') {
            return null;
          }
          
          // Prevent stack overflow by limiting line length
          const truncatedLine = line.length > 2000 ? line.substring(0, 2000) + '...' : line;
          
          // Try standard log format first: 2025-04-02 16:00:29 [INFO]: Message
          const standardMatch = truncatedLine.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+\[([^\]]+)\]:\s+(.*)/);
          if (standardMatch) {
            const [, date, time, level, message] = standardMatch;
            
            // Ensure message is not empty
            if (!message || message.trim() === '') {
              logger.debug(`Empty message found in log: ${truncatedLine}`);
            }
            
            // Normalize level to match UI expectations (WARNING -> WARN)
            let normalizedLevel = defaultLevel || level;
            if (normalizedLevel === 'WARNING') {
              normalizedLevel = 'WARN';
            }
            
            return {
              date,
              time,
              level: normalizedLevel,
              message: message || truncatedLine, // Use the entire line if message extraction failed
              service: this.detectService(message || truncatedLine)
            };
          }

          // Try alternative format: 2025-04-02 16:00:29 [INFO] Message
          const altMatch1 = truncatedLine.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+\[([^\]]+)\]\s+(.*)/);
          if (altMatch1) {
            const [, date, time, level, message] = altMatch1;
            
            // Ensure message is not empty
            if (!message || message.trim() === '') {
              logger.debug(`Empty message found in log: ${truncatedLine}`);
            }
            
            // Normalize level to match UI expectations (WARNING -> WARN)
            let normalizedLevel = defaultLevel || level;
            if (normalizedLevel === 'WARNING') {
              normalizedLevel = 'WARN';
            }
            
            return {
              date,
              time,
              level: normalizedLevel,
              message: message || truncatedLine, // Use the entire line if message extraction failed
              service: this.detectService(message || truncatedLine)
            };
          }

          // Try format with tab separators: 2025-04-02\t16:00:29\tINFO\tSystem\tMessage
          const tabSeparatedMatch = truncatedLine.match(/(\d{4}-\d{2}-\d{2})\t(\d{2}:\d{2}:\d{2})\t([^\t]+)\t([^\t]+)\t(.*)/);
          if (tabSeparatedMatch) {
            const [, date, time, level, service, message] = tabSeparatedMatch;
            
            // Normalize level to match UI expectations (WARNING -> WARN)
            let normalizedLevel = level.toUpperCase();
            if (normalizedLevel === 'WARNING') {
              normalizedLevel = 'WARN';
            }
            
            return {
              date,
              time,
              level: normalizedLevel,
              message: message || truncatedLine, // Use the entire line if message extraction failed
              service: service || this.detectService(message || truncatedLine)
            };
          }

          // Try format without level: 2025-04-02 16:00:29 Message
          const dateTimeOnlyMatch = truncatedLine.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(.*)/);
          if (dateTimeOnlyMatch) {
            const [, date, time, message] = dateTimeOnlyMatch;
            // Determine log level from message content or use default
            let detectedLevel = defaultLevel || this.detectLogLevel(message);
            
            // Normalize level to match UI expectations (WARNING -> WARN)
            if (detectedLevel === 'WARNING') {
              detectedLevel = 'WARN';
            }
            
            return {
              date,
              time,
              level: detectedLevel,
              message: message || truncatedLine, // Use the entire line if message extraction failed
              service: this.detectService(message || truncatedLine)
            };
          }

          // No recognized format, try to extract what we can
          if (truncatedLine.trim()) {
            const dateMatch = truncatedLine.match(/(\d{4}-\d{2}-\d{2})/);
            const timeMatch = truncatedLine.match(/(\d{2}:\d{2}:\d{2})/);
            const levelMatch = truncatedLine.match(/\[(ERROR|WARNING|WARN|INFO|DEBUG)\]/i);

            // Get the date from the log filename if we can't extract it from the content
            let date;
            if (dateMatch) {
              date = dateMatch[1];
            } else {
              // Try to extract date from the filename if it was passed in the defaultLevel as a fallback
              const fileMatch = defaultLevel && defaultLevel.match(/combined-(\d{4}-\d{2}-\d{2})/);
              date = fileMatch ? fileMatch[1] : currentDate;
            }

            let level = 'INFO';
            if (levelMatch) {
              level = levelMatch[1].toUpperCase();
              // Normalize level to match UI expectations (WARNING -> WARN)
              if (level === 'WARNING') {
                level = 'WARN';
              }
            } else {
              level = defaultLevel || 'INFO';
            }
            
            return {
              date,
              time: timeMatch ? timeMatch[1] : '00:00:00',
              level: level,
              message: truncatedLine, // Use the full line as the message since we couldn't parse it
              service: this.detectService(truncatedLine)
            };
          }

          return null;
        } catch (lineError) {
          logger.warn(`Error parsing log line ${index}: ${lineError.message}`);
          // Even if parsing fails, try to return something
          try {
            return {
              date: currentDate,
              time: '00:00:00',
              level: 'INFO',
              message: line.substring(0, 2000), // Use the original line as the message
              service: 'System'
            };
          } catch (e) {
            return null;
          }
        }
      })
      .filter(log => log !== null);

    return logs;
  } catch (error) {
    logger.error(`Error in parseLogs: ${error.message}`);
    return []; // Return empty array on error
  }
},
  
  /**
   * Detect log level from message if not explicitly provided
   * @param {string} message - Log message
   * @returns {string} Detected log level
   */
  detectLogLevel(message) {
    try {
      if (!message) return 'INFO';
      
      const lowerMessage = message.toLowerCase();
      if (lowerMessage.includes('error') || lowerMessage.includes('exception') || lowerMessage.includes('fail')) {
        return 'ERROR';
      } else if (lowerMessage.includes('warn')) {
        return 'WARN';  // Changed from 'WARNING' to 'WARN' to match the UI
      } else if (lowerMessage.includes('debug')) {
        return 'DEBUG';  // Added detection for DEBUG logs
      } else {
        return 'INFO';
      }
    } catch (error) {
      logger.warn(`Error detecting log level: ${error.message}`);
      return 'INFO'; // Default to INFO on error
    }
  },
  
  /**
   * Detect service from message
   * @param {string} message - Log message
   * @returns {string} Detected service
   */
  detectService(message) {
    try {
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
    } catch (error) {
      logger.warn(`Error detecting service: ${error.message}`);
      return 'System'; // Default to System on error
    }
  },
  
  /**
   * Get date range based on options
   * @param {Object} options - Date range options
   * @returns {Object} Start and end dates
   */
  getDateRange(options) {
    try {
      const now = new Date();
      let startDate, endDate;

      // Explicitly handle custom date ranges first
      if (options.dateRange === 'custom' && options.startDate && options.endDate) {
        // Custom date range explicitly provided
        startDate = new Date(options.startDate);
        endDate = new Date(options.endDate);
      } else {
        // Handle other date range options
        switch (options.dateRange) {
          case 'yesterday':
            // Set to exact yesterday, from 00:00:00 to 23:59:59
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 1);
            startDate.setHours(0, 0, 0, 0);

            endDate = new Date(startDate);
            endDate.setHours(23, 59, 59, 999);

            logger.debug(`Yesterday date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
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

          default: // today or any unrecognized value
            startDate = new Date(now);
            startDate.setHours(0, 0, 0, 0); // Start of today
            endDate = new Date(now);
            endDate.setHours(23, 59, 59, 999); // End of today
        }
      }

      // Format dates as YYYY-MM-DD
      return {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0]
      };
    } catch (error) {
      logger.error(`Error getting date range: ${error.message}`);

      // For error recovery, default to today
      const today = new Date().toISOString().split('T')[0];

      return {
        startDate: today,
        endDate: today
      };
    }
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

      // First check if the logs directory exists
      try {
        await fs.access(logDir);
      } catch (dirError) {
        logger.error(`Logs directory does not exist: ${logDir}`);
        return [];
      }

      const files = await fs.readdir(logDir);
      logger.debug(`All files in logs directory: ${files.join(', ')}`);

      const logFiles = [];

      // Always include current log files if today is in the range
      const today = new Date().toISOString().split('T')[0];
      if (startDate <= today && today <= endDate) {
        const currentCombinedLog = path.join(logDir, 'combined.log');
        const currentErrorLog = path.join(logDir, 'error.log');

        try {
          await fs.access(currentCombinedLog);
          logFiles.push(currentCombinedLog);
          logger.debug(`Added current combined log: ${currentCombinedLog}`);
        } catch (error) {
          logger.debug(`Current combined log not found: ${currentCombinedLog}`);
        }

        try {
          await fs.access(currentErrorLog);
          logFiles.push(currentErrorLog);
          logger.debug(`Added current error log: ${currentErrorLog}`);
        } catch (error) {
          logger.debug(`Current error log not found: ${currentErrorLog}`);
        }
      }

      // Add all log files that fall within the date range - both compressed and uncompressed
      for (const file of files) {
        // Skip files that don't look like our log files
        if (!file.startsWith('combined-') && !file.startsWith('error-')) {
          continue;
        }

        let filePath = path.join(logDir, file);
        let fileDate = null;

        // Extract date from filename patterns
        const dateMatch = file.match(/(?:combined|error)-(\d{4}-\d{2}-\d{2})\.log(?:\.gz)?$/);
        if (dateMatch) {
          fileDate = dateMatch[1];
        }

        // If we found a valid date and it's in range, add the file
        if (fileDate && fileDate >= startDate && fileDate <= endDate) {
          try {
            await fs.access(filePath);
            logFiles.push(filePath);
            logger.debug(`Added log file in range: ${file}`);
          } catch (error) {
            logger.warn(`Could not access log file ${filePath}: ${error.message}`);
          }
        }
      }

      if (logFiles.length === 0) {
        logger.warn(`No log files found for date range ${startDate} to ${endDate}`);

        // List what we're looking for to help debug
        const yesterdayDate = new Date();
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterdayStr = yesterdayDate.toISOString().split('T')[0];

        logger.debug(`Looking for files like: combined-${startDate}.log, combined-${startDate}.log.gz`);
        logger.debug(`Yesterday's date calculated as: ${yesterdayStr}`);

        // Check specifically for yesterday's files to aid debugging
        if (startDate === yesterdayStr) {
          const yesterdayFiles = files.filter(f => f.includes(yesterdayStr));
          logger.debug(`Files found containing yesterday's date: ${yesterdayFiles.join(', ') || 'none'}`);
        }
      }

      logger.info(`Found ${logFiles.length} log files in range ${startDate} to ${endDate}`);
      return logFiles;
    } catch (error) {
      logger.error(`Error getting log files in range: ${error.message}`, { stack: error.stack });
      return [];
    }
  },
  async debugYesterdayLogs() {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      
      logger.info(`Debugging yesterday's logs for date: ${yesterdayStr}`);
      
      const logDir = path.join(__dirname, '../logs');
      const compressedFilePath = path.join(logDir, `combined-${yesterdayStr}.log.gz`);
      
      // Check if the file exists
      const fileExists = await fs.access(compressedFilePath).then(() => true).catch(() => false);
      logger.info(`Yesterday's compressed log file exists: ${fileExists}`);
      
      if (fileExists) {
        // Try to read and decompress the file
        try {
          const compressedData = await fs.readFile(compressedFilePath);
          logger.info(`Successfully read compressed file of size: ${compressedData.length} bytes`);
          
          const decompressedData = await gunzip(compressedData);
          logger.info(`Successfully decompressed to: ${decompressedData.length} bytes`);
          
          // Display first few lines
          const content = decompressedData.toString('utf8');
          const lines = content.split('\n').slice(0, 5);
          logger.info(`First 5 lines of content: ${JSON.stringify(lines)}`);
          
          return {
            success: true,
            lines: lines.length,
            sample: lines
          };
        } catch (error) {
          logger.error(`Error reading/decompressing file: ${error.message}`);
          return {
            success: false,
            error: error.message
          };
        }
      } else {
        logger.info('Looking for alternative files for yesterday');
        const files = await fs.readdir(logDir);
        const yesterdayFiles = files.filter(f => f.includes(yesterdayStr));
        logger.info(`Files found for yesterday: ${yesterdayFiles.join(', ')}`);
        
        return {
          success: false,
          error: 'Compressed log file not found',
          alternativeFiles: yesterdayFiles
        };
      }
    } catch (error) {
      logger.error(`Debug error: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  },
  /**
 * Debug function to verify yesterday's logs can be read
 * @returns {Promise<Object>} Debug results
 */
  async debugYesterdayLogs() {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      logger.info(`Debugging yesterday's logs for date: ${yesterdayStr}`);

      const logDir = path.join(__dirname, '../logs');
      const compressedFilePath = path.join(logDir, `combined-${yesterdayStr}.log.gz`);

      // Check if the file exists
      const fileExists = await fs.access(compressedFilePath).then(() => true).catch(() => false);
      logger.info(`Yesterday's compressed log file exists: ${fileExists}`);

      if (fileExists) {
        // Try to read and decompress the file
        try {
          const compressedData = await fs.readFile(compressedFilePath);
          logger.info(`Successfully read compressed file of size: ${compressedData.length} bytes`);

          const decompressedData = await gunzip(compressedData);
          logger.info(`Successfully decompressed to: ${decompressedData.length} bytes`);

          // Display first few lines
          const content = decompressedData.toString('utf8');
          const lines = content.split('\n').slice(0, 5);
          logger.info(`First 5 lines of content: ${JSON.stringify(lines)}`);

          return {
            success: true,
            lines: lines.length,
            sample: lines
          };
        } catch (error) {
          logger.error(`Error reading/decompressing file: ${error.message}`);
          return {
            success: false,
            error: error.message
          };
        }
      } else {
        logger.info('Looking for alternative files for yesterday');
        const files = await fs.readdir(logDir);
        const yesterdayFiles = files.filter(f => f.includes(yesterdayStr));
        logger.info(`Files found for yesterday: ${yesterdayFiles.join(', ')}`);

        return {
          success: false,
          error: 'Compressed log file not found',
          alternativeFiles: yesterdayFiles
        };
      }
    } catch (error) {
      logger.error(`Debug error: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
};

module.exports = logsService;