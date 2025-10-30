const fs = require('fs').promises;
const path = require('path');
const mime = require('mime-types');
const { logger } = require('../../../shared/lib/logger');
const dbService = require('../../../shared/lib/db-connection-service');
const fileUtils = require('../utils/fileUtils');
const metadataService = require('./metadataService');
const Crawler = require('../utils/crawler'); // having a crawler utility to fetch webpage content
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
   * Extracts text content from a file buffer based on MIME type
   * @param {Buffer} buffer - File buffer
   * @param {string} mimeType - File MIME type
   * @returns {string} Extracted text
   */
  async _extractText(buffer, mimeType) {
    try {
      if (mimeType === 'application/pdf') {
        const data = await pdf(buffer);
        const text = data.text || '';
        logger.info(`[FILE-SERVICE] pdf-parse extracted ${text.length} characters. Start of text: "${text.substring(0, 200).replace(/\s+/g, ' ')}..."`);
        return text;
      }
      if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const { value } = await mammoth.extractRawText({ buffer });
        const text = value || '';
        logger.info(`[FILE-SERVICE] mammoth extracted ${text.length} characters. Start of text: "${text.substring(0, 200).replace(/\s+/g, ' ')}..."`);
        return text;
      }
      if (mimeType.startsWith('text/')) {
        const text = buffer.toString('utf-8');
        logger.info(`[FILE-SERVICE] Text file extracted ${text.length} characters.`);
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
    if (!text || text.trim().length < 20) { // Don't detect on very short strings
      logger.warn(`[FILE-SERVICE] Language detection skipped: Text is too short (${text ? text.length : 0} chars)`);
      return null;
    }
    
    logger.info(`[FILE-SERVICE] Detecting language from text (first 200 chars): "${text.substring(0, 200).replace(/\s+/g, ' ')}..."`);
    
    try {
      // **FIX:** Use detectOne() which is more robust and returns a simple string or throws an error.
      const langCode = langdetect.detectOne(text); 
      
      if (langCode) {
        logger.info(`[FILE-SERVICE] Language_detect result: ${langCode}`);
        return langCode;
      }

      // This should not be reachable, as detectOne throws on failure
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
      if (ingestionTypes.includes(mimeType)) {
        logger.info(`[FILE-SERVICE] Performing language detection for ${originalFileName}`);
        const text = await this._extractText(fileData.buffer, mimeType);
        detectedLang = this._detectLanguage(text);

        logger.info(`[FILE-SERVICE] Language detected: ${detectedLang} (Required: ${requiredLanguage})`);

        // **Stricter logic**
        // Block if language is NOT detected (null) OR if it is the wrong language.
        if (!detectedLang || detectedLang.toLowerCase() !== requiredLanguage) {
          const langFound = detectedLang || 'unknown'; // Handle null for the error message
          throw new Error(`File [${originalFileName}] appears to be in [${langFound}]. Only [${requiredLanguage.toUpperCase()}] documents are supported for ingestion.`);
        }
      }

      // Generate unique file ID
      const fileId = fileUtils.generateUniqueFileId();
      const savedFileName = `${fileId}${fileExtension}`;
      filePath = path.join(this.uploadDir, savedFileName);
      logger.info(`[FILE-SERVICE] Save file ${originalFileName} into ${savedFileName}`);

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
      logger.info(`[FILE-SERVICE]  Ensure upload directory exists: ${this.uploadDir}`);
      await fileUtils.ensureDirectoryExists(this.uploadDir);

      // Perform virus scan if enabled
      if (appConfig.virusScanning) {
        logger.info(`[FILE-SERVICE] Performing virus scan`);
        const scanResult = await securityService.scanBuffer(fileData.buffer);
        logger.info(`[FILE-SERVICE] VIRUS SCAN result for ${originalFileName}: ${JSON.stringify(scanResult, null, 2)}`);

        if (scanResult.isInfected) {
          throw new Error(`File contains virus: ${scanResult.viruses}`);
        }
      }

      // Write file to disk (using buffer from memory storage)
      logger.info(`[FILE-SERVICE]  Write file to disk: ${filePath}`);
      await fs.writeFile(filePath, fileData.buffer);

      // Get file stats to determine creation date
      const stats = await fs.stat(filePath);
      const createdDate = stats.birthtime;
      logger.info(`[FILE-SERVICE] File creation date: ${createdDate}`);
      
      // Create file record in database
      const fileRecord = {
        file_id: fileId,
        file_name: originalFileName,
        file_size: fileData.size,
        file_type: mimeType,
        storage_path : filePath,
        file_hash: await fileUtils.getFileHash(filePath), // Optional: calculate hash if needed
        labels: fileInfo.labels,
        author: fileInfo.author,
        uploaded_date: new Date().toISOString(),
        created_date: createdDate,
        crawl_date: fileInfo.crawlDate || null,
        source_url: fileInfo.sourceUrl || '',
        language: detectedLang || fileInfo.language || '', // Use detected language
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
      if (filePath && await fs.access(filePath).then(() => true).catch(() => false)) {
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

    let content = response.data || response.text;

    const language = crawler.getLanguage(content);

    // Save content to a temp file
    let title = crawler.getTitle(content) || 'untitled';
    title = title.replace(/[\/\\?%*:|"<>]/g, '-').substring(0, 100) || 'untitled';

    if (title === 'untitled') {
      try {
        const { hostname, pathname } = new URL(url);
        // Use hostname and last path segment as fallback
        const pathPart = pathname.split('/').filter(Boolean).pop() || 'index';
        title = `${hostname}-${pathPart}`;
      } catch {
        title = 'untitled-webpage';
      }
    }

    const ext = fileType === 'md' ? '.md' : '.html'; //if fileType is 'md' then use .md else use .html
    const fileName = `${title}${ext}`;
    const filePath = path.join(this.uploadDir, fileName);

    if (fileType === 'md') {
      // Optionally convert HTML to Markdown here
      const TurndownService = require('turndown');
      const turndownService = new TurndownService();
      content = turndownService.turndown(content);
    }

    await fileUtils.ensureDirectoryExists(this.uploadDir);
    await fs.writeFile(filePath, content);

    // Prepare fileData object similar to multer
    const stats = await fs.stat(filePath);
    const fileData = {
      originalname: fileName,
      mimetype: fileType === 'md' ? 'text/markdown' : 'text/html',
      size: stats.size,
      buffer: Buffer.from(content)
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

    // Delete the originally downloaded html file
    try {
      await fs.unlink(filePath);
      logger.debug(`[FILE-SERVICE] Deleted temp file: ${filePath}`);
    } catch (err) {
      logger.warn(`[FILE-SERVICE] Failed to delete temp file: ${filePath} - ${err.message}`);
    }

    return uploadedFile;
  }


  /**
   * Get all files with pagination
   * @param {Object} options - Query options
   * @returns {Object} Files list with pagination
   */
  async getFiles(options = {}) {
    try {
      const { page = 1, limit = 10, language, mimeType, search, dataprepStatus} = options;
      const offset = (page - 1) * limit;

      // Build query
      let query = 'FOR file IN files';
      const bindVars = {};

      // Add filters
      const filters = [];
      if (language) {
        filters.push('file.language == @language');
        bindVars.category = category;
      }
      if (mimeType) {
        filters.push('file.file_type == @mimeType');
        bindVars.mimeType = mimeType;
      }
      if (search) {
        filters.push('CONTAINS(LOWER(file.file_name), LOWER(@search))');
        bindVars.search = search;
      }
      if (dataprepStatus) {
        const status = dataprepStatus.toLowerCase();
        // Adjust for capitalized status in DB if needed, but spec implies lowercase search
        filters.push('LOWER(file.dataprep.status) == @status');
        bindVars.status = status;
      }

      if (filters.length > 0) {
        query += ` FILTER ${filters.join(' AND ')}`;
      }

      query += ' SORT file.upload_date DESC';
      query += ` LIMIT ${offset}, ${limit}`;
      query += ' RETURN file';

      // Execute query
      const db = await this.getDb();
      const cursor = await db.query(query, bindVars);
      const files = await cursor.all();

      // Get total count
      const countQuery = 'RETURN LENGTH(files)';
      const totalCount = await db.query(countQuery).then(cursor => cursor.next());

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
      logger.error(`Error getting files: $ {error}`);
      throw error;
    }
  }


  /**
   * Delete file by ID
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
      const filePath = path.join(this.uploadDir, fileNameOnDisk);

      // Check if file exists on disk
      try {
        await fs.access(filePath);
        logger.info(`File found on disk: ${filePath}`);
      } catch (error) {
        logger.warn(`File not found on disk: ${filePath}`);
        throw new Error(`File not found on disk: ${filePath}`);
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
        throw new Error(`File deleted but failed to delete metadata for file ${fileId}`);
      }

      // Delete the physical file from disk
      try {
        await fs.unlink(filePath);
        logger.info(`File deleted from disk: ${filePath}`);
        return true;
      } catch (error) {
        logger.error(`File deleted from metadata but failed to delete physical file: ${error.message}`);
        // attempt to restore metadata if file deletion fails
        if (deletedMetadata && metadataBackup) {
          try {
            await metadataService.addMetadata(filePath, metadataBackup);
            logger.info(`Metadata restored for file ${fileId}`);
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
      const { limit = 10, category, mimeType } = options;

      // Build search query
      let searchQuery = `
        FOR file IN files
        FILTER CONTAINS(LOWER(file.originalName), LOWER(@query)) 
            OR CONTAINS(LOWER(file.description), LOWER(@query))
            OR CONTAINS(LOWER(file.metadata.content), LOWER(@query))
      `;

      const bindVars = { query };

      // Add additional filters
      if (category) {
        searchQuery += ' AND file.category == @category';
        bindVars.category = category;
      }
      if (mimeType) {
        searchQuery += ' AND file.mimeType == @mimeType';
        bindVars.mimeType = mimeType;
      }

      searchQuery += ' SORT BM25(file) DESC';
      searchQuery += ` LIMIT ${limit}`;
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
      const stats = await db.query(`
        RETURN {
          totalFiles: LENGTH(files),
          totalSize: SUM(files[*].size),
          filesByType: (
            FOR file IN files
            COLLECT mimeType = file.mimeType WITH COUNT INTO count
            RETURN { mimeType, count }
          ),
          filesByCategory: (
            FOR file IN files
            COLLECT category = file.category WITH COUNT INTO count
            RETURN { category, count }
          )
        }
      `).then(cursor => cursor.next());
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