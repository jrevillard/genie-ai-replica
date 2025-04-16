const { createLogger, format, transports } = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');

// Default log format
const logFormat = format.printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level.toUpperCase()}]: ${message}`;
});

// Default configuration for the logger
let loggerConfig = {
  level: 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    logFormat
  ),
  transports: [
    new transports.Console(),
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '10m',
      maxFiles: '30d',
      zippedArchive: true,
    }),
    new DailyRotateFile({
      filename: 'logs/combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '10m',
      maxFiles: '30d',
      zippedArchive: true,
    }),
  ],
};

// Create the initial logger instance
let logger = createLogger(loggerConfig);

// Store references to the DailyRotateFile transports for manual rotation
// Changed from const to let so we can update the references
let errorTransport = logger.transports.find(
  (transport) => transport instanceof DailyRotateFile && transport.level === 'error'
);
let combinedTransport = logger.transports.find(
  (transport) => transport instanceof DailyRotateFile && !transport.level
);

// Function to reconfigure the logger
const reconfigureLogger = (newConfig) => {
  // Update the configuration with new values (if provided)
  loggerConfig.level = newConfig.level || loggerConfig.level;
  loggerConfig.transports = [
    new transports.Console(), // Keep console transport
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: newConfig.errorMaxSize || '10m', // Allow changing maxSize
      maxFiles: newConfig.errorMaxFiles || '30d', // Allow changing retention
      zippedArchive: newConfig.zippedArchive !== undefined ? newConfig.zippedArchive : true,
    }),
    new DailyRotateFile({
      filename: 'logs/combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: newConfig.combinedMaxSize || '10m', // Allow changing maxSize
      maxFiles: newConfig.combinedMaxFiles || '30d', // Allow changing retention
      zippedArchive: newConfig.zippedArchive !== undefined ? newConfig.zippedArchive : true,
    }),
  ];

  // Clear existing transports
  logger.clear();

  // Apply the new configuration
  logger.configure({
    level: loggerConfig.level,
    format: loggerConfig.format,
    transports: loggerConfig.transports,
  });

  // Update references to the new DailyRotateFile transports
  errorTransport = logger.transports.find(
    (transport) => transport instanceof DailyRotateFile && transport.level === 'error'
  );
  combinedTransport = logger.transports.find(
    (transport) => transport instanceof DailyRotateFile && !transport.level
  );

  logger.info('Logger configuration updated');
};

// Function to trigger an immediate log rollover
const triggerLogRollover = () => {
  try {
    // Re-find the transports in case they've changed
    const currentErrorTransport = logger.transports.find(
      (transport) => transport instanceof DailyRotateFile && transport.level === 'error'
    );
    
    const currentCombinedTransport = logger.transports.find(
      (transport) => transport instanceof DailyRotateFile && !transport.level
    );
    
    if (currentErrorTransport && typeof currentErrorTransport.rotate === 'function') {
      currentErrorTransport.rotate();
      logger.info('Error log rolled over manually');
    } else {
      logger.warn('Error log transport not found or does not support rotation');
    }
    
    if (currentCombinedTransport && typeof currentCombinedTransport.rotate === 'function') {
      currentCombinedTransport.rotate();
      logger.info('Combined log rolled over manually');
    } else {
      logger.warn('Combined log transport not found or does not support rotation');
    }
    
    logger.info('Log rollover operation completed');
  } catch (error) {
    logger.error(`Error during log rollover: ${error.message}`);
    throw error; // Re-throw to be caught by the controller
  }
};

// Export the logger and the reconfiguration functions
module.exports = {
  logger,
  reconfigureLogger,
  triggerLogRollover,
};