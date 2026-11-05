/**
 * workers/crawlWorker.js
 * Optimized for MEMORY EFFICIENCY.
 * Streams content directly to disk to prevent GC Thrashing during long crawls.
 */

const fs = require('fs').promises;
const fsStandard = require('fs'); // Required for createWriteStream
const path = require('path');
const { Worker, isMainThread } = require('worker_threads');
const os = require('os');

// Shared libraries
const { logger, dbService } = require('../../shared-lib');

// App dependencies
const appConfig = require('../config/appConfig');
const fileService = require('../services/fileService');
const Crawler = require('../utils/crawler');
const fileUtils = require('../utils/fileUtils');

// Configuration constants
const POLL_INTERVAL_MS = appConfig.crawler?.pollIntervalMs || 5000;
const REQUEST_TIMEOUT_MS = appConfig.crawler?.requestTimeoutMs || 5000;
const MAX_PAGES_PER_JOB = appConfig.crawler?.maxPages || 1000;
const WORKER_CONCURRENCY = appConfig.crawler?.workerConcurrency || 20;
const REQUIRED_LANG = (appConfig.upload?.requiredIngestionLanguage || 'en').toLowerCase();
const UPLOAD_DIR = path.join(__dirname, '..', '..', appConfig.upload.uploadDir || 'uploads');
const KILL_WATCH_INTERVAL_MS = appConfig.crawler?.killWatchIntervalMs || 2000;

// Definitive document absence — THE canonical classifier, imported from
// fileService (review !622 round 11): this worker's private twin had
// drifted (statusCode-only, no errorNum guard), which re-admitted the
// 1203-missing-collection infra fault as "job gone" and missed the
// driver-shape HTTP 404 (arangojs carries the status as .code). One
// classifier, two consumers, no third copy.
const isDocumentNotFound = fileService.isDocumentNotFound;

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

// A job is claimed with a timestamp; only jobs claimed BEFORE this worker
// started are orphans (the previous process died holding them). A job this
// worker — or another live instance — claimed after the boot is untouched.
const BOOT_TIME = new Date().toISOString();

// Boot-time recovery retries in the background while it keeps failing: a
// container booting while the DB is still coming up must not strand the
// previous container's jobs. The retry stops as soon as a pass succeeds, so
// the steady state costs no query at all.
const REQUEUE_RETRY_MS = 5000;
const requeueZombieJobs = async () => {
  let db;
  try {
    db = await dbService.getConnection('crawl_job');
  } catch (error) {
    logger.error(`[CRAWL-WORKER] Zombie requeue skipped, DB unavailable: ${error.message}`);
    return { ok: false, hadFailures: false };
  }
  // Bounded page size; the pass paginates until the tail is exhausted so a
  // large crash backlog cannot strand zombies behind the first page.
  const PAGE_SIZE = 50;
  let hadFailures = false;
  let batch;
  do {
    const cursor = await db.query(
      "FOR job IN crawl_job FILTER job.status == 'Crawling' AND (job.claimed_at == null || job.claimed_at < @bootTime) LIMIT @limit RETURN job",
      { bootTime: BOOT_TIME, limit: PAGE_SIZE }
    );
    batch = await cursor.all();
    hadFailures = (await requeueBatch(db, batch)) || hadFailures;
  } while (batch.length === PAGE_SIZE);
  return { ok: true, hadFailures };
};

// Requeues one page of zombies; the DB failure of the whole pass surfaces at
// the caller. Returns true when any job of the page failed.
const requeueBatch = async (db, batch) => {
  const jobCol = db.collection('crawl_job');
  let hadFailures = false;
  for (const job of batch) {
    // Per-job guard: one bad job must not strand the rest in 'Crawling'.
    try {
      if (job.kill_requested) {
        // The operator already asked for this crawl to die — do not restart
        // it; finalize it as Killed.
        await jobCol.update(job._key, {
          status: 'Killed',
          error_message: 'Crawl worker restarted mid-crawl after kill request',
          finished_at: new Date().toISOString()
        });
        await fileService.addCrawlLog(job.file_id, 'WARN', 'System', 'Crawl worker restarted; killed job finalized.');
        logger.warn(`[CRAWL-WORKER] Finalized killed zombie job ${job._key}`);
        continue;
      }
      // Clear the dead run's terminal fields — an error_message, a
      // finished_at or a stale page count from the abandoned attempt must
      // not survive into the retry (the retry re-crawls from page 0).
      await jobCol.update(job._key, {
        status: 'Pending',
        error_message: null,
        finished_at: null,
        pages_crawled: 0
      });
      await fileService.addCrawlLog(job.file_id, 'WARN', 'System', 'Crawl worker restarted mid-crawl; job requeued.');
      logger.warn(`[CRAWL-WORKER] Requeued zombie job ${job._key} (was Crawling at startup)`);
    } catch (jobError) {
      hadFailures = true;
      logger.error(`[CRAWL-WORKER] Failed to requeue zombie job ${job._key}: ${jobError.message}`);
    }
  }
  return hadFailures;
};
// Single-flight worker: a job still 'Crawling' when it starts has no live
// owner, and the poll loop only picks 'Pending' — so leftover jobs are
// requeued here or they starve. Runs BEFORE the first poll tick: a job
// picked and set to 'Crawling' by this very worker must not be seen as a
// zombie.
let started = false;

const start = () => {
  // Idempotent: a second call would arm a second poll loop and a second
  // requeue loop — two single-flight crawlers over the same queue.
  if (started) return;
  started = true;
  initWorkers();
  logger.info(`[CRAWL-WORKER] Starting background worker. Polling every ${POLL_INTERVAL_MS}ms.`);

  // The requeue runs BEFORE the poll starts (a job the poll had already
  // claimed must not be flipped back) and keeps retrying in the background
  // while it fails. A later pass cannot flip a job claimed after this worker
  // started — the claim timestamp excludes it.
  const requeueLoop = async () => {
    const { ok, hadFailures } = await requeueZombieJobs();
    if (!ok || hadFailures) {
      setTimeout(requeueLoop, REQUEUE_RETRY_MS);
    }
  };
  requeueLoop().then(poll);
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

  writeStream.setMaxListeners(WORKER_CONCURRENCY + 10);

  // Helper to handle backpressure
  const writeToDisk = async (text) => {
    if (!writeStream.write(text)) {
      // If buffer is full, wait for 'drain' event to prevent memory buildup
      await new Promise((resolve) => writeStream.once('drain', resolve));
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
      await Promise.all(bufferCopy.map((l) => fileService.addCrawlLog(fileId, l.level, l.stage, l.message)));
    } catch (e) {
      logger.warn(`[CRAWL-WORKER] Failed to flush logs: ${e.message}`);
    }
  };

  // --- REUSABLE KILL CHECK ---
  const checkKillStatus = async () => {
    if (isJobKilled) throw new Error('Killed');

    const now = Date.now();
    if (now - lastKillCheck > 2000) {
      try {
        const currentJob = await db.collection('crawl_job').document(job._key);
        if (currentJob.kill_requested) {
          isJobKilled = true;
          crawler.abort();
          throw new Error('Killed');
        }
      } catch (e) {
        if (e.message === 'Killed') throw e;
        // The job doc is GONE (file deleted mid-crawl). The kill channel IS the
        // job doc — once it is removed there is nothing left to save, report,
        // or honor a kill signal from, so treat definitive not-found as a kill.
        // Treating it as a transient error left an unkillable zombie crawl
        // holding the single-flight worker (2026-09-12 zalora incident).
        if (isDocumentNotFound(e)) {
          isJobKilled = true;
          crawler.abort();
          throw new Error('Killed', { cause: e });
        }
        // Ignore transient DB errors during check, rely on next check
        logger.warn(`[CRAWL-WORKER] Kill check failed: ${e.message}`);
      }
      lastKillCheck = now;
    }
  };

  // --- KILL WATCH (hard deadline) ---
  // checkKillStatus only fires from crawl callbacks (per page / per batch), so
  // a batch stuck in fetch-retry storms can delay the kill signal by minutes.
  // This timer polls on a fixed cadence regardless of what the crawler is
  // doing; when it fires, crawler.abort() cancels in-flight requests so the
  // crawl unwinds within ~one batch.
  const killWatch = setInterval(() => {
    checkKillStatus().catch(() => {
      // 'Killed' already aborted the crawler; transient errors retry next tick
    });
  }, KILL_WATCH_INTERVAL_MS);

  try {
    await db.collection('crawl_job').update(job._key, {
      status: 'Crawling',
      claimed_at: new Date().toISOString()
    });
    await fileService.addCrawlLog(fileId, 'INFO', 'System', `Crawl started for ${job.url}. Streaming to disk.`);

    // --- WORK CALLBACK (Executed for every successfully fetched page) ---
    const workCallback = async (crawledUrl, $) => {
      // 1. Kill Check
      await checkKillStatus();

      // 2. Page Limit
      if (pagesProcessed >= MAX_PAGES_PER_JOB) throw new Error('MaxPagesReached');

      // 3. Thread Processing
      const rawHtml = $.html();

      try {
        const result = await processPageOnThread(rawHtml, crawledUrl, crawlConfig);

        if (result.result === 'empty') return;

        if (result.shouldSkip) {
          logBuffer.push({
            level: 'INFO',
            stage: 'Filter',
            message: `Skipped ${crawledUrl}: Detected '${result.detectedLang}'`
          });
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

    // --- METRICS CALLBACK (Executed periodically by Crawler) ---
    const onMetricsUpdate = async (metrics) => {
      // 1. Kill Check (Crucial: Runs even if pages are failing/slow)
      await checkKillStatus();

      // 2. Report Metrics
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
        } catch (e) {
          // Do not swallow "Killed", but ignore other metrics errors
          if (e.message === 'Killed') throw e;
        }
        lastMetricsUpdate = now;
      }
    };

    // EXECUTE CRAWL
    await crawler.crawl([job.url], workCallback, job.depth, WORKER_CONCURRENCY, onMetricsUpdate);

    // CLOSE STREAM
    writeStream.end();
    await new Promise((resolve) => writeStream.on('finish', resolve));

    await flushLogBuffer();

    if (!hasWrittenContent) {
      throw new Error('Crawl finished but no content was extracted.');
    }

    // UPDATE DB
    const stats = await fs.stat(storagePath);
    const fileHash = await fileUtils.getFileHash(storagePath); // This might take time for huge files, but inevitable

    const fileDb = await dbService.getConnection('files');
    await fileDb.query(
      `
      FOR f IN files
      FILTER f.file_id == @fileId
      UPDATE f WITH { 
        storage_path: @storagePath,
        file_size: @fileSize,
        file_hash: @fileHash,
        uploaded_date: @uploadedDate
      } IN files
    `,
      {
        fileId: fileId,
        storagePath: storagePath,
        fileSize: stats.size,
        fileHash: fileHash,
        uploadedDate: new Date().toISOString()
      }
    );

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
        await fileDb.query(
          `
                FOR f IN files FILTER f.file_id == @fileId
                UPDATE f WITH { storage_path: @storagePath, file_size: @fileSize, uploaded_date: @uploadedDate } IN files
            `,
          { fileId, storagePath, fileSize: stats.size, uploadedDate: new Date().toISOString() }
        );

        await db.collection('crawl_job').update(job._key, {
          status: 'Succeeded',
          pages_crawled: pagesProcessed,
          finished_at: new Date().toISOString()
        });
        await fileService.addCrawlLog(
          fileId,
          'WARN',
          'System',
          'Crawl stopped: Max pages reached. Saved partial content.'
        );
        return;
      } catch (e) {
        logger.error('Failed to save metadata on max pages', e);
      }
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
    } catch (e) {
      logger.error('Failed to update error status', e);
    }
  } finally {
    clearInterval(killWatch);
  }
};

const updateJobProgress = async (db, key, count) => {
  try {
    await db.collection('crawl_job').update(key, { pages_crawled: count });
  } catch {
    // Ignore update errors
  }
};

// When loaded AS a worker thread, run. A plain require (tests, the main
// thread) does nothing.
if (!isMainThread) {
  start();
}

module.exports = { start };
