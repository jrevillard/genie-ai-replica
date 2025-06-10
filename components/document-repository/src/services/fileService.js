const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');
const { logger } = require('../shared-lib/logger');
const dbService = require('../shared-lib/db-connection-service');

// NOTE: securityService is not implemented yet
// - securityService is not implemented yet
// - dataprepClient is not implemented yet
// - securityService is not implemented yet

// Import services
// const securityService = require('./securityService');
// const dataprepClient = require('./dataprepClient');

// Import utils
const appConfig = require('../config/appConfig');

class FileService {
  constructor() {
    this.uploadDir = path.join(__dirname, '..', '..', appConfig.upload.uploadDir || 'uploads');
    this.allowedMimeTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/markdown',
      'text/html',
      'text/plain'
    ];
  }

  /**
   * Get database connection for files
   */
  async getDb() {
    return await dbService.getConnection('files');
  }

  /**
   * Extract metadata from a file
   * @param {string} filePath - Path to the file
   * @param {string} mimeType - MIME type of the file
   * @returns {Object} Extracted metadata
   */
  async extractMetadata(filePath, mimeType) {
    try {
      const stats = await fs.stat(filePath);
      const metadata = {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        accessed: stats.atime,
        type: mimeType,
        extension: path.extname(filePath).toLowerCase().slice(1)
      };

      // TODO: [LOW] Implement metadata extraction for more file types
      // - currently only support pdf extraction to get page count
      
      // Extract additional metadata based on file type
      switch (mimeType) {
        // pdf file
        case 'application/pdf':
          metadata.pageCount = await this.extractPdfPageCount(filePath);
          break;
        // word processing file
        case 'application/msword':
        case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
          metadata.wordCount = 0; //await this.extractWordCount(filePath);
          break;
        // spreadsheet file
        case 'application/vnd.ms-excel':
        case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
          metadata.sheetCount = 0; //await this.extractExcelSheetCount(filePath);
          break;
        // text file, markdown file, html file
        case 'text/plain':
        case 'text/markdown':
        case 'text/html':
          metadata.lineCount = 0; //await this.extractLineCount(filePath);
          metadata.wordCount = 0; //await this.extractWordCount(filePath);
          break;
      }

      return metadata;
    } catch (error) {
      logger.error(`Error extracting metadata: {error}`);
      return {
        size: 0,
        type: mimeType,
        extension: path.extname(filePath).toLowerCase().slice(1),
        error: 'Failed to extract metadata'
      };
    }
  }

  // TODO: [LOW] It's still not working
  // - doc.numPages returns null

  /**
   * Extract page count from PDF file
   * @private
   */
  async extractPdfPageCount(filePath) {
    try {
      const pdfjs = require('pdfjs-dist');
      const data = await fs.readFile(filePath);
      logger.debug(`File data length: ${data.length}`);
      logger.debug(`File data type: ${data.constructor.name}`);
      // Convert Buffer to Uint8Array
      const uint8Array = new Uint8Array(data);
      logger.debug(`Uint8Array length: ${uint8Array.length}`);
      const doc = await pdfjs.getDocument(uint8Array).promise;
      logger.debug(`PDF page count: ${doc.numPages}`);
      return doc.numPages;
    } catch (error) {
      logger.warn(`Failed to extract PDF page count: {error}`);
      return null;
    }
  }

  /**
   * Extract word count from text-based files
   * @private
   */
  async extractWordCount(filePath) {
    return null;
  }

  /**
   * Extract line count from text files
   * @private
   */
  async extractLineCount(filePath) {
    return null;
  }

  /**
   * Extract sheet count from Excel files
   * @private
   */
  async extractExcelSheetCount(filePath) {
    return null;
  }

  /**
   * Upload and process a file
   * @param {Object} fileData - File data from multer
   * @param {Object} fileInfo - Additional information about the file (provided by the user)
   * @returns {Object} File record
   */
  async uploadFile(fileData, fileInfo = {}) {
    logger.debug(`[FILE-SERVICE] uploadFile`);
    logger.debug(`[FILE-SERVICE] Uploading file: ${fileData}`);

    let filePath;
    try {
      // Generate unique file ID
      const fileId = uuidv4();
      const originalName = fileData.originalname;
      const fileExtension = path.extname(originalName);
      const fileName = `${fileId}${fileExtension}`;
      filePath = path.join(this.uploadDir, fileName);
      logger.info(`[FILE-SERVICE] Generate unique file ID: ${fileName}`);

      // Validate file type
      const mimeType = mime.lookup(originalName) || fileData.mimetype;
      if (!this.allowedMimeTypes.includes(mimeType)) {
        throw new Error(`File type ${mimeType} is not allowed`);
      }

      // TODO: [NORMAL] Move size to config
      // Validate file size (default: 50MB)
      const maxFileSize = appConfig.maxFileSize || 50 * 1024 * 1024;
      if (fileData.size > maxFileSize) {
        throw new Error(`File size exceeds maximum allowed size of ${maxFileSize} bytes`);
      }

      // Ensure upload directory exists
      logger.debug(`[FILE-SERVICE]  Ensure upload directory exists: ${this.uploadDir}`);
      await fs.mkdir(this.uploadDir, { recursive: true });

      // Write file to disk (using buffer from memory storage)
      logger.debug(`[FILE-SERVICE]  Write file to disk: ${filePath}`);
      await fs.writeFile(filePath, fileData.buffer);

      // TODO: [HIGH] Implement virus scan
      // Perform virus scan if enabled
      // if (appConfig.virusScanning) {
      //   const scanResult = await securityService.scanFile(filePath);
      //   if (!scanResult.clean) {
      //     // Delete infected file
      //     await fs.unlink(filePath);
      //     throw new Error(`File contains virus: ${scanResult.virus}`);
      //   }
      // }

      // Extract metadata
      const extractedMetadata = await this.extractMetadata(filePath, mimeType);

      // Create file record in database
      const fileRecord = {
        _key: fileId,
        id: fileId,
        originalName,
        fileName,
        filePath,
        mimeType,
        size: fileData.size,
        uploadedAt: new Date().toISOString(),
        metadata: {
          ...extractedMetadata
        },
        status: 'uploaded',
        processed: false, // indicate if the file has been processed by data prep service
        tags: fileInfo.tags || [],
        description: fileInfo.description || '',
        category: fileInfo.category || 'general'
      };

      // Save to database
      const db = await this.getDb();
      await db.collection('files').save(fileRecord);
      logger.info(`File record saved to database: ${fileId}: ${fileRecord.id}`);

      // Index for search if enabled
      if (appConfig.searchIndexing) {
        await this.indexFileForSearch(fileRecord);
      }

      return fileRecord;
    } catch (error) {
      logger.error(`Error uploading file: ${error}`);
      
      // Cleanup file if it exists
      if (filePath) {
        try {
          await fs.unlink(filePath);
        } catch (cleanupError) {
          logger.error(`Error cleaning up file: ${cleanupError}`);
        }
      }
      
      throw error;
    }
  }

  /**
   * Get file by ID
   * @param {string} fileId - File ID
   * @returns {Object} File record
   */
  async getFileById(fileId) {
    try {
      const db = await this.getDb();
      const file = await db.collection('files').document(fileId);
      return file;
    } catch (error) {
      if (error.code === 404) {
        throw new Error('File not found');
      }
      throw error;
    }
  }

  /**
   * Get all files with pagination
   * @param {Object} options - Query options
   * @returns {Object} Files list with pagination
   */
  async getFiles(options = {}) {
    try {
      const { page = 1, limit = 10, category, mimeType, search } = options;
      const offset = (page - 1) * limit;

      // Build query
      let query = 'FOR file IN files';
      const bindVars = {};

      // Add filters
      const filters = [];
      if (category) {
        filters.push('file.category == @category');
        bindVars.category = category;
      }
      if (mimeType) {
        filters.push('file.mimeType == @mimeType');
        bindVars.mimeType = mimeType;
      }
      if (search) {
        filters.push('CONTAINS(LOWER(file.originalName), LOWER(@search)) OR CONTAINS(LOWER(file.description), LOWER(@search))');
        bindVars.search = search;
      }

      if (filters.length > 0) {
        query += ` FILTER ${filters.join(' AND ')}`;
      }

      query += ' SORT file.uploadedAt DESC';
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
      const file = await this.getFileById(fileId);
      
      // Delete physical file
      const filePath = path.join(this.uploadDir, file.fileName);
      try {
        await fs.unlink(filePath);
      } catch (error) {
        logger.warn(`Physical file not found or already deleted: ${filePath}`);
      }

      // Delete from database
      const db = await this.getDb();
      await db.collection('files').remove(fileId);
      logger.info(`File deleted from database: ${fileId}`);

      // Remove from search index if enabled
      if (appConfig.searchIndexing) {
        await this.removeFromSearchIndex(fileId);
      }

      return true;
    } catch (error) {
      logger.error(`Error deleting file: ${error}`);
      throw error;
    }
  }

  /**
   * Process a file (sending file to data prep service)
   * @param {string} fileId - ID of the file to process
   * @returns {Promise<Object>} Processing result
   */
  async processFile(fileId) {
    try {
      const db = await this.getDb();
      const fileRecord = await db.collection('files').firstExample({ id: fileId });
      
      if (!fileRecord) {
        throw new Error(`File not found: ${fileId}`);
      }

      // Check if file exists
      try {
        await fs.access(fileRecord.filePath);
      } catch (error) {
        throw new Error(`File not found on disk: ${fileRecord.filePath}`);
      }

      // TODO: [HIGH] Send file to data prep service
      // - send file to data prep service
      // - wait for data prep service to process the file
 
      // Update file record
      const updates = {
        processed: true,
        processedAt: new Date().toISOString(),
      };

      await db.collection('files').update(fileRecord._key, updates);
      logger.info(`File processed successfully: ${fileId}`);

      return {
        ...fileRecord,
        ...updates
      };
    } catch (error) {
      logger.error(`Error processing file: ${error}`);
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