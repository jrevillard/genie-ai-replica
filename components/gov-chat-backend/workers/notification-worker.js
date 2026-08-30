require('dotenv').config();
const { Worker } = require('bullmq');
const { logger } = require('../shared-lib');
const {
  notificationQueue,
  redisOptions,
  BROADCAST_QUEUE,
  CHUNK_QUEUE,
  MAINTENANCE_QUEUE,
} = require('../services/notification/queue');
const { BroadcastProcessor } = require('../services/notification/broadcast-processor');

/**
 * BullMQ workers for the notification fan-out.
 *
 * Runs in-process with the API by default (started from index.js). To move
 * it to its own container, run `node workers/notification-worker.js` from
 * the same image and set NOTIFICATION_WORKER_ENABLED=false on the API.
 */

let workers = [];
let processor = null;

// Full-jitter exponential backoff: ~5s/10s/20s/40s envelope, 60s cap.
function fullJitterBackoff(attemptsMade) {
  const ceiling = Math.min(5000 * Math.pow(2, Math.max(attemptsMade - 1, 0)), 60000);
  return Math.round(Math.random() * ceiling);
}

async function startWorkers({ tokenRepository, broadcastRepository, fcmSender }) {
  if (workers.length > 0) return workers;

  notificationQueue.init();
  processor = new BroadcastProcessor({ tokenRepository, broadcastRepository, fcmSender });

  const connection = redisOptions();
  const concurrency = parseInt(process.env.NOTIFICATION_SEND_CONCURRENCY, 10) || 4;
  const chunksPerSec = parseInt(process.env.NOTIFICATION_CHUNKS_PER_SEC, 10) || 8;
  const attempts = parseInt(process.env.NOTIFICATION_JOB_ATTEMPTS, 10) || 5;

  const broadcastWorker = new Worker(
    BROADCAST_QUEUE,
    (job) => processor.processBroadcast(job),
    {
      connection,
      concurrency: 2,
      settings: { backoffStrategy: fullJitterBackoff },
    },
  );

  const chunkWorker = new Worker(
    CHUNK_QUEUE,
    (job) => processor.processChunk(job),
    {
      connection,
      concurrency,
      limiter: { max: chunksPerSec, duration: 1000 },
      settings: { backoffStrategy: fullJitterBackoff },
    },
  );

  // A chunk that exhausted its attempts still counts toward completion —
  // without this, one dead chunk leaves the broadcast stuck in 'sending'.
  chunkWorker.on('failed', (job, err) => {
    if (!job) return;
    if (err && err.name === 'UnrecoverableError') return; // abort path: doc already marked failed
    const maxAttempts = job.opts?.attempts || attempts;
    if (job.attemptsMade >= maxAttempts) {
      processor.handleChunkExhausted(job).catch((e) => {
        logger.error('notification-worker.exhausted_handler_failed', { error: e.message, jobId: job.id });
      });
    }
  });

  const maintenanceWorker = new Worker(
    MAINTENANCE_QUEUE,
    async (job) => {
      if (job.name === 'reap-stale-tokens') {
        return tokenRepository.reapStale();
      }
      return null;
    },
    { connection, concurrency: 1 },
  );

  for (const w of [broadcastWorker, chunkWorker, maintenanceWorker]) {
    w.on('error', (err) => logger.error('notification-worker.error', { error: err.message }));
  }

  // Daily token hygiene at 03:00 — hard-delete old soft-deactivated rows,
  // soft-deactivate tokens unseen for 270 days (FCM's own staleness bar).
  await notificationQueue.maintenanceQueue.add(
    'reap-stale-tokens',
    {},
    {
      repeat: { pattern: '0 3 * * *' },
      jobId: 'reap-stale-tokens',
      removeOnComplete: { count: 7 },
      removeOnFail: { count: 7 },
    },
  ).catch((err) => {
    logger.warn('notification-worker.repeatable_setup_failed', { error: err.message });
  });

  workers = [broadcastWorker, chunkWorker, maintenanceWorker];
  logger.info('notification-worker.started', { concurrency, chunksPerSec, attempts });
  return workers;
}

async function stopWorkers() {
  for (const w of workers) {
    await w.close().catch(() => {});
  }
  workers = [];
  await notificationQueue.closeAll();
  logger.info('notification-worker.stopped');
}

module.exports = { startWorkers, stopWorkers };

// Standalone mode: node workers/notification-worker.js
if (require.main === module) {
  const notificationService = require('../services/notification-service');
  (async () => {
    await notificationService.init();
    await startWorkers({
      tokenRepository: notificationService.tokenRepository,
      broadcastRepository: notificationService.broadcastRepository,
      fcmSender: notificationService.fcmSender,
    });
    logger.info('notification-worker running standalone');
    const shutdown = async (signal) => {
      logger.info(`notification-worker received ${signal} — shutting down`);
      await stopWorkers();
      process.exit(0);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  })().catch((err) => {
    logger.error('notification-worker failed to start', { error: err.message, stack: err.stack });
    process.exit(1);
  });
}
