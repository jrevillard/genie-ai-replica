/**
 * workers/crawlWorker.js
 * Background worker that processes asynchronous site crawl jobs.
 * It polls the 'crawl_job' collection, executes full-site crawls,
 * converts content to Markdown, and manages job state.
 */

const fs = require('fs').promises;
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
const REQUEST_TIMEOUT_MS = appConfig.crawler?.requestTimeoutMs || 10000; // New timeout setting
const MAX_PAGES_PER_JOB = appConfig.crawler?.maxPages || 1000;
const WORKER_CONCURRENCY = appConfig.crawler?.workerConcurrency || 10;
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

  // [FIX] Pass crawlConfig as the 3rd argument
  const crawler = new Crawler(null, REQUEST_TIMEOUT_MS, crawlConfig);
  
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
  });

  // Container for the final content
  const markdownSegments = [];
  let pagesProcessed = 0;

  try {
    // --- A. UPDATE STATUS TO CRAWLING ---
    await updateJobStatus(db, job._key, 'Crawling');
    await fileService.addCrawlLog(fileId, 'INFO', 'System', `Crawl started for ${job.url} (Depth: ${job.depth}).`);

    // --- B. DEFINE WORKER CALLBACK ---
    // This function is called by the Crawler utility for every fetched page
    const workCallback = async (crawledUrl, $) => {
      // 1. Check Kill Signal
      const currentJob = await db.collection('crawl_job').document(job._key);
      
      if (currentJob.kill_requested) {
        throw new Error('Killed'); // Specific message for control flow
      }

      // 2. Check Page Limit
      if (pagesProcessed >= MAX_PAGES_PER_JOB) {
        logger.warn(`[CRAWL-WORKER] Job ${job._key} hit max page limit (${MAX_PAGES_PER_JOB}). Stopping traversal.`);
        // Throwing specific error to stop the crawler loop cleanly
        throw new Error('MaxPagesReached');
      }

      // 3. Content Cleaning (Remove non-content elements)
      // Standard junk
      $('script').remove();
      $('style').remove();
      $('nav').remove();
      $('footer').remove();
      $('header').remove();
      $('iframe').remove();
      $('noscript').remove();
      
      // Specific RAG Optimization: Remove noise
      // Remove common cookie/privacy banners
      $('div[class*="cookie"]').remove();
      $('div[class*="privacy"]').remove();
      $('div[id*="cookie"]').remove();
      
      // Remove "Enquire" or "Book" buttons/links that clutter text
      $('a:contains("ENQUIRE")').remove();
      $('a:contains("Book")').remove();
      $('button').remove();
      
      // Remove internal navigation menus (often lists of links at top/bottom)
      // Heuristic: if a div contains mainly links and little text, kill it
      $('div').each((i, el) => {
          const linkCount = $(el).find('a').length;
          const textLength = $(el).text().trim().length;
          // If high density of links (e.g. > 5 links) and low text-to-link ratio, it's likely a menu
          if (linkCount > 5 && textLength / linkCount < 15) { 
              $(el).remove();
          }
      });

      // 4. Fix Relative Image Paths
      $('img').each((i, el) => {
        const src = $(el).attr('src');
        if (src && !src.startsWith('http') && !src.startsWith('data:')) {
          try {
            // Resolve relative path against the crawled page URL
            const absoluteUrl = new URL(src, crawledUrl).href;
            $(el).attr('src', absoluteUrl);
          } catch (e) {
            // Ignore invalid URLs
          }
        }
      });
      
      // Fix Relative Links (for better RAG context)
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

      // B. Fallback Heuristics (Original Logic)
      if (!contentHtml || !contentHtml.trim()) {
          contentHtml = $('main').html() || $('article').html() || $('div.content').html() || $('body').html();
      }
      
      if (!contentHtml || !contentHtml.trim()) {
        logger.debug(`[CRAWL-WORKER] No content extracted for ${crawledUrl}`);
        return;
      }

      // 6. Convert to Markdown
      const markdown = turndownService.turndown(contentHtml);

      // 7. Store Segment
      if (markdown && markdown.length > 0) {
        markdownSegments.push(`## Source: ${crawledUrl}\n\n${markdown}`);
        pagesProcessed++;
        
        if (pagesProcessed % 5 === 0) {
           await updateJobProgress(db, job._key, pagesProcessed);
        }
      }

      // 8. Log Progress
      await fileService.addCrawlLog(fileId, 'INFO', 'Page', `Crawled: ${crawledUrl}`);
    };

    // --- C. EXECUTE CRAWL ---
    logger.debug(`[CRAWL-WORKER] Invoking crawler for ${job.url}`);
    await crawler.crawl([job.url], workCallback, job.depth, WORKER_CONCURRENCY);

    // --- D. POST-CRAWL PROCESSING ---
    if (markdownSegments.length === 0) {
      throw new Error('Crawl finished but no content was extracted.');
    }

    logger.info(`[CRAWL-WORKER] Crawl complete. Joining ${markdownSegments.length} segments.`);
    const finalMarkdown = markdownSegments.join('\n\n---\n\n');

    // --- E. LANGUAGE VALIDATION ---
    const detectedLang = langdetect.detectOne(finalMarkdown);
    logger.info(`[CRAWL-WORKER] Detected language: ${detectedLang}, Required: ${REQUIRED_LANG}`);

    if (!detectedLang || detectedLang.toLowerCase() !== REQUIRED_LANG) {
      // Warning instead of Error to allow saving partial successful crawls even if lang is iffy
      logger.warn(`[CRAWL-WORKER] Language validation warning: Found [${detectedLang}], require [${REQUIRED_LANG}]. Continuing...`);
    }

    // --- F. SAVE FILE ---
    await fileUtils.ensureDirectoryExists(UPLOAD_DIR);
    const fileName = `${fileId}.md`;
    const storagePath = path.join(UPLOAD_DIR, fileName);
    
    await fs.writeFile(storagePath, finalMarkdown, 'utf8');
    logger.info(`[CRAWL-WORKER] Saved markdown file to ${storagePath}`);

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
    
    // 1. Handle Max Pages (Partial Success)
    if (error.message === 'MaxPagesReached') {
        logger.info(`[CRAWL-WORKER] Job ${job._key} reached max pages. Saving partial results.`);
        try {
            if (markdownSegments.length > 0) {
                const finalMarkdown = markdownSegments.join('\n\n---\n\n');
                await fileUtils.ensureDirectoryExists(UPLOAD_DIR);
                const fileName = `${fileId}.md`;
                const storagePath = path.join(UPLOAD_DIR, fileName);
                await fs.writeFile(storagePath, finalMarkdown, 'utf8');
                
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