const fs = require('fs').promises;
const path = require('path');
const mime = require('mime-types');
const { logger } = require('../../shared-lib');
const { dbService } = require('../../shared-lib');
const fileUtils = require('../utils/fileUtils');
const metadataService = require('./metadataService');
const Crawler = require('../utils/crawler');
const langdetect = require('langdetect');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');

// Import services
const securityService = require('./securityService');

// Import utils
const appConfig = require('../config/appConfig');

class FileService {
  constructor() {
    this.uploadDir = path.join(__dirname, '..', '..', appConfig.upload.uploadDir || 'uploads');
    this.allowedMimeTypes = appConfig.upload.allowedMimeTypes;
    this.allowedExtensions = appConfig.upload.allowedExtensions;
  }

  /**
   * Get database connection for files
   */
  async getDb() {
    return await dbService.getConnection('files');
  }

  /**
   * Remove a file id from all aiTwins.linkedKbFileIds.
   * Best-effort cleanup only; does not fail file deletion if aiTwins DB is unavailable.
   *
   * @param {string} fileId
   */
  async _unlinkFileFromAiTwins(fileId) {
    if (!fileId) return;
    try {
      const twinDb = await dbService.getConnection('default');
      await twinDb.query(
        `
          FOR t IN aiTwins
            FILTER t.linkedKbFileIds != null AND @fileId IN t.linkedKbFileIds
            UPDATE t WITH {
              linkedKbFileIds: REMOVE_VALUE(t.linkedKbFileIds, @fileId),
              updatedAt: DATE_ISO8601(DATE_NOW())
            } IN aiTwins
        `,
        { fileId }
      );
      logger.info(`[FILE-SERVICE] Unlinked file ${fileId} from aiTwins`);
    } catch (e) {
      logger.warn(`[FILE-SERVICE] Could not unlink ${fileId} from aiTwins: ${e.message}`);
    }
  }

  /**
   * Extracts text content from a file buffer based on MIME type
   * @param {Buffer} buffer - File buffer
   * @param {string} mimeType - File MIME type
   * @returns {string} Extracted text
   */
  async _extractText(buffer, mimeType, originalFileName = '') {
    try {
      if (mimeType === 'application/pdf') {
        const data = await pdf(buffer);
        const text = data.text || '';
        logger.info(
          `[FILE-SERVICE] pdf-parse extracted ${text.length} characters. Start of text: "${text.substring(0, 200).replace(/\s+/g, ' ')}..."`
        );
        return text;
      }
      if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const { value } = await mammoth.extractRawText({ buffer });
        const text = value || '';
        logger.info(
          `[FILE-SERVICE] mammoth extracted ${text.length} characters. Start of text: "${text.substring(0, 200).replace(/\s+/g, ' ')}..."`
        );
        return text;
      }
      if (mimeType.startsWith('text/')) {
        let text = buffer.toString('utf-8');
        // --- UPDATED LOGIC: Strip HTML tags if it's an HTML file OR .html extension---
        if (mimeType === 'text/html' || originalFileName.toLowerCase().endsWith('.html')) {
          // Remove <style> and <script> blocks entirely
          text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
          text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
          // Remove all other HTML tags, leaving content
          text = text.replace(/<[^>]+>/g, ' ');
          // Replace multiple whitespace chars with a single space
          text = text.replace(/\s+/g, ' ').trim();
          logger.info(`[FILE-SERVICE] Stripped HTML. Start of text: "${text.substring(0, 200)}..."`);
        } else {
          logger.info(`[FILE-SERVICE] Text file extracted ${text.length} characters.`);
        }
        return text;
      }
    } catch (error) {
      logger.error(`[FILE-SERVICE] Text extraction failed for mimeType ${mimeType}: ${error.message}`);
    }
    return ''; // Return empty string if no text extracted or type not supported
  }

  /**
   * Detects language from text.
   * @param {string} text - Text to analyze
   * @returns {string} ISO language code (e.g., 'en') or null
   */
  _detectLanguage(text) {
    if (!text || text.trim().length < 20) {
      // Don't detect on very short strings
      logger.warn(`[FILE-SERVICE] Language detection skipped: Text is too short (${text ? text.length : 0} chars)`);
      return null;
    }

    logger.info(
      `[FILE-SERVICE] Detecting language from text (first 200 chars): "${text.substring(0, 200).replace(/\s+/g, ' ')}..."`
    );

    try {
      // Use detectOne() which is more robust and returns a simple string or throws an error.
      const langCode = langdetect.detectOne(text);

      if (langCode) {
        logger.info(`[FILE-SERVICE] Language_detect result: ${langCode}`);
        return langCode;
      }

      logger.warn(`[FILE-SERVICE] Language_detect.detectOne returned an empty result.`);
      return null;
    } catch (error) {
      // langdetect throws an error if no language features are found
      logger.warn(`[FILE-SERVICE] Language detection failed (no language features found or error): ${error.message}`);
      return null;
    }
  }

  /**
   * Upload and process a file
   * @param {Object} fileData - File data from multer
   * @param {Object} fileInfo - Additional information about the file (provided by the user)
   * @returns {Object} File record
   */
  async uploadFile(fileData, fileInfo = {}) {
    let filePath;
    try {
      const originalFileName = fileData.originalname;
      const mimeType = mime.lookup(originalFileName) || fileData.mimetype;
      const fileExtension = path.extname(originalFileName).toLowerCase();

      // Perform Language Detection (Spec Sec 4.1)
      const requiredLanguage = (appConfig.upload.requiredIngestionLanguage || 'en').toLowerCase();

      // Only check supported types for ingestion
      const ingestionTypes = [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/markdown',
        'text/html',
        'text/plain'
      ];

      let detectedLang = null;
      if (ingestionTypes.includes(mimeType) || originalFileName.toLowerCase().endsWith('.html')) {
        logger.info(`[FILE-SERVICE] Performing language check for ${originalFileName}`);

        // --- UPDATED LOGIC ---
        // 1. Extract clean text from the file buffer
        const text = await this._extractText(fileData.buffer, mimeType, originalFileName);

        // 2. Detect language from the clean text
        detectedLang = this._detectLanguage(text);

        // 3. Get the language from the HTML tag (if provided by the crawler)
        const tagLang = fileInfo.language; // This is 'ru' from <html lang="ru">

        logger.info(
          `[FILE-SERVICE] Language detected (Content): ${detectedLang}, (HTML Tag): ${tagLang}, (Required): ${requiredLanguage}`
        );

        // 4. Stricter validation
        // Block if language is NOT detected (null) OR if it is the wrong language.
        if (!detectedLang || detectedLang.toLowerCase() !== requiredLanguage) {
          const langFound = detectedLang || 'unknown'; // Handle null for the error message
          throw new Error(
            `File [${originalFileName}] content appears to be in [${langFound}]. Only [${requiredLanguage.toUpperCase()}] documents are supported for ingestion.`
          );
        }

        // 5. NEW: Validate tag language against content language if tag exists
        if (tagLang && tagLang.trim() !== '' && tagLang.toLowerCase() !== 'unknown') {
          if (tagLang.toLowerCase() !== detectedLang.toLowerCase()) {
            logger.warn(
              `[FILE-SERVICE] Conflicting languages for ${originalFileName}. HTML tag: [${tagLang}], Content: [${detectedLang}].`
            );
            // Allowing ingestion based on content as per logic flow, but flagging discrepancy.
            // If this should be a hard failure, uncomment the line below:
            // throw new Error(`File [${originalFileName}] has conflicting languages. HTML tag says [${tagLang}] but content appears to be [${detectedLang}].`);
          }
          // If they match, we trust the detected content language
          logger.info(
            `[FILE-SERVICE] HTML tag lang "${tagLang}" matches content lang "${detectedLang}". Validation passed.`
          );
        }
        // --- END UPDATED LOGIC ---
      }

      // Generate unique file ID
      const fileId = fileUtils.generateUniqueFileId();
      const savedFileName = `${fileId}${fileExtension}`;
      filePath = path.join(this.uploadDir, savedFileName);
      logger.debug(`[FILE-SERVICE] Save file ${originalFileName} into ${savedFileName}`);

      // Validate file type & extension
      const isMimeAllowed = this.allowedMimeTypes.includes(mimeType);
      const isExtensionAllowed = this.allowedExtensions.includes(fileExtension);
      if (!(isMimeAllowed && isExtensionAllowed)) {
        throw new Error(`File type ${mimeType} or extension ${fileExtension} is not allowed`);
      }

      // Validate file size
      const maxFileSize = appConfig.upload.maxFileSize;
      if (fileData.size > maxFileSize) {
        throw new Error(`File size exceeds maximum allowed size of ${maxFileSize} bytes`);
      }

      // Ensure upload directory exists
      logger.debug(`[FILE-SERVICE]  Ensure upload directory exists: ${this.uploadDir}`);
      await fileUtils.ensureDirectoryExists(this.uploadDir);

      // Perform virus scan if enabled
      if (appConfig.virusScanning) {
        logger.debug(`[FILE-SERVICE] Performing virus scan`);
        const scanResult = await securityService.scanBuffer(fileData.buffer);
        logger.info(`[FILE-SERVICE] VIRUS SCAN result for ${originalFileName}: ${JSON.stringify(scanResult, null, 2)}`);

        if (scanResult.isInfected) {
          throw new Error(`File contains virus: ${scanResult.viruses}`);
        }
      }

      // Write file to disk (using buffer from memory storage)
      logger.debug(`[FILE-SERVICE]  Write file to disk: ${filePath}`);
      await fs.writeFile(filePath, fileData.buffer);

      // Get file stats to determine creation date
      const stats = await fs.stat(filePath);
      const createdDate = stats.birthtime;
      logger.debug(`[FILE-SERVICE] File creation date: ${createdDate}`);

      // Create file record in database
      const fileRecord = {
        file_id: fileId,
        file_name: originalFileName,
        file_size: fileData.size,
        file_type: mimeType,
        storage_path: filePath,
        file_hash: await fileUtils.getFileHash(filePath), // Optional: calculate hash if needed
        labels: fileInfo.labels,
        author: fileInfo.author,
        uploaded_date: new Date().toISOString(),
        created_date: createdDate,
        crawl_date: fileInfo.crawlDate || null,
        source_url: fileInfo.sourceUrl || '',
        language: detectedLang, // Use the final validated content language
        chunk_count: 0,
        dataprep: {
          status: 'Pending', // Use capitalized status per spec
          ingest_date: '',
          retract_date: ''
        }
      };

      try {
        await metadataService.addMetadata(filePath, fileRecord);
      } catch (error) {
        logger.error(`Failed to add metadata for file ${originalFileName}: ${error.message}`);
        // Cleanup file if metadata addition fails
        await fs.unlink(filePath);
      }

      return fileRecord;
    } catch (error) {
      logger.error(`Upload file FAILED. ${error}`);

      // Cleanup file if it exists
      if (
        filePath &&
        (await fs
          .access(filePath)
          .then(() => true)
          .catch(() => false))
      ) {
        try {
          await fs.unlink(filePath);
        } catch (cleanupError) {
          logger.error(`Error cleaning up file: ${cleanupError}`);
        }
      }

      throw error;
    }
  }

  async uploadLink(url, fileType = 'html') {
    // Use crawler to fetch content
    const crawler = new Crawler();
    const response = await crawler.fetch(url);
    if (!response) throw new Error('Failed to fetch URL');

    // 1. Parse HTML using Cheerio (Required for cleaning)
    const cheerio = require('cheerio');
    const $ = cheerio.load(response.data || response.text);

    // 2. [FIXED] Clean content (Match logic from crawlWorker.js)
    if (fileType === 'md') {
      $('script').remove();
      $('style').remove();
      $('nav').remove();
      $('footer').remove();
      $('header').remove();
      $('iframe').remove();
      $('noscript').remove();
      $('div[class*="cookie"]').remove();
      $('div[class*="privacy"]').remove();
      $('button').remove();

      // Fix relative links & images
      $('img, a').each((i, el) => {
        const attr = el.tagName === 'img' ? 'src' : 'href';
        const val = $(el).attr(attr);
        if (val && !val.startsWith('http') && !val.startsWith('data:') && !val.startsWith('#')) {
          try {
            $(el).attr(attr, new URL(val, url).href);
          } catch {
            // Ignore invalid URLs
          }
        }
      });
    }

    // 3. Extract Content
    const contentHtml = $('main').html() || $('article').html() || $('div.content').html() || $('body').html();

    // 4. Detect Language
    const language = crawler.getLanguage($.html());
    logger.info(`[FILE-SERVICE] Detected language tag: ${language}`);

    // 5. Generate Filename
    let pageTitle = $('title').text().trim() || 'untitled';
    pageTitle = pageTitle.replace(/[/\\?%*:|"<>]/g, '-').substring(0, 100) || 'untitled';

    // Include the domain in the filename so a search for the domain matches.
    let domain = 'web';
    try {
      domain = new URL(url).hostname;
    } catch {
      // Use default 'web' if URL is invalid
    }
    const title = `${domain}_${pageTitle}`;

    const ext = fileType === 'md' ? '.md' : '.html';
    const fileName = `${title}${ext}`;
    const filePath = path.join(this.uploadDir, fileName);

    let finalContent = contentHtml;

    // 6. Convert to Markdown if requested
    if (fileType === 'md') {
      const TurndownService = require('turndown');
      const turndownService = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced'
      });
      // Add Source Header
      finalContent = `## Source: ${url}\n\n${turndownService.turndown(contentHtml || '')}`;
    }

    await fileUtils.ensureDirectoryExists(this.uploadDir);
    await fs.writeFile(filePath, finalContent);

    // Prepare fileData object similar to multer
    const stats = await fs.stat(filePath);
    const fileData = {
      originalname: fileName,
      mimetype: fileType === 'md' ? 'text/markdown' : 'text/html',
      size: stats.size,
      buffer: Buffer.from(finalContent)
    };

    // Call uploadFile to handle security, metadata, etc.
    const fileInfo = {
      sourceUrl: url,
      labels: [],
      author: 'crawler',
      language: language,
      crawlDate: new Date().toISOString()
    };

    const uploadedFile = await this.uploadFile(fileData, fileInfo);

    // Stamp a synthetic crawl_job row so the dashboard reflects this crawl.
    try {
      const db = await this.getDb();
      const crawlJob = {
        _key: `job_${uploadedFile.file_id}`,
        file_id: uploadedFile.file_id,
        url: url,
        status: 'Succeeded', // It was synchronous and successful
        depth: 0,
        config: {
          followExternalLinks: false,
          maxExternalDepth: 0,
          singlePage: true
        },
        max_pages: 1,
        pages_crawled: 1,
        kill_requested: false,
        started_at: uploadedFile.uploaded_date,
        finished_at: new Date().toISOString(),
        error_message: null
      };
      await db.collection('crawl_job').save(crawlJob);
      logger.info(`[FILE-SERVICE] Created crawl_job record for single page: ${url}`);

      // Add log
      await this.addCrawlLog(uploadedFile.file_id, 'INFO', 'System', 'Single page crawl completed successfully.');
    } catch (e) {
      logger.warn(`[FILE-SERVICE] Failed to create crawl_job record: ${e.message}`);
    }

    // Delete the temp file
    try {
      await fs.unlink(filePath);
      logger.debug(`[FILE-SERVICE] Deleted temp file: ${filePath}`);
    } catch (err) {
      logger.warn(`[FILE-SERVICE] Failed to delete temp file: ${filePath} - ${err.message}`);
    }

    return uploadedFile;
  }

  // --- NEW ASYNCHRONOUS CRAWLER METHODS (Spec v1.5) ---

  /**
   * Schedules an asynchronous site crawl.
   * Creates a file stub and a crawl job record.
   * @param {string} url - The URL to crawl
   * @param {number} depth - The crawl depth
   * @param {Object} config - Advanced crawler configuration
   * @returns {Object} The created file record stub
   */
  async scheduleSiteCrawl(url, depth, config = {}) {
    const db = await this.getDb();
    const fileId = fileUtils.generateUniqueFileId();

    // Extract domain for filename
    let domain = 'unknown-site';
    try {
      domain = new URL(url).hostname;
    } catch {
      logger.warn(`[FILE-SERVICE] Could not parse hostname from ${url}`);
    }

    const fileName = `${domain}_full_crawl.md`;

    // 1. Create File Stub
    const fileRecord = {
      file_id: fileId,
      file_name: fileName,
      file_size: 0,
      file_type: 'text/markdown',
      storage_path: null,
      file_hash: null,
      labels: [],
      author: 'System Crawler',
      uploaded_date: new Date().toISOString(),
      created_date: new Date().toISOString(),
      crawl_date: new Date().toISOString(),
      source_url: url,
      language: null,
      chunk_count: 0,
      dataprep: {
        status: 'Pending',
        ingest_date: '',
        retract_date: ''
      }
    };

    // 2. Create Crawl Job (With Config)
    const crawlJob = {
      file_id: fileId,
      url: url,
      status: 'Pending',
      depth: depth,
      // Use defaults if config values aren't provided
      config: {
        followExternalLinks: config.followExternalLinks || false,
        maxExternalDepth: config.maxExternalDepth || 0,
        contentSelector: config.contentSelector || null,
        excludePatterns: config.excludePatterns || []
      },
      max_pages: appConfig.crawler.maxPages,
      pages_crawled: 0,
      kill_requested: false,
      started_at: new Date().toISOString(),
      finished_at: null,
      error_message: null
    };

    // Save to DB
    await db.collection('files').save(fileRecord);
    await db.collection('crawl_job').save(crawlJob);

    logger.info(
      `[FILE-SERVICE] Scheduled crawl for ${url} (ID: ${fileId}) with config: ${JSON.stringify(crawlJob.config)}`
    );
    return fileRecord;
  }

  /**
   * Get crawl job status by file ID
   * @param {string} fileId
   */
  async getCrawlJobByFileId(fileId) {
    const db = await this.getDb();
    const query = `
      FOR job IN crawl_job
      FILTER job.file_id == @fileId
      RETURN job
    `;
    const cursor = await db.query(query, { fileId });
    return await cursor.next();
  }

  /**
   * Get live crawl metrics by file ID
   * @param {string} fileId
   */
  async getCrawlMetrics(fileId) {
    const db = await this.getDb();
    const query = `
      FOR m IN crawl_metrics
      FILTER m.file_id == @fileId
      LIMIT 1
      RETURN m
    `;
    const cursor = await db.query(query, { fileId });
    return await cursor.next();
  }

  /**
   * Update (upsert) crawl metrics
   * @param {string} fileId
   * @param {Object} metrics
   */
  async updateCrawlMetrics(fileId, metrics) {
    const db = await this.getDb();
    // Use UPSERT to either insert or update
    const query = `
      UPSERT { file_id: @fileId }
      INSERT MERGE({ file_id: @fileId, timestamp: DATE_ISO8601(DATE_NOW()) }, @metrics)
      UPDATE MERGE({ timestamp: DATE_ISO8601(DATE_NOW()) }, @metrics)
      IN crawl_metrics
    `;
    await db.query(query, { fileId, metrics });
  }

  /**
   * Add a log entry for a crawl job
   */
  async addCrawlLog(fileId, level, stage, message) {
    const db = await this.getDb();
    const logEntry = {
      file_id: fileId,
      timestamp: new Date().toISOString(),
      level: level,
      stage: stage,
      message: message
    };
    await db.collection('crawl_log').save(logEntry);
  }

  /**
   * Get logs for a crawl job
   */
  async getCrawlLogs(fileId) {
    const db = await this.getDb();
    const query = `
      FOR log IN crawl_log
      FILTER log.file_id == @fileId
      SORT log.timestamp ASC
      RETURN log
    `;
    const cursor = await db.query(query, { fileId });
    return await cursor.all();
  }

  /**
   * Trigger kill signal for a crawl job
   */
  async killCrawlTask(fileId) {
    const db = await this.getDb();
    const query = `
      FOR job IN crawl_job
      FILTER job.file_id == @fileId
      UPDATE job WITH { kill_requested: true } IN crawl_job
    `;
    await db.query(query, { fileId });
    logger.info(`[FILE-SERVICE] Kill signal sent for job ${fileId}`);
  }

  /**
   * Get all files with pagination
   * MODIFIED: Performs a LEFT JOIN on crawl_job to include crawl status in the result
   * @param {Object} options - Query options
   * @returns {Object} Files list with pagination
   */
  async getFiles(options = {}) {
    try {
      const { page = 1, limit = 10, language, mimeType, search, dataprepStatus } = options;
      const offset = (page - 1) * limit;

      // Build query
      // Note: using subquery for the JOIN to be efficient and safe if no job exists
      let query = `
        FOR file IN files
        LET crawlJob = (
          FOR job IN crawl_job
          FILTER job.file_id == file.file_id
          LIMIT 1
          RETURN job
        )[0]
      `;

      const bindVars = {};

      // Add filters
      const filters = [];
      if (language) {
        filters.push('file.language == @language');
        bindVars.language = language;
      }
      if (mimeType) {
        filters.push('file.file_type == @mimeType');
        bindVars.mimeType = mimeType;
      }
      if (search) {
        // Match against filename AND source_url so domain searches still hit.
        filters.push(
          '(CONTAINS(LOWER(file.file_name), LOWER(@search)) OR CONTAINS(LOWER(file.source_url), LOWER(@search)))'
        );
        bindVars.search = search;
      }
      if (dataprepStatus) {
        // Use case-insensitive matching for status
        filters.push('LOWER(file.dataprep.status) == LOWER(@status)');
        bindVars.status = dataprepStatus;
      }

      if (filters.length > 0) {
        query += ` FILTER ${filters.join(' AND ')}`;
      }

      // Sort by file_id DESC — chronologically generated, sidesteps the UTC
      // / timezone confusion that bit us when sorting by uploaded_date.
      query += ' SORT file.file_id DESC';

      query += ` LIMIT ${offset}, ${limit}`;
      // MERGE the file with the found crawlJob (if any)
      query += ' RETURN MERGE(file, { crawl_job: crawlJob })';

      // Execute query
      const db = await this.getDb();
      const cursor = await db.query(query, bindVars);
      const files = await cursor.all();

      // Get total count for pagination
      let countQuery = 'FOR file IN files';
      if (filters.length > 0) {
        countQuery += ` FILTER ${filters.join(' AND ')}`;
      }
      countQuery += ' COLLECT WITH COUNT INTO totalCount RETURN totalCount';

      const countCursor = await db.query(countQuery, bindVars);
      const totalCount = (await countCursor.next()) || 0;

      return {
        files,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
          totalFiles: totalCount,
          limit
        }
      };
    } catch (error) {
      logger.error(`Error getting files: ${error}`);
      throw error;
    }
  }

  /**
   * Delete file by ID
   * MODIFIED: Added cleanup for crawl_job, crawl_log, and crawl_metrics
   * @param {string} fileId - File ID
   * @returns {boolean} Success status
   */
  async deleteFile(fileId) {
    try {
      // Get file record
      const file = await metadataService.getMetadataById(fileId);
      if (!file) {
        throw new Error(`File record not found in database: ${fileId}`);
      }

      // prepare file path for deletion
      const fileExtension = path.extname(file.file_name).slice(1);
      const fileNameOnDisk = file.file_id + '.' + fileExtension;
      const filePath = file.storage_path || path.join(this.uploadDir, fileNameOnDisk); // Use stored path if available (crawler), else construct it

      // Check if file exists on disk
      try {
        await fs.access(filePath);
        logger.info(`File found on disk: ${filePath}`);
      } catch {
        logger.warn(`File not found on disk: ${filePath}`);
        // Do not throw error here, allow metadata deletion even if file is missing
      }

      // Delete metadata first and keep a backup
      let deletedMetadata = false;
      let metadataBackup = null;
      try {
        metadataBackup = { ...file }; // Create a backup of the metadata
        deletedMetadata = await metadataService.deleteMetadata(fileId);
        logger.info(`Metadata deleted for file ${fileId}`);
      } catch (error) {
        logger.error(`Failed to delete metadata for file ${fileId}: ${error.message}`);
        throw new Error(`Failed to delete metadata for file ${fileId}`, { cause: error });
      }

      // --- NEW: Clean up crawl job, logs, and metrics if they exist ---
      const db = await this.getDb();
      try {
        await db.query('FOR job IN crawl_job FILTER job.file_id == @id REMOVE job IN crawl_job', { id: fileId });
        await db.query('FOR log IN crawl_log FILTER log.file_id == @id REMOVE log IN crawl_log', { id: fileId });
        await db.query('FOR m IN crawl_metrics FILTER m.file_id == @id REMOVE m IN crawl_metrics', { id: fileId });
        logger.debug(`Cleaned up crawl logs, jobs, and metrics for ${fileId}`);
      } catch (e) {
        logger.warn(`Failed to cleanup crawl data for ${fileId}: ${e.message}`);
        // Proceed, as main file is deleted
      }
      // -----------------------------------------------------

      // Delete the physical file from disk if it exists
      try {
        await fs.unlink(filePath);
        logger.info(`File deleted from disk: ${filePath}`);
        await this._unlinkFileFromAiTwins(fileId);
        return true;
      } catch (error) {
        if (error.code === 'ENOENT') {
          logger.warn(`Physical file was already missing, but metadata deleted: ${filePath}`);
          await this._unlinkFileFromAiTwins(fileId);
          return true; // Consider success if metadata is gone and file was already gone
        }
        logger.error(`File metadata deleted but failed to delete physical file: ${error.message}`);
        // attempt to restore metadata if file deletion fails
        if (deletedMetadata && metadataBackup) {
          try {
            // We can't restore perfectly without the file, but we can restore metadata
            await metadataService.addMetadata(filePath, metadataBackup);
            logger.info(`Metadata restored for file ${fileId} after file delete failure`);
          } catch (restoreError) {
            logger.error(`Failed to restore metadata for file ${fileId}: ${restoreError.message}`);
            return false; // Return false if restoration fails
          }
        }
        return false; // Return false if file deletion fails
      }
    } catch (error) {
      logger.error(`Error deleting file: ${error}`);
      throw error;
    }
  }

  /**
   * Search files
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Array} Search results
   */
  async searchFiles(query, options = {}) {
    try {
      const { limit = 10, mimeType } = options;

      // Build search query against actual schema fields
      let searchQuery = `
        FOR file IN files
        FILTER (CONTAINS(LOWER(file.file_name), LOWER(@query))
            OR CONTAINS(LOWER(file.source_url), LOWER(@query))
            OR CONTAINS(LOWER(file.author), LOWER(@query)))
      `;

      const bindVars = { query };

      if (mimeType) {
        searchQuery += ' AND file.file_type == @mimeType';
        bindVars.mimeType = mimeType;
      }

      searchQuery += ' SORT file.file_id DESC';
      searchQuery += ` LIMIT ${parseInt(limit, 10)}`;
      searchQuery += ' RETURN file';

      // Execute search
      const db = await this.getDb();
      const cursor = await db.query(searchQuery, bindVars);
      const results = await cursor.all();

      return results;
    } catch (error) {
      logger.error(`Error searching files: ${error}`);
      throw error;
    }
  }

  /**
   * Get file statistics
   * @returns {Object} File statistics
   */
  async getFileStats() {
    try {
      const db = await this.getDb();
      const stats = await db
        .query(
          `
        RETURN {
          totalFiles: COUNT(FOR file IN files RETURN 1),
          totalSize: SUM(FOR file IN files RETURN file.file_size || 0),
          filesByType: (
            FOR file IN files
            COLLECT mimeType = file.file_type WITH COUNT INTO count
            RETURN { mimeType, count }
          )
        }
      `
        )
        .then((cursor) => cursor.next());
      return stats;
    } catch (error) {
      logger.error(`Error getting file stats: ${error}`);
      throw error;
    }
  }

  /**
   * Add an ingestion log entry to the ingestion_log collection
   * @param {string} fileId - The ID of the file
   * @param {Object} logData - { level, stage, message }
   * @returns {Object} The saved log entry
   */
  async addIngestionLog(fileId, logData) {
    try {
      const db = await this.getDb();
      const logEntry = {
        file_id: fileId,
        timestamp: new Date().toISOString(),
        level: logData.level,
        stage: logData.stage,
        message: logData.message
      };

      const result = await db.collection('ingestion_log').save(logEntry, { returnNew: true });
      logger.debug(`[FILE-SERVICE] Ingestion log added for ${fileId}: ${logData.message}`);
      return result.new;
    } catch (error) {
      logger.error(`Error adding ingestion log for file ${fileId}: ${error}`);
      throw error;
    }
  }

  /**
   * Get all ingestion logs for a file, sorted by timestamp
   * @param {string} fileId - The ID of the file
   * @returns {Array} List of log entries
   */
  async getIngestionLogs(fileId) {
    try {
      const db = await this.getDb();
      const query = `
        FOR log IN ingestion_log
        FILTER log.file_id == @fileId
        SORT log.timestamp ASC
        RETURN log
      `;
      const cursor = await db.query(query, { fileId });
      const logs = await cursor.all();
      return logs;
    } catch (error) {
      logger.error(`Error getting ingestion logs for file ${fileId}: ${error}`);
      throw error;
    }
  }
}

module.exports = new FileService();
