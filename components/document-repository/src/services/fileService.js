const fs = require('fs').promises;
const path = require('path');
const mime = require('mime-types');
const { logger } = require('../shared-lib/logger');
const dbService = require('../shared-lib/db-connection-service');
const fileUtils = require('../utils/fileUtils');
const metadataService = require('./metadataService');
const Crawler = require('../utils/crawler'); // having a crawler utility to fetch webpage content


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
   * Upload and process a file
   * @param {Object} fileData - File data from multer
   * @param {Object} fileInfo - Additional information about the file (provided by the user)
   * @returns {Object} File record
   */
  async uploadFile(fileData, fileInfo = {}) {
    
    let filePath;
    try {
      // Generate unique file ID
      const fileId = fileUtils.generateUniqueFileId();
      const originalFileName = fileData.originalname;
      const fileExtension = path.extname(originalFileName).toLowerCase();
      const savedFileName = `${fileId}${fileExtension}`;
      filePath = path.join(this.uploadDir, savedFileName);
      logger.debug(`[FILE-SERVICE] Save file ${originalFileName} into ${savedFileName}`);

      // Validate file type & extension
      const mimeType = mime.lookup(originalFileName) || fileData.mimetype;
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

      // TODO: Review Fix createdDate
      // - Currently it is the date when the file was written to the disk in the server
      // - expected: the date when the file was created on the client side
      // - limitation: HTTP file uploads don't preserve filesystem metadata
      // - option 1: current solution, use the date when the file was written to the disk in the server
      // - option 2: frontend should provide the created_date by extracting it from the file metadata

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
        storage_path : filePath,
        file_hash: await fileUtils.getFileHash(filePath), // Optional: calculate hash if needed
        labels: fileInfo.labels,
        author: fileInfo.author,
        uploaded_date: new Date().toISOString(),
        created_date: createdDate,
        crawl_date: fileInfo.crawlDate || null,
        source_url: fileInfo.sourceUrl || '',
        language: fileInfo.language || '',
        chunk_count: 0,
        dataprep: {
          status: 'pending',
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
        filters.push('file.dataprep.status == @status');
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
}

module.exports = new FileService();