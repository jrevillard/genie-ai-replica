/**
 * workers/crawlWorker.js
 * Background worker that processes asynchronous site crawl jobs.
 * Optimized with Worker Threads for CPU-bound tasks (HTML parsing & Markdown conversion).
 */

const fs = require('fs').promises;
const fsStandard = require('fs'); // For streaming support
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

// Configuration constants from appConfig
const POLL_INTERVAL_MS = appConfig.crawler?.pollIntervalMs || 5000;
const REQUEST_TIMEOUT_MS = appConfig.crawler?.requestTimeoutMs || 10000;
const MAX_PAGES_PER_JOB = appConfig.crawler?.maxPages || 1000;
// We can now increase concurrency because CPU work is offloaded
const WORKER_CONCURRENCY = appConfig.crawler?.workerConcurrency || 20; 
const REQUIRED_LANG = (appConfig.upload?.requiredIngestionLanguage || 'en').toLowerCase();
const UPLOAD_DIR = path.join(__dirname, '..', '..', appConfig.upload.uploadDir || 'uploads');

// --- THREAD POOL SETUP ---
const NUM_CPUS = os.cpus().length;
// Reserve 1 core for the main thread/event loop, use the rest for processing
const NUM_THREADS = Math.max(1, NUM_CPUS - 1);
const workers = [];
let workerRR = 0; // Round-robin index

/**
 * Initialize the worker thread pool.
 */
const initWorkers = () => {
    logger.info(`[CRAWL-WORKER] Initializing ${NUM_THREADS} CPU worker threads (PageProcessors)...`);
    for (let i = 0; i < NUM_THREADS; i++) {
        workers.push(new Worker(path.join(__dirname, 'pageProcessor.js')));
    }
};

/**
 * Helper: Offload page processing to a worker thread.
 * Returns a Promise that resolves when the worker replies.
 */
const processPageOnThread = (html, url, config) => {
    return new Promise((resolve, reject) => {
        // Simple Round-Robin Scheduling
        const worker = workers[workerRR];
        workerRR = (workerRR + 1) % NUM_THREADS;

        // Create a one-time listener for the result
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

        // Send data to thread
        worker.postMessage({ 
            html, 
            url, 
            config, 
            requiredLang: REQUIRED_LANG 
        });
    });
};

/**
 * Starts the background worker.
 */
const start = () => {
  initWorkers();
  logger.info(`[CRAWL-WORKER] Starting background worker. Polling every ${POLL_INTERVAL_MS}ms.`);
  poll();
};

/**
 * Recursive polling function.
 */
const poll = async () => {
  try {
    await checkAndProcessJobs();
  } catch (err) {
    logger.error(`[CRAWL-WORKER] Global polling error: ${err.message}`, err);
  } finally {
    setTimeout(poll, POLL_INTERVAL_MS);
  }
};

/**
 * Checks for a pending job and processes it.
 */
const checkAndProcessJobs = async () => {
  let db;
  try {
    db = await dbService.getConnection('crawl_job');
  } catch (error) {
    logger.error(`[CRAWL-WORKER] Failed to connect to DB: ${error.message}`);
    return;
  }

  // FIFO Query
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
      logger.info(`[CRAWL-WORKER] Found pending job: ${job._key} for URL: ${job.url}`);
      await processJob(job, db);
    }
  } catch (error) {
    logger.error(`[CRAWL-WORKER] Error querying pending jobs: ${error.message}`);
  }
};

/**
 * Executes the crawl logic for a specific job.
 */
const processJob = async (job, db) => {
  const fileId = job.file_id;
  const crawlConfig = job.config || {};

  const crawler = new Crawler(null, REQUEST_TIMEOUT_MS, crawlConfig);
  
  // Container for the final content
  const markdownSegments = [];
  let pagesProcessed = 0;

  // --- [PERFORMANCE PATCH START] State Variables for Throttling ---
  let lastKillCheck = 0;
  let lastMetricsUpdate = 0;
  let isJobKilled = false;
  let logBuffer = [];

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

  // Helper: Writes segments to disk using streams
  const saveSegmentsToStream = async (segments, destPath) => {
    const writeStream = fsStandard.createWriteStream(destPath, { encoding: 'utf8' });
    const yieldToEventLoop = () => new Promise(resolve => setImmediate(resolve));

    for (let i = 0; i < segments.length; i++) {
        const separator = (i < segments.length - 1) ? '\n\n---\n\n' : '';
        const chunk = segments[i] + separator;
        const canContinue = writeStream.write(chunk);

        if (!canContinue) {
            await new Promise(resolve => writeStream.once('drain', resolve));
        }
        if (i % 50 === 0) await yieldToEventLoop();
    }
    writeStream.end();
    await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
    });
  };

  try {
    // --- A. UPDATE STATUS TO CRAWLING ---
    await updateJobStatus(db, job._key, 'Crawling');
    await fileService.addCrawlLog(fileId, 'INFO', 'System', `Crawl started for ${job.url} with ${NUM_THREADS} threads.`);

    // --- B. DEFINE WORKER CALLBACK ---
    const workCallback = async (crawledUrl, $) => {
      
      // 1. Throttled Kill Check
      const now = Date.now();
      if (now - lastKillCheck > 2000) {
          const currentJob = await db.collection('crawl_job').document(job._key);
          if (currentJob.kill_requested) {
            isJobKilled = true;
          }
          lastKillCheck = now;
      }
      if (isJobKilled) throw new Error('Killed');

      // 2. Check Page Limit
      if (pagesProcessed >= MAX_PAGES_PER_JOB) {
        logger.warn(`[CRAWL-WORKER] Job ${job._key} hit max page limit (${MAX_PAGES_PER_JOB}).`);
        throw new Error('MaxPagesReached');
      }

      // 3. OFFLOAD CPU INTENSIVE WORK TO THREAD
      // Note: 'crawler.js' passes us a cheerio object '$'. 
      // We convert it back to HTML to send to the thread.
      const rawHtml = $.html();

      try {
        const result = await processPageOnThread(rawHtml, crawledUrl, crawlConfig);

        // Handle thread result
        if (result.result === 'empty') {
             logger.debug(`[CRAWL-WORKER] No content extracted for ${crawledUrl}`);
             return;
        }

        if (result.shouldSkip) {
             logBuffer.push({ level: 'INFO', stage: 'Filter', message: `Skipped ${crawledUrl}: Detected '${result.detectedLang}'` });
             return;
        }

        // Store Segment
        if (result.markdown && result.markdown.length > 0) {
            markdownSegments.push(`## Source: ${crawledUrl}\n\n${result.markdown}`);
            pagesProcessed++;
        }

        // Log Progress
        logBuffer.push({ level: 'INFO', stage: 'Page', message: `Crawled: ${crawledUrl}` });
        
        if (logBuffer.length >= 20) await flushLogBuffer();

      } catch (threadError) {
        logger.warn(`[CRAWL-WORKER] Thread processing failed for ${crawledUrl}: ${threadError.message}`);
      }
    };

    // --- METRICS UPDATE CALLBACK ---
    const onMetricsUpdate = async (metrics) => {
      const now = Date.now();
      if (now - lastMetricsUpdate > 3000) {
          const fullMetrics = {
            ...metrics,
            processed: pagesProcessed,
            limit: MAX_PAGES_PER_JOB,
            max_depth: job.depth 
          };
          try {
            await fileService.updateCrawlMetrics(fileId, fullMetrics);
            await updateJobProgress(db, job._key, pagesProcessed);
            await flushLogBuffer();
          } catch (e) {
            logger.error(`[CRAWL-WORKER] Failed to update metrics: ${e.message}`);
          }
          lastMetricsUpdate = now;
      }
    };

    // --- C. EXECUTE CRAWL ---
    logger.debug(`[CRAWL-WORKER] Invoking crawler for ${job.url}`);
    await crawler.crawl([job.url], workCallback, job.depth, WORKER_CONCURRENCY, onMetricsUpdate);

    // --- FINAL FLUSH ---
    await flushLogBuffer();

    // --- D. POST-CRAWL PROCESSING ---
    if (markdownSegments.length === 0) {
      throw new Error('Crawl finished but no content was extracted.');
    }

    logger.info(`[CRAWL-WORKER] Crawl complete. Processing ${markdownSegments.length} segments.`);

    // --- F. SAVE FILE (STREAMING) ---
    await fileUtils.ensureDirectoryExists(UPLOAD_DIR);
    const fileName = `${fileId}.md`;
    const storagePath = path.join(UPLOAD_DIR, fileName);
    
    await saveSegmentsToStream(markdownSegments, storagePath);
    
    logger.info(`[CRAWL-WORKER] Streamed markdown file to ${storagePath}`);

    const stats = await fs.stat(storagePath);
    const fileHash = await fileUtils.getFileHash(storagePath);

    // --- G. UPDATE METADATA & JOB SUCCESS ---
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

    await fileService.addCrawlLog(fileId, 'INFO', 'System', 'Crawl complete. File is ready for manual ingestion.');
    logger.info(`[CRAWL-WORKER] Job ${job._key} SUCCEEDED.`);

  } catch (error) {
    // --- H. ERROR HANDLING ---
    await flushLogBuffer();

    // 1. Handle Max Pages (Partial Success)
    if (error.message === 'MaxPagesReached') {
        logger.info(`[CRAWL-WORKER] Job ${job._key} reached max pages. Saving partial results.`);
        try {
            if (markdownSegments.length > 0) {
                await fileUtils.ensureDirectoryExists(UPLOAD_DIR);
                const fileName = `${fileId}.md`;
                const storagePath = path.join(UPLOAD_DIR, fileName);
                
                await saveSegmentsToStream(markdownSegments, storagePath);
                
                const stats = await fs.stat(storagePath);
                const fileHash = await fileUtils.getFileHash(storagePath);
                
                const fileDb = await dbService.getConnection('files');
                await fileDb.query(`
                  FOR f IN files
                  FILTER f.file_id == @fileId
                  UPDATE f WITH { storage_path: @storagePath, file_size: @fileSize, file_hash: @fileHash, upload_date: @uploadDate } IN files
                `, { 
                    fileId, 
                    storagePath, 
                    fileSize: stats.size, 
                    fileHash,
                    uploadDate: new Date().toISOString() 
                });

                await db.collection('crawl_job').update(job._key, {
                  status: 'Succeeded',
                  pages_crawled: pagesProcessed,
                  finished_at: new Date().toISOString()
                });
                await fileService.addCrawlLog(fileId, 'WARN', 'System', 'Crawl stopped: Max pages reached. Saved partial content.');
                return; 
            }
        } catch (e) {
            logger.error(`[CRAWL-WORKER] Failed to save partial crawl: ${e.message}`);
        }
    }

    // 2. Handle Kill/Failure
    const isKilled = error.message.includes('Killed');
    const finalStatus = isKilled ? 'Killed' : 'Failed';
    const logMessage = isKilled ? 'Crawl task was killed by user.' : `Crawl failed: ${error.message}`;

    logger.error(`[CRAWL-WORKER] Job ${job._key} ${finalStatus}: ${error.message}`);

    try {
      await db.collection('crawl_job').update(job._key, {
        status: finalStatus,
        error_message: error.message,
        pages_crawled: pagesProcessed,
        finished_at: new Date().toISOString()
      });

      await fileService.addCrawlLog(fileId, 'ERROR', 'System', logMessage);
    } catch (dbError) {
      logger.error(`[CRAWL-WORKER] Failed to update error status in DB: ${dbError.message}`);
    }
  }
};

const updateJobStatus = async (db, key, status) => {
  await db.collection('crawl_job').update(key, { status: status });
};

const updateJobProgress = async (db, key, count) => {
  try {
    await db.collection('crawl_job').update(key, { pages_crawled: count });
  } catch (e) {
    // Ignore
  }
};

module.exports = { start };