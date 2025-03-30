const { createLogger, format, transports } = require('winston');

// Define log format
const logFormat = format.printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level.toUpperCase()}]: ${message}`;
});

const logger = createLogger({
  level: 'info', // Minimum level to log (e.g., 'info' logs info, warn, error)
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), // Add timestamps
    format.errors({ stack: true }), // Include stack traces for errors
    logFormat
  ),
  transports: [
    // Log to console
    new transports.Console(),
    // Log to a file
    new transports.File({ filename: 'logs/error.log', level: 'error' }), // Errors only
    new transports.File({ filename: 'logs/combined.log' }) // All logs
  ],
});

module.exports = logger;