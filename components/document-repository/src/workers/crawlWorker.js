/**
 * workers/crawlWorker.js
 * Optimized for MEMORY EFFICIENCY.
 * Streams content directly to disk to prevent GC Thrashing during long crawls.
 */

const fs = require('fs').promises;
const fsStandard = require('fs'); // Required for createWriteStream
const path = require('path');
const { Worker } = require('worker_threads');
const os = require('os');
const { URL } = require('url');

// Shared libraries
const { logger, dbService } = require('../../shared-lib');

// App dependencies
const appConfig = require('../config/appConfig');
const fileService = require('../services/fileService');
const Crawler = require('../utils/crawler');
const fileUtils = require('../utils/fileUtils');

// Configuration constants
const POLL_INTERVAL_MS = appConfig.crawler?.pollIntervalMs || 5000;
const REQUEST_TIMEOUT_MS = appConfig.crawler?.requestTimeoutMs || 10000;
const MAX_PAGES_PER_JOB = appConfig.crawler?.maxPages || 1000;
const WORKER_CONCURRENCY = appConfig.crawler?.workerConcurrency || 20; 
const REQUIRED_LANG = (appConfig.upload?.requiredIngestionLanguage || 'en').toLowerCase();
const UPLOAD_DIR = path.join(__dirname, '..', '..', appConfig.upload.uploadDir || 'uploads');

// --- THREAD POOL SETUP ---
const NUM_CPUS = os.cpus().length;
const NUM_THREADS = Math.max(1, NUM_CPUS - 1);
const workers = [];
let workerRR = 0;

const initWorkers = () => {
    if (workers.length > 0) return; // Prevent double init
    logger.info(`[CRAWL-WORKER] Initializing ${NUM_THREADS} CPU worker threads...`);
    for (let i = 0; i < NUM_THREADS; i++) {
        workers.push(new Worker(path.join(__dirname, 'pageProcessor.js')));
    }
};

const processPageOnThread = (html, url, config) => {
    return new Promise((resolve, reject) => {
        const worker = workers[workerRR];
        workerRR = (workerRR + 1) % NUM_THREADS;

        const handler = (msg) => {
            cleanup();
            if (msg.result === 'error') reject(new Error(msg.message));
            else resolve(msg);
        };
        const errorHandler = (err) => {
            cleanup();
            reject(err);
        };
        const cleanup = () => {
            worker.off('message', handler);
            worker.off('error', errorHandler);
        };

        worker.on('message', handler);
        worker.on('error', errorHandler);

        worker.postMessage({ html, url, config, requiredLang: REQUIRED_LANG });
    });
};

const start = () => {
  initWorkers();
  logger.info(`[CRAWL-WORKER] Starting background worker. Polling every ${POLL_INTERVAL_MS}ms.`);
  poll();
};

const poll = async () => {
  try {
    await checkAndProcessJobs();
  } catch (err) {
    logger.error(`[CRAWL-WORKER] Global polling error: ${err.message}`, err);
  } finally {
    setTimeout(poll, POLL_INTERVAL_MS);
  }
};

const checkAndProcessJobs = async () => {
  let db;
  try {
    db = await dbService.getConnection('crawl_job');
  } catch (error) {
    logger.error(`[CRAWL-WORKER] Failed to connect to DB: ${error.message}`);
    return;
  }

  const query = `
    FOR job IN crawl_job
      FILTER job.status == 'Pending'
      SORT job.started_at ASC
      LIMIT 1
      RETURN job
  `;

  try {
    const cursor = await db.query(query);
    const job = await cursor.next();

    if (job) {
      logger.info(`[CRAWL-WORKER] Found pending job: ${job._key}`);
      await processJob(job, db);
    }
  } catch (error) {
    logger.error(`[CRAWL-WORKER] Error querying pending jobs: ${error.message}`);
  }
};

const processJob = async (job, db) => {
  const fileId = job.file_id;
  const crawlConfig = job.config || {};
  const crawler = new Crawler(null, REQUEST_TIMEOUT_MS, crawlConfig);
  
  let pagesProcessed = 0;

  // --- STREAM SETUP (OPTIMIZATION) ---
  // We open the file stream IMMEDIATELY to write data as we get it.
  await fileUtils.ensureDirectoryExists(UPLOAD_DIR);
  const fileName = `${fileId}.md`;
  const storagePath = path.join(UPLOAD_DIR, fileName);
  const writeStream = fsStandard.createWriteStream(storagePath, { flags: 'w', encoding: 'utf8' });

  // Helper to handle backpressure
  const writeToDisk = async (text) => {
      if (!writeStream.write(text)) {
          // If buffer is full, wait for 'drain' event to prevent memory buildup
          await new Promise(resolve => writeStream.once('drain', resolve));
      }
  };

  // State
  let lastKillCheck = 0;
  let lastMetricsUpdate = 0;
  let isJobKilled = false;
  let logBuffer = [];
  let hasWrittenContent = false; // Track if we wrote anything

  const flushLogBuffer = async () => {
    if (logBuffer.length === 0) return;
    const bufferCopy = [...logBuffer];
    logBuffer = [];
    try {
        await Promise.all(bufferCopy.map(l => fileService.addCrawlLog(fileId, l.level, l.stage, l.message)));
    } catch (e) {
        logger.warn(`[CRAWL-WORKER] Failed to flush logs: ${e.message}`);
    }
  };

  try {
    await updateJobStatus(db, job._key, 'Crawling');
    await fileService.addCrawlLog(fileId, 'INFO', 'System', `Crawl started for ${job.url}. Streaming to disk.`);

    const workCallback = async (crawledUrl, $) => {
      // 1. Kill Check
      const now = Date.now();
      if (now - lastKillCheck > 2000) {
          const currentJob = await db.collection('crawl_job').document(job._key);
          if (currentJob.kill_requested) isJobKilled = true;
          lastKillCheck = now;
      }
      if (isJobKilled) throw new Error('Killed');

      // 2. Page Limit
      if (pagesProcessed >= MAX_PAGES_PER_JOB) throw new Error('MaxPagesReached');

      // 3. Thread Processing
      const rawHtml = $.html();

      try {
        const result = await processPageOnThread(rawHtml, crawledUrl, crawlConfig);

        if (result.result === 'empty') return;

        if (result.shouldSkip) {
             logBuffer.push({ level: 'INFO', stage: 'Filter', message: `Skipped ${crawledUrl}: Detected '${result.detectedLang}'` });
             return;
        }

        if (result.markdown && result.markdown.length > 0) {
            // --- STREAMING WRITE ---
            const separator = hasWrittenContent ? '\n\n---\n\n' : '';
            const content = `${separator}## Source: ${crawledUrl}\n\n${result.markdown}`;
            
            await writeToDisk(content);
            
            hasWrittenContent = true;
            pagesProcessed++;
        }

        logBuffer.push({ level: 'INFO', stage: 'Page', message: `Crawled: ${crawledUrl}` });
        if (logBuffer.length >= 20) await flushLogBuffer();

      } catch (threadError) {
        logger.warn(`[CRAWL-WORKER] Thread processing failed for ${crawledUrl}: ${threadError.message}`);
      }
    };

    const onMetricsUpdate = async (metrics) => {
      const now = Date.now();
      if (now - lastMetricsUpdate > 3000) {
          try {
            await fileService.updateCrawlMetrics(fileId, {
                ...metrics,
                processed: pagesProcessed,
                limit: MAX_PAGES_PER_JOB,
                max_depth: job.depth 
            });
            await updateJobProgress(db, job._key, pagesProcessed);
            await flushLogBuffer();
          } catch (e) { /* ignore metrics errors */ }
          lastMetricsUpdate = now;
      }
    };

    // EXECUTE CRAWL
    await crawler.crawl([job.url], workCallback, job.depth, WORKER_CONCURRENCY, onMetricsUpdate);

    // CLOSE STREAM
    writeStream.end();
    await new Promise(resolve => writeStream.on('finish', resolve));

    await flushLogBuffer();

    if (!hasWrittenContent) {
      throw new Error('Crawl finished but no content was extracted.');
    }

    // UPDATE DB
    const stats = await fs.stat(storagePath);
    const fileHash = await fileUtils.getFileHash(storagePath); // This might take time for huge files, but inevitable

    const fileDb = await dbService.getConnection('files');
    await fileDb.query(`
      FOR f IN files
      FILTER f.file_id == @fileId
      UPDATE f WITH { 
        storage_path: @storagePath,
        file_size: @fileSize,
        file_hash: @fileHash,
        upload_date: @uploadDate
      } IN files
    `, {
      fileId: fileId,
      storagePath: storagePath,
      fileSize: stats.size,
      fileHash: fileHash,
      uploadDate: new Date().toISOString()
    });

    await db.collection('crawl_job').update(job._key, {
      status: 'Succeeded',
      pages_crawled: pagesProcessed,
      finished_at: new Date().toISOString()
    });

    await fileService.addCrawlLog(fileId, 'INFO', 'System', 'Crawl complete.');
    logger.info(`[CRAWL-WORKER] Job ${job._key} SUCCEEDED. Saved to ${storagePath}`);

  } catch (error) {
    // CLOSE STREAM ON ERROR
    if (writeStream && !writeStream.closed) {
        writeStream.end();
    }
    await flushLogBuffer();

    // Partial Success (Max Pages)
    if (error.message === 'MaxPagesReached') {
        logger.info(`[CRAWL-WORKER] Max pages reached. Partial save valid.`);
        // Even if we stopped early, the file on disk is valid because we streamed it!
        // Just update metadata.
        try {
            const stats = await fs.stat(storagePath);
            const fileDb = await dbService.getConnection('files');
            await fileDb.query(`
                FOR f IN files FILTER f.file_id == @fileId
                UPDATE f WITH { storage_path: @storagePath, file_size: @fileSize, upload_date: @uploadDate } IN files
            `, { fileId, storagePath, fileSize: stats.size, uploadDate: new Date().toISOString() });

            await db.collection('crawl_job').update(job._key, {
                status: 'Succeeded',
                pages_crawled: pagesProcessed,
                finished_at: new Date().toISOString()
            });
            await fileService.addCrawlLog(fileId, 'WARN', 'System', 'Crawl stopped: Max pages reached. Saved partial content.');
            return;
        } catch(e) { logger.error('Failed to save metadata on max pages', e); }
    }

    // Standard Failure
    const isKilled = error.message.includes('Killed');
    const finalStatus = isKilled ? 'Killed' : 'Failed';
    const logMessage = isKilled ? 'Crawl task was killed.' : `Crawl failed: ${error.message}`;

    try {
      await db.collection('crawl_job').update(job._key, {
        status: finalStatus,
        error_message: error.message,
        pages_crawled: pagesProcessed,
        finished_at: new Date().toISOString()
      });
      await fileService.addCrawlLog(fileId, 'ERROR', 'System', logMessage);
    } catch (e) { logger.error('Failed to update error status', e); }
  }
};

const updateJobStatus = async (db, key, status) => {
  await db.collection('crawl_job').update(key, { status: status });
};

const updateJobProgress = async (db, key, count) => {
  try { await db.collection('crawl_job').update(key, { pages_crawled: count }); } catch (e) {}
};

module.exports = { start };