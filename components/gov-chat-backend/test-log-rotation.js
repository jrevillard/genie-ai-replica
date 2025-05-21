// test-log-rotation.js
const { logger } = require('./logger');
for (let i = 0; i < 100000; i++) {
  logger.info(`Test log message ${i}: This is a long message to simulate a large log file. `.repeat(10));
  logger.error(`Test error message ${i}: This is a long error message to simulate a large log file. `.repeat(10));
}
console.log('Logging complete. Check the logs directory.');