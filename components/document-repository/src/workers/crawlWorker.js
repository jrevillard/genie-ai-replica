/**
 * workers/crawlWorker.js
 * Background worker that processes asynchronous site crawl jobs.
 * It polls the 'crawl_job' collection, executes full-site crawls,
 * converts content to Markdown, and manages job state.
 */

const fs = require('fs').promises;
const fsStandard = require('fs'); // [MODIFIED] Added for streaming support
const path = require('path');
const TurndownService = require('turndown');
const langdetect = require('langdetect');
const cheerio = require('cheerio');
const { URL } = require('url'); // Explicitly import URL

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
const WORKER_CONCURRENCY = appConfig.crawler?.workerConcurrency || 10;
// [CRITICAL] This is the language filter target (e.g., 'en')
const REQUIRED_LANG = (appConfig.upload?.requiredIngestionLanguage || 'en').toLowerCase();
const UPLOAD_DIR = path.join(__dirname, '..', '..', appConfig.upload.uploadDir || 'uploads');

/**
 * Starts the background worker.
 * Exported method called by app.js on startup.
 */
const start = () => {
  logger.info(`[CRAWL-WORKER] Starting background worker. Polling every ${POLL_INTERVAL_MS}ms.`);
  poll();
};

/**
 * Recursive polling function using setTimeout to ensure
 * previous job finishes before next poll.
 */
const poll = async () => {
  try {
    await checkAndProcessJobs();
  } catch (err) {
    logger.error(`[CRAWL-WORKER] Global polling error: ${err.message}`, err);
  } finally {
    // Schedule next poll
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

  // 1. Query for a Pending job (FIFO)
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
 * @param {Object} job - The job document
 * @param {Object} db - Database connection
 */
const processJob = async (job, db) => {
  const fileId = job.file_id;
  
  // Extract advanced config (if any)
  const crawlConfig = job.config || {};

  // Pass crawlConfig as the 3rd argument
  const crawler = new Crawler(null, REQUEST_TIMEOUT_MS, crawlConfig);
  
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
  });

  // Container for the final content
  const markdownSegments = [];
  let pagesProcessed = 0;

  // --- [PERFORMANCE PATCH START] State Variables for Throttling ---
  let lastKillCheck = 0;
  let lastMetricsUpdate = 0;
  let isJobKilled = false;
  let logBuffer = [];

  // Helper: Flush logs to DB in batch to prevent connection starvation
  const flushLogBuffer = async () => {
    if (logBuffer.length === 0) return;
    const bufferCopy = [...logBuffer];
    logBuffer = []; // Clear immediately
    try {
        // Execute inserts in parallel (Promise.all) to minimize event loop blocking
        await Promise.all(bufferCopy.map(l => fileService.addCrawlLog(fileId, l.level, l.stage, l.message)));
    } catch (e) {
        logger.warn(`[CRAWL-WORKER] Failed to flush logs: ${e.message}`);
    }
  };
  // --- [PERFORMANCE PATCH END] ---

  // [ADDED] Helper: Writes segments to disk using streams to prevent OOM and Event Loop Blocking
  const saveSegmentsToStream = async (segments, destPath) => {
    const writeStream = fsStandard.createWriteStream(destPath, { encoding: 'utf8' });
    
    // Helper to allow the Event Loop to breathe (process other requests)
    const yieldToEventLoop = () => new Promise(resolve => setImmediate(resolve));

    for (let i = 0; i < segments.length; i++) {
        // Add separator unless it's the very last segment
        const separator = (i < segments.length - 1) ? '\n\n---\n\n' : '';
        const chunk = segments[i] + separator;

        // Write to stream
        const canContinue = writeStream.write(chunk);

        // Handle Backpressure: If buffer is full, wait for 'drain'
        if (!canContinue) {
            await new Promise(resolve => writeStream.once('drain', resolve));
        }

        // CPU PROTECTION: Every 50 segments, force a yield to the Node.js event loop
        if (i % 50 === 0) {
            await yieldToEventLoop();
        }
    }

    // Close stream and wait for finish
    writeStream.end();
    await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
    });
  };

  try {
    // --- A. UPDATE STATUS TO CRAWLING ---
    await updateJobStatus(db, job._key, 'Crawling');
    await fileService.addCrawlLog(fileId, 'INFO', 'System', `Crawl started for ${job.url} (Depth: ${job.depth}).`);

    // --- B. DEFINE WORKER CALLBACK ---
    // This function is called by the Crawler utility for every fetched page
    const workCallback = async (crawledUrl, $) => {
      
      // --- [PERFORMANCE PATCH START] Throttled Kill Check ---
      const now = Date.now();
      if (now - lastKillCheck > 2000) {
          const currentJob = await db.collection('crawl_job').document(job._key);
          if (currentJob.kill_requested) {
            isJobKilled = true;
          }
          lastKillCheck = now;
      }

      if (isJobKilled) {
        throw new Error('Killed'); // Specific message for control flow
      }
      // --- [PERFORMANCE PATCH END] ---

      // 2. Check Page Limit
      if (pagesProcessed >= MAX_PAGES_PER_JOB) {
        logger.warn(`[CRAWL-WORKER] Job ${job._key} hit max page limit (${MAX_PAGES_PER_JOB}). Stopping traversal.`);
        throw new Error('MaxPagesReached');
      }

      // 3. Content Cleaning (Remove non-content elements)
      $('script').remove();
      $('style').remove();
      $('nav').remove();
      $('footer').remove();
      $('header').remove();
      $('iframe').remove();
      $('noscript').remove();
      
      $('div[class*="cookie"]').remove();
      $('div[class*="privacy"]').remove();
      $('div[id*="cookie"]').remove();
      
      $('a:contains("ENQUIRE")').remove();
      $('a:contains("Book")').remove();
      $('button').remove();
      
      $('div').each((i, el) => {
          const linkCount = $(el).find('a').length;
          const textLength = $(el).text().trim().length;
          if (linkCount > 5 && textLength / linkCount < 15) { 
              $(el).remove();
          }
      });

      // 4. Fix Relative Image Paths
      $('img').each((i, el) => {
        const src = $(el).attr('src');
        if (src && !src.startsWith('http') && !src.startsWith('data:')) {
          try {
            const absoluteUrl = new URL(src, crawledUrl).href;
            $(el).attr('src', absoluteUrl);
          } catch (e) { }
        }
      });
      
      // Fix Relative Links
      $('a').each((i, el) => {
        const href = $(el).attr('href');
        if (href && !href.startsWith('http') && !href.startsWith('#') && !href.startsWith('mailto:')) {
            try {
                const absoluteUrl = new URL(href, crawledUrl).href;
                $(el).attr('href', absoluteUrl);
            } catch (e) {}
        }
      });


      // 5. Extract Main Content
      let contentHtml = null;

      // A. Configured Selector
      if (crawlConfig.contentSelector && crawlConfig.contentSelector.trim() !== '') {
          try {
              const userHtml = $(crawlConfig.contentSelector.trim()).html();
              if (userHtml && userHtml.trim()) {
                  contentHtml = userHtml;
              }
          } catch (selErr) {
              logger.warn(`[CRAWL-WORKER] Invalid selector '${crawlConfig.contentSelector}': ${selErr.message}`);
          }
      }

      // B. Fallback Heuristics
      if (!contentHtml || !contentHtml.trim()) {
          contentHtml = $('main').html() || $('article').html() || $('div.content').html() || $('body').html();
      }
      
      if (!contentHtml || !contentHtml.trim()) {
        logger.debug(`[CRAWL-WORKER] No content extracted for ${crawledUrl}`);
        return;
      }

      // 6. Convert to Markdown
      const markdown = turndownService.turndown(contentHtml);

      // --- [ADDED] LANGUAGE FILTER (PER PAGE) ---
      // Ensure we only keep pages that match the required ingestion language
      if (markdown && markdown.length > 50) { // Don't check very short snippets
        let pageLang = null;
        
        // A. Check HTML Tag first (Fastest)
        const htmlLang = $('html').attr('lang');
        if (htmlLang) {
             pageLang = htmlLang.split('-')[0].toLowerCase();
        }

        // B. If Tag matches or doesn't exist, Double Check Content (Most Accurate)
        // If tag says 'en' but content is 'fr', we want to catch that.
        if (!pageLang || pageLang === REQUIRED_LANG) {
             const detected = langdetect.detectOne(markdown);
             if (detected) pageLang = detected;
        }

        // C. Enforce Filter
        if (pageLang && pageLang !== REQUIRED_LANG) {
             // Log it locally but don't throw error, just skip this specific page
             // This allows the crawl to continue finding English links on this page, but not save the non-English content
             logBuffer.push({ level: 'INFO', stage: 'Filter', message: `Skipped ${crawledUrl}: Detected '${pageLang}', required '${REQUIRED_LANG}'` });
             return; // EXIT CALLBACK HERE -> Content is NOT added to markdownSegments
        }
      }
      // ----------------------------------------

      // 7. Store Segment
      if (markdown && markdown.length > 0) {
        markdownSegments.push(`## Source: ${crawledUrl}\n\n${markdown}`);
        pagesProcessed++;
      }

      // 8. Log Progress
      // --- [PERFORMANCE PATCH START] Buffered Logging ---
      logBuffer.push({ level: 'INFO', stage: 'Page', message: `Crawled: ${crawledUrl}` });
      
      if (logBuffer.length >= 20) {
          await flushLogBuffer();
      }
      // --- [PERFORMANCE PATCH END] ---
    };

    // --- [ADDED] METRICS UPDATE CALLBACK ---
    const onMetricsUpdate = async (metrics) => {
      // --- [PERFORMANCE PATCH START] Throttled Metrics ---
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
      // --- [PERFORMANCE PATCH END] ---
    };

    // --- C. EXECUTE CRAWL ---
    logger.debug(`[CRAWL-WORKER] Invoking crawler for ${job.url}`);
    await crawler.crawl([job.url], workCallback, job.depth, WORKER_CONCURRENCY, onMetricsUpdate);

    // --- [PERFORMANCE PATCH START] Final Flush ---
    await flushLogBuffer();
    // --- [PERFORMANCE PATCH END] ---

    // --- D. POST-CRAWL PROCESSING (OPTIMIZED) ---
    if (markdownSegments.length === 0) {
      throw new Error('Crawl finished but no content was extracted.');
    }

    logger.info(`[CRAWL-WORKER] Crawl complete. Processing ${markdownSegments.length} segments with stream strategy.`);

    // --- E. LANGUAGE VALIDATION (SAMPLING) ---
    // [MODIFIED] Detect language on sample only to save CPU
    const sampleSize = Math.min(markdownSegments.length, 50);
    const sampleText = markdownSegments.slice(0, sampleSize).join('\n');
    const detectedLang = langdetect.detectOne(sampleText);
    logger.info(`[CRAWL-WORKER] Detected language (from sample): ${detectedLang}, Required: ${REQUIRED_LANG}`);

    if (!detectedLang || detectedLang.toLowerCase() !== REQUIRED_LANG) {
      logger.warn(`[CRAWL-WORKER] Language validation warning: Found [${detectedLang}], require [${REQUIRED_LANG}]. Continuing...`);
    }

    // --- F. SAVE FILE (STREAMING) ---
    await fileUtils.ensureDirectoryExists(UPLOAD_DIR);
    const fileName = `${fileId}.md`;
    const storagePath = path.join(UPLOAD_DIR, fileName);
    
    // [MODIFIED] Use streaming helper
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
    
    // --- [PERFORMANCE PATCH] Flush any remaining logs in error state ---
    await flushLogBuffer();

    // 1. Handle Max Pages (Partial Success)
    if (error.message === 'MaxPagesReached') {
        logger.info(`[CRAWL-WORKER] Job ${job._key} reached max pages. Saving partial results.`);
        try {
            if (markdownSegments.length > 0) {
                // [MODIFIED] Use streaming helper for partial save too
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
                  status: 'Succeeded', // Marked as success because we got data
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

// Helper to update status
const updateJobStatus = async (db, key, status) => {
  await db.collection('crawl_job').update(key, { status: status });
};

// Helper to update page count progress
const updateJobProgress = async (db, key, count) => {
  try {
    await db.collection('crawl_job').update(key, { pages_crawled: count });
  } catch (e) {
    // Ignore
  }
};

module.exports = { start };