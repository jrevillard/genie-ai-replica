const fs = require('fs').promises;
const path = require('path');
const { logger } = require('../shared-lib');
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
class LogsService {
  constructor() {
    if (LogsService.instance) {
      return LogsService.instance;
    }
    this.initialized = false;
    logger.info('LogsService constructor called');
    LogsService.instance = this;
    return this;
  }

  static getInstance() {
    if (!LogsService.instance) {
      LogsService.instance = new LogsService();
    }
    return LogsService.instance;
  }

  /**
   * Initialize the LogsService
   * @returns {Promise<void>}
   */
  async init() {
    if (this.initialized) {
      logger.debug('LogsService already initialized, skipping');
      return;
    }
    try {
      // Ensure logs directory exists
      const logDir = path.join(__dirname, '../logs');
      await fs.access(logDir).catch(async () => {
        await fs.mkdir(logDir, { recursive: true });
        logger.info(`Created logs directory: ${logDir}`);
      });
      this.initialized = true;
      logger.info('LogsService initialized successfully');
    } catch (error) {
      logger.error(`Error initializing LogsService: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Get a summary of logs grouped by type and service
   */
  async getLogsSummary(options = {}) {
    try {
      logger.info('Getting logs summary with options:', options);

      let params = options;
      if (options.params && typeof options.params === 'string') {
        try {
          params = JSON.parse(options.params);
          logger.info('Parsed params for logs summary:', params);
        } catch (e) {
          logger.error('Failed to parse params:', e);
        }
      }

      const date = params.date || new Date().toISOString().split('T')[0];
      logger.info(`Getting summary for date: ${date}`);

      let errorLogs = [];
      let warningLogs = [];

      try {
        // Check method existence
        if (!this.getLogFilesInRange || !this.readLogFile || !this.extractLogs || !this.groupLogs) {
          logger.error('One or more required methods are undefined in LogsService', {
            getLogFilesInRange: !!this.getLogFilesInRange,
            readLogFile: !!this.readLogFile,
            extractLogs: !!this.extractLogs,
            groupLogs: !!this.groupLogs
          });
          throw new Error('Required methods are undefined');
        }

        const logFiles = await this.getLogFilesInRange(date, date, true);
        logger.info(`Found ${logFiles.length} files for summary: ${logFiles.join(', ')}`);
        
        if (logFiles.length === 0) {
          logger.error(`No log files found for date ${date}`);
          return { errors: [], warnings: [], date };
        }

        // Process all found log files
        for (const logFile of logFiles) {
          try {
            logger.debug(`Processing summary for file: ${logFile}`);
            const logContent = await this.readLogFile(logFile);
            
            let logLines = logContent.split('\n').filter(line => line.trim() !== '');
            if (logLines.length > MAX_LINES_TO_PROCESS) {
              logger.warn(`Too many log lines in ${logFile} (${logLines.length}), limiting to ${MAX_LINES_TO_PROCESS}`);
              logLines = logLines.slice(0, MAX_LINES_TO_PROCESS);
            }

            logger.debug(`Processing ${logLines.length} log lines for summary from ${logFile}`);

            // Extract error and warning logs
            const fileErrorLogs = this.extractLogs(logLines, 'ERROR');
            const fileWarningLogs = this.extractLogs(logLines, 'WARN');
            
            errorLogs.push(...fileErrorLogs);
            warningLogs.push(...fileWarningLogs);
            
            logger.debug(`Found ${fileErrorLogs.length} ERROR and ${fileWarningLogs.length} WARN logs in ${logFile}`);
          } catch (fileError) {
            logger.error(`Error processing file ${logFile} for summary: ${fileError.message}`);
          }
        }

        logger.debug(`Total found: ${errorLogs.length} ERROR logs and ${warningLogs.length} WARN logs`);

        // Group logs by type and service
        const errorLogsSummary = this.groupLogs(errorLogs);
        const warningLogsSummary = this.groupLogs(warningLogs);

        return {
          errors: errorLogsSummary,
          warnings: warningLogsSummary,
          date
        };
      } catch (error) {
        logger.error(`Error reading log files for summary: ${error.message}`);
        return { errors: [], warnings: [], date };
      }
    } catch (error) {
      logger.error(`Error in getLogsSummary: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

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
  }

  /**
   * Read file content, handling both compressed and uncompressed files
   */
  async readLogFile(filePath) {
    try {
      logger.debug(`Attempting to read file: ${filePath}`);
      
      // Try to read the file directly first
      try {
        await fs.access(filePath);
        const stats = await fs.stat(filePath);
        
        if (stats.size > MAX_LOG_FILE_SIZE) {
          logger.warn(`Log file too large (${Math.round(stats.size / 1024 / 1024)}MB), reading first ${Math.round(MAX_LOG_FILE_SIZE / 1024 / 1024)}MB`);
          const fileHandle = await fs.open(filePath, 'r');
          const buffer = Buffer.alloc(MAX_LOG_FILE_SIZE);
          await fileHandle.read(buffer, 0, MAX_LOG_FILE_SIZE, 0);
          await fileHandle.close();
          const content = buffer.toString('utf8');
          logger.debug(`Read large file: ${filePath}`);
          return content;
        }
        
        if (filePath.endsWith('.gz')) {
          const compressedData = await fs.readFile(filePath);
          const decompressedData = await gunzip(compressedData);
          const content = decompressedData.toString('utf8');
          logger.debug(`Successfully read and decompressed: ${filePath}`);
          return content;
        }
        
        const content = await fs.readFile(filePath, 'utf8');
        logger.debug(`Read file: ${filePath}`);
        return content;
      } catch (error) {
        logger.error(`Error reading file ${filePath}: ${error.message}`);
        throw error;
      }
    } catch (err) {
      logger.error(`Error reading file ${filePath}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Search logs with filtering
   */
  async searchLogs(options = {}) {
    try {
      logger.debug('Searching logs with options:', options);
      
      // Check method existence
      if (!this.getDateRange || !this.getLogFilesInRange || !this.readLogFile || !this.parseLogs) {
        logger.error('One or more required methods are undefined in LogsService', {
          getDateRange: !!this.getDateRange,
          getLogFilesInRange: !!this.getLogFilesInRange,
          readLogFile: !!this.readLogFile,
          parseLogs: !!this.parseLogs
        });
        throw new Error('Required methods are undefined');
      }

      let searchParams = options;
      if (options.params && typeof options.params === 'string') {
        try {
          searchParams = JSON.parse(options.params);
          logger.info('Parsed search parameters:', searchParams);
        } catch (e) {
          logger.error('Failed to parse search parameters:', e);
        }
      }

      const { startDate, endDate } = this.getDateRange(searchParams);
      logger.debug(`Using date range: ${startDate} to ${endDate}`);
      
      const logFiles = await this.getLogFilesInRange(startDate, endDate, searchParams.includeArchived);
      logger.info(`Found ${logFiles.length} log files to search:`, logFiles);

      const allLogs = [];
      let totalLinesProcessed = 0;
      
      for (const file of logFiles) {
        try {
          logger.debug(`Reading log file: ${file}`);
          const logContent = await this.readLogFile(file);
          let logLines = logContent.split('\n').filter(line => line.trim() !== '');
          
          totalLinesProcessed += logLines.length;
          
          if (logLines.length > MAX_LINES_TO_PROCESS) {
            logger.warn(`Too many log lines in ${file} (${logLines.length}), limiting to ${MAX_LINES_TO_PROCESS}`);
            logLines = logLines.slice(0, MAX_LINES_TO_PROCESS);
          }
          
          logger.debug(`Found ${logLines.length} lines in ${file}`);
          const isErrorLog = file.includes('error');
          const parsedLogs = this.parseLogs(logLines, isErrorLog ? 'ERROR' : null);
          logger.debug(`Parsed ${parsedLogs.length} logs from ${file}`);
          allLogs.push(...parsedLogs);
        } catch (error) {
          logger.error(`Error processing log file ${file}: ${error.message}`);
        }
      }

      logger.info(`Parsed ${allLogs.length} total log entries from ${totalLinesProcessed} lines before filtering`);
      
      // Apply filters
      let filteredLogs = allLogs.filter(log => log.date >= startDate && log.date <= endDate);
      logger.debug(`After date filter: ${filteredLogs.length} logs`);
      
      if (searchParams.level && searchParams.level.trim() !== '') {
        const targetLevel = searchParams.level.toUpperCase();
        filteredLogs = filteredLogs.filter(log =>
          log.level === targetLevel || (targetLevel === 'WARN' && log.level === 'WARNING')
        );
        logger.debug(`After level filter (${targetLevel}): ${filteredLogs.length} logs`);
      }
      
      if (searchParams.service && searchParams.service.trim() !== '') {
        filteredLogs = filteredLogs.filter(log =>
          log.service && log.service.toLowerCase().includes(searchParams.service.toLowerCase())
        );
        logger.debug(`After service filter (${searchParams.service}): ${filteredLogs.length} logs`);
      }
      
      if (searchParams.term && searchParams.term.trim() !== '') {
        filteredLogs = filteredLogs.filter(log =>
          log.message && log.message.toLowerCase().includes(searchParams.term.toLowerCase())
        );
        logger.debug(`After term filter (${searchParams.term}): ${filteredLogs.length} logs`);
      }

      // Sort by date and time (most recent first)
      filteredLogs.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return new Date(`${b.date} ${b.time}`) - new Date(`${a.date} ${a.time}`);
      });
      
      logger.debug(`Sorting logs by date and time (most recent first)`);
      
      // Limit results
      const limit = 1000;
      if (filteredLogs.length > limit) {
        filteredLogs = filteredLogs.slice(0, limit);
        logger.debug(`Limiting logs to ${limit}`);
      }

      const formattedLogs = filteredLogs.map(log => ({
        date: log.date,
        time: log.time,
        level: log.level,
        service: log.service,
        message: log.message,
      }));

      logger.debug(`Log search response: ${formattedLogs.length} logs returned out of ${allLogs.length} total`);
      
      return {
        logs: formattedLogs,
        total: formattedLogs.length,
      };
    } catch (error) {
      logger.error(`Error in searchLogs: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Get all log files in the specified date range
   */
  /**
 * Get all log files in the specified date range
 */
async getLogFilesInRange(startDate, endDate, includeArchived = true) {
  try {
    const logDir = path.join(__dirname, '../logs');
    logger.debug(`Checking logs directory: ${logDir}`);
    
    await fs.access(logDir).catch(() => {
      logger.error(`Logs directory does not exist: ${logDir}`);
      return [];
    });

    const files = await fs.readdir(logDir);
    logger.debug(`Files in logs directory: ${files.join(', ')}`);
    const logFiles = [];
    const today = new Date().toISOString().split('T')[0];

    // Validate date range
    if (new Date(startDate) > new Date(endDate)) {
      logger.error(`Invalid date range: startDate (${startDate}) is after endDate (${endDate})`);
      return [];
    }

    // Include current active log files if today is in range
    if (startDate <= today && today <= endDate) {
      const currentLogs = ['combined.log', 'combined1.log', 'error.log'];
      for (const file of currentLogs) {
        const filePath = path.join(logDir, file);
        try {
          await fs.access(filePath);
          logFiles.push(filePath);
          logger.debug(`Added current active log: ${filePath}`);
        } catch (error) {
          logger.debug(`Current log not found: ${filePath}`);
        }
      }
    }

    // Process all files to find date-based logs
    for (const file of files) {
      // Skip non-log files
      if (!file.startsWith('combined-') && !file.startsWith('error-')) {
        continue;
      }

      // Extract date from filename
      const dateMatch = file.match(/^(combined|error)-(\d{4}-\d{2}-\d{2})\.log/);
      if (!dateMatch) {
        logger.debug(`File does not match date pattern: ${file}`);
        continue;
      }

      const [, logType, fileDate] = dateMatch;
      
      // Strictly enforce date range
      if (fileDate >= startDate && fileDate <= endDate) {
        const filePath = path.join(logDir, file);
        try {
          await fs.access(filePath);
          logFiles.push(filePath);
          logger.debug(`Added dated log file: ${filePath}`);
        } catch (error) {
          logger.warn(`Could not access log file ${filePath}: ${error.message}`);
        }
      } else {
        logger.debug(`File ${file} date ${fileDate} out of range ${startDate} to ${endDate}`);
      }
    }

    // Sort files by date and type for consistent processing order
    logFiles.sort((a, b) => {
      const aFile = path.basename(a);
      const bFile = path.basename(b);
      
      // Current logs first
      if (aFile.startsWith('combined.log') || aFile.startsWith('combined1.log')) return -1;
      if (bFile.startsWith('combined.log') || bFile.startsWith('combined1.log')) return 1;
      
      // Then by date
      return bFile.localeCompare(aFile);
    });

    if (logFiles.length === 0) {
      logger.warn(`No log files found for date range ${startDate} to ${endDate}`);
      logger.debug(`Expected patterns: combined-${startDate}.log*, error-${startDate}.log*`);
    } else {
      logger.debug(`Found ${logFiles.length} log files in range ${startDate} to ${endDate}: ${logFiles.join(', ')}`);
    }
    
    return logFiles;
  } catch (error) {
    logger.error(`Error getting log files: ${error.message}`, { stack: error.stack });
    throw error;
  }
}

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
  }

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
  }

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
  }

  /**
   * Parse raw log lines into structured log objects
   */
  /**
 * Parse raw log lines into structured log objects
 */
parseLogs(logLines, defaultLevel = null) {
  try {
    const logs = [];
    const processedLines = new Set(); // Track processed lines to avoid duplicates

    for (let index = 0; index < logLines.length; index++) {
      try {
        const line = logLines[index];
        if (!line || typeof line !== 'string' || line.trim() === '' || processedLines.has(line)) {
          continue;
        }

        processedLines.add(line);
        const trimmedLine = line.trim();

        // Skip debug lines about skipping unparseable log lines to avoid recursive loops
        if (trimmedLine.includes('[DEBUG]: Skipping unparseable log line:')) {
          // Extract embedded log lines
          const embeddedMatch = trimmedLine.match(/\[DEBUG\]: Skipping unparseable log line: (.+)/);
          if (embeddedMatch) {
            const embeddedLine = embeddedMatch[1].trim();
            if (embeddedLine && !processedLines.has(embeddedLine)) {
              // Parse the embedded line as a single log entry
              const embeddedLogs = this.parseLogs([embeddedLine], defaultLevel);
              logs.push(...embeddedLogs);
              processedLines.add(embeddedLine);
            }
          }
          continue;
        }

        // Handle potential embedded logs in debug messages
        if (trimmedLine.startsWith(`${trimmedLine.split(' ')[0]} [DEBUG]:`) && trimmedLine.includes(':')) {
          // Try to extract multiple embedded log lines from the debug message
          const messageStart = trimmedLine.indexOf(':') + 1;
          const debugMessage = trimmedLine.slice(messageStart).trim();
          if (debugMessage) {
            // Split potential embedded logs by common delimiters (newlines, semicolons, or other separators)
            const potentialEmbeddedLogs = debugMessage.split(/(?:\n|;|\|)/).map(l => l.trim()).filter(l => l);
            for (const embeddedLine of potentialEmbeddedLogs) {
              if (embeddedLine && !processedLines.has(embeddedLine)) {
                // Recursively parse each potential embedded log
                const embeddedLogs = this.parseLogs([embeddedLine], defaultLevel);
                logs.push(...embeddedLogs);
                processedLines.add(embeddedLine);
              }
            }
          }
        }

        // Primary format: YYYY-MM-DD HH:MM:SS [LEVEL]: Message
        const standardMatch = trimmedLine.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+\[([^\]]+)\]:\s*(.*)/);
        if (standardMatch) {
          const [, date, time, level, message] = standardMatch;
          if (!message || message.trim() === '') {
            continue;
          }
          let normalizedLevel = defaultLevel || level.toUpperCase();
          if (normalizedLevel === 'WARNING') normalizedLevel = 'WARN';
          if (!this.detectService || !this.detectLogLevel) {
            logger.error('One or more required methods are undefined in LogsService', {
              detectService: !!this.detectService,
              detectLogLevel: !!this.detectLogLevel
            });
            throw new Error('Required methods are undefined');
          }
          logs.push({
            date,
            time,
            level: normalizedLevel,
            message: message.trim(),
            service: this.detectService(message),
          });
          continue;
        }

        // Alternative format: YYYY-MM-DD HH:MM:SS [LEVEL] Message (without colon)
        const altMatch = trimmedLine.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+\[([^\]]+)\]\s+(.*)/);
        if (altMatch) {
          const [, date, time, level, message] = altMatch;
          if (!message || message.trim() === '') {
            continue;
          }
          let normalizedLevel = defaultLevel || level.toUpperCase();
          if (normalizedLevel === 'WARNING') normalizedLevel = 'WARN';
          if (!this.detectService || !this.detectLogLevel) {
            logger.error('One or more required methods are undefined in LogsService', {
              detectService: !!this.detectService,
              detectLogLevel: !!this.detectLogLevel
            });
            throw new Error('Required methods are undefined');
          }
          logs.push({
            date,
            time,
            level: normalizedLevel,
            message: message.trim(),
            service: this.detectService(message),
          });
          continue;
        }

        // Fallback: YYYY-MM-DD HH:MM:SS Message (no level brackets)
        const dateTimeOnlyMatch = trimmedLine.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(.*)/);
        if (dateTimeOnlyMatch) {
          const [, date, time, message] = dateTimeOnlyMatch;
          if (!message || message.trim() === '') {
            continue;
          }
          if (!this.detectService || !this.detectLogLevel) {
            logger.error('One or more required methods are undefined in LogsService', {
              detectService: !!this.detectService,
              detectLogLevel: !!this.detectLogLevel
            });
            throw new Error('Required methods are undefined');
          }
          let detectedLevel = defaultLevel || this.detectLogLevel(message);
          if (detectedLevel === 'WARNING') detectedLevel = 'WARN';
          logs.push({
            date,
            time,
            level: detectedLevel,
            message: message.trim(),
            service: this.detectService(message),
          });
          continue;
        }

        // If no pattern matches, log as unparseable
        logger.debug(`Line ${index} does not match any format: "${trimmedLine.substring(0, 100)}..."`);
      } catch (lineError) {
        logger.warn(`Error parsing line ${index}: ${lineError.message}`);
      }
    }

    logger.debug(`Parsed ${logs.length} logs from ${logLines.length} lines`); // Changed from INFO to DEBUG
    if (logs.length < logLines.length) {
      const skipped = logLines.length - logs.length;
      logger.debug(`Skipped ${skipped} lines during parsing`); // Changed from INFO to DEBUG
    }
    return logs;
  } catch (error) {
    logger.error(`Error in parseLogs: ${error.message}`);
    return [];
  }
}

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
        return 'WARN';
      } else if (lowerMessage.includes('debug')) {
        return 'DEBUG';
      } else {
        return 'INFO';
      }
    } catch (error) {
      logger.warn(`Error detecting log level: ${error.message}`);
      return 'INFO';
    }
  }

  /**
   * Detect service from message
   * @param {string} message - Log message
   * @returns {string} Detected service
   */
  detectService(message) {
    try {
      if (!message) return 'System';
  
      // Service detection patterns
      if (message.includes('EmailService')) return 'Email Service';
      if (message.includes('DatabaseService')) return 'Database Service';  
      if (message.includes('AuthService')) return 'Auth Service';
      if (message.includes('SessionService')) return 'Session Service';
      if (message.includes('ServiceCategoryService')) return 'Service Category';
      if (message.includes('AnalyticsService')) return 'Analytics Service';
      if (message.includes('HTTP_REQUEST')) return 'HTTP Service';
      if (message.includes('database connection') || message.includes('Database connection')) return 'Database Service';
      if (message.includes('SMTP') || message.includes('smtp')) return 'Email Service';
      if (message.includes('login') || message.includes('auth') || message.includes('token')) return 'Auth Service';
      if (message.includes('route') || message.includes('mount')) return 'Router Service';
  
      // Look for service names in brackets or patterns
      const serviceMatch = message.match(/\[([A-Z]+)\s+DEBUG\]/i);
      if (serviceMatch) {
        const serviceType = serviceMatch[1].toUpperCase();
        switch (serviceType) {
          case 'AUTH': return 'Auth Service';
          case 'ADMIN': return 'Admin Service';
          case 'API': return 'API Gateway';
          case 'DB': return 'Database Service';
          case 'CACHE': return 'Cache Service';
          default: return serviceType + ' Service';
        }
      }
  
      return 'System';
    } catch (error) {
      logger.warn(`Error detecting service: ${error.message}`);
      return 'System';
    }
  }

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
  }

  /**
   * Debug function to verify yesterday's logs can be read
   */
  async debugYesterdayLogs() {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      logger.info(`Debugging yesterday's logs for date: ${yesterdayStr}`);

      // Check method existence
      if (!this.getLogFilesInRange || !this.readLogFile) {
        logger.error('One or more required methods are undefined in LogsService', {
          getLogFilesInRange: !!this.getLogFilesInRange,
          readLogFile: !!this.readLogFile
        });
        throw new Error('Required methods are undefined');
      }

      const logFiles = await this.getLogFilesInRange(yesterdayStr, yesterdayStr, true);
      
      if (logFiles.length === 0) {
        logger.info('No log files found for yesterday');
        return {
          success: false,
          error: 'No log files found for yesterday',
          alternativeFiles: []
        };
      }

      logger.info(`Found ${logFiles.length} files for yesterday: ${logFiles.join(', ')}`);

      // Try to read the first file found
      try {
        const content = await this.readLogFile(logFiles[0]);
        const lines = content.split('\n').slice(0, 5);
        logger.info(`First 5 lines of content: ${JSON.stringify(lines)}`);

        return {
          success: true,
          lines: lines.length,
          sample: lines,
          filesFound: logFiles
        };
      } catch (error) {
        logger.error(`Error reading/decompressing file: ${error.message}`);
        return {
          success: false,
          error: error.message,
          filesFound: logFiles
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
}

const logsService = LogsService.getInstance();
module.exports = logsService;