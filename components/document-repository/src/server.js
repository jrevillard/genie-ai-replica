require('dotenv').config();
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || 128; // Increased from default 4 to support high concurrency

const http = require('http'); // [ADDED] For agent tuning
const path = require('path'); // [ADDED] For worker path resolution
const { Worker } = require('worker_threads'); // [ADDED] For non-blocking execution

const app = require('./app');
const appConfig = require('./config/appConfig');
const { logger } = require('../shared-lib');

// Validate required environment variables
const requiredEnvVars = ['ARANGO_URL', 'ARANGO_DB', 'ARANGO_PASSWORD'];
const missingEnvVars = requiredEnvVars.filter(key => !process.env[key]);
if (missingEnvVars.length > 0) {
  logger.error('Missing required environment variables:', { missing: missingEnvVars });
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

// Validate required secrets in production
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction) {
  const requiredSecrets = ['ARANGO_PASSWORD'];
  const missingSecrets = requiredSecrets.filter(key => !process.env[key] || process.env[key].includes('default') || process.env[key].includes('change'));
  if (missingSecrets.length > 0) {
    logger.error('Missing or insecure secrets in production:', { missing: missingSecrets });
    throw new Error(`Production requires secure values for: ${missingSecrets.join(', ')}`);
  }
}
// const crawlWorker = require('./workers/crawlWorker'); // [MODIFIED] Handled via Worker Thread now

// [ADDED] High Concurrency Global Tuning
// Allow more concurrent outgoing connections (e.g., to DB, Dataprep, or external sites)
http.globalAgent.maxSockets = 1000;
http.globalAgent.keepAlive = true;

const PORT = appConfig.port || process.env.PORT || 3001;
const HOST = appConfig.host || process.env.HOST || '0.0.0.0';

// Graceful shutdown function
const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  
  server.close(() => {
    logger.info('HTTP server closed.');
    
    // Close database connections if needed
    // Add any cleanup code here
    
    process.exit(0);
  });
  
  // Force close after 30 seconds
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 30000);
};

// Start server
const server = app.listen(PORT, HOST, () => {
  logger.info(appConfig.getFormattedConfiguration());
  logger.info(`🚀 Document Repository Server is running on http://${HOST}:${PORT}`);
  logger.info(`📂 Upload directory: ${appConfig.upload.uploadDir}`);
  logger.info(`🛡️  Virus scanning: ${appConfig.virusScanning ? 'enabled' : 'disabled'}`);

  // [ADDED] Server Socket Optimizations
  // Prevents "EMFILE" errors and helps drop stuck connections faster
  server.maxConnections = 10000; // Hard limit on concurrent TCP connections
  server.keepAliveTimeout = 60000; // 1 minute (must be higher than load balancer timeout)
  server.headersTimeout = 65000;   // Must be slightly higher than keepAliveTimeout

  // Start background workers
  try {
    // [MODIFIED] Spawn Crawler in a separate thread to prevent Event Loop blocking
    const workerPath = path.resolve(__dirname, './workers/crawlWorker.js');
    
    // We use eval to require the file and call start(), isolating the CPU load
    const worker = new Worker(`
      const { start } = require('${workerPath.replace(/\\/g, '/')}');
      start();
    `, { eval: true });

    worker.on('error', err => logger.error('Crawl Worker Error:', err));
    worker.on('exit', code => {
        if (code !== 0) logger.warn(`Crawl Worker stopped with exit code ${code}`);
    });

    logger.info('🕷️  Background Crawl Worker started (Threaded Mode)');
  } catch (error) {
    logger.error('Failed to start Crawl Worker:', error);
  }
});

// Handle unhandled promise rejections — log but don't crash
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions — graceful shutdown then exit (process state is undefined after this)
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

// Handle graceful shutdown
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = server;